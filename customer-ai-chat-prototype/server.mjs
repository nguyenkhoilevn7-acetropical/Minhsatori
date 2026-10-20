/**
 * Minh Satori Customer AI Chat — entirely isolated SANDBOX server.
 * ZERO imports or writes to real Minh Satori Drive / Apps Script / GitHub production.
 * Node 20+, built-in modules only. Rule-first, optional Gemini Developer API Free Tier.
 * Work's original OpenAI build remains untouched on its separate GitHub branch.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {parseOrder,parseRules,geminiConfigured} from './free-parser.mjs';
import {CATALOGUE,productFor,productList,resolveProduct} from './catalogue.mjs';
import {makeCustomerLinks} from './customer-links.mjs';
import {extractDeliveryIntent} from './delivery-intent.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST=process.env.DEMO_BIND||'127.0.0.1';
const PORT=Number(process.env.PORT||8787);
const MODEL='gemini-3.5-flash-lite';
const DATA_DIR=path.resolve(process.env.DEMO_DATA_DIR||path.join(os.tmpdir(),'minh-satori-customer-chat-SANDBOX'));
fs.mkdirSync(DATA_DIR,{recursive:true});
const DATA_FILE=path.join(DATA_DIR,'orders.json');
const customerLinks=makeCustomerLinks(DATA_DIR);
const FIXTURES=Object.freeze({
 'demo-a':{id:'KH-DEMO-A',name:'Khách Demo A',phone:'000 000 0001',address:'123 Đường Thử Nghiệm, TP.HCM',discount:20,ship:8,favourite:'S5L',lastQty:10,uniqueFavourite:true},
 'demo-b':{id:'KH-DEMO-B',name:'Khách Demo B',phone:'000 000 0002',address:'456 Đường Mẫu, TP.HCM',discount:35,ship:8,favourite:'S500',lastQty:5,uniqueFavourite:false}
});
const sessions=new Map(),quotes=new Map(),orders=new Map(),idempotency=new Map(),rate=new Map();
const geminiProbe={status:'not_run',elapsedMs:null};
function safeJSON(s){try{return JSON.parse(s)}catch{return null}}
if(fs.existsSync(DATA_FILE))for(const o of safeJSON(fs.readFileSync(DATA_FILE,'utf8'))||[]){if(o?.ref&&o.sandbox)orders.set(o.ref,o);if(o?.requestId)idempotency.set(o.requestId,o.ref)}
function reply(res,status,obj){const body=JSON.stringify(obj);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'"});res.end(body)}
function fail(res,status,code,message){reply(res,status,{ok:false,error:code,message})}
function getProfile(token){return Object.hasOwn(FIXTURES,token)?FIXTURES[token]:customerLinks.getProfile(token)}
async function bodyJSON(req){const chunks=[];let size=0;for await(const buf of req){size+=buf.length;if(size>8_192)throw new Error('PAYLOAD_TOO_LARGE');chunks.push(buf)}return safeJSON(Buffer.concat(chunks).toString('utf8'))}
function rateLimit(req,token){const now=Date.now();const key=(req.socket.remoteAddress||'localhost')+'|'+token;const list=(rate.get(key)||[]).filter(t=>now-t<60000);if(list.length>=20)return false;list.push(now);rate.set(key,list);return true}
function money(v){return Math.round(v)}
function normalizeDeliveryNote(value){if(value==null)return '';if(typeof value!=='string'||value.length>300)throw new Error('INVALID_DELIVERY_NOTE');return value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()}

// Pricing, discounts, identity and persistence are server-owned; AI only parses messages.
function makeQuote(token,profile,sku,qty){
 if(!productFor(sku)||!Number.isSafeInteger(qty)||qty<1||qty>500)return null;
 const product=productFor(sku);const unitPrice=money(product.listPrice*(1-profile.discount/100));const subtotal=qty*unitPrice;const shipping=money(subtotal*profile.ship/100);const q={quoteId:crypto.randomUUID(),profileId:profile.id,sku,qty,name:profile.name,phone:profile.phone,address:profile.address,discount:profile.discount,ship:profile.ship,unitPrice,product:product.name,code:product.code,unit:product.unit,spec:product.spec,listPrice:product.listPrice,subtotal,shipping,total:subtotal+shipping,expiresAt:Date.now()+10*60_000,token};quotes.set(q.quoteId,q);return q;
}
function saveOrdersAtomic(){const data=JSON.stringify([...orders.values()],null,2);const tmp=DATA_FILE+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,data,{mode:0o600});fs.renameSync(tmp,DATA_FILE)}
async function generatePdf(o){return new Promise((resolve,reject)=>{const proc=spawn('python3',[path.join(HERE,'invoice_pdf.py')],{stdio:['pipe','pipe','pipe']});const out=[],err=[];proc.stdout.on('data',d=>out.push(d));proc.stderr.on('data',d=>err.push(d));proc.on('error',reject);proc.on('close',code=>code===0?resolve(Buffer.concat(out)):reject(new Error(Buffer.concat(err).toString('utf8').slice(0,300)||'PDF_ERROR')));proc.stdin.end(JSON.stringify(o))})}
function sendHtml(res){const html=fs.readFileSync(path.join(HERE,'index.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'"});res.end(html)}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost'),p=url.pathname;
 if(req.method==='GET'&&p==='/assets/logo-satori.jpg'){const logo=path.join(HERE,'assets','logo-satori.jpg');if(!fs.existsSync(logo))return fail(res,404,'NO_LOGO','Không tìm thấy logo');res.writeHead(200,{'content-type':'image/jpeg','cache-control':'public, max-age=86400','x-content-type-options':'nosniff'});return fs.createReadStream(logo).pipe(res)}
 if(req.method==='GET'&&p==='/health')return reply(res,200,{ok:true,sandbox:true,aiProvider:'Gemini Free Tier (optional) + rules',aiConfigured:geminiConfigured(),rulesReady:true,model:MODEL,orders:orders.size,geminiProbe});
 if(req.method==='GET'&&/^\/c\/(?:demo-[ab]|[A-Za-z0-9_-]{40,96})$/.test(p))return sendHtml(res);
 if(req.method==='GET'&&p==='/admin'){const html=fs.readFileSync(path.join(HERE,'admin.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'"});return res.end(html)}
 if(await customerLinks.handleAdmin(req,res,url,bodyJSON))return;
 if(req.method==='GET'&&p==='/api/history')return customerLinks.history(res,url.searchParams.get('token')||'',orders,FIXTURES);
 if(req.method==='GET'&&p==='/api/catalogue'){
  const profile=getProfile(url.searchParams.get('token')||'');if(!profile)return fail(res,403,'DEMO_LINK_REQUIRED','Chỉ hiển thị giá riêng trong link khách thử hợp lệ');
  return reply(res,200,{ok:true,sandbox:true,source:'official-default-snapshot',catalogueSync:'snapshot_only',count:CATALOGUE.length,products:CATALOGUE.map(item=>({code:item.code,name:item.name,brand:item.brand,unit:item.unit,spec:item.spec,listPrice:item.listPrice,discount:profile.discount,unitPrice:money(item.listPrice*(1-profile.discount/100))}))});
 }
 if(req.method==='GET'&&p==='/api/session'){
  const token=url.searchParams.get('token')||'';const c=getProfile(token);if(!c)return fail(res,404,'LINK_INVALID','Liên kết không hợp lệ');
  return reply(res,200,{ok:true,sandbox:true,provider:'Gemini + rules',aiConfigured:geminiConfigured(),rulesReady:true,profile:{id:c.id,name:c.name,phone:c.phone,address:c.address,discount:c.discount,ship:c.ship}})
 }
 if(req.method==='POST'&&p==='/api/message'){
  const b=await bodyJSON(req);const token=b?.token;const c=getProfile(token);if(!c)return fail(res,403,'INVALID_LINK','Không thể nhận diện link khách');
  if(!rateLimit(req,token))return fail(res,429,'RATE_LIMIT','Bạn đã gửi quá nhiều tin nhắn, vui lòng thử lại sau');
  const message=String(b?.message||'').trim();if(!message||message.length>500)return fail(res,400,'BAD_MESSAGE','Tin nhắn phải dài 1–500 ký tự');
  const normalized=message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
  // Treat "thêm 3 thùng nữa" as an edit request, not a new independent order.
  if(/\bthem\b.*\b(nua|vao don)\b/.test(normalized))return reply(res,200,{ok:true,needMoreDetails:true,message:'Bạn muốn tăng số lượng của báo giá đang xem hay tạo đơn mới? Vui lòng nói rõ loại nước và tổng số thùng trước khi xác nhận.'});
  // A short answer to a clarification is merged with the *previous sandbox question*.
  // It never changes another customer's profile, discount, or price.
  const previous=sessions.get(token);
  let parsedMessage=message;
  if(previous?.pendingDeliveryMessage&&previous.expiresAt>Date.now()&&/^(?:(?:sau|luc|vao)\\s+)?\\d{1,2}\\s*(?:gio|h|tieng)\\s*(?:chieu|sang|trua|toi|dem|nua)$/i.test(normalized.trim())){
   const answer=normalized.trim();
   const suffix=/\\bnua$/.test(answer)?'giao sau '+answer.replace(/^sau\\s+/,''):'giao sau '+answer.replace(/^(luc|vao|sau)\\s+/,'');
   parsedMessage=previous.pendingDeliveryMessage.replace(/(?:giao|ship)\\s+sau\\s+\\d{1,2}\\s*(?:giờ|gio|h)\\b/iu,suffix);
  }else if(previous&&previous.expiresAt>Date.now()){
   const onlySku=normalized.trim().match(/^(?:nuoc\s+|loai\s+)?(5\s*l|500\s*ml|350\s*ml)$/);
   const onlyQty=normalized.trim().match(/^(\d{1,4})(?:\s*(?:thung|thg|t))?$/);
   if(onlySku&&previous.qty>0)parsedMessage='Cho '+previous.qty+' thùng nước '+onlySku[1];
   if(onlyQty&&previous.sku!=='unknown'&&productFor(previous.sku)){
    const item=productFor(previous.sku);
    parsedMessage='Cho '+onlyQty[1]+' '+item.unit+' '+item.name;
   }
   if(!onlyQty&&previous.qty>0&&/^(?:nuoc\s+)?(?:satori\s+)?(?:premium(?:\s*450\s*ml)?|350\s*ml|500\s*ml|1500\s*ml|5\s*l\s+(?:co|khong)\s+voi|mang\s+cau|oi\s+hong|hikari\s+500\s*ml)$/i.test(normalized.trim())){
    const found=resolveProduct(message,c);
    if(found.sku&&productFor(found.sku))parsedMessage='Cho '+previous.qty+' '+productFor(found.sku).unit+' '+productFor(found.sku).name;
   }
  }

  const explicitChange=/(giao (den|toi|ve) (dia chi|noi|cho) khac|doi dia chi|dia chi moi|so dien thoai moi|sdt moi|doi nguoi nhan|nguoi nhan khac)/.test(normalized);
  if(explicitChange)return reply(res,200,{ok:true,needsHuman:true,message:'Bạn yêu cầu đổi người nhận, số điện thoại hoặc địa chỉ. Cửa hàng cần xác minh và duyệt thủ công; không tự áp dụng chiết khấu riêng.'});
  const delivery=extractDeliveryIntent(parsedMessage,new Date());
  if(delivery.clarification){
   sessions.set(token,{pendingDeliveryMessage:parsedMessage,expiresAt:Date.now()+5*60_000});
   return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'DELIVERY_TIME',message:delivery.clarification});
  }
  const parsed=await parseOrder(parsedMessage,c);
  if(parsed.needsHuman)return reply(res,200,{ok:true,needsHuman:true,message:'Yêu cầu thay đổi người nhận, địa chỉ hoặc số điện thoại phải được cửa hàng xác minh trước khi áp dụng giá riêng.'});
  if(parsed.address_change||parsed.receiver_or_phone_change)return reply(res,200,{ok:true,needsHuman:true,message:'Bạn yêu cầu thay địa chỉ, SĐT hoặc người nhận. Mức chiết khấu riêng sẽ không được áp dụng tự động; cửa hàng cần kiểm tra thủ công.'});
  if(parsed.intent!=='order')return reply(res,200,{ok:true,message:'Mình có thể hỗ trợ đủ 20 sản phẩm Satori, Hikari và Juice. Bạn muốn đặt loại nào và bao nhiêu thùng, bình hoặc lốc?'});
  const sku=parsed.sku!=='unknown'?parsed.sku:(parsed.use_last_order||c.uniqueFavourite)?c.favourite:null, qty=parsed.qty>0?parsed.qty:parsed.use_last_order?c.lastQty:0;
  if(parsed.needMoreDetails||!sku||qty<1){
   const fields=parseRules(parsedMessage,c);
   if(fields?.intent==='order'&&!fields.needsHuman&&fields.reason!=='UNSUPPORTED'&&fields.reason!=='MULTI_SKU'){
    const savedSku=fields.sku&&fields.sku!=='unknown'?fields.sku:'unknown';
    const savedQty=Number.isSafeInteger(fields.qty)&&fields.qty>0?fields.qty:0;
    if(savedSku!=='unknown'||savedQty>0)sessions.set(token,{sku:savedSku,qty:savedQty,expiresAt:Date.now()+5*60_000});
   }
   return reply(res,200,{ok:true,needMoreDetails:true,message:fields?.reason==='UNSUPPORTED'?'Sản phẩm này chưa có trong danh mục Minh Satori. Bạn vui lòng chọn trong Tất cả sản phẩm.':!sku||parsed.reason==='PRODUCT_AMBIGUOUS'?'Bạn muốn đặt sản phẩm nào? Có thể chọn Premium 450ml, Hikari, Satori hoặc xem Tất cả sản phẩm.':'Bạn muốn đặt bao nhiêu '+(productFor(sku)?.unit||'đơn vị')+'?'});
  }
  const quote=makeQuote(token,c,sku,qty);if(!quote)return fail(res,400,'INVALID_QUANTITY','Chỉ chấp nhận tối đa 500 thùng một đơn');
  quote.deliveryNote=normalizeDeliveryNote(delivery.deliveryNote);
  quote.requestedDeliveryAt=delivery.requestedDeliveryAt;
  sessions.delete(token);
  return reply(res,200,{ok:true,sandbox:true,parserSource:parsed.source||'rules',message:'Mình đã lập báo giá theo cấu hình khách THỬ. Bạn xem lại và xác nhận nhé.',quote});
 }
 if(req.method==='POST'&&p==='/api/confirm'){
  const b=await bodyJSON(req),token=b?.token,c=getProfile(token);if(!c)return fail(res,403,'INVALID_LINK','Không có quyền');
  const key=String(b.requestId||'');if(!/^[a-z0-9-]{8,80}$/i.test(key))return fail(res,400,'BAD_REQUEST_ID','Thiếu mã chống gửi trùng');
  const idemKey=token+'|'+key;if(idempotency.has(idemKey))return reply(res,200,{ok:true,duplicate:true,order:orders.get(idempotency.get(idemKey))});
  const q=quotes.get(b.quoteId);if(!q||q.token!==token||q.expiresAt<Date.now())return fail(res,409,'QUOTE_EXPIRED','Báo giá hết hạn hoặc không thuộc khách này');
  if(q.profileId!==c.id||q.discount!==c.discount||q.ship!==c.ship||q.address!==c.address||q.phone!==c.phone)return fail(res,409,'PROFILE_CHANGED','Thông tin khách đã thay đổi, cần lập lại báo giá');
  let deliveryNote;
  try{deliveryNote=normalizeDeliveryNote(b?.deliveryNote??q.deliveryNote)}catch{return fail(res,400,'INVALID_DELIVERY_NOTE','Lưu ý giao hàng phải là văn bản tối đa 300 ký tự')}
  const o={...q,deliveryNote,ref:'TEST-'+crypto.randomBytes(5).toString('hex').toUpperCase(),requestId:idemKey,createdAt:new Date().toISOString(),status:'Chờ thanh toán',sandbox:true};
  delete o.token; // Do not write the bearer link credential into invoice/order storage.
  orders.set(o.ref,o);idempotency.set(idemKey,o.ref);saveOrdersAtomic();quotes.delete(q.quoteId);
  return reply(res,200,{ok:true,duplicate:false,order:o});
 }
 if(req.method==='GET'&&p.startsWith('/api/invoice/')){
  const ref=decodeURIComponent(p.slice('/api/invoice/'.length)),token=url.searchParams.get('token'),o=orders.get(ref);
  const c=getProfile(token);
  if(!o||!c||o.profileId!==c.id)return fail(res,404,'NOT_FOUND','Không tìm thấy hóa đơn thử');
  try{const buf=await generatePdf(o);res.writeHead(200,{'content-type':'application/pdf','content-disposition':'attachment; filename="'+o.ref+'.pdf"','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(buf)}catch(err){return fail(res,503,'PDF_FAILED','Không tạo được PDF. Kiểm tra python3, reportlab và font tiếng Việt.')}
  return;
 }
 return fail(res,404,'NOT_FOUND','Không có đường dẫn này');
 }catch(err){return fail(res,err.message==='PAYLOAD_TOO_LARGE'?413:500,'SERVER_ERROR','Lỗi xử lý yêu cầu thử nghiệm')}
});
server.listen(PORT,HOST,()=>{
 console.log('Minh Satori Customer AI Chat SANDBOX http://'+HOST+':'+PORT+'/c/demo-a | provider Gemini Free + rules | production untouched');
 // One test with fake words only, no customer data, no stored orders, no API key printed.
 // This is intentionally an actual Gemini API call, and consumes at most one Free Tier request per deployment.
 if(!geminiConfigured()){
  geminiProbe.status='missing_key_or_free_tier_flag';
  console.log('GEMINI_SANDBOX_PROBE missing_key_or_free_tier_flag');
 }else {
  geminiProbe.status='running';
  setTimeout(async()=>{
   const started=performance.now();
   try {
    const r=await parseOrder('Cho tôi 1 tá thùng nước Satori 5L',FIXTURES['demo-a']);
    geminiProbe.elapsedMs=Math.round(performance.now()-started);
    geminiProbe.status=r.source==='gemini'&&r.qty===12&&r.sku==='S5L'?'passed':'not_verified';
   }catch{geminiProbe.status='failed';geminiProbe.elapsedMs=Math.round(performance.now()-started)}
   console.log('GEMINI_SANDBOX_PROBE '+geminiProbe.status+' '+geminiProbe.elapsedMs+'ms');
  },500);
 }
});
