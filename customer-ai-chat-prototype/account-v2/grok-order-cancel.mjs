/**
 * Grok owner connector: SOFT cancel of one invoice, two steps.
 *
 *  1. satori_order_cancel_request({invoiceNo|orderId, reason}): reads the exact
 *     invoice, refuses paid / Satori-paid / paired / already-cancelled invoices,
 *     stores a 30-minute request (PostgreSQL only) and returns a summary +
 *     cancelRequestId. NOTHING is written to the ledger.
 *  2. satori_order_cancel_confirm({cancelRequestId}) after the owner says "ok":
 *     ONE signed orders.cancel through the isolated V2 writer. The ledger keeps
 *     the invoice row and its history, sets status "Đã hủy" (already excluded
 *     from debt by BotApi active()) and appends an audit entry (who, when,
 *     reason). Idempotent by requestId: a second confirm never cancels twice.
 *
 * Never deletes. Disabled unless GROK_OWNER_WRITES_ENABLED=1.
 */
import crypto from 'node:crypto';
import {GrokOrderError,grokOrdersEnabled} from './grok-orders.mjs';
import {exactOrder,isActive,brief,vnd} from './grok-ledger-read.mjs';
import {norm} from './grok-search.mjs';
import {ledgerRelayConfig} from './canonical-ledger-relay.mjs';

export const GROK_CANCEL_TOOL_NAMES=['satori_order_cancel_request','satori_order_cancel_confirm'];
export const CANCEL_TTL_MINUTES=30;
export const CANCEL_ACTOR='grok-owner-connector';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bad=(code,message)=>{throw new GrokOrderError(code,message)};
const need=(ok,code,message)=>{if(!ok)bad(code,message)};
const writesOn=env=>need(grokOrdersEnabled(env),'WRITES_DISABLED',
 'Quyền ghi của Grok đang tắt (GROK_OWNER_WRITES_ENABLED). Không hủy được, chưa ghi gì.');

/** Business refusals shared by request and confirm (from the signed ledger row). */
export function cancelRefusal(o){
 const no='#'+Number(o.invoiceNo);
 if(String(o.status)==='Đã hủy')return ['ALREADY_CANCELLED','Hóa đơn '+no+' đã ở trạng thái Đã hủy.'];
 if(!isActive(o))return ['NOT_COUNTED','Hóa đơn '+no+' đang "'+o.status+'", không phải hóa đơn đang tính nợ.'];
 if(o.customerPaid===true||o.customerPaidAt||String(o.status)==='Đã thanh toán')
  return ['PAID_ORDER_PROTECTED','Hóa đơn '+no+' đã ghi nhận khách thanh toán; không hủy được. Muốn hủy phải sửa thanh toán trước (ngoài Grok).'];
 if(o.satoriPaid===true||o.satoriPaidAt||String(o.status)==='Đã TT Satori')
  return ['PAID_ORDER_PROTECTED','Hóa đơn '+no+' đã ghi nhận thanh toán cho Satori; không hủy được.'];
 if(o.pairGroupId)return ['PAIRED_ORDER_LOCKED','Hóa đơn '+no+' thuộc cặp CTV; không hủy riêng một hóa đơn của cặp.'];
 return null;
}

export function cancelSummary(o,reason){
 const b=brief(o);
 return ['YÊU CẦU HỦY HÓA ĐƠN (chưa hủy)',
  'Hóa đơn #'+b.invoiceNo+(b.date?' · '+b.date:''),
  'Khách: '+b.name+(b.location?' — '+b.location:''),
  'Tổng: '+vnd(b.total)+' · Trạng thái: '+(b.status||'Chưa thanh toán'),
  'Lý do: '+reason,
  'Hủy MỀM: hóa đơn vẫn nằm trong sổ với trạng thái "Đã hủy", giữ lịch sử, không tính công nợ. Yêu cầu hết hạn sau '+CANCEL_TTL_MINUTES+' phút.'].join('\n');
}

export async function requestCancel(pool,reader,args={},env=process.env){
 writesOn(env);
 const reason=String(args.reason||'').replace(/[\u0000-\u001f]/g,' ').trim();
 need(reason.length>=3&&reason.length<=300,'REASON_REQUIRED','Cần lý do hủy (3-300 ký tự).');
 const {order}=await exactOrder(reader,{invoiceNo:args.invoiceNo,orderId:args.orderId},pool);
 const refusal=cancelRefusal(order);
 if(refusal)bad(...refusal);
 const id=crypto.randomUUID();
 const requestId='grokcancel-'+id.replace(/-/g,'');
 const summary=cancelSummary(order,reason);
 const r=await pool.query('INSERT INTO satori_v2_grok_cancel_requests(id,request_id,invoice_no,ledger_id,expected_name,expected_total,'+
  'reason,summary,requested_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+make_interval(mins=>$10)) RETURNING expires_at',
  [id,requestId,Number(order.invoiceNo),String(order.id),String(order.name||''),String(order.total??0),reason,summary,CANCEL_ACTOR,CANCEL_TTL_MINUTES]);
 return {cancelRequestId:id,written:false,invoiceNo:Number(order.invoiceNo),expiresAt:r.rows[0]?.expires_at??null,summary,
  instruction:'Gửi nguyên văn summary cho chủ cửa hàng. CHỈ khi chủ cửa hàng trả lời "ok" trong một tin nhắn mới '+
   'mới gọi satori_order_cancel_confirm với cancelRequestId này. Chưa có gì bị hủy.'};
}

/**
 * Signed orders.cancel through the SAME isolated V2 writer key/endpoint as
 * order creation (never the read key). Requires the Apps Script action and the
 * orders:cancel scope on that key (see api/BotApiOrderCancel.gs).
 */
export function createCancelRelay({env=process.env,fetcher=fetch,now=()=>Date.now(),
 generateNonce=()=>crypto.randomBytes(18).toString('hex')}={}){
 const cfg=ledgerRelayConfig(env);
 async function cancel(payload){
  const timestamp=now(),nonce=generateNonce(),action='orders.cancel';
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
   PAIRED_ORDER_LOCKED:'PAIRED_ORDER_LOCKED',INVALID_ORDER:'ORDER_CHANGED',REUSED_REQUEST_ID:'LEDGER_REQUEST_ID_CONFLICT'}[up]||'LEDGER_UPSTREAM_REJECTED';
  const e=Error(code);e.code=code;throw e;
 }
 return Object.freeze({cancel});
}

async function setState(pool,id,status,note,extra=''){
 await pool.query('UPDATE satori_v2_grok_cancel_requests SET status=$2,last_note=$3,updated_at=now()'+extra+' WHERE id=$1',
  [id,status,note==null?null:String(note).slice(0,200)]);
}
const FINAL_REFUSALS=new Set(['PAID_ORDER_PROTECTED','ORDER_CHANGED','PAIRED_ORDER_LOCKED','NOT_COUNTED','ORDER_NOT_FOUND','ORDER_AMBIGUOUS','LEDGER_REQUEST_ID_CONFLICT']);
const doneReply=(row,duplicate)=>({ok:true,state:'CANCELLED',duplicate:!!duplicate,invoiceNo:Number(row.invoice_no),
 message:'Đã hủy mềm hóa đơn #'+Number(row.invoice_no)+': vẫn nằm trong sổ với trạng thái "Đã hủy", giữ lịch sử, không còn tính công nợ.'+
  (duplicate?' (Đã hủy từ trước bằng chính yêu cầu này; không hủy lần hai.)':'')});

/** cancelRelayFactory(): {cancel(payload)}; reader: signed read transport. */
export async function confirmCancel(pool,reader,cancelRelayFactory,{cancelRequestId}={},env=process.env){
 writesOn(env);
 need(UUID.test(String(cancelRequestId||'')),'INVALID_CANCEL_REQUEST','cancelRequestId không hợp lệ.');
 const id=String(cancelRequestId).toLowerCase();
 let relay;
 try{relay=cancelRelayFactory()}catch{bad('WRITER_NOT_READY','Máy chủ chưa bật quyền ghi sổ; chưa hủy gì.')}
 const client=await pool.connect();
 let row,previous;
 try{
  await client.query('BEGIN');
  const r=await client.query("SELECT *,expires_at<now() AS expired,updated_at<now()-interval '2 minutes' AS stale "+
   'FROM satori_v2_grok_cancel_requests WHERE id=$1 FOR UPDATE',[id]);
  need(r.rows.length===1,'CANCEL_REQUEST_NOT_FOUND','Không tìm thấy yêu cầu hủy.');
  row=r.rows[0];previous=row.status;
  if(row.status==='cancelled'){await client.query('COMMIT');return doneReply(row,true)}
  need(row.status!=='rejected','CANCEL_REQUEST_CLOSED','Yêu cầu hủy đã bị từ chối ('+(row.last_note||'')+'). Tạo yêu cầu mới nếu cần.');
  if(row.status==='pending'&&row.expired){
   await client.query("UPDATE satori_v2_grok_cancel_requests SET status='expired',updated_at=now() WHERE id=$1",[id]);
   await client.query('COMMIT');
   bad('CANCEL_REQUEST_EXPIRED','Yêu cầu hủy đã quá '+CANCEL_TTL_MINUTES+' phút. Chưa hủy gì; tạo yêu cầu mới.');
  }
  need(row.status!=='expired','CANCEL_REQUEST_EXPIRED','Yêu cầu hủy đã hết hạn. Chưa hủy gì; tạo yêu cầu mới.');
  need(row.status!=='submitting'||row.stale,'CANCEL_IN_PROGRESS','Yêu cầu hủy đang được xử lý; đợi rồi gọi lại.');
  if(row.status==='submitting')previous='uncertain';
  // One dispatcher only: a parallel confirm now sees a fresh 'submitting'.
  await client.query("UPDATE satori_v2_grok_cancel_requests SET status='submitting',confirmed_at=coalesce(confirmed_at,now()),"+
   'confirmed_by=$2,updated_at=now() WHERE id=$1',[id,CANCEL_ACTOR]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
 finally{client.release()}

 const back=previous==='uncertain'?'uncertain':'pending';
 for(let attempt=0;attempt<2;attempt++){
  let cur;
  try{cur=await exactOrder(reader,{invoiceNo:Number(row.invoice_no),orderId:row.ledger_id})}
  catch(e){
   if(e instanceof GrokOrderError&&FINAL_REFUSALS.has(e.code)){await setState(pool,id,'rejected',e.code);throw e}
   await setState(pool,id,back,'READ_FAILED');
   bad('LEDGER_UNAVAILABLE','Chưa đọc được sổ; chưa hủy. Gọi lại satori_order_cancel_confirm với cùng cancelRequestId.');
  }
  const o=cur.order;
  const alreadyCancelled=String(o.status)==='Đã hủy';
  if(!alreadyCancelled){
   if(norm(o.name)!==norm(row.expected_name)||String(Number(o.total))!==String(Number(row.expected_total))){
    await setState(pool,id,'rejected','ORDER_CHANGED');
    bad('ORDER_CHANGED','Hóa đơn #'+Number(row.invoice_no)+' đã thay đổi (tên/tổng) sau khi yêu cầu. Chưa hủy; xem lại rồi tạo yêu cầu mới.');
   }
   const refusal=cancelRefusal(o);
   if(refusal){await setState(pool,id,'rejected',refusal[0]);bad(...refusal)}
  }
  let result;
  try{
   result=await relay.cancel({requestId:row.request_id,expectedRevision:cur.revision,invoiceNo:Number(row.invoice_no),
    id:String(row.ledger_id),expectedName:String(row.expected_name),expectedTotal:Number(row.expected_total),
    reason:String(row.reason),actor:CANCEL_ACTOR,confirmed:true});
  }catch(e){
   const code=e?.code||'ERROR';
   if(code==='LEDGER_REVISION_CONFLICT'&&attempt===0)continue; // nothing written; re-read and retry once
   if(code==='ALREADY_CANCELLED'){
    // Cancelled by someone else (not this request): never cancel twice.
    await setState(pool,id,'rejected','ALREADY_CANCELLED');
    return {ok:true,state:'ALREADY_CANCELLED',invoiceNo:Number(row.invoice_no),
     message:'Hóa đơn #'+Number(row.invoice_no)+' đã ở trạng thái Đã hủy từ trước (không phải yêu cầu này). Không hủy lần hai.'};
   }
   if(FINAL_REFUSALS.has(code)){await setState(pool,id,'rejected',code);bad(code,'Sổ từ chối hủy hóa đơn #'+Number(row.invoice_no)+' ('+code+'). Chưa hủy.')}
   if(['LEDGER_ACTION_NOT_DEPLOYED','LEDGER_SCOPE_MISSING','LEDGER_REVISION_CONFLICT'].includes(code)){
    await setState(pool,id,back,code);
    bad(code==='LEDGER_REVISION_CONFLICT'?'RETRY':'WRITER_NOT_READY',code==='LEDGER_REVISION_CONFLICT'?
     'Sổ đang thay đổi liên tục; chưa hủy. Gọi lại với cùng cancelRequestId.':
     'Apps Script chưa có lệnh orders.cancel hoặc khóa ghi V2 chưa có quyền orders:cancel. Chưa hủy gì.');
   }
   await setState(pool,id,'uncertain',code);
   return {ok:false,state:'UNCERTAIN',message:'Chưa xác minh được kết quả hủy. Gọi lại satori_order_cancel_confirm với cùng cancelRequestId (an toàn, không hủy hai lần).'};
  }
  // Exact readback: the ledger row must now be "Đã hủy" and still present.
  try{
   const after=await exactOrder(reader,{invoiceNo:Number(row.invoice_no),orderId:row.ledger_id});
   if(String(after.order.status)==='Đã hủy'){
    await setState(pool,id,'cancelled',null,',cancelled_at=coalesce(cancelled_at,now())'+
     (Number.isSafeInteger(result?.revision)?',ledger_revision='+result.revision:''));
    return doneReply(row,result?.data?.duplicate===true);
   }
  }catch{}
  await setState(pool,id,'uncertain','NO_READBACK');
  return {ok:false,state:'UNCERTAIN',message:'Đã gửi lệnh hủy nhưng chưa đọc lại được trạng thái. Gọi lại satori_order_cancel_confirm với cùng cancelRequestId.'};
 }
 await setState(pool,id,back,'REVISION_CONFLICT');
 return {ok:false,state:'RETRY',message:'Sổ vừa thay đổi; chưa hủy. Gọi lại satori_order_cancel_confirm với cùng cancelRequestId.'};
}

export const GROK_CANCEL_TOOLS=[
 {name:'satori_order_cancel_request',title:'Minh Satori: yêu cầu hủy hóa đơn (chưa hủy)',
  description:'Bước 1 hủy MỀM: đọc đúng hóa đơn, kiểm tra được phép hủy (chưa thanh toán, chưa hủy), trả summary + cancelRequestId. '+
   'KHÔNG ghi sổ. Gửi nguyên summary cho chủ cửa hàng và chờ họ trả lời "ok" trong tin nhắn mới.',
  inputSchema:{type:'object',required:['reason'],additionalProperties:false,properties:{
   invoiceNo:{type:'integer',minimum:1,description:'Số hóa đơn (Hƒ)'},orderId:{type:['string','integer'],description:'Số hóa đơn hoặc ledgerId'},
   reason:{type:'string',minLength:3,maxLength:300,description:'Lý do hủy, đúng lời chủ cửa hàng'}}},
  annotations:{readOnlyHint:true,openWorldHint:false}},
 {name:'satori_order_cancel_confirm',title:'Minh Satori: xác nhận hủy mềm hóa đơn',
  description:'Bước 2: CHỈ gọi sau khi chủ cửa hàng trả lời "ok" cho summary hủy. Đánh dấu hóa đơn "Đã hủy" (giữ trong sổ và lịch sử, '+
   'không tính công nợ). Gọi lại với cùng cancelRequestId không hủy hai lần. Hết hạn 30 phút.',
  inputSchema:{type:'object',required:['cancelRequestId'],additionalProperties:false,properties:{cancelRequestId:{type:'string'}}},
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}}
];

/** deps: {reader, cancelRelayFactory, env} */
export async function callGrokCancelTool(pool,deps,name,args={}){
 const env=deps.env||process.env;
 if(name==='satori_order_cancel_request')return requestCancel(pool,deps.reader,args,env);
 if(name==='satori_order_cancel_confirm')return confirmCancel(pool,deps.reader,deps.cancelRelayFactory,args,env);
 bad('UNKNOWN_TOOL','Công cụ không tồn tại.');
}
