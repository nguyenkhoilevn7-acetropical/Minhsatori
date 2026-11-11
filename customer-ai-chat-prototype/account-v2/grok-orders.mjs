/**
 * Grok Phase B: the owner creates REAL orders by chatting with Grok.
 *
 * Flow (every step server-side; the model never computes money):
 *  1. satori_find_customer  - read-only lookup of past delivery destinations.
 *  2. satori_order_draft    - server prices the owner's order with the SAME rules
 *     as live BotApi orders.create (goods, invoice VAT or optional per-line VAT,
 *     shipping, total) and stores an immutable draft + a 4-digit approval code.
 *     Nothing is written to the ledger.
 *  3. satori_order_confirm  - only with the code the owner typed back in Grok:
 *     ONE signed orders.create through the existing V2 writer relay
 *     (findByRequestId first, revision check, exact readback). Retries reuse
 *     the same requestId, so a lost reply can never create a second invoice.
 *  4. satori_order_status   - read-only reconciliation by the same requestId.
 *
 * Disabled unless GROK_OWNER_WRITES_ENABLED=1 (tools are not even listed).
 * No payment, delete, edit or VAT-policy write is possible here.
 */
import crypto from 'node:crypto';

export const GROK_ORDER_TOOL_NAMES=['satori_find_customer','satori_order_draft','satori_order_confirm','satori_order_status'];
export const grokOrdersEnabled=(env=process.env)=>env.GROK_OWNER_WRITES_ENABLED==='1';

const DRAFT_TTL_MINUTES=30;
const MAX_CODE_ATTEMPTS=5;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const vnd=n=>Number(n).toLocaleString('vi-VN')+' đ';

export class GrokOrderError extends Error{constructor(code,message){super(message);this.code=code}}
const bad=(code,message)=>{throw new GrokOrderError(code,message)};
const need=(ok,code,message)=>{if(!ok)bad(code,message)};

/** Same normalisation as BotApi norm(): accent/case-insensitive identity. */
export const norm=v=>String(v==null?'':v).normalize('NFD').replace(/[̀-ͯ]/g,'')
 .replace(/đ/g,'d').replace(/Đ/g,'d').toLowerCase().replace(/\btreky\b/g,'traky').trim();
const digits=v=>String(v||'').replace(/\D/g,'');
const intMoney=(v,label)=>{
 need(Number.isSafeInteger(v)&&v>=0&&v<=1e11,'INVALID_AMOUNT',label+' phải là số đồng nguyên, không âm.');
 return v;
};
/** BotApi invoiceVatRate(): 0..100 with at most 2 decimals -> basis points. */
export function vatBasisPoints(v,label='VAT'){
 need(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100&&
  Math.abs(v*100-Math.round(v*100))<1e-7,'INVALID_TAX_RATE',label+' phải từ 0 đến 100%, tối đa 2 chữ số thập phân.');
 return Math.round(v*100);
}

/**
 * Builds the exact orders.create order object and its money breakdown.
 * VAT rules (owner-approved contract, mirrors live BotApi):
 *  - no vatRate anywhere            -> no VAT.
 *  - order vatRate, no line fields  -> invoice VAT: round(goods * rate / 100),
 *    sent as the historic vatAmount (same as checkout-preflight / old PDFs).
 *  - any line vatRate / vatExempt   -> per_line: exempt > line rate > order rate;
 *    lineVat = round(qty*unitPrice*bp/10000), summed once.
 * total = goods + shipping + VAT. Shipping is never taxed.
 */
export function priceOwnerOrder(input){
 need(input&&typeof input==='object','INVALID_ORDER','Thiếu thông tin đơn.');
 const c=input.customer||{};
 const name=String(c.name||'').trim(),phone=String(c.phone||'').trim(),location=String(c.location||'').trim();
 need(name.length>=2&&name.length<=150,'INVALID_ORDER','Tên khách phải từ 2 đến 150 ký tự.');
 need(phone.length<=60&&(!phone||/^[0-9 +().-]{6,60}$/.test(phone)),'INVALID_ORDER','Số điện thoại không hợp lệ.');
 need(location.length<=500,'INVALID_ORDER','Địa chỉ quá dài.');
 const raw=input.items;
 need(Array.isArray(raw)&&raw.length>=1&&raw.length<=50,'INVALID_ORDER','Đơn cần 1 đến 50 dòng hàng.');
 const hasOrderRate=input.vatRate!==undefined&&input.vatRate!==null;
 const orderBp=hasOrderRate?vatBasisPoints(input.vatRate,'VAT của đơn'):null;
 const perLine=raw.some(i=>i&&(i.vatExempt===true||(i.vatRate!==undefined&&i.vatRate!==null)));
 let goods=0,vat=0;
 const lines=raw.map((i,n)=>{
  need(i&&typeof i==='object','INVALID_ITEM','Dòng '+(n+1)+' không hợp lệ.');
  const product=String(i.product||'').trim();
  need(product.length>=2&&product.length<=200,'INVALID_ITEM','Dòng '+(n+1)+': tên sản phẩm 2-200 ký tự.');
  const qty=i.qty;
  need(Number.isSafeInteger(qty)&&qty>=1&&qty<=100000,'INVALID_ITEM','Dòng '+(n+1)+': số lượng phải là số nguyên dương.');
  const unitPrice=intMoney(i.unitPrice,'Dòng '+(n+1)+': đơn giá');
  const listPrice=i.listPrice==null?unitPrice:intMoney(i.listPrice,'Dòng '+(n+1)+': giá niêm yết');
  // Reject a non-boolean exemption even outside per-line mode: never silently tax it.
  need(i.vatExempt===undefined||typeof i.vatExempt==='boolean','INVALID_TAX_RATE','Dòng '+(n+1)+': vatExempt phải là true/false.');
  const code=String(i.code||'').trim();
  need(code.length<=50,'INVALID_ITEM','Dòng '+(n+1)+': mã sản phẩm quá dài.');
  const unit=String(i.unit||'').trim()||'Thùng';
  need(unit.length<=30,'INVALID_ITEM','Dòng '+(n+1)+': đơn vị quá dài.');
  const subtotal=qty*unitPrice;
  need(Number.isSafeInteger(subtotal)&&subtotal<=1e11,'INVALID_AMOUNT','Dòng '+(n+1)+': thành tiền vượt giới hạn.');
  goods+=subtotal;
  const line={code,product,unit,qty,unitPrice,listPrice};
  if(perLine){
   need(i.vatExempt===undefined||typeof i.vatExempt==='boolean','INVALID_TAX_RATE','Dòng '+(n+1)+': vatExempt phải là true/false.');
   const exempt=i.vatExempt===true,hasRate=i.vatRate!==undefined&&i.vatRate!==null;
   const bp=exempt?0:hasRate?vatBasisPoints(i.vatRate,'VAT dòng '+(n+1)):orderBp;
   need(bp!==null,'VAT_RATE_REQUIRED','Dòng '+(n+1)+' chưa có mức VAT: cần VAT của đơn hoặc VAT riêng cho dòng.');
   const lineVat=Math.round(subtotal*bp/10000);
   if(exempt)line.vatExempt=true;
   if(hasRate&&!exempt)line.vatRate=i.vatRate;
   line.vatAmount=lineVat;
   vat+=lineVat;
   return {...line,_rate:bp/100,_vat:lineVat,_exempt:exempt};
  }
  return line;
 });
 need(goods<=1e11,'INVALID_AMOUNT','Tiền hàng vượt giới hạn.');
 if(!perLine&&hasOrderRate)vat=Math.round(goods*orderBp/10000);
 const shipping=input.shippingAmount==null?0:intMoney(input.shippingAmount,'Phí giao hàng');
 const total=goods+shipping+vat;
 need(total<=1e11,'INVALID_AMOUNT','Tổng tiền vượt giới hạn.');
 const deliveryDate=input.deliveryDate==null||input.deliveryDate===''?'':String(input.deliveryDate);
 need(!deliveryDate||(/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(deliveryDate)&&
  new Date(deliveryDate+'T00:00:00Z').toISOString().slice(0,10)===deliveryDate),'INVALID_ORDER','Ngày giao phải dạng YYYY-MM-DD.');
 const deliveryNote=String(input.deliveryNote||'').trim();
 need(deliveryNote.length<=300,'INVALID_ORDER','Ghi chú giao hàng tối đa 300 ký tự.');
 const order={name,phone,location,
  items:lines.map(({_rate,_vat,_exempt,...x})=>x),
  shippingAmount:shipping,vatAmount:vat,total,deliveryNote};
 if(deliveryDate)order.deliveryDate=deliveryDate;
 if(perLine&&hasOrderRate)order.vatRate=input.vatRate;
 const vatMode=perLine?'per_line':hasOrderRate?'invoice':'none';
 return {order,breakdown:{goods,shipping,vat,total,vatMode,
  invoiceVatRate:hasOrderRate?orderBp/100:null,
  lines:lines.map(l=>({product:l.product,unit:l.unit,qty:l.qty,unitPrice:l.unitPrice,
   subtotal:l.qty*l.unitPrice,...(perLine?{vatRate:l._rate,vatExempt:l._exempt,vatAmount:l._vat}:{})}))}};
}

/** Plain-text summary Grok shows to the owner before approval. */
export function draftSummary({order,breakdown},code,customerLabel){
 const rows=breakdown.lines.map((l,i)=>(i+1)+'. '+l.product+' — '+l.qty+' '+l.unit+' × '+vnd(l.unitPrice)+
  ' = '+vnd(l.subtotal)+(breakdown.vatMode==='per_line'?(l.vatExempt?' (không VAT)':' (VAT '+l.vatRate+'%: '+vnd(l.vatAmount)+')'):''));
 const vatLine=breakdown.vatMode==='none'?'VAT: không':
  breakdown.vatMode==='invoice'?'VAT '+breakdown.invoiceVatRate+'% trên tiền hàng: '+vnd(breakdown.vat):
  'VAT theo từng dòng: '+vnd(breakdown.vat);
 return ['ĐƠN NHÁP (chưa ghi sổ)',
  'Khách: '+order.name+(order.phone?' · '+order.phone:''),
  'Địa chỉ: '+(order.location||'(không có)')+' — '+customerLabel,
  ...(order.deliveryDate?['Ngày giao: '+order.deliveryDate]:[]),
  ...(order.deliveryNote?['Ghi chú: '+order.deliveryNote]:[]),
  ...rows,
  'Tiền hàng: '+vnd(breakdown.goods),
  vatLine,
  'Phí giao: '+vnd(breakdown.shipping),
  'TỔNG: '+vnd(breakdown.total),
  'Mã duyệt: '+code+' (hiệu lực '+DRAFT_TTL_MINUTES+' phút)'].join('\n');
}

function signedOrders(result){
 need(Number.isSafeInteger(result?.revision)&&Array.isArray(result?.data?.orders),
  'LEDGER_UNAVAILABLE','Chưa đọc được sổ Minh Satori, thử lại sau.');
 return result.data.orders;
}

/** Past delivery destinations matching a name or phone (newest first, deduplicated). */
export async function findCustomers(reader,query){
 const q=String(query||'').trim();
 need(q.length>=2&&q.length<=80,'INVALID_QUERY','Nhập tên hoặc số điện thoại (2-80 ký tự).');
 const rows=signedOrders(await reader('orders.list',{query:q,limit:100}));
 const seen=new Map();
 for(const r of rows){
  const no=Number(r?.invoiceNo);
  if(!Number.isSafeInteger(no)||no<=0||r?.id==null)continue;
  const key=norm(r.name)+'|'+norm(r.location)+'|'+digits(r.phone);
  const prev=seen.get(key);
  if(!prev||no>prev.customerRef.invoiceNo)seen.set(key,{customerRef:{id:r.id,invoiceNo:no},
   name:String(r.name||''),phone:String(r.phone||''),location:String(r.location||''),lastOrderDate:String(r.date||'')});
 }
 const customers=[...seen.values()].sort((a,b)=>b.customerRef.invoiceNo-a.customerRef.invoiceNo).slice(0,10);
 return {count:customers.length,truncated:rows.length>=100,customers};
}

/** Mirrors BotApi checkProfile(): the referenced invoice must carry EXACTLY this destination. */
export async function verifyCustomerRef(reader,ref,customer){
 need(ref&&(typeof ref.id==='string'||Number.isSafeInteger(ref.id))&&
  Number.isSafeInteger(ref.invoiceNo)&&ref.invoiceNo>0,'INVALID_CUSTOMER_REF','customerRef không hợp lệ.');
 const rows=signedOrders(await reader('orders.list',{query:String(ref.invoiceNo),limit:100}));
 const refs=rows.filter(r=>String(r?.id)===String(ref.id)&&Number(r?.invoiceNo)===ref.invoiceNo);
 need(refs.length>=1,'PROFILE_CHANGED','Không tìm thấy hóa đơn tham chiếu của khách; tìm lại khách.');
 const exact=refs.filter(r=>norm(r.name)===norm(customer.name)&&norm(r.location)===norm(customer.location)&&
  digits(r.phone)===digits(customer.phone));
 need(exact.length===1,'PROFILE_MISMATCH','Tên, địa chỉ hoặc số điện thoại khác điểm giao đã chọn. '+
  'Dùng đúng thông tin từ satori_find_customer, hoặc tạo như khách mới nếu chủ cửa hàng xác nhận.');
 return {id:ref.id,invoiceNo:ref.invoiceNo};
}

const codeHash=(id,code)=>crypto.createHash('sha256').update(id+':'+code).digest('hex');
const sameHash=(a,b)=>a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));

export async function createDraft(pool,reader,args){
 const priced=priceOwnerOrder(args);
 let customerRef=null,customerLabel;
 if(args.customerRef!=null){
  need(args.newCustomer!==true,'INVALID_ORDER','Chỉ chọn một: customerRef hoặc newCustomer.');
  customerRef=await verifyCustomerRef(reader,args.customerRef,priced.order);
  customerLabel='khách cũ (theo hóa đơn #'+customerRef.invoiceNo+')';
 }else{
  need(args.newCustomer===true,'PROFILE_CONFIRMATION_REQUIRED',
   'Chưa chọn khách: dùng customerRef từ satori_find_customer, hoặc newCustomer=true nếu chủ cửa hàng xác nhận là khách mới.');
  need(priced.order.location.length>=5,'INVALID_ORDER','Khách mới phải có địa chỉ (ít nhất 5 ký tự).');
  customerLabel='KHÁCH MỚI';
 }
 const id=crypto.randomUUID();
 const code=String(crypto.randomInt(0,10000)).padStart(4,'0');
 const requestId='grok-'+id.replace(/-/g,'');
 const summary=draftSummary(priced,code,customerLabel);
 await pool.query('INSERT INTO satori_v2_grok_order_drafts(id,request_id,code_hash,customer_ref,order_payload,summary,expires_at) '+
  "VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,now()+make_interval(mins=>$7))",
  [id,requestId,codeHash(id,code),customerRef?JSON.stringify(customerRef):null,JSON.stringify(priced.order),summary,DRAFT_TTL_MINUTES]);
 return {draftId:id,approvalCode:code,total:priced.breakdown.total,breakdown:priced.breakdown,summary,
  instruction:'Gửi nguyên văn summary cho chủ cửa hàng. CHỈ gọi satori_order_confirm khi chủ cửa hàng tự gõ lại đúng mã duyệt '+
   'trong tin nhắn mới. Nếu chủ cửa hàng sửa bất kỳ điều gì, tạo nháp mới.'};
}

function intentOf(row,expectedRevision){
 const intent={requestId:row.request_id,expectedRevision,order:row.order_payload};
 if(row.customer_ref)intent.customerRef=row.customer_ref;else intent.confirmedNewCustomer=true;
 return intent;
}
async function currentRevision(reader){
 const r=await reader('system.status',{});
 need(Number.isSafeInteger(r?.revision)&&r.revision>=1,'LEDGER_UNAVAILABLE','Chưa đọc được sổ Minh Satori, thử lại sau.');
 return r.revision;
}
async function finish(pool,id,state,result,note){
 const inv=result?.invoice;
 await pool.query('UPDATE satori_v2_grok_order_drafts SET status=$2,invoice_no=$3,ledger_id=$4,last_note=$5,updated_at=now() WHERE id=$1',
  [id,state,inv?.invoiceNo??null,inv?String(inv.id):null,note??null]);
}
const committedReply=(row,inv,duplicate)=>({ok:true,state:'COMMITTED',invoiceNo:inv.invoiceNo,ledgerId:String(inv.id),
 total:inv.total,duplicate:!!duplicate,message:'Đã ghi hóa đơn #'+inv.invoiceNo+' vào sổ Minh Satori (đã đối soát). '+
  'Push cho chủ cửa hàng và PDF Zalo sẽ vào hàng đợi như mọi đơn mới.'});

/**
 * relayFactory(): returns {submit(intent), findIntent(intent)} (createV2CanonicalRelay).
 * kick(): optional fast path for the owner push relay after a committed write.
 */
export async function confirmDraft(pool,reader,relayFactory,{draftId,approvalCode},kick=()=>{}){
 need(UUID.test(String(draftId||'')),'INVALID_DRAFT','draftId không hợp lệ.');
 need(/^[0-9]{4}$/.test(String(approvalCode||'')),'INVALID_CODE','Mã duyệt gồm 4 chữ số.');
 const id=String(draftId).toLowerCase();
 // Fail BEFORE claiming the draft when the isolated V2 writer is not configured.
 let relay;
 try{relay=relayFactory()}catch{bad('WRITER_NOT_READY','Máy chủ chưa bật quyền ghi sổ; chưa ghi gì.')}
 const client=await pool.connect();
 let row;
 try{
  await client.query('BEGIN');
  const r=await client.query('SELECT *,expires_at<now() AS expired FROM satori_v2_grok_order_drafts WHERE id=$1 FOR UPDATE',[id]);
  need(r.rows.length===1,'DRAFT_NOT_FOUND','Không tìm thấy đơn nháp.');
  row=r.rows[0];
  if(row.status==='committed'){await client.query('COMMIT');
   return committedReply(row,{invoiceNo:Number(row.invoice_no),id:row.ledger_id,total:row.order_payload.total},true)}
  need(['draft','uncertain'].includes(row.status),'DRAFT_CLOSED','Đơn nháp đã '+
   ({cancelled:'bị hủy',submitting:'đang được gửi',rejected:'bị từ chối'}[row.status]||row.status)+'.');
  need(row.status==='uncertain'||!row.expired,'DRAFT_EXPIRED','Đơn nháp đã hết hạn; tạo nháp mới.');
  if(!sameHash(codeHash(id,String(approvalCode)),row.code_hash)){
   const attempts=row.code_attempts+1;
   await client.query("UPDATE satori_v2_grok_order_drafts SET code_attempts=$2::int,status=CASE WHEN $2::int>=$3::int AND status='draft' THEN 'cancelled' ELSE status END,updated_at=now() WHERE id=$1",
    [id,attempts,MAX_CODE_ATTEMPTS]);
   await client.query('COMMIT');
   bad('WRONG_CODE',attempts>=MAX_CODE_ATTEMPTS&&row.status==='draft'?'Sai mã quá '+MAX_CODE_ATTEMPTS+' lần, đơn nháp đã hủy.':'Mã duyệt không đúng.');
  }
  // One dispatcher only: a parallel confirm sees 'submitting' and stops.
  await client.query("UPDATE satori_v2_grok_order_drafts SET status='submitting',approved_at=coalesce(approved_at,now()),updated_at=now() WHERE id=$1",[id]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
 finally{client.release()}
 let result;
 try{
  const intent=intentOf(row,await currentRevision(reader));
  result=await relay.submit(intent);
 }catch(e){
  // Unknown whether the ledger wrote: keep it reconcilable by the same requestId.
  await finish(pool,id,'uncertain',null,String(e?.code||'ERROR').slice(0,60));
  return {ok:false,state:'UNCERTAIN',message:'Chưa xác minh được kết quả ghi sổ. KHÔNG tạo đơn mới; gọi satori_order_status với cùng draftId.'};
 }
 if(result.state==='COMMITTED'){
  await finish(pool,id,'committed',result,null);kick();
  return committedReply(row,result.invoice,result.duplicate);
 }
 if(result.state==='REJECTED'&&result.reason==='LEDGER_REVISION_CONFLICT'){
  // Nothing was written (checked before orders.create). Same code may be retried.
  await finish(pool,id,row.status==='uncertain'?'uncertain':'draft',null,'REVISION_CONFLICT');
  return {ok:false,state:'RETRY',message:'Sổ vừa thay đổi trong lúc gửi; chưa ghi gì. Gọi lại satori_order_confirm với cùng mã.'};
 }
 await finish(pool,id,'uncertain',null,String(result.reason||'UNCERTAIN').slice(0,60));
 return {ok:false,state:'UNCERTAIN',message:'Chưa xác minh được hóa đơn. KHÔNG tạo đơn mới; gọi satori_order_status với cùng draftId.'};
}

export async function draftStatus(pool,relayFactory,{draftId},kick=()=>{}){
 need(UUID.test(String(draftId||'')),'INVALID_DRAFT','draftId không hợp lệ.');
 const id=String(draftId).toLowerCase();
 const r=await pool.query('SELECT *,expires_at<now() AS expired FROM satori_v2_grok_order_drafts WHERE id=$1',[id]);
 need(r.rows.length===1,'DRAFT_NOT_FOUND','Không tìm thấy đơn nháp.');
 const row=r.rows[0];
 if(row.status==='committed')return committedReply(row,{invoiceNo:Number(row.invoice_no),id:row.ledger_id,total:row.order_payload.total},true);
 if(row.status==='uncertain'){
  try{
   const inv=await relayFactory().findIntent(intentOf(row,1));
   if(inv){await finish(pool,id,'committed',{invoice:inv},null);kick();return committedReply(row,inv,true)}
   return {ok:true,state:'NOT_WRITTEN',message:'Sổ chưa có hóa đơn cho nháp này. Có thể gọi satori_order_confirm lại với cùng mã (an toàn, không tạo trùng).'};
  }catch{return {ok:false,state:'UNCERTAIN',message:'Chưa đọc được sổ; thử lại sau. Không tạo đơn mới.'}}
 }
 return {ok:true,state:row.status==='draft'&&row.expired?'EXPIRED':row.status.toUpperCase(),summary:row.summary.replace(/\nMã duyệt: .*$/,'')};
}

const customerSchema={type:'object',required:['name'],additionalProperties:false,properties:{
 name:{type:'string',description:'Tên khách / điểm giao, đúng như chủ cửa hàng nói hoặc như satori_find_customer trả về'},
 phone:{type:'string'},location:{type:'string',description:'Địa chỉ giao'}}};
const itemSchema={type:'object',required:['product','qty','unitPrice'],additionalProperties:false,properties:{
 product:{type:'string'},code:{type:'string',description:'Mã sản phẩm nếu biết'},unit:{type:'string',description:'Mặc định Thùng'},
 qty:{type:'integer',minimum:1},unitPrice:{type:'integer',minimum:0,description:'Đơn giá bán (đồng), đúng giá chủ cửa hàng nói'},
 listPrice:{type:'integer',minimum:0,description:'Giá niêm yết nếu có'},
 vatRate:{type:'number',minimum:0,maximum:100,description:'Chỉ khi chủ cửa hàng nói VAT riêng cho dòng này'},
 vatExempt:{type:'boolean',description:'true nếu dòng này không chịu VAT'}}};

export const GROK_ORDER_TOOLS=[
 {name:'satori_find_customer',title:'Minh Satori: tìm khách / điểm giao cũ',
  description:'Tìm điểm giao đã từng có hóa đơn theo tên hoặc số điện thoại. Dùng customerRef trả về cho satori_order_draft. '+
   'Nếu có nhiều kết quả, hỏi chủ cửa hàng chọn đúng điểm giao.',
  inputSchema:{type:'object',required:['query'],additionalProperties:false,properties:{query:{type:'string',minLength:2,maxLength:80}}},
  annotations:{readOnlyHint:true,openWorldHint:false}},
 {name:'satori_order_draft',title:'Minh Satori: lập đơn nháp (chưa ghi sổ)',
  description:'Lập đơn NHÁP từ yêu cầu của chủ cửa hàng. Máy chủ tự tính tiền hàng, VAT, phí giao và tổng; không tự tính hay đoán giá. '+
   'VAT: không nói thì không có VAT; vatRate cấp đơn = VAT trên tiền hàng; vatRate/vatExempt ở dòng = VAT theo từng dòng. '+
   'Trả về summary và mã duyệt 4 số: gửi nguyên summary cho chủ cửa hàng, chờ họ gõ lại mã.',
  inputSchema:{type:'object',required:['customer','items'],additionalProperties:false,properties:{
   customer:customerSchema,
   customerRef:{type:'object',required:['id','invoiceNo'],additionalProperties:false,
    properties:{id:{type:['string','integer']},invoiceNo:{type:'integer'}},description:'Từ satori_find_customer (khách cũ)'},
   newCustomer:{type:'boolean',description:'true chỉ khi chủ cửa hàng xác nhận đây là khách mới'},
   items:{type:'array',minItems:1,maxItems:50,items:itemSchema},
   shippingAmount:{type:'integer',minimum:0},vatRate:{type:'number',minimum:0,maximum:100},
   deliveryDate:{type:'string',description:'YYYY-MM-DD'},deliveryNote:{type:'string',maxLength:300}}},
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}},
 {name:'satori_order_confirm',title:'Minh Satori: ghi đơn đã duyệt vào sổ',
  description:'Ghi đơn nháp vào sổ Minh Satori. CHỈ gọi sau khi chủ cửa hàng tự gõ đúng mã duyệt trong tin nhắn mới; '+
   'không bao giờ tự điền mã. Gọi lại với cùng draftId không tạo hóa đơn trùng.',
  inputSchema:{type:'object',required:['draftId','approvalCode'],additionalProperties:false,properties:{
   draftId:{type:'string'},approvalCode:{type:'string',pattern:'^[0-9]{4}$'}}},
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 {name:'satori_order_status',title:'Minh Satori: trạng thái đơn nháp',
  description:'Xem/đối soát trạng thái một đơn nháp (đã ghi sổ chưa, số hóa đơn). Dùng khi confirm trả UNCERTAIN.',
  inputSchema:{type:'object',required:['draftId'],additionalProperties:false,properties:{draftId:{type:'string'}}},
  annotations:{readOnlyHint:true,openWorldHint:false}}
];

/** Dispatch one Grok order tool. deps: {reader, relayFactory, kick}. */
export async function callGrokOrderTool(pool,deps,name,args={}){
 if(name==='satori_find_customer')return findCustomers(deps.reader,args.query);
 if(name==='satori_order_draft')return createDraft(pool,deps.reader,args);
 if(name==='satori_order_confirm')return confirmDraft(pool,deps.reader,deps.relayFactory,args,deps.kick);
 if(name==='satori_order_status')return draftStatus(pool,deps.relayFactory,args,deps.kick);
 bad('UNKNOWN_TOOL','Công cụ không tồn tại.');
}
