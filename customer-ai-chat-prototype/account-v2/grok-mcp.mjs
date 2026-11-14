/**
 * Grok custom connector (MCP, Streamable HTTP, JSON responses) for the owner's
 * PDF delivery queue. grok.com custom connectors accept only a name and a
 * server URL, so access is a capability URL: /mcp/grok/<SATORI_GROK_MCP_TOKEN>.
 *
 * Phase A scope (deliberately small):
 *  - satori_pending_pdf_deliveries: NEW verified invoices still to send.
 *  - satori_mark_pdf_delivered: record sent / failed / skipped (idempotent).
 * Grok fetches the official PDF with the existing satori_invoice_pdf tool of
 * the minh-satori connector and sends it with Zalo Desktop on the owner's PC.
 *
 * No invoice, payment, VAT, shipping or ledger write is possible here. The
 * endpoint is disabled unless SATORI_GROK_MCP_ENABLED=1 and a token of at
 * least 40 characters is configured. Tokens are never logged.
 */
import crypto from 'node:crypto';
import {invoicePdfFilename} from './pdf-filename.mjs';
import {ownerPdfDownloadPath} from './owner-pdf-delivery.mjs';
import {GROK_ORDER_TOOLS,GROK_ORDER_TOOL_NAMES,GrokOrderError,callGrokOrderTool,grokOrdersEnabled} from './grok-orders.mjs';

export const GROK_MCP_PREFIX='/mcp/grok/';
const PROTOCOL_VERSIONS=['2025-06-18','2025-03-26','2024-11-05'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY=64*1024;

export function grokMcpConfig(env=process.env){
 const token=String(env.SATORI_GROK_MCP_TOKEN||'');
 if(env.SATORI_GROK_MCP_ENABLED!=='1')return {enabled:false,reason:'GROK_MCP_DISABLED'};
 if(token.length<40||!/^[A-Za-z0-9_-]+$/.test(token))return {enabled:false,reason:'GROK_MCP_TOKEN_INVALID'};
 return {enabled:true,token};
}

/** Constant-time check of the path token; false for any malformed path. */
export function grokPathAuthorized(pathname,env=process.env){
 const cfg=grokMcpConfig(env);
 if(!cfg.enabled||!String(pathname).startsWith(GROK_MCP_PREFIX))return false;
 const given=Buffer.from(String(pathname).slice(GROK_MCP_PREFIX.length).replace(/\/+$/,''));
 const want=Buffer.from(cfg.token);
 return given.length===want.length&&crypto.timingSafeEqual(given,want);
}

/** The two-line Zalo text agreed with the owner: invoice number, then recipient. */
export function deliveryText(row){
 return 'Hóa đơn #'+row.invoice_no+'\n'+(row.recipient_name||'');
}

export const GROK_TOOLS=[
 {name:'satori_pending_pdf_deliveries',
  title:'Minh Satori: PDF hóa đơn mới cần gửi Zalo',
  description:'Danh sách hóa đơn MỚI đã xác minh trong sổ Minh Satori mà chưa gửi PDF. '+
   'KHÔNG chia sẻ file đính kèm tạm từ công cụ satori_invoice_pdf hoặc file chat AI vào Zalo: hệ thống trung gian có thể chèn UUID. '+
   'Mở ownerDownloadPath trên trình duyệt Owner, hoặc dùng mục 📄 PDF của /owner-v2 để tải file thật vào Downloads trước khi gửi. '+
   'hoặc đổi tên tệp vật lý theo fileName, không dùng UUID/ledgerId/ID tạm trong tên tệp, '+
   'gửi PDF kèm đúng nội dung zaloText qua Zalo Desktop tới người/nhóm chủ cửa hàng chỉ định, '+
   'rồi gọi satori_mark_pdf_delivered. Không tự sửa giá, khách hay nội dung tin.',
  inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:20,default:10}},
   additionalProperties:false},
  annotations:{readOnlyHint:true,openWorldHint:false}},
 {name:'satori_mark_pdf_delivered',
  title:'Minh Satori: ghi nhận đã gửi PDF',
  description:'Ghi kết quả PDF: sent (đã gửi), failed hoặc skipped. '+
   'Nếu sent: BẮT BUỘC cung cấp actualFileName từ tệp THỰC TẾ đưa vào Zalo; '+
   'phải khớp hoàn toàn fileName của satori_pending_pdf_deliveries. '+
   'UUID hoặc tên tạm bị chặn. Không gọi sent nếu mới tải tệp nhưng chưa gửi.',
  inputSchema:{type:'object',required:['deliveryId','status'],properties:{
   deliveryId:{type:'string',description:'deliveryId từ satori_pending_pdf_deliveries'},
   status:{type:'string',enum:['sent','failed','skipped']},
   note:{type:'string',maxLength:200,description:'Ghi chú ngắn, không chứa dữ liệu khách'},
   actualFileName:{type:'string',maxLength:180,description:'Tên PDF thực tế được gửi vào Zalo, bắt buộc cho sent; đúng fileName đã xác thực'}} ,
   additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}}
];

const toolError=text=>({content:[{type:'text',text}],isError:true});
const toolOk=data=>({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data});

export async function callGrokTool(pool,name,args={}){
 if(name==='satori_pending_pdf_deliveries'){
  const limit=Math.min(20,Math.max(1,Number.isSafeInteger(args.limit)?args.limit:10));
  const r=await pool.query('SELECT id,invoice_no,ledger_id,recipient_name,order_date,status,attempts,created_at '+
   "FROM satori_v2_owner_pdf_deliveries WHERE status IN ('pending','failed') AND attempts<10 "+
   "AND created_at>now()-interval '7 days' ORDER BY created_at LIMIT $1",[limit]);
  return toolOk({count:r.rows.length,deliveries:r.rows.map(x=>{
   let fileName=null,ownerDownloadPath=null;
   try{
    fileName=invoicePdfFilename({invoiceNo:Number(x.invoice_no),
     recipientName:x.recipient_name,date:x.order_date});
    ownerDownloadPath=ownerPdfDownloadPath({invoiceNo:Number(x.invoice_no),ledgerId:x.ledger_id});
   }catch{}
   return {deliveryId:x.id,invoiceNo:Number(x.invoice_no),ledgerId:x.ledger_id,
    recipientName:x.recipient_name,orderDate:x.order_date,fileName,ownerDownloadPath,
    requiresFilenameVerification:!fileName,zaloText:deliveryText(x),
    status:x.status,attempts:x.attempts,createdAt:x.created_at};
  })});
 }
 if(name==='satori_mark_pdf_delivered'){
  if(!UUID.test(String(args.deliveryId||'')))return toolError('deliveryId không hợp lệ.');
  if(!['sent','failed','skipped'].includes(args.status))return toolError('status phải là sent, failed hoặc skipped.');
  const note=typeof args.note==='string'?args.note.replace(/[\u0000-\u001f]/g,' ').slice(0,200):null;
  if(args.status==='sent'){
   const check=await pool.query('SELECT invoice_no,recipient_name,order_date,status '+
    'FROM satori_v2_owner_pdf_deliveries WHERE id=$1',[args.deliveryId.toLowerCase()]);
   if(!check.rows.length)return toolError('Không tìm thấy mục giao PDF.');
   if(check.rows[0].status==='pending'||check.rows[0].status==='failed'){
    let expected;
    try{expected=invoicePdfFilename({invoiceNo:Number(check.rows[0].invoice_no),
     recipientName:check.rows[0].recipient_name,date:check.rows[0].order_date})}catch{
     return toolError('Không có ngày order gốc đã xác minh. Không thể đánh dấu đã gửi.');
    }
    if(typeof args.actualFileName!=='string'||args.actualFileName!==expected)
     return toolError('Sai tên PDF. Phải tải/đổi tên tệp thành: '+expected);
   }
  }
  // A delivery already marked sent/skipped is final: retries never resend it.
  const r=await pool.query('UPDATE satori_v2_owner_pdf_deliveries SET status=$2,last_note=$3,'+
   "attempts=attempts+CASE WHEN $2='failed' THEN 1 ELSE 0 END,updated_at=now(),"+
   "delivered_at=CASE WHEN $2='sent' THEN now() ELSE delivered_at END "+
   "WHERE id=$1 AND status IN ('pending','failed') RETURNING id,invoice_no,status",
   [args.deliveryId.toLowerCase(),args.status,note]);
  if(r.rows.length)return toolOk({ok:true,deliveryId:r.rows[0].id,invoiceNo:Number(r.rows[0].invoice_no),status:r.rows[0].status});
  const cur=await pool.query('SELECT status,invoice_no FROM satori_v2_owner_pdf_deliveries WHERE id=$1',[args.deliveryId.toLowerCase()]);
  if(!cur.rows.length)return toolError('Không tìm thấy mục giao PDF này.');
  return toolOk({ok:true,alreadyFinal:true,invoiceNo:Number(cur.rows[0].invoice_no),status:cur.rows[0].status});
 }
 return toolError('Công cụ không tồn tại: '+String(name).slice(0,60));
}

const rpcError=(id,code,message)=>({jsonrpc:'2.0',id:id??null,error:{code,message}});
/** Phase A tools always; Phase B order tools only when GROK_OWNER_WRITES_ENABLED=1. */
export const grokToolList=(env=process.env)=>grokOrdersEnabled(env)?[...GROK_TOOLS,...GROK_ORDER_TOOLS]:GROK_TOOLS;

/** Handles one JSON-RPC message; returns a response object or null for notifications. */
export async function handleGrokRpc(pool,msg,deps={}){
 const env=deps.env||process.env;
 if(!msg||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return rpcError(msg?.id,-32600,'Invalid Request');
 const isNotification=msg.id===undefined;
 if(isNotification)return null;
 const id=msg.id;
 try{
  if(msg.method==='initialize'){
   const asked=msg.params?.protocolVersion;
   return {jsonrpc:'2.0',id,result:{
    protocolVersion:PROTOCOL_VERSIONS.includes(asked)?asked:PROTOCOL_VERSIONS[0],
    capabilities:{tools:{listChanged:false}},
    serverInfo:{name:'minh-satori-grok-delivery',version:'1.0.0'},
    instructions:'Hàng đợi gửi PDF hóa đơn mới của Minh Satori. Chỉ gửi đúng nội dung zaloText kèm PDF '+
     'chính thức từ ownerDownloadPath hoặc trang /owner-v2 trên Chrome đã đăng nhập Owner; không gửi tệp tạm của AI. '+
     'Nếu không thể tải tệp có fileName chuẩn, không gửi Zalo và không đánh dấu sent; '+
     'không gắn ID tạm/UUID. Nếu thiếu fileName phải xác minh ngày từ PDF gốc, tuyệt đối không dùng ngày tải; '+
     'chỉ sau khi gửi Zalo và kiểm tra tên file thực tế mới ghi satori_mark_pdf_delivered '+
     '(sent và actualFileName bằng đúng fileName).'+
     (grokOrdersEnabled(env)?' Tạo đơn: satori_find_customer -> satori_order_draft -> gửi summary cho chủ cửa hàng -> '+
      'chỉ khi chủ cửa hàng gõ lại mã duyệt mới gọi satori_order_confirm.':'')}};
  }
  if(msg.method==='ping')return {jsonrpc:'2.0',id,result:{}};
  if(msg.method==='tools/list')return {jsonrpc:'2.0',id,result:{tools:grokToolList(env)}};
  if(msg.method==='tools/call'){
   const name=msg.params?.name,args=msg.params?.arguments||{};
   if(!grokToolList(env).some(t=>t.name===name))return rpcError(id,-32602,'Unknown tool');
   if(GROK_ORDER_TOOL_NAMES.includes(name)){
    try{return {jsonrpc:'2.0',id,result:toolOk(await callGrokOrderTool(pool,deps,name,args))}}
    catch(e){
     // Business errors carry a safe Vietnamese message; anything else stays generic.
     if(e instanceof GrokOrderError)return {jsonrpc:'2.0',id,result:toolError(e.code+': '+e.message)};
     throw e;
    }
   }
   return {jsonrpc:'2.0',id,result:await callGrokTool(pool,name,args)};
  }
  return rpcError(id,-32601,'Method not found');
 }catch{
  // Never echo database/driver errors (could contain data) to the model.
  return {jsonrpc:'2.0',id,result:toolError('Máy chủ Minh Satori tạm lỗi, vui lòng thử lại sau.')};
 }
}

async function readBody(req){
 const chunks=[];let n=0;
 for await(const c of req){n+=c.length;if(n>MAX_BODY)throw Object.assign(new Error('TOO_LARGE'),{status:413});chunks.push(c)}
 return Buffer.concat(chunks).toString('utf8');
}
function sendJson(res,status,body){
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
 res.end(body===undefined?'':JSON.stringify(body));
}

/** HTTP entry. Returns true when the request was for this endpoint. */
export async function handleGrokMcpHttp(req,res,pathname,getPool,env=process.env,deps={}){
 deps={env,...deps};
 if(!String(pathname).startsWith(GROK_MCP_PREFIX))return false;
 // Same 404 for disabled, wrong token and malformed path: no probing signal.
 if(!grokPathAuthorized(pathname,env)){sendJson(res,404,{ok:false,error:'NOT_FOUND'});return true}
 if(req.method==='GET'||req.method==='DELETE'){res.writeHead(405,{allow:'POST'});res.end();return true}
 if(req.method!=='POST'){res.writeHead(405,{allow:'POST'});res.end();return true}
 let payload;
 try{payload=JSON.parse(await readBody(req))}
 catch(e){sendJson(res,e?.status===413?413:400,rpcError(null,-32700,'Parse error'));return true}
 const pool=await getPool();
 const { ensureOwnerPushSchema }=await import('./owner-push.mjs');
 await ensureOwnerPushSchema(pool);
 if(Array.isArray(payload)){
  const out=(await Promise.all(payload.slice(0,20).map(m=>handleGrokRpc(pool,m,deps)))).filter(Boolean);
  if(!out.length){res.writeHead(202);res.end();return true}
  sendJson(res,200,out);return true;
 }
 const out=await handleGrokRpc(pool,payload,deps);
 if(!out){res.writeHead(202);res.end();return true}
 sendJson(res,200,out);return true;
}
