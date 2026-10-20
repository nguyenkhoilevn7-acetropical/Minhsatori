/**
 * Minh Satori Customer AI Chat — entirely isolated SANDBOX server.
 * ZERO imports or writes to real Minh Satori Drive / Apps Script / GitHub production.
 * Node 20+, built-in modules only. Optional OPENAI_API_KEY for the ONLY AI provider.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST=process.env.DEMO_BIND||'127.0.0.1';
const PORT=Number(process.env.PORT||8787);
const MODEL=process.env.OPENAI_MODEL||'gpt-5-mini';
const DATA_DIR=path.resolve(process.env.DEMO_DATA_DIR||path.join(os.tmpdir(),'minh-satori-customer-chat-SANDBOX'));
fs.mkdirSync(DATA_DIR,{recursive:true});
const DATA_FILE=path.join(DATA_DIR,'orders.json');
const FIXTURES=Object.freeze({
 'demo-a':{id:'KH-DEMO-A',name:'Khách Demo A',phone:'000 000 0001',address:'123 Đường Thử Nghiệm, TP.HCM',discount:20,ship:8,favourite:'S5L',lastQty:10,uniqueFavourite:true},
 'demo-b':{id:'KH-DEMO-B',name:'Khách Demo B',phone:'000 000 0002',address:'456 Đường Mẫu, TP.HCM',discount:35,ship:8,favourite:'S500',lastQty:5,uniqueFavourite:false}
});
const PRODUCTS=Object.freeze({
 S5L:{name:'Nước tinh khiết Satori 5L có vòi',listPrice:110000},
 S500:{name:'Nước tinh khiết Satori 500ml',listPrice:98000},
 S350:{name:'Nước tinh khiết Satori 350ml',listPrice:88000}
});
const sessions=new Map(),quotes=new Map(),orders=new Map(),idempotency=new Map(),rate=new Map();
function safeJSON(s){try{return JSON.parse(s)}catch{return null}}
if(fs.existsSync(DATA_FILE))for(const o of safeJSON(fs.readFileSync(DATA_FILE,'utf8'))||[]){if(o?.ref&&o.sandbox)orders.set(o.ref,o);if(o?.requestId)idempotency.set(o.requestId,o.ref)}
function reply(res,status,obj){const body=JSON.stringify(obj);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'"});res.end(body)}
function fail(res,status,code,message){reply(res,status,{ok:false,error:code,message})}
function getProfile(token){return Object.hasOwn(FIXTURES,token)?FIXTURES[token]:null}
async function bodyJSON(req){const chunks=[];let size=0;for await(const buf of req){size+=buf.length;if(size>8_192)throw new Error('PAYLOAD_TOO_LARGE');chunks.push(buf)}return safeJSON(Buffer.concat(chunks).toString('utf8'))}
function rateLimit(req,token){const now=Date.now();const key=(req.socket.remoteAddress||'localhost')+'|'+token;const list=(rate.get(key)||[]).filter(t=>now-t<60000);if(list.length>=20)return false;list.push(now);rate.set(key,list);return true}
function money(v){return Math.round(v)}
const SCHEMA={type:'object',additionalProperties:false,properties:{intent:{type:'string',enum:['order','other']},sku:{type:'string',enum:['S5L','S500','S350','unknown']},qty:{type:'integer'},use_last_order:{type:'boolean'},receiver_or_phone_change:{type:'boolean'},address_change:{type:'boolean'},clarification:{type:'string'}},required:['intent','sku','qty','use_last_order','receiver_or_phone_change','address_change','clarification']};
async function openAIParse(message){
 const key=String(process.env.OPENAI_API_KEY||'').trim();
 if(!key)return {error:'AI_NOT_CONFIGURED'};
 if(/[^\x21-\x7e]/.test(key))return {error:'AI_KEY_FORMAT_INVALID'};
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12500);
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{
   method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},signal:controller.signal,
   body:JSON.stringify({model:MODEL,store:false,max_output_tokens:650,
    instructions:'Bạn là bộ bóc tách Ý ĐỊNH ĐẶT HÀNG trong tiếng Việt của Minh Satori. Chỉ xuất dữ liệu có cấu trúc. Không tính tiền, không chọn mức chiết khấu, không xác nhận tạo đơn. SKU: S5L = nước tinh khiết 5L, S500 = 500ml, S350 = 350ml. Nếu không chắc loại hàng thì sku unknown. "Như lần trước" => use_last_order true. Nếu tin nhắn yêu cầu thay địa chỉ, số điện thoại hoặc người nhận thì đánh dấu true, kể cả nếu thông tin không đầy đủ. Nếu không rõ lượng thì qty=0. Không được đoán giá.',
    input:[{role:'user',content:message}],text:{format:{type:'json_schema',name:'order_intent_v1',strict:true,schema:SCHEMA}}})});
  if(!response.ok){
   const detail=await response.json().catch(()=>null);
   const code=detail?.error?.code||detail?.error?.type;
   const hint=String(detail?.error?.message||detail?.message||'');
   if(/insufficient[_ ]quota|billing[_ ]hard[_ ]limit|exceeded your current quota|run out of credits|credit balance|no balance left/i.test(String(code)+' '+hint))return {error:'OPENAI_INSUFFICIENT_QUOTA'};
   if(/rate[_ ]limit[_ ]exceeded|rate limit reached|requests per min|tokens per min/i.test(String(code)+' '+hint))return {error:'OPENAI_RATE_LIMIT_EXCEEDED'};
   const allowed=['insufficient_quota','rate_limit_exceeded','invalid_api_key','model_not_found'];
   return {error:allowed.includes(code)?'OPENAI_'+code.toUpperCase():'OPENAI_HTTP_'+response.status};
  }
  const data=await response.json();
  const txt=(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
  if(!txt)return {error:'EMPTY_AI_OUTPUT'};
  const parsed=safeJSON(txt);if(!parsed||!['order','other'].includes(parsed.intent))return {error:'INVALID_AI_OUTPUT'};
  return parsed;
 }catch(err){
  const code=err?.cause?.code||err?.code;
  const allowed=['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ENETUNREACH','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','ERR_INVALID_CHAR','ERR_INVALID_HTTP_TOKEN','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE'];
  return {error:err.name==='AbortError'?'AI_TIMEOUT':allowed.includes(code)?'AI_NETWORK_'+code:'AI_REQUEST_ERROR'}
 }finally{clearTimeout(timer)}
}
function makeQuote(token,profile,sku,qty){
 if(!PRODUCTS[sku]||!Number.isSafeInteger(qty)||qty<1||qty>500)return null;
 const product=PRODUCTS[sku];const unitPrice=money(product.listPrice*(1-profile.discount/100));const subtotal=qty*unitPrice;const shipping=money(subtotal*profile.ship/100);const q={quoteId:crypto.randomUUID(),profileId:profile.id,sku,qty,name:profile.name,phone:profile.phone,address:profile.address,discount:profile.discount,ship:profile.ship,unitPrice,product:product.name,subtotal,shipping,total:subtotal+shipping,expiresAt:Date.now()+10*60_000,token};quotes.set(q.quoteId,q);return q;
}
function saveOrdersAtomic(){const data=JSON.stringify([...orders.values()],null,2);const tmp=DATA_FILE+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,data,{mode:0o600});fs.renameSync(tmp,DATA_FILE)}
async function generatePdf(o){return new Promise((resolve,reject)=>{const proc=spawn('python3',[path.join(HERE,'invoice_pdf.py')],{stdio:['pipe','pipe','pipe']});const out=[],err=[];proc.stdout.on('data',d=>out.push(d));proc.stderr.on('data',d=>err.push(d));proc.on('error',reject);proc.on('close',code=>code===0?resolve(Buffer.concat(out)):reject(new Error(Buffer.concat(err).toString('utf8').slice(0,300)||'PDF_ERROR')));proc.stdin.end(JSON.stringify(o))})}
function sendHtml(res){const html=fs.readFileSync(path.join(HERE,'index.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'"});res.end(html)}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost'),p=url.pathname;
 if(req.method==='GET'&&p==='/health')return reply(res,200,{ok:true,sandbox:true,aiProvider:'OpenAI only',aiConfigured:!!String(process.env.OPENAI_API_KEY||'').trim(),model:MODEL,orders:orders.size});
 if(req.method==='GET'&&/^\/c\/demo-[ab]$/.test(p))return sendHtml(res);
 if(req.method==='GET'&&p==='/api/session'){
  const token=url.searchParams.get('token')||'';const c=getProfile(token);if(!c)return fail(res,404,'LINK_INVALID','Liên kết không hợp lệ');
  return reply(res,200,{ok:true,sandbox:true,provider:'OpenAI',aiConfigured:!!String(process.env.OPENAI_API_KEY||'').trim(),profile:{id:c.id,name:c.name,phone:c.phone,address:c.address,discount:c.discount,ship:c.ship}})
 }
 if(req.method==='POST'&&p==='/api/message'){
  const b=await bodyJSON(req);const token=b?.token;const c=getProfile(token);if(!c)return fail(res,403,'INVALID_LINK','Không thể nhận diện link khách');
  if(!rateLimit(req,token))return fail(res,429,'RATE_LIMIT','Bạn đã gửi quá nhiều tin nhắn, vui lòng thử lại sau');
  const message=String(b?.message||'').trim();if(!message||message.length>500)return fail(res,400,'BAD_MESSAGE','Tin nhắn phải dài 1–500 ký tự');
  const normalized=message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
  const explicitChange=/(giao (den|toi|ve) (dia chi|noi|cho) khac|doi dia chi|dia chi moi|so dien thoai moi|sdt moi|doi nguoi nhan|nguoi nhan khac)/.test(normalized);
  if(explicitChange)return reply(res,200,{ok:true,needsHuman:true,message:'Bạn yêu cầu đổi người nhận, số điện thoại hoặc địa chỉ. Cửa hàng cần xác minh và duyệt thủ công; không tự áp dụng chiết khấu riêng.'});
  const parsed=await openAIParse(message);
  if(parsed.error)return fail(res,503,parsed.error,'OpenAI chưa sẵn sàng ('+parsed.error+'). Không tạo đơn và không áp dụng giá khi AI gặp lỗi.');
  if(parsed.address_change||parsed.receiver_or_phone_change)return reply(res,200,{ok:true,needsHuman:true,message:'Bạn yêu cầu thay địa chỉ, SĐT hoặc người nhận. Mức chiết khấu riêng sẽ không được áp dụng tự động; cửa hàng cần kiểm tra thủ công.'});
  if(parsed.intent!=='order')return reply(res,200,{ok:true,message:'Mình có thể hỗ trợ đặt nước. Bạn muốn đặt loại 350ml, 500ml hay 5L và bao nhiêu thùng?'});
  const sku=parsed.sku!=='unknown'?parsed.sku:(parsed.use_last_order||c.uniqueFavourite)?c.favourite:null, qty=parsed.qty>0?parsed.qty:parsed.use_last_order?c.lastQty:0;
  if(!sku||qty<1)return reply(res,200,{ok:true,needMoreDetails:true,message:'Mình chưa xác định đủ loại nước và số thùng. Bạn vui lòng cho biết rõ nhé.'});
  const quote=makeQuote(token,c,sku,qty);if(!quote)return fail(res,400,'INVALID_QUANTITY','Chỉ chấp nhận tối đa 500 thùng một đơn');
  return reply(res,200,{ok:true,sandbox:true,message:'Mình đã lập báo giá theo cấu hình khách THỬ. Bạn xem lại và xác nhận nhé.',quote});
 }
 if(req.method==='POST'&&p==='/api/confirm'){
  const b=await bodyJSON(req),token=b?.token,c=getProfile(token);if(!c)return fail(res,403,'INVALID_LINK','Không có quyền');
  const key=String(b.requestId||'');if(!/^[a-z0-9-]{8,80}$/i.test(key))return fail(res,400,'BAD_REQUEST_ID','Thiếu mã chống gửi trùng');
  const idemKey=token+'|'+key;if(idempotency.has(idemKey))return reply(res,200,{ok:true,duplicate:true,order:orders.get(idempotency.get(idemKey))});
  const q=quotes.get(b.quoteId);if(!q||q.token!==token||q.expiresAt<Date.now())return fail(res,409,'QUOTE_EXPIRED','Báo giá hết hạn hoặc không thuộc khách này');
  if(q.profileId!==c.id||q.discount!==c.discount||q.ship!==c.ship||q.address!==c.address||q.phone!==c.phone)return fail(res,409,'PROFILE_CHANGED','Thông tin khách đã thay đổi, cần lập lại báo giá');
  const o={...q,ref:'TEST-'+crypto.randomBytes(5).toString('hex').toUpperCase(),requestId:idemKey,createdAt:new Date().toISOString(),status:'Chờ thanh toán',sandbox:true};
  orders.set(o.ref,o);idempotency.set(idemKey,o.ref);saveOrdersAtomic();quotes.delete(q.quoteId);
  return reply(res,200,{ok:true,duplicate:false,order:o});
 }
 if(req.method==='GET'&&p.startsWith('/api/invoice/')){
  const ref=decodeURIComponent(p.slice('/api/invoice/'.length)),token=url.searchParams.get('token'),o=orders.get(ref);
  if(!o||o.token!==token)return fail(res,404,'NOT_FOUND','Không tìm thấy hóa đơn thử');
  try{const buf=await generatePdf(o);res.writeHead(200,{'content-type':'application/pdf','content-disposition':'attachment; filename="'+o.ref+'.pdf"','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(buf)}catch(err){return fail(res,503,'PDF_FAILED','Không tạo được PDF. Kiểm tra python3, reportlab và font tiếng Việt.')}
  return;
 }
 return fail(res,404,'NOT_FOUND','Không có đường dẫn này');
 }catch(err){return fail(res,err.message==='PAYLOAD_TOO_LARGE'?413:500,'SERVER_ERROR','Lỗi xử lý yêu cầu thử nghiệm')}
});
server.listen(PORT,HOST,()=>console.log('Minh Satori Customer AI Chat SANDBOX http://'+HOST+':'+PORT+'/c/demo-a | provider OpenAI | production untouched'));
