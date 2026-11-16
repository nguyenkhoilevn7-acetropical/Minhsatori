/**
 * Grok owner connector: ledger writes, limited to what ChatGPT can already do
 * through the EXISTING production Apps Script BotApi (no new ledger function):
 *
 *  trash    satori_order_trash_request/confirm      -> orders.delete  (30-day trash bin, restorable)
 *  restore  satori_order_restore_request/confirm    -> orders.restore (out of that trash bin)
 *  update   satori_order_update_request/confirm     -> orders.update  (unpaid invoices only, edit log)
 *  undo     satori_order_undo_update_request/confirm-> orders.undoUpdate (the latest edit only)
 *  pay_*    satori_payment_request/confirm          -> payments.markCustomerPaid / markCustomerUnpaid /
 *                                                      markSatoriPaid / markSatoriUnpaid
 * There is NO "cancel" here: production has no orders.cancel (ChatGPT cannot set
 * "Đã hủy" either); the owner does that in the app.
 *
 * Request: reads the exact invoice, applies the ledger's own refusals (updates are
 * dry-run through production orders.previewUpdate), stores a 30-minute PostgreSQL
 * request and returns a summary. NOTHING is written to the ledger.
 * Confirm: row lock (one dispatcher), fresh re-read, ONE signed ledger call with
 * the request's fixed requestId (BotApi replays it: a second confirm never acts
 * twice), exact readback. Disabled unless GROK_OWNER_WRITES_ENABLED=1.
 * All ledger calls use the isolated V2 WRITER key (never the read key).
 */
import crypto from 'node:crypto';
import {GrokOrderError,grokOrdersEnabled} from './grok-orders.mjs';
import {exactOrder,trashEntry,isActive,brief,vnd,auditHistory} from './grok-ledger-read.mjs';
import {norm} from './grok-search.mjs';
import {ledgerRelayConfig} from './canonical-ledger-relay.mjs';

export const WRITE_TTL_MINUTES=30;
export const WRITE_ACTOR='grok-owner-connector';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bad=(code,message)=>{throw new GrokOrderError(code,message)};
const need=(ok,code,message)=>{if(!ok)bad(code,message)};
const TABLE='satori_v2_grok_write_requests';
const PAY_CHANGES={
 customer_paid:{kind:'pay_customer_paid',action:'payments.markCustomerPaid',flag:'customer',to:true,label:'GHI NHẬN KHÁCH ĐÃ THANH TOÁN'},
 customer_unpaid:{kind:'pay_customer_unpaid',action:'payments.markCustomerUnpaid',flag:'customer',to:false,label:'BỎ GHI NHẬN KHÁCH ĐÃ THANH TOÁN'},
 satori_paid:{kind:'pay_satori_paid',action:'payments.markSatoriPaid',flag:'satori',to:true,label:'GHI NHẬN ĐÃ THANH TOÁN SATORI'},
 satori_unpaid:{kind:'pay_satori_unpaid',action:'payments.markSatoriUnpaid',flag:'satori',to:false,label:'BỎ GHI NHẬN ĐÃ THANH TOÁN SATORI'}};
const PAY_BY_KIND=Object.fromEntries(Object.entries(PAY_CHANGES).map(([change,v])=>[v.kind,{...v,change}]));
const TOOL={
 mark_paid:{request:'satori_order_mark_paid_request',confirm:'satori_order_mark_paid_confirm'},
 trash:{request:'satori_order_trash_request',confirm:'satori_order_trash_confirm'},
 restore:{request:'satori_order_restore_request',confirm:'satori_order_restore_confirm'},
 update:{request:'satori_order_update_request',confirm:'satori_order_update_confirm'},
 undo:{request:'satori_order_undo_update_request',confirm:'satori_order_undo_update_confirm'},
 pay:{request:'satori_payment_request',confirm:'satori_payment_confirm'}};
const toolOf=kind=>TOOL[PAY_BY_KIND[kind]?'pay':kind];
const KINDS={
 mark_paid:{prefix:'grokflags-',label:'CẬP NHẬT THANH TOÁN'},
 trash:{prefix:'groktrash-',action:'orders.delete',label:'XÓA (đưa vào thùng rác)'},
 restore:{prefix:'grokrestore-',action:'orders.restore',label:'KHÔI PHỤC từ thùng rác'},
 update:{prefix:'grokupdate-',action:'orders.update',label:'SỬA'},
 undo:{prefix:'grokundo-',action:'orders.undoUpdate',label:'HOÀN TÁC LẦN SỬA'},
 ...Object.fromEntries(Object.values(PAY_BY_KIND).map(v=>[v.kind,{prefix:'grokpay-',action:v.action,label:v.label}]))};
/** Actions the writer relay may sign: the production actions above + the two read-only helpers it needs. */
export const WRITER_ACTIONS=Object.freeze(['orders.delete','orders.restore','orders.update','orders.undoUpdate',
 'orders.previewUpdate','orders.get','payments.markCustomerPaid','payments.markCustomerUnpaid',
 'payments.markSatoriPaid','payments.markSatoriUnpaid']);

const writesOn=env=>need(grokOrdersEnabled(env),'WRITES_DISABLED',
 'Quyền ghi của Grok đang tắt (GROK_OWNER_WRITES_ENABLED). Chưa ghi gì.');
const customerPaid=o=>o.customerPaid===true||!!o.customerPaidAt||String(o.status)==='Đã thanh toán';
const satoriPaid=o=>o.satoriPaid===true||!!o.satoriPaidAt||String(o.status)==='Đã TT Satori';
const hasPayment=o=>customerPaid(o)||satoriPaid(o);
const text=(v,max)=>String(v==null?'':v).replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max);

/** Production refusals, checked at request AND again at confirm. */
export function refusalFor(kind,o){
 const no='#'+Number(o.invoiceNo);
 if(kind==='trash'||kind==='update'||kind==='undo'){
  if(kind!=='trash'&&!isActive(o))return ['NOT_COUNTED','Hóa đơn '+no+' đang "'+o.status+'"; không sửa được.'];
  if(hasPayment(o))return ['PAID_ORDER_PROTECTED','Hóa đơn '+no+' đã ghi nhận thanh toán ('+(satoriPaid(o)?'đã TT Satori':'khách đã trả')+'). '+
   (kind==='trash'?'Không xóa':'Chỉ sửa được hóa đơn chưa thanh toán')+': nếu cần, bỏ ghi nhận thanh toán trước rồi yêu cầu lại.'];
  if(o.pairGroupId||o.pairRole||o.pairInvoiceNo)return ['PAIRED_ORDER_LOCKED','Hóa đơn '+no+' thuộc cặp CTV; không '+(kind==='trash'?'xóa':'sửa')+' riêng một hóa đơn của cặp.'];
  return null;
 }
 const pay=PAY_BY_KIND[kind];
 if(pay||kind==='mark_paid'){
  if(!isActive(o))return ['NOT_COUNTED','Hóa đơn '+no+' đang "'+o.status+'"; không ghi nhận thanh toán.'];
  if(o.pairRole==='collaborator')return ['CTV_INTERNAL_NOT_RECEIVABLE','Hóa đơn '+no+' là bill CTV nội bộ, chỉ để đối soát; không ghi nhận thanh toán khách.'];
  if(!pay)return null;
  const now=pay.flag==='customer'?customerPaid(o):satoriPaid(o);
  if(now===pay.to)return ['ALREADY_SET','Hóa đơn '+no+' đã ở đúng trạng thái này rồi; không cần làm gì.'];
 }
 return null;
}

const itemLine=i=>'  - '+text(i.product||i.name,80)+' x'+Number(i.qty)+(i.inputUnitPrice!=null||i.unitPrice!=null?
 ' @ '+vnd(Math.round(Number(i.inputUnitPrice??i.unitPrice)))+(i.priceMode?' ('+(i.priceMode==='inclusive'?'gồm VAT':'chưa VAT')+')':''):'');
export function writeSummary(kind,o,reason,extra={}){
 const b=brief(o);
 const lines=['YÊU CẦU '+KINDS[kind].label+' HÓA ĐƠN (chưa thực hiện)',
  'Hóa đơn #'+b.invoiceNo+(b.date?' · '+b.date:''),
  'Khách: '+b.name+(b.location?' — '+b.location:''),
  'Tổng hiện tại: '+vnd(b.total)+' · Trạng thái: '+(b.status||'Chưa thanh toán'),
  'Lý do: '+reason];
 if(kind==='trash')lines.push('XÓA: hóa đơn chuyển vào Thùng Rác 30 ngày (giống nút Xóa trong app), biến khỏi danh sách và công nợ, '+
  'khôi phục được trong 30 ngày. Không xóa vĩnh viễn.');
 if(kind==='restore')lines.push('KHÔI PHỤC: hóa đơn trở lại danh sách với đúng dữ liệu và trạng thái thanh toán cũ'+
  (extra.expiresAt?' (thùng rác giữ tới '+new Date(extra.expiresAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})+')':'')+'.');
 if(kind==='update'){
  const a=extra.after||{};
  lines.push('SAU KHI SỬA (sổ đã tính thử, chưa ghi):',
   'Khách: '+text(a.name,150)+(a.location?' — '+text(a.location,200):'')+(a.phone?' · '+text(a.phone,30):''),
   ...(Array.isArray(a.items)?a.items.slice(0,50).map(itemLine):[]),
   'Phí giao: '+vnd(Number(a.shippingAmount||0))+' · VAT: '+vnd(Number(a.vatAmount||0)),
   'Tổng mới: '+vnd(Number(a.total))+' (cũ '+vnd(b.total)+')');
 }
 if(kind==='undo'){
  const t=extra.target||{};
  lines.push('HOÀN TÁC lần sửa '+text(t.requestId,100)+(t.timestamp?' lúc '+new Date(t.timestamp).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'')+
   (t.reason?' (lý do lúc sửa: '+text(t.reason,200)+')':''),
   'Hóa đơn trở về đúng nội dung trước lần sửa đó. Tổng sau hoàn tác: '+vnd(Number(t.before?.total))+' (hiện tại '+vnd(b.total)+').');
 }
 const pay=PAY_BY_KIND[kind];
 if(pay)lines.push(pay.label+': '+(pay.change==='customer_paid'?'ghi nhận khách đã trả đủ '+vnd(b.total)+' cho hóa đơn này (không chuyển tiền thật).':
  pay.change==='customer_unpaid'?'hóa đơn quay lại "khách chưa trả"; dữ liệu thanh toán cũ được giữ trong lịch sử thanh toán.':
  pay.change==='satori_paid'?'ghi nhận đã thanh toán cho Satori (không chuyển tiền thật).':
  'bỏ ghi nhận đã thanh toán Satori; dữ liệu cũ được giữ trong lịch sử thanh toán.'));
 if(kind==='mark_paid')lines.push('Trước: '+JSON.stringify(extra.payment.before),'Sau: '+JSON.stringify({...extra.payment.before,...extra.payment.desired}),
  'Chứng từ: '+reason,'paidAt (chỉ lưu audit V2, sổ dùng thời gian máy chủ): '+(extra.payment.paidAt||'hiện tại'));
 lines.push('Yêu cầu hết hạn sau '+WRITE_TTL_MINUTES+' phút.');
 return lines.join('\n');
}

/**
 * Signed ledger calls through the SAME isolated V2 writer key/endpoint as order
 * creation (never the read key). Only WRITER_ACTIONS. Upstream refusal codes
 * and their fixed Vietnamese BotApi messages are kept for the owner.
 */
export function createOwnerWriteRelay({env=process.env,fetcher=fetch,now=()=>Date.now(),
 generateNonce=()=>crypto.randomBytes(18).toString('hex')}={}){
 const cfg=ledgerRelayConfig(env);
 async function send(action,payload){
  need(WRITER_ACTIONS.includes(action),'LEDGER_ACTION_DENIED','Lệnh không được phép.');
  const timestamp=now(),nonce=generateNonce();
  const message=[cfg.keyId,timestamp,nonce,action,JSON.stringify(payload)].join('\n');
  const signature=crypto.createHmac('sha256',cfg.secret).update(message,'utf8').digest('hex');
  let body;
  try{
   const res=await fetcher(cfg.endpoint,{method:'POST',redirect:'follow',headers:{'content-type':'application/json'},
    signal:AbortSignal.timeout(15000),body:JSON.stringify({keyId:cfg.keyId,timestamp,nonce,action,payload,signature})});
   if(!res?.ok)throw Error('HTTP');
   const raw=await res.text();if(raw.length>200_000)throw Error('LARGE');
   body=JSON.parse(raw);
  }catch{const e=Error('LEDGER_NETWORK_OR_TIMEOUT');e.code='LEDGER_NETWORK_OR_TIMEOUT';throw e}
  if(body?.ok===true&&body.action===action&&Number.isSafeInteger(body.revision))return body;
  const up=String(body?.error?.code||'');
  const code={REVISION_CONFLICT:'LEDGER_REVISION_CONFLICT',INVALID_ACTION:'LEDGER_ACTION_NOT_DEPLOYED',FORBIDDEN:'LEDGER_SCOPE_MISSING',
   INVALID_ORDER:'TARGET_GONE',TRASH_NOT_FOUND:'TARGET_GONE',REUSED_REQUEST_ID:'LEDGER_REQUEST_ID_CONFLICT',
   REQUEST_ID_CONFLICT:'LEDGER_REQUEST_ID_CONFLICT',AUTH_FAILED:'LEDGER_SCOPE_MISSING'}[up]||
   (/^[A-Z][A-Z0-9_]{2,40}$/.test(up)?up:'LEDGER_UPSTREAM_REJECTED');
  const e=Error(code);e.code=code;
  e.upstreamMessage=text(body?.error?.message,200);
  throw e;
 }
 return Object.freeze({send});
}
function relayOf(relayFactory){
 try{return relayFactory()}catch{bad('WRITER_NOT_READY','Máy chủ chưa bật khóa ghi V2; chưa làm gì.')}
}
/** Business message for a refusal coming back from the ledger (fixed BotApi text). */
function ledgerRefusal(e,prefix){
 if(e instanceof GrokOrderError)throw e;
 const code=e?.code||'ERROR';
 if(code==='LEDGER_ACTION_NOT_DEPLOYED'||code==='LEDGER_SCOPE_MISSING')
  bad('WRITER_NOT_READY','Khóa ghi V2 chưa được cấp quyền cho thao tác này trong Apps Script (chủ cửa hàng cấp). Chưa làm gì.');
 if(code==='LEDGER_NETWORK_OR_TIMEOUT')bad('LEDGER_UNAVAILABLE','Chưa liên lạc được sổ; chưa làm gì. Thử lại sau.');
 bad(code,prefix+(e?.upstreamMessage?': '+e.upstreamMessage:'')+' ('+code+'). Chưa làm gì.');
}

/* ---------- update helpers ---------- */
const DRAFT_KEYS=['name','phone','location','deliveryDate','deliveryNote','shippingAmount','vatRate','vatMode','vatAmount','total','priceMode','items'];
/** Owner's change on top of the current raw invoice: only fields Grok gives are replaced; items must be complete. */
export function buildDraft(raw,change){
 need(change&&typeof change==='object'&&!Array.isArray(change)&&JSON.stringify(change).length<=20000,'INVALID_ORDER','order không hợp lệ.');
 const extra=Object.keys(change).filter(k=>!DRAFT_KEYS.includes(k));
 need(!extra.length,'INVALID_ORDER','order có trường không hỗ trợ: '+extra.join(', '));
 need(['inclusive','exclusive'].includes(change.priceMode),'PRICE_MODE_REQUIRED',
  'Cần priceMode: "inclusive" (đơn giá đã gồm VAT) hoặc "exclusive" (chưa VAT), giống ChatGPT.');
 need(Array.isArray(change.items)&&change.items.length>=1&&change.items.length<=50,'INVALID_ORDER',
  'Cần đủ danh sách dòng hàng sau khi sửa (1-50 dòng), kể cả dòng không đổi.');
 const draft={name:raw.name,phone:raw.phone||'',location:raw.location||'',deliveryDate:raw.deliveryDate||undefined,
  deliveryNote:raw.deliveryNote||'',shippingAmount:Number(raw.shippingAmount||0),
  ...(raw.vatRate!=null?{vatRate:raw.vatRate}:{}),...(raw.vatMode?{vatMode:raw.vatMode}:{})};
 for(const k of DRAFT_KEYS)if(change[k]!==undefined)draft[k]=change[k];
 if(draft.deliveryDate===undefined)delete draft.deliveryDate;
 // Never drop VAT silently: an invoice that carries VAT must say which rate the edit uses.
 need(!(Number(raw.vatAmount||0)>0&&draft.vatRate==null&&draft.vatMode!=='per_line'),'VAT_RATE_REQUIRED',
  'Hóa đơn hiện có VAT '+vnd(Number(raw.vatAmount))+': cần ghi rõ vatRate (ví dụ 8) hoặc vatMode per_line, nếu không VAT sẽ mất.');
 // Production requires a numeric invoice rate with priceMode; an invoice without VAT stays at 0%.
 if(draft.vatRate==null)draft.vatRate=0;
 return draft;
}

/* ---------- request ---------- */
async function locate(kind,reader,ref,pool){
 if(kind==='restore'){
  const t=await trashEntry(reader,ref);
  return {revision:t.revision,order:t.order,expiresAt:t.expiresAt};
 }
 return exactOrder(reader,ref,pool);
}
async function lastEdit(reader,ref,pool){
 const h=await auditHistory(reader,ref,pool);
 return Array.isArray(h.entries)?h.entries:[];
}

export async function requestWrite(kind,pool,reader,args={},env=process.env,relayFactory=null){
 writesOn(env);
 need(Object.prototype.hasOwnProperty.call(KINDS,kind),'UNKNOWN_TOOL','Thao tác không tồn tại.');
 const reason=kind==='mark_paid'?text(args.proofNote,300)||'Chủ duyệt bỏ ghi nhận thanh toán':text(args.reason,300);
 need(reason.length>=3,'REASON_REQUIRED','Cần lý do (3-300 ký tự).');
 const ref={invoiceNo:args.invoiceNo,orderId:kind==='mark_paid'?args.id:args.orderId};
 const found=await locate(kind,reader,ref,pool);
 const o=found.order;
 if(kind!=='restore'){const r=refusalFor(kind,o);if(r)bad(...r)}
 const extra={...found};let payload=null;
 if(kind==='mark_paid'){
  need(Number.isSafeInteger(args.invoiceNo)&&Number.isFinite(args.expectedTotal)&&typeof args.expectedName==='string'&&
   args.expectedName.trim().length>=2&&args.expectedName.length<=150,'INVALID_REQUEST','Cần số bill, tên và tổng chính xác.');
  need(args.id===undefined||String(o.id)===String(args.id),'ORDER_NOT_FOUND','ID không khớp số bill.');
  need(norm(o.name)===norm(args.expectedName)&&Number(o.total)===args.expectedTotal,'ORDER_CHANGED','Tên hoặc tổng bill không khớp.');
  const desired={};
  for(const flag of ['customerPaid','satoriPaid'])if(args[flag]!==undefined){
   need(typeof args[flag]==='boolean','INVALID_REQUEST',flag+' phải là true/false.');desired[flag]=args[flag];
  }
  need(Object.keys(desired).length,'INVALID_REQUEST','Cần ít nhất một cờ thanh toán.');
  need(!Object.values(desired).includes(true)||(typeof args.proofNote==='string'&&args.proofNote.trim().length>=3&&args.proofNote.length<=300),
   'PROOF_REQUIRED','Đánh dấu đã trả cần proofNote (3-300 ký tự).');
  if(args.proofNote!==undefined)need(typeof args.proofNote==='string'&&args.proofNote.trim().length>=3&&args.proofNote.length<=300,'PROOF_REQUIRED','proofNote cần 3-300 ký tự.');
  need(args.paidAt===undefined||(typeof args.paidAt==='string'&&Number.isFinite(Date.parse(args.paidAt))),'INVALID_REQUEST','paidAt không hợp lệ.');
  const before=paymentSnapshot(o);
  need(Object.entries(desired).some(([k,v])=>before[k]!==v),'ALREADY_SET','Bill đã đúng trạng thái, không cần đổi.');
  payload={desired,before,proofNote:reason,paidAt:args.paidAt??null};
  extra.payment=payload;
 }

 if(kind==='update'){
  const relay=relayOf(relayFactory);
  let raw;
  try{raw=(await relay.send('orders.get',{invoiceNo:Number(o.invoiceNo),id:String(o.id)})).data.order}
  catch(e){ledgerRefusal(e,'Không đọc được hóa đơn để sửa')}
  need(raw&&String(raw.id)===String(o.id),'LEDGER_UNAVAILABLE','Chưa đọc được hóa đơn; chưa làm gì.');
  const draft=buildDraft(raw,args.order);
  let preview;
  try{preview=await relay.send('orders.previewUpdate',{expectedRevision:found.revision,
   requestId:'grokpreview-'+crypto.randomBytes(12).toString('hex'),invoiceNo:Number(o.invoiceNo),id:String(o.id),
   expectedName:String(o.name||''),expectedTotal:Number(o.total),confirmed:true,reason,order:draft})}
  catch(e){ledgerRefusal(e,'Sổ không chấp nhận nội dung sửa')}
  extra.after=preview?.data?.order;
  need(extra.after&&Number.isFinite(Number(extra.after.total)),'LEDGER_UNAVAILABLE','Sổ chưa tính thử được; chưa làm gì.');
  payload={order:draft,afterTotal:Number(extra.after.total)};
 }
 if(kind==='undo'){
  const undoOf=text(args.undoRequestId,100);
  need(/^[A-Za-z0-9_-]{8,100}$/.test(undoOf),'INVALID_REQUEST','Cần undoRequestId: mã requestId của lần sửa cần hoàn tác (xem satori_order_audit_history).');
  const entries=await lastEdit(reader,{invoiceNo:Number(o.invoiceNo),orderId:String(o.id)},pool);
  const target=entries.find(e=>e&&e.requestId===undoOf);
  need(target&&target.before&&target.after,'UNDO_UNAVAILABLE','Không thấy lần sửa '+undoOf+' (kèm ảnh chụp trước/sau) của hóa đơn #'+Number(o.invoiceNo)+'.');
  need(entries[entries.length-1]?.requestId===undoOf,'REQUEST_SUPERSEDED','Chỉ hoàn tác được lần sửa GẦN NHẤT của hóa đơn này.');
  extra.target=target;payload={undoRequestId:undoOf};
 }
 const id=crypto.randomUUID();
 const requestId=KINDS[kind].prefix+id.replace(/-/g,'');
 const summary=writeSummary(kind,o,reason,extra);
 const r=await pool.query('INSERT INTO '+TABLE+'(id,kind,request_id,invoice_no,ledger_id,expected_name,expected_total,'+
  'reason,summary,requested_by,expires_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+make_interval(mins=>$11),$12) RETURNING expires_at',
  [id,kind,requestId,Number(o.invoiceNo),String(o.id),String(o.name||''),String(o.total??0),reason,summary.slice(0,4000),WRITE_ACTOR,WRITE_TTL_MINUTES,
   payload==null?null:JSON.stringify(payload)]);
 return {requestId:id,kind,written:false,invoiceNo:Number(o.invoiceNo),expiresAt:r.rows[0]?.expires_at??null,summary,
  instruction:'Gửi nguyên văn summary cho chủ cửa hàng. CHỈ khi chủ cửa hàng trả lời "ok" trong một tin nhắn mới '+
   'mới gọi '+toolOf(kind).confirm+' với requestId này. Chưa có gì thay đổi.'};
}

/* ---------- confirm ---------- */
async function setState(pool,id,status,note,done=false,revision=null){
 await pool.query('UPDATE '+TABLE+' SET status=$2,last_note=$3,updated_at=now()'+
  (done?',done_at=coalesce(done_at,now())':'')+(Number.isSafeInteger(revision)?',ledger_revision='+revision:'')+' WHERE id=$1',
  [id,status,note==null?null:String(note).slice(0,200)]);
}
const FINAL=new Set(['PAID_ORDER_PROTECTED','ORDER_CHANGED','PAIRED_ORDER_LOCKED','NOT_COUNTED','ORDER_AMBIGUOUS',
 'LEDGER_REQUEST_ID_CONFLICT','TRASH_EXPIRED','RESTORE_CONFLICT','TARGET_GONE','TRASH_AMBIGUOUS','REQUEST_SUPERSEDED',
 'UNDO_UNAVAILABLE','CTV_INTERNAL_NOT_RECEIVABLE','PAYMENT_AUDIT_FULL','TOTAL_MISMATCH','PRODUCT_DISCONTINUED',
 'PRICE_MODE_REQUIRED','PER_LINE_VAT_REQUIRED','INVALID_ITEM','INVALID_TAX_RATE','LINE_VAT_MISMATCH','VAT_MISMATCH',
 'INVALID_AMOUNT','REASON_REQUIRED','CONFIRMATION_REQUIRED','LEDGER_UPSTREAM_REJECTED','ALREADY_SET']);
const doneMessage={
 mark_paid:no=>'Đã cập nhật cờ thanh toán hóa đơn #'+no+'.',
 trash:no=>'Đã chuyển hóa đơn #'+no+' vào Thùng Rác (khôi phục được trong 30 ngày). Không còn trong danh sách và công nợ.',
 restore:no=>'Đã khôi phục hóa đơn #'+no+' từ Thùng Rác về danh sách, giữ nguyên trạng thái thanh toán cũ.',
 update:no=>'Đã sửa hóa đơn #'+no+' (nhật ký sửa lưu trước/sau; hoàn tác được bằng satori_order_undo_update_request).',
 undo:no=>'Đã hoàn tác lần sửa của hóa đơn #'+no+' về nội dung trước đó.',
 pay_customer_paid:no=>'Đã ghi nhận khách đã thanh toán hóa đơn #'+no+'.',
 pay_customer_unpaid:no=>'Đã bỏ ghi nhận khách đã thanh toán hóa đơn #'+no+' (lịch sử thanh toán vẫn giữ).',
 pay_satori_paid:no=>'Đã ghi nhận đã thanh toán Satori cho hóa đơn #'+no+'.',
 pay_satori_unpaid:no=>'Đã bỏ ghi nhận đã thanh toán Satori cho hóa đơn #'+no+' (lịch sử thanh toán vẫn giữ).'};
const doneReply=(row,duplicate)=>({ok:true,state:'DONE',kind:row.kind,duplicate:!!duplicate,invoiceNo:Number(row.invoice_no),
 message:doneMessage[row.kind](Number(row.invoice_no))+(duplicate?' (Đã làm từ trước bằng chính yêu cầu này; không làm lần hai.)':'')});
const rowPayload=row=>row.payload==null?{}:typeof row.payload==='string'?JSON.parse(row.payload):row.payload;

/** Ledger state of the target: 'before' (action still needed), 'after' (done) or 'gone'. */
async function observe(kind,reader,row){
 const ref={invoiceNo:Number(row.invoice_no),orderId:String(row.ledger_id)};
 const inOrders=await exactOrder(reader,ref).catch(e=>{if(e?.code==='ORDER_NOT_FOUND')return null;throw e});
 if(kind==='update'||kind==='undo'){
  if(!inOrders)return {state:'gone'};
  const entries=await lastEdit(reader,ref);
  return {state:entries.some(e=>e&&e.requestId===row.request_id)?'after':'before',...inOrders};
 }
 const pay=PAY_BY_KIND[kind];
 if(pay){
  if(!inOrders)return {state:'gone'};
  const now=pay.flag==='customer'?customerPaid(inOrders.order):satoriPaid(inOrders.order);
  return {state:now===pay.to?'after':'before',...inOrders};
 }
 const inTrash=await trashEntry(reader,ref).catch(e=>{if(['TRASH_NOT_FOUND','TRASH_EXPIRED'].includes(e?.code))return null;throw e});
 if(kind==='trash'){
  if(inOrders)return {state:'before',...inOrders};
  return {state:inTrash?'after':'gone',...(inTrash||{})};
 }
 if(inTrash&&inOrders)bad('RESTORE_CONFLICT','Số hóa đơn #'+Number(row.invoice_no)+' vừa có trong danh sách vừa có trong Thùng Rác; không ghi đè.');
 if(inTrash)return {state:'before',...inTrash};
 return {state:inOrders?'after':'gone',...(inOrders||{})};
}
function ledgerPayload(kind,row,revision){
 const base={expectedRevision:revision,invoiceNo:Number(row.invoice_no),id:String(row.ledger_id),
  expectedName:String(row.expected_name),expectedTotal:Number(row.expected_total),confirmed:true};
 const p=rowPayload(row);
 if(kind==='trash'||kind==='restore')return {...base,requestId:row.request_id};
 if(kind==='update')return {...base,requestId:row.request_id,reason:String(row.reason),order:p.order};
 if(kind==='undo')return {...base,requestId:row.request_id,undoRequestId:String(p.undoRequestId),reason:String(row.reason)};
 if(kind==='pay_customer_paid')return {...base,amount:Number(row.expected_total)};
 return {...base,requestId:row.request_id,reason:String(row.reason)};
}

export async function confirmWrite(kind,pool,reader,relayFactory,{requestId}={},env=process.env){
 writesOn(env);
 need(UUID.test(String(requestId||'')),'INVALID_REQUEST','requestId không hợp lệ.');
 const id=String(requestId).toLowerCase();
 const relay=relayOf(relayFactory);
 const client=await pool.connect();
 let row,previous;
 try{
  await client.query('BEGIN');
  const r=await client.query("SELECT *,expires_at<now() AS expired,updated_at<now()-interval '2 minutes' AS stale "+
   'FROM '+TABLE+' WHERE id=$1 FOR UPDATE',[id]);
  need(r.rows.length===1,'REQUEST_NOT_FOUND','Không tìm thấy yêu cầu.');
  row=r.rows[0];previous=row.status;
  const okKind=kind==='pay'?!!PAY_BY_KIND[row.kind]:row.kind===kind;
  need(okKind&&KINDS[row.kind],'WRONG_CONFIRM_TOOL','Yêu cầu này là "'+row.kind+'", phải xác nhận bằng '+
   (KINDS[row.kind]?toolOf(row.kind).confirm:'app')+'.');
  if(row.status==='done'){await client.query('COMMIT');return doneReply(row,true)}
  need(row.status!=='rejected','REQUEST_CLOSED','Yêu cầu đã bị từ chối ('+(row.last_note||'')+'). Tạo yêu cầu mới nếu cần.');
  if((row.status==='pending'||row.kind==='mark_paid')&&row.expired){
   await client.query("UPDATE "+TABLE+" SET status='expired',updated_at=now() WHERE id=$1",[id]);
   await client.query('COMMIT');
   bad('REQUEST_EXPIRED','Yêu cầu đã quá '+WRITE_TTL_MINUTES+' phút. Chưa làm gì; tạo yêu cầu mới.');
  }
  need(row.status!=='expired','REQUEST_EXPIRED','Yêu cầu đã hết hạn. Chưa làm gì; tạo yêu cầu mới.');
  need(row.status!=='submitting'||row.stale,'IN_PROGRESS','Yêu cầu đang được xử lý; đợi rồi gọi lại.');
  if(row.status==='submitting')previous='uncertain';
  await client.query("UPDATE "+TABLE+" SET status='submitting',confirmed_at=coalesce(confirmed_at,now()),"+
   'confirmed_by=$2,updated_at=now() WHERE id=$1',[id,WRITE_ACTOR]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
 finally{client.release()}

 kind=row.kind;
 if(kind==='mark_paid')return confirmPaymentFlags(pool,reader,relay,row);
 const confirmTool=toolOf(kind).confirm;
 const back=previous==='uncertain'?'uncertain':'pending';
 const no=Number(row.invoice_no);
 for(let attempt=0;attempt<2;attempt++){
  let seen;
  try{seen=await observe(kind,reader,row)}
  catch(e){
   if(e instanceof GrokOrderError&&FINAL.has(e.code)){await setState(pool,id,'rejected',e.code);throw e}
   await setState(pool,id,back,'READ_FAILED');
   bad('LEDGER_UNAVAILABLE','Chưa đọc được sổ; chưa làm gì. Gọi lại với cùng requestId.');
  }
  if(seen.state==='gone'){await setState(pool,id,'rejected','TARGET_GONE');
   bad('TARGET_GONE','Không còn thấy hóa đơn #'+no+(kind==='restore'?' trong Thùng Rác (đã khôi phục hoặc hết hạn).':' trong sổ.')+' Chưa làm gì.')}
  if(seen.state==='after'&&PAY_BY_KIND[kind]&&previous==='pending'){
   // Payment flags carry no requestId on the row: already in the target state before ANY attempt => done by someone else.
   await setState(pool,id,'rejected','DONE_BY_OTHER');
   return {ok:true,state:'ALREADY_DONE',kind,invoiceNo:no,message:'Hóa đơn #'+no+' đã ở đúng trạng thái này từ trước (không phải yêu cầu này). Không làm lần hai.'};
  }
  if(seen.state==='before'){
   const o=seen.order;
   if(norm(o.name)!==norm(row.expected_name)||Number(o.total)!==Number(row.expected_total)){
    await setState(pool,id,'rejected','ORDER_CHANGED');
    bad('ORDER_CHANGED','Hóa đơn #'+no+' đã thay đổi (tên/tổng) sau khi yêu cầu. Chưa làm gì; xem lại rồi tạo yêu cầu mới.');
   }
   if(kind!=='restore'){const r=refusalFor(kind,o);if(r){await setState(pool,id,'rejected',r[0]);bad(...r)}}
  }
  if(seen.state==='after'&&(kind==='update'||kind==='undo')){
   // The edit log already holds this exact requestId: it was applied (by an earlier attempt of this request).
   await setState(pool,id,'done',null,true);
   return doneReply(row,true);
  }
  if(seen.state==='after'&&PAY_BY_KIND[kind]){
   // Our own earlier attempt (lost reply) already set it.
   await setState(pool,id,'done',null,true);
   return doneReply(row,true);
  }
  // 'after' (update/undo/trash/restore) is still sent: BotApi replays the same requestId (duplicate).
  let result;
  try{result=await relay.send(KINDS[kind].action,ledgerPayload(kind,row,seen.revision))}
  catch(e){
   const code=e?.code||'ERROR';
   if(code==='LEDGER_REVISION_CONFLICT'&&attempt===0)continue; // nothing written; re-read and retry once
   if(seen.state==='after'&&['TARGET_GONE','RESTORE_CONFLICT','LEDGER_REQUEST_ID_CONFLICT'].includes(code)){
    await setState(pool,id,'rejected','DONE_BY_OTHER');
    return {ok:true,state:'ALREADY_DONE',kind,invoiceNo:no,
     message:'Hóa đơn #'+no+' đã được xử lý từ trước (không phải yêu cầu này). Không làm lần hai.'};
   }
   if(FINAL.has(code)){await setState(pool,id,'rejected',code);
    bad(code,'Sổ từ chối thao tác với hóa đơn #'+no+(e.upstreamMessage?': '+e.upstreamMessage:'')+' ('+code+'). Chưa làm gì.')}
   if(['LEDGER_ACTION_NOT_DEPLOYED','LEDGER_SCOPE_MISSING','LEDGER_REVISION_CONFLICT'].includes(code)){
    await setState(pool,id,back,code);
    bad(code==='LEDGER_REVISION_CONFLICT'?'RETRY':'WRITER_NOT_READY',code==='LEDGER_REVISION_CONFLICT'?
     'Sổ đang thay đổi liên tục; chưa làm gì. Gọi lại với cùng requestId.':
     'Khóa ghi V2 chưa được cấp quyền '+KINDS[kind].action+' trong Apps Script. Chưa làm gì.');
   }
   await setState(pool,id,'uncertain',code);
   return {ok:false,state:'UNCERTAIN',kind,message:'Chưa xác minh được kết quả. Gọi lại '+confirmTool+' với cùng requestId (an toàn, không làm hai lần).'};
  }
  try{
   const after=await observe(kind,reader,row);
   if(after.state==='after'){
    await setState(pool,id,'done',null,true,result?.revision);
    return doneReply(row,result?.data?.duplicate===true||result?.data?.alreadyApplied===true);
   }
  }catch{}
  await setState(pool,id,'uncertain','NO_READBACK');
  return {ok:false,state:'UNCERTAIN',kind,message:'Đã gửi lệnh nhưng chưa đọc lại được kết quả. Gọi lại '+confirmTool+' với cùng requestId.'};
 }
 await setState(pool,id,back,'REVISION_CONFLICT');
 return {ok:false,state:'RETRY',kind,message:'Sổ vừa thay đổi; chưa làm gì. Gọi lại với cùng requestId.'};
}

const paymentSnapshot=o=>({customerPaid:customerPaid(o),satoriPaid:satoriPaid(o)});
async function confirmPaymentFlags(pool,reader,relay,row){
 const p=rowPayload(row),completed=[];
 const save=()=>pool.query('UPDATE '+TABLE+' SET payload=$2::jsonb,updated_at=now() WHERE id=$1',[row.id,JSON.stringify(p)]);
 try{
  for(const flag of ['customerPaid','satoriPaid']){
   if(p.desired[flag]===undefined)continue;
   // Fresh revision for EVERY flag; never reuse the first write's revision.
   const {revision,order:o}=await exactOrder(reader,{invoiceNo:Number(row.invoice_no),orderId:String(row.ledger_id)});
   need(String(o.id)===String(row.ledger_id)&&norm(o.name)===norm(row.expected_name)&&Number(o.total)===Number(row.expected_total),
    'ORDER_CHANGED','Bill đã đổi tên/tổng; dừng thanh toán.');
   const refusal=refusalFor('mark_paid',o);if(refusal)bad(...refusal);
   if(p.applied?.[flag])need(paymentSnapshot(o)[flag]===p.desired[flag],'ORDER_CHANGED','Cờ đã ghi trước đó bị thay đổi; tạo yêu cầu mới.');
   if(paymentSnapshot(o)[flag]===p.desired[flag])continue;
   const key=(flag==='customerPaid'?'customer':'satori')+(p.desired[flag]?'_paid':'_unpaid');
   const action=PAY_CHANGES[key].action;
   const base={expectedRevision:revision,invoiceNo:Number(row.invoice_no),id:String(row.ledger_id),
    expectedName:row.expected_name,expectedTotal:Number(row.expected_total),confirmed:true};
   const payload=key==='customer_paid'?{...base,amount:Number(row.expected_total)}:
    {...base,reason:row.reason,requestId:row.request_id+'_'+(flag==='customerPaid'?'c':'s')};
   await relay.send(action,payload);
   const after=await exactOrder(reader,{invoiceNo:Number(row.invoice_no),orderId:String(row.ledger_id)});
   need(paymentSnapshot(after.order)[flag]===p.desired[flag],'NO_READBACK','Chưa xác minh được cờ vừa đổi.');
   completed.push(flag);
   p.applied={...p.applied,[flag]:true};
   p.after=paymentSnapshot(after.order);p.lastVerifiedAt=new Date().toISOString();await save();
  }
  const {order:o}=await exactOrder(reader,{invoiceNo:Number(row.invoice_no),orderId:String(row.ledger_id)});
  p.after=paymentSnapshot(o);
  need(Object.entries(p.desired).every(([k,v])=>p.after[k]===v),'NO_READBACK','Cờ thanh toán vừa thay đổi, cần kiểm tra lại.');
  await save();await setState(pool,row.id,'done',null,true);
  return doneReply(row,false);
 }catch(e){
  await setState(pool,row.id,'uncertain',e.code||'ERROR');
  return {ok:false,state:completed.length?'PARTIAL':'UNCERTAIN',completed,code:e.code||'ERROR',
   message:'Đã xác minh đổi: '+(completed.join(', ')||'chưa có cờ nào')+'. Phần còn lại lỗi ('+(e.code||'ERROR')+
    '). Không hoàn tác phần đã ghi. Kiểm tra rồi gọi lại satori_order_mark_paid_confirm với cùng requestId.'};
 }
}

/** Dry-run of an edit through production orders.previewUpdate on the WRITER key. Never writes. */
export async function previewUpdateWithWriter(reader,relayFactory,args={},pool=null){
 const reason=text(args.reason,300);
 need(reason.length>=3,'REASON_REQUIRED','Cần lý do sửa (3-300 ký tự).');
 const {revision,order:cur}=await exactOrder(reader,args,pool);
 const r=refusalFor('update',cur);if(r)bad(...r);
 const relay=relayOf(relayFactory);
 let raw,preview;
 try{raw=(await relay.send('orders.get',{invoiceNo:Number(cur.invoiceNo),id:String(cur.id)})).data.order}
 catch(e){ledgerRefusal(e,'Không đọc được hóa đơn để xem trước')}
 const draft=buildDraft(raw,args.order);
 try{preview=await relay.send('orders.previewUpdate',{expectedRevision:revision,
  requestId:'grokpreview-'+crypto.randomBytes(12).toString('hex'),invoiceNo:Number(cur.invoiceNo),id:String(cur.id),
  expectedName:String(cur.name||''),expectedTotal:Number(cur.total),confirmed:true,reason,order:draft})}
 catch(e){ledgerRefusal(e,'Sổ không chấp nhận nội dung sửa')}
 const after=preview?.data?.order||null;
 return {preview:true,written:false,ledgerRevision:preview?.revision??revision,before:brief(cur),after:after?brief(after):null,
  afterDetail:after,note:'Chỉ xem trước, KHÔNG ghi sổ. Muốn sửa thật: satori_order_update_request (cùng nội dung) rồi chờ chủ cửa hàng "ok".'};
}

/* ---------- MCP tool definitions ---------- */
const refProps={invoiceNo:{type:'integer',minimum:1,description:'Số hóa đơn (Hƒ)'},
 orderId:{type:['string','integer'],description:'Số hóa đơn hoặc ledgerId'},
 reason:{type:'string',minLength:3,maxLength:300,description:'Lý do, đúng lời chủ cửa hàng'}};
export const ORDER_CHANGE_SCHEMA={type:'object',required:['priceMode','items'],additionalProperties:false,
 description:'Nội dung hóa đơn SAU KHI SỬA (giống ChatGPT). items phải đủ mọi dòng, kể cả dòng không đổi. '+
  'Trường khách/giao hàng/VAT không gửi thì giữ nguyên như hóa đơn hiện tại.',
 properties:{priceMode:{type:'string',enum:['inclusive','exclusive'],description:'inclusive = đơn giá đã gồm VAT; exclusive = chưa VAT'},
  items:{type:'array',minItems:1,maxItems:50,items:{type:'object',required:['product','qty','unitPrice'],properties:{
   code:{type:'string'},product:{type:'string'},unit:{type:'string'},qty:{type:'integer',minimum:1},
   unitPrice:{type:'number',minimum:0},listPrice:{type:'number',minimum:0},discountPercent:{type:'number',minimum:0},
   vatRate:{type:'number'},vatExempt:{type:'boolean'}}}},
  name:{type:'string'},phone:{type:'string'},location:{type:'string'},deliveryDate:{type:'string',description:'YYYY-MM-DD'},
  deliveryNote:{type:'string'},shippingAmount:{type:'number',minimum:0},vatRate:{type:'number'},
  vatMode:{type:'string',enum:['invoice','per_line']},vatAmount:{type:'number'},total:{type:'number'}}};
const reqTool=(name,title,description,properties=refProps,required=['reason'])=>({name,title,description:description+
 ' KHÔNG ghi sổ. Gửi nguyên summary cho chủ cửa hàng và chờ họ trả lời "ok" trong tin nhắn mới.',
 inputSchema:{type:'object',required,additionalProperties:false,properties},
 annotations:{readOnlyHint:true,openWorldHint:false}});
const confTool=(name,title,description)=>({name,title,description:'CHỈ gọi sau khi chủ cửa hàng trả lời "ok". '+description+
 ' Gọi lại với cùng requestId không làm hai lần. Yêu cầu hết hạn sau 30 phút.',
 inputSchema:{type:'object',required:['requestId'],additionalProperties:false,properties:{requestId:{type:'string'}}},
 annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}});

export const GROK_WRITE_TOOLS=[
 reqTool(TOOL.mark_paid.request,'Minh Satori: yêu cầu đổi cờ thanh toán',
  'Đối chiếu chính xác bill, tên và tổng. Cờ bỏ trống giữ nguyên; proofNote bắt buộc khi đánh dấu đã trả.',
  {invoiceNo:refProps.invoiceNo,id:{type:['string','integer']},expectedName:{type:'string',minLength:2,maxLength:150},
   expectedTotal:{type:'number'},customerPaid:{type:'boolean'},satoriPaid:{type:'boolean'},
   proofNote:{type:'string',minLength:3,maxLength:300},paidAt:{type:'string',format:'date-time'}},['invoiceNo','expectedName','expectedTotal']),
 confTool(TOOL.mark_paid.confirm,'Minh Satori: xác nhận đổi cờ thanh toán','Đổi lần lượt hai cờ đã duyệt; báo riêng nếu chỉ thực hiện được một phần.'),

 {name:'satori_order_preview_update',title:'Minh Satori: xem trước sửa hóa đơn (không ghi)',
  description:'Sổ tính thử nội dung sửa của hóa đơn chưa thanh toán (giống ChatGPT) và trả trước/sau; tuyệt đối không ghi sổ. Cần lý do.',
  inputSchema:{type:'object',required:['reason','order'],additionalProperties:false,properties:{...refProps,order:ORDER_CHANGE_SCHEMA}},
  annotations:{readOnlyHint:true,openWorldHint:false}},
 reqTool(TOOL.trash.request,'Minh Satori: yêu cầu XÓA hóa đơn vào thùng rác (chưa xóa)',
  'Bước 1 XÓA: hóa đơn sẽ chuyển vào Thùng Rác 30 ngày như nút Xóa trong app, khôi phục được.'),
 confTool(TOOL.trash.confirm,'Minh Satori: xác nhận XÓA vào thùng rác','Chuyển hóa đơn vào Thùng Rác 30 ngày (không xóa vĩnh viễn).'),
 reqTool(TOOL.restore.request,'Minh Satori: yêu cầu KHÔI PHỤC hóa đơn từ thùng rác (chưa khôi phục)',
  'Bước 1 KHÔI PHỤC: tìm hóa đơn trong Thùng Rác (satori_trash_list) và lập yêu cầu.'),
 confTool(TOOL.restore.confirm,'Minh Satori: xác nhận KHÔI PHỤC từ thùng rác','Đưa hóa đơn từ Thùng Rác về danh sách, giữ trạng thái thanh toán cũ.'),
 reqTool(TOOL.update.request,'Minh Satori: yêu cầu SỬA hóa đơn (chưa sửa)',
  'Bước 1 SỬA hóa đơn chưa thanh toán (giống ChatGPT): sổ tính thử nội dung mới và trả trước/sau.',
  {...refProps,order:ORDER_CHANGE_SCHEMA},['reason','order']),
 confTool(TOOL.update.confirm,'Minh Satori: xác nhận SỬA hóa đơn','Ghi nội dung đã tính thử vào sổ; nhật ký sửa lưu trước/sau.'),
 reqTool(TOOL.undo.request,'Minh Satori: yêu cầu HOÀN TÁC lần sửa gần nhất (chưa hoàn tác)',
  'Bước 1 HOÀN TÁC: đưa hóa đơn về nội dung trước lần sửa gần nhất. Lấy undoRequestId trong satori_order_audit_history.',
  {...refProps,undoRequestId:{type:'string',minLength:8,maxLength:100,description:'requestId của lần sửa cần hoàn tác'}},['reason','undoRequestId']),
 confTool(TOOL.undo.confirm,'Minh Satori: xác nhận HOÀN TÁC lần sửa','Đưa hóa đơn về nội dung trước lần sửa đó.'),
 reqTool(TOOL.pay.request,'Minh Satori: yêu cầu cập nhật THANH TOÁN (chưa ghi)',
  'Bước 1 THANH TOÁN (giống ChatGPT): change = customer_paid (khách đã trả đủ), customer_unpaid (bỏ ghi nhận khách trả), '+
  'satori_paid (đã thanh toán Satori), satori_unpaid (bỏ ghi nhận Satori). Chỉ ghi nhận, không chuyển tiền.',
  {...refProps,change:{type:'string',enum:Object.keys(PAY_CHANGES)}},['reason','change']),
 confTool(TOOL.pay.confirm,'Minh Satori: xác nhận cập nhật THANH TOÁN','Ghi đúng thay đổi thanh toán đã yêu cầu vào sổ.')
];
export const GROK_WRITE_TOOL_NAMES=GROK_WRITE_TOOLS.map(t=>t.name);

/** deps: {reader, ownerWriteRelayFactory, env} */
export async function callGrokWriteTool(pool,deps,name,args={}){
 const env=deps.env||process.env,rf=deps.ownerWriteRelayFactory;
 if(name==='satori_order_preview_update')return previewUpdateWithWriter(deps.reader,rf,args,pool);
 if(name===TOOL.mark_paid.request)return requestWrite('mark_paid',pool,deps.reader,args,env,rf);
 if(name===TOOL.mark_paid.confirm)return confirmWrite('mark_paid',pool,deps.reader,rf,args,env);
 if(name===TOOL.pay.request){
  const change=PAY_CHANGES[String(args.change||'')];
  need(change,'INVALID_REQUEST','change phải là một trong: '+Object.keys(PAY_CHANGES).join(', ')+'.');
  const {change:_c,...rest}=args;
  return requestWrite(change.kind,pool,deps.reader,rest,env,rf);
 }
 if(name===TOOL.pay.confirm)return confirmWrite('pay',pool,deps.reader,rf,args,env);
 for(const kind of ['trash','restore','update','undo']){
  if(name===TOOL[kind].request)return requestWrite(kind,pool,deps.reader,args,env,rf);
  if(name===TOOL[kind].confirm)return confirmWrite(kind,pool,deps.reader,rf,args,env);
 }
 bad('UNKNOWN_TOOL','Công cụ không tồn tại.');
}
