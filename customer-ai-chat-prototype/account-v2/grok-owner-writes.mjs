/**
 * Grok owner connector: the ONLY ledger writes besides order creation.
 * Three separate operations, each request -> owner "ok" -> confirm:
 *
 *  cancel  (satori_order_cancel_request/confirm)
 *     Same meaning as the app's status "Đã hủy": the invoice STAYS in the
 *     system, its effective amount is 0 đ (the app and BotApi active() exclude
 *     it from debt, revenue, bill totals and profit). Lines and original total
 *     are kept for traceability. Ledger action orders.cancel (api/BotApiOrderCancel.gs).
 *  trash   (satori_order_trash_request/confirm)
 *     = "Xóa" in the app: moved into the EXISTING 30-day trash bin through the
 *     existing BotApi orders.delete (soft, restorable). Never a hard delete.
 *  restore (satori_order_restore_request/confirm)
 *     The existing BotApi orders.restore out of that trash bin.
 *
 * Request: reads the exact invoice, applies the ledger's own refusals, stores a
 * 30-minute PostgreSQL request and returns a summary. NOTHING is written to the
 * ledger. Confirm: row lock (one dispatcher), fresh re-read, ONE signed ledger
 * call with the request's fixed requestId (BotApi replays it: a second confirm
 * never acts twice), exact readback. Audit: who/when/reason in this table, plus
 * the ledger's own records (cancel audit / trash entry with the requestId).
 * Disabled unless GROK_OWNER_WRITES_ENABLED=1.
 */
import crypto from 'node:crypto';
import {GrokOrderError,grokOrdersEnabled} from './grok-orders.mjs';
import {exactOrder,trashEntry,isActive,brief,vnd} from './grok-ledger-read.mjs';
import {norm} from './grok-search.mjs';
import {ledgerRelayConfig} from './canonical-ledger-relay.mjs';

export const WRITE_TTL_MINUTES=30;
export const WRITE_ACTOR='grok-owner-connector';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bad=(code,message)=>{throw new GrokOrderError(code,message)};
const need=(ok,code,message)=>{if(!ok)bad(code,message)};
const TABLE='satori_v2_grok_write_requests';
const KINDS={
 cancel:{prefix:'grokcancel-',action:'orders.cancel',label:'HỦY',done:'Đã hủy'},
 trash:{prefix:'groktrash-',action:'orders.delete',label:'XÓA (đưa vào thùng rác)',done:'Đã chuyển vào thùng rác'},
 restore:{prefix:'grokrestore-',action:'orders.restore',label:'KHÔI PHỤC từ thùng rác',done:'Đã khôi phục'}
};
const writesOn=env=>need(grokOrdersEnabled(env),'WRITES_DISABLED',
 'Quyền ghi của Grok đang tắt (GROK_OWNER_WRITES_ENABLED). Chưa ghi gì.');
const hasPayment=o=>o.customerPaid===true||!!o.customerPaidAt||String(o.status)==='Đã thanh toán'||
 o.satoriPaid===true||!!o.satoriPaidAt||String(o.status)==='Đã TT Satori';

/**
 * Ledger refusals, checked at request AND again at confirm.
 * Paid invoices: the app has no credit-balance ("dư có") mechanism, and BotApi
 * orders.delete already refuses paid invoices, so Grok refuses both cancel and
 * trash for them and says why (the owner can still decide in the app).
 */
export function refusalFor(kind,o){
 const no='#'+Number(o.invoiceNo);
 if(kind==='cancel'){
  if(String(o.status)==='Đã hủy')return ['ALREADY_CANCELLED','Hóa đơn '+no+' đã ở trạng thái Đã hủy.'];
  if(!isActive(o))return ['NOT_COUNTED','Hóa đơn '+no+' đang "'+o.status+'", vốn đã không tính tiền.'];
 }
 if(hasPayment(o))return ['PAID_ORDER_PROTECTED','Hóa đơn '+no+' đã ghi nhận thanh toán ('+
  (o.satoriPaid||o.satoriPaidAt||o.status==='Đã TT Satori'?'đã TT Satori':'khách đã trả')+'). '+
  'Sổ không có cơ chế dư có/hoàn tiền nên Grok không '+(kind==='cancel'?'hủy':'xóa')+
  ': nếu cần, sửa trạng thái thanh toán trước trong app rồi yêu cầu lại.'];
 if(o.pairGroupId)return ['PAIRED_ORDER_LOCKED','Hóa đơn '+no+' thuộc cặp CTV; không '+(kind==='cancel'?'hủy':'xóa')+' riêng một hóa đơn của cặp.'];
 return null;
}

export function writeSummary(kind,o,reason,extra={}){
 const b=brief(o);
 const lines=['YÊU CẦU '+KINDS[kind].label+' HÓA ĐƠN (chưa thực hiện)',
  'Hóa đơn #'+b.invoiceNo+(b.date?' · '+b.date:''),
  'Khách: '+b.name+(b.location?' — '+b.location:''),
  'Tổng hiện tại: '+vnd(b.total)+' · Trạng thái: '+(b.status||'Chưa thanh toán'),
  'Lý do: '+reason];
 if(kind==='cancel')lines.push('HỦY: hóa đơn vẫn nằm trong hệ thống với trạng thái "Đã hủy", số tiền hiệu lực về 0 đ '+
  '(không cộng vào công nợ, tổng bill, doanh thu). Dòng hàng và tổng gốc '+vnd(b.total)+' được giữ để truy vết.');
 if(kind==='trash')lines.push('XÓA: hóa đơn chuyển vào Thùng Rác 30 ngày (giống nút Xóa trong app), biến khỏi danh sách và công nợ, '+
  'khôi phục được trong 30 ngày. Không xóa vĩnh viễn.');
 if(kind==='restore')lines.push('KHÔI PHỤC: hóa đơn trở lại danh sách với đúng dữ liệu và trạng thái thanh toán cũ'+
  (extra.expiresAt?' (thùng rác giữ tới '+new Date(extra.expiresAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})+')':'')+'.');
 lines.push('Yêu cầu hết hạn sau '+WRITE_TTL_MINUTES+' phút.');
 return lines.join('\n');
}

/** Current ledger location of the invoice for this kind: {order, revision} or a refusal. */
async function locate(kind,reader,ref,pool){
 if(kind==='restore'){
  const t=await trashEntry(reader,ref);
  return {revision:t.revision,order:t.order,expiresAt:t.expiresAt};
 }
 return exactOrder(reader,ref,pool);
}

export async function requestWrite(kind,pool,reader,args={},env=process.env){
 writesOn(env);
 const reason=String(args.reason||'').replace(/[\u0000-\u001f]/g,' ').trim();
 need(reason.length>=3&&reason.length<=300,'REASON_REQUIRED','Cần lý do (3-300 ký tự).');
 const found=await locate(kind,reader,{invoiceNo:args.invoiceNo,orderId:args.orderId},pool);
 const o=found.order;
 if(kind!=='restore'){const r=refusalFor(kind,o);if(r)bad(...r)}
 const id=crypto.randomUUID();
 const requestId=KINDS[kind].prefix+id.replace(/-/g,'');
 const summary=writeSummary(kind,o,reason,found);
 const r=await pool.query('INSERT INTO '+TABLE+'(id,kind,request_id,invoice_no,ledger_id,expected_name,expected_total,'+
  'reason,summary,requested_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+make_interval(mins=>$11)) RETURNING expires_at',
  [id,kind,requestId,Number(o.invoiceNo),String(o.id),String(o.name||''),String(o.total??0),reason,summary,WRITE_ACTOR,WRITE_TTL_MINUTES]);
 return {requestId:id,kind,written:false,invoiceNo:Number(o.invoiceNo),expiresAt:r.rows[0]?.expires_at??null,summary,
  instruction:'Gửi nguyên văn summary cho chủ cửa hàng. CHỈ khi chủ cửa hàng trả lời "ok" trong một tin nhắn mới '+
   'mới gọi '+TOOL[kind].confirm+' với requestId này. Chưa có gì thay đổi.'};
}

/**
 * Signed ledger writes through the SAME isolated V2 writer key/endpoint as order
 * creation (never the read key). orders.delete/orders.restore already exist in
 * BotApi; orders.cancel needs api/BotApiOrderCancel.gs. Scopes on the writer key:
 * orders:cancel, orders:delete (orders.restore uses orders:write, already granted).
 */
export function createOwnerWriteRelay({env=process.env,fetcher=fetch,now=()=>Date.now(),
 generateNonce=()=>crypto.randomBytes(18).toString('hex')}={}){
 const cfg=ledgerRelayConfig(env);
 async function send(action,payload){
  need(['orders.cancel','orders.delete','orders.restore'].includes(action),'LEDGER_ACTION_DENIED','Lệnh không được phép.');
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
   PAID_ORDER_PROTECTED:'PAID_ORDER_PROTECTED',ALREADY_CANCELLED:'ALREADY_CANCELLED',ORDER_CHANGED:'ORDER_CHANGED',
   PAIRED_ORDER_LOCKED:'PAIRED_ORDER_LOCKED',INVALID_ORDER:'TARGET_GONE',TRASH_NOT_FOUND:'TARGET_GONE',
   TRASH_EXPIRED:'TRASH_EXPIRED',RESTORE_CONFLICT:'RESTORE_CONFLICT',NOT_COUNTED:'NOT_COUNTED',
   REUSED_REQUEST_ID:'LEDGER_REQUEST_ID_CONFLICT'}[up]||'LEDGER_UPSTREAM_REJECTED';
  const e=Error(code);e.code=code;throw e;
 }
 return Object.freeze({send});
}

async function setState(pool,id,status,note,done=false,revision=null){
 await pool.query('UPDATE '+TABLE+' SET status=$2,last_note=$3,updated_at=now()'+
  (done?',done_at=coalesce(done_at,now())':'')+(Number.isSafeInteger(revision)?',ledger_revision='+revision:'')+' WHERE id=$1',
  [id,status,note==null?null:String(note).slice(0,200)]);
}
const FINAL=new Set(['PAID_ORDER_PROTECTED','ORDER_CHANGED','PAIRED_ORDER_LOCKED','NOT_COUNTED','ORDER_AMBIGUOUS',
 'LEDGER_REQUEST_ID_CONFLICT','TRASH_EXPIRED','RESTORE_CONFLICT','TARGET_GONE','TRASH_AMBIGUOUS']);
const doneMessage={
 cancel:no=>'Đã hủy hóa đơn #'+no+': vẫn nằm trong hệ thống với trạng thái "Đã hủy", tính 0 đ (không vào công nợ/tổng bill), giữ dòng hàng và tổng gốc.',
 trash:no=>'Đã chuyển hóa đơn #'+no+' vào Thùng Rác (khôi phục được trong 30 ngày). Không còn trong danh sách và công nợ.',
 restore:no=>'Đã khôi phục hóa đơn #'+no+' từ Thùng Rác về danh sách, giữ nguyên trạng thái thanh toán cũ.'};
const doneReply=(row,duplicate)=>({ok:true,state:'DONE',kind:row.kind,duplicate:!!duplicate,invoiceNo:Number(row.invoice_no),
 message:doneMessage[row.kind](Number(row.invoice_no))+(duplicate?' (Đã làm từ trước bằng chính yêu cầu này; không làm lần hai.)':'')});

/** Ledger state of the target: 'before' (action still needed), 'after' (done) or 'gone'. */
async function observe(kind,reader,row){
 const ref={invoiceNo:Number(row.invoice_no),orderId:String(row.ledger_id)};
 const inOrders=await exactOrder(reader,ref).catch(e=>{if(e?.code==='ORDER_NOT_FOUND')return null;throw e});
 if(kind==='cancel'){
  if(!inOrders)return {state:'gone'};
  return {state:String(inOrders.order.status)==='Đã hủy'?'after':'before',...inOrders};
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

export async function confirmWrite(kind,pool,reader,relayFactory,{requestId}={},env=process.env){
 writesOn(env);
 need(UUID.test(String(requestId||'')),'INVALID_REQUEST','requestId không hợp lệ.');
 const id=String(requestId).toLowerCase();
 let relay;
 try{relay=relayFactory()}catch{bad('WRITER_NOT_READY','Máy chủ chưa bật quyền ghi sổ; chưa làm gì.')}
 const client=await pool.connect();
 let row,previous;
 try{
  await client.query('BEGIN');
  const r=await client.query("SELECT *,expires_at<now() AS expired,updated_at<now()-interval '2 minutes' AS stale "+
   'FROM '+TABLE+' WHERE id=$1 FOR UPDATE',[id]);
  need(r.rows.length===1,'REQUEST_NOT_FOUND','Không tìm thấy yêu cầu.');
  row=r.rows[0];previous=row.status;
  need(row.kind===kind,'WRONG_CONFIRM_TOOL','Yêu cầu này là "'+row.kind+'", phải xác nhận bằng '+TOOL[row.kind].confirm+'.');
  if(row.status==='done'){await client.query('COMMIT');return doneReply(row,true)}
  need(row.status!=='rejected','REQUEST_CLOSED','Yêu cầu đã bị từ chối ('+(row.last_note||'')+'). Tạo yêu cầu mới nếu cần.');
  if(row.status==='pending'&&row.expired){
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
  if(seen.state==='before'){
   const o=seen.order;
   if(norm(o.name)!==norm(row.expected_name)||Number(o.total)!==Number(row.expected_total)){
    await setState(pool,id,'rejected','ORDER_CHANGED');
    bad('ORDER_CHANGED','Hóa đơn #'+no+' đã thay đổi (tên/tổng) sau khi yêu cầu. Chưa làm gì; xem lại rồi tạo yêu cầu mới.');
   }
   if(kind!=='restore'){const r=refusalFor(kind,o);if(r){await setState(pool,id,'rejected',r[0]);bad(...r)}}
  }
  // 'after' is still sent: BotApi replays the same requestId (duplicate) or reports another actor.
  const payload={expectedRevision:seen.revision,requestId:row.request_id,id:String(row.ledger_id),invoiceNo:no,
   expectedName:String(row.expected_name),expectedTotal:Number(row.expected_total),confirmed:true,
   ...(kind==='cancel'?{reason:String(row.reason),actor:WRITE_ACTOR}:{})};
  let result;
  try{result=await relay.send(KINDS[kind].action,payload)}
  catch(e){
   const code=e?.code||'ERROR';
   if(code==='LEDGER_REVISION_CONFLICT'&&attempt===0)continue; // nothing written; re-read and retry once
   if(code==='ALREADY_CANCELLED'||(seen.state==='after'&&['TARGET_GONE','RESTORE_CONFLICT','LEDGER_REQUEST_ID_CONFLICT'].includes(code))){
    await setState(pool,id,'rejected','DONE_BY_OTHER');
    return {ok:true,state:'ALREADY_DONE',kind,invoiceNo:no,
     message:'Hóa đơn #'+no+' đã ở trạng thái "'+KINDS[kind].done+'" từ trước (không phải yêu cầu này). Không làm lần hai.'};
   }
   if(FINAL.has(code)){await setState(pool,id,'rejected',code);bad(code,'Sổ từ chối thao tác với hóa đơn #'+no+' ('+code+'). Chưa làm gì.')}
   if(['LEDGER_ACTION_NOT_DEPLOYED','LEDGER_SCOPE_MISSING','LEDGER_REVISION_CONFLICT'].includes(code)){
    await setState(pool,id,back,code);
    bad(code==='LEDGER_REVISION_CONFLICT'?'RETRY':'WRITER_NOT_READY',code==='LEDGER_REVISION_CONFLICT'?
     'Sổ đang thay đổi liên tục; chưa làm gì. Gọi lại với cùng requestId.':
     'Apps Script chưa có lệnh '+KINDS[kind].action+' hoặc khóa ghi V2 chưa có quyền. Chưa làm gì.');
   }
   await setState(pool,id,'uncertain',code);
   return {ok:false,state:'UNCERTAIN',kind,message:'Chưa xác minh được kết quả. Gọi lại '+TOOL[kind].confirm+' với cùng requestId (an toàn, không làm hai lần).'};
  }
  try{
   const after=await observe(kind,reader,row);
   if(after.state==='after'){
    await setState(pool,id,'done',null,true,result?.revision);
    return doneReply(row,result?.data?.duplicate===true);
   }
  }catch{}
  await setState(pool,id,'uncertain','NO_READBACK');
  return {ok:false,state:'UNCERTAIN',kind,message:'Đã gửi lệnh nhưng chưa đọc lại được kết quả. Gọi lại '+TOOL[kind].confirm+' với cùng requestId.'};
 }
 await setState(pool,id,back,'REVISION_CONFLICT');
 return {ok:false,state:'RETRY',kind,message:'Sổ vừa thay đổi; chưa làm gì. Gọi lại với cùng requestId.'};
}

const TOOL={
 cancel:{request:'satori_order_cancel_request',confirm:'satori_order_cancel_confirm'},
 trash:{request:'satori_order_trash_request',confirm:'satori_order_trash_confirm'},
 restore:{request:'satori_order_restore_request',confirm:'satori_order_restore_confirm'}};
const refProps={invoiceNo:{type:'integer',minimum:1,description:'Số hóa đơn (Hƒ)'},
 orderId:{type:['string','integer'],description:'Số hóa đơn hoặc ledgerId'},
 reason:{type:'string',minLength:3,maxLength:300,description:'Lý do, đúng lời chủ cửa hàng'}};
const reqTool=(kind,title,description)=>({name:TOOL[kind].request,title,description:description+
 ' KHÔNG ghi sổ. Gửi nguyên summary cho chủ cửa hàng và chờ họ trả lời "ok" trong tin nhắn mới.',
 inputSchema:{type:'object',required:['reason'],additionalProperties:false,properties:refProps},
 annotations:{readOnlyHint:true,openWorldHint:false}});
const confTool=(kind,title,description)=>({name:TOOL[kind].confirm,title,description:'CHỈ gọi sau khi chủ cửa hàng trả lời "ok". '+description+
 ' Gọi lại với cùng requestId không làm hai lần. Yêu cầu hết hạn sau 30 phút.',
 inputSchema:{type:'object',required:['requestId'],additionalProperties:false,properties:{requestId:{type:'string'}}},
 annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}});

export const GROK_WRITE_TOOLS=[
 reqTool('cancel','Minh Satori: yêu cầu HỦY hóa đơn (chưa hủy)',
  'Bước 1 HỦY: hóa đơn sẽ ở lại hệ thống với trạng thái "Đã hủy", tính 0 đ (không vào công nợ/tổng bill). Khác XÓA.'),
 confTool('cancel','Minh Satori: xác nhận HỦY hóa đơn','Đánh dấu "Đã hủy": giữ trong hệ thống, số tiền hiệu lực 0 đ, giữ dòng hàng và tổng gốc.'),
 reqTool('trash','Minh Satori: yêu cầu XÓA hóa đơn vào thùng rác (chưa xóa)',
  'Bước 1 XÓA: hóa đơn sẽ chuyển vào Thùng Rác 30 ngày như nút Xóa trong app, khôi phục được. Khác HỦY.'),
 confTool('trash','Minh Satori: xác nhận XÓA vào thùng rác','Chuyển hóa đơn vào Thùng Rác 30 ngày (không xóa vĩnh viễn).'),
 reqTool('restore','Minh Satori: yêu cầu KHÔI PHỤC hóa đơn từ thùng rác (chưa khôi phục)',
  'Bước 1 KHÔI PHỤC: tìm hóa đơn trong Thùng Rác (satori_trash_list) và lập yêu cầu.'),
 confTool('restore','Minh Satori: xác nhận KHÔI PHỤC từ thùng rác','Đưa hóa đơn từ Thùng Rác về danh sách, giữ trạng thái thanh toán cũ.')
];
export const GROK_WRITE_TOOL_NAMES=GROK_WRITE_TOOLS.map(t=>t.name);

/** deps: {reader, ownerWriteRelayFactory, env} */
export async function callGrokWriteTool(pool,deps,name,args={}){
 const env=deps.env||process.env;
 for(const kind of Object.keys(TOOL)){
  if(name===TOOL[kind].request)return requestWrite(kind,pool,deps.reader,args,env);
  if(name===TOOL[kind].confirm)return confirmWrite(kind,pool,deps.reader,deps.ownerWriteRelayFactory,args,env);
 }
 bad('UNKNOWN_TOOL','Công cụ không tồn tại.');
}
