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
import {parseOrder,parseRules,geminiConfigured,identityChange} from './free-parser.mjs';
import {parseMultiOrder} from './multi-order.mjs';
import {CATALOGUE,productFor,productList,resolveProduct} from './catalogue.mjs';
import {makeCustomerLinks} from './customer-links.mjs';
import {extractDeliveryIntent} from './delivery-intent.mjs';
import {createSandboxBackup,verifySandboxBackup} from './sandbox-backup.mjs';
import {readMinhSatori,readOnlyReady} from './satori-readonly.mjs';
import {checkCatalogueParity} from './catalogue-parity.mjs';
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
// Backward-compatibility scrub: older TEST orders embedded the opaque customer URL
// credential into requestId. Replace it with a stable internal profile ID instead.
let scrubbedLegacyRequestIds=false;
if(fs.existsSync(DATA_FILE))for(const o of safeJSON(fs.readFileSync(DATA_FILE,'utf8'))||[]){
 if(!o?.ref||!o.sandbox)continue;
 if(typeof o.requestId==='string'&&typeof o.profileId==='string'){
  const separator=o.requestId.lastIndexOf('|');
  if(separator>0){
   const suffix=o.requestId.slice(separator+1);
   const safeKey=o.profileId+'|'+suffix;
   if(o.requestId!==safeKey){o.requestId=safeKey;scrubbedLegacyRequestIds=true}
  }
 }
 orders.set(o.ref,o);
 if(o.requestId)idempotency.set(o.requestId,o.ref);
}
function reply(res,status,obj){const body=JSON.stringify(obj);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'"});res.end(body)}
function fail(res,status,code,message){reply(res,status,{ok:false,error:code,message})}
function getProfile(token){return Object.hasOwn(FIXTURES,token)?FIXTURES[token]:customerLinks.getProfile(token)}
async function bodyJSON(req,maxBytes=8_192){const chunks=[];let size=0;for await(const buf of req){size+=buf.length;if(size>maxBytes)throw new Error('PAYLOAD_TOO_LARGE');chunks.push(buf)}return safeJSON(Buffer.concat(chunks).toString('utf8'))}
function rateLimit(req,token){const now=Date.now();const key=(req.socket.remoteAddress||'localhost')+'|'+token;const list=(rate.get(key)||[]).filter(t=>now-t<60000);if(list.length>=20)return false;list.push(now);rate.set(key,list);return true}
function money(v){return Math.round(v)}
function normalizeDeliveryNote(value){if(value==null)return '';if(typeof value!=='string'||value.length>300)throw new Error('INVALID_DELIVERY_NOTE');return value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()}

// Pricing, discounts, identity and persistence are server-owned; AI only parses messages.
function makeQuote(token,profile,sku,qty){
 if(!productFor(sku)||!Number.isSafeInteger(qty)||qty<1||qty>500)return null;
 const product=productFor(sku);const unitPrice=money(product.listPrice*(1-profile.discount/100));const subtotal=qty*unitPrice;const shipping=money(subtotal*profile.ship/100);const vatRate=profile.vatRate??0;const vatAmount=money(subtotal*vatRate/100);const q={quoteId:crypto.randomUUID(),profileId:profile.id,sku,qty,name:profile.name,phone:profile.phone,address:profile.address,discount:profile.discount,ship:profile.ship,unitPrice,product:product.name,code:product.code,unit:product.unit,spec:product.spec,listPrice:product.listPrice,subtotal,shipping,vatRate,vatAmount,total:subtotal+shipping+vatAmount,expiresAt:Date.now()+10*60_000,token};quotes.set(q.quoteId,q);return q;
}
function makeMultiQuote(token,profile,requestedItems){
 if(!Array.isArray(requestedItems)||requestedItems.length<2||requestedItems.length>6)return null;
 const totalQty=requestedItems.reduce((sum,x)=>sum+x.qty,0);
 if(totalQty>500||totalQty<2)return null;
 const items=requestedItems.map(({sku,qty})=>{
  const product=productFor(sku);
  if(!product||!Number.isSafeInteger(qty)||qty<1||qty>500)return null;
  const unitPrice=money(product.listPrice*(1-profile.discount/100));
  return {sku:product.code,code:product.code,product:product.name,unit:product.unit,spec:product.spec,qty,listPrice:product.listPrice,discount:profile.discount,unitPrice,subtotal:money(qty*unitPrice)};
 });
 if(items.some(x=>!x))return null;
 const subtotal=items.reduce((sum,x)=>sum+x.subtotal,0),shipping=money(subtotal*profile.ship/100),vatRate=profile.vatRate??0,vatAmount=money(subtotal*vatRate/100);
 const q={quoteId:crypto.randomUUID(),profileId:profile.id,sku:'MULTI',qty:totalQty,name:profile.name,phone:profile.phone,address:profile.address,discount:profile.discount,ship:profile.ship,product:items.length+' loại sản phẩm',unit:'đơn vị',items,subtotal,shipping,vatRate,vatAmount,total:subtotal+shipping+vatAmount,expiresAt:Date.now()+10*60_000,token};
 quotes.set(q.quoteId,q);return q;
}
function saveOrdersAtomic(){const data=JSON.stringify([...orders.values()],null,2);const tmp=DATA_FILE+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,data,{mode:0o600});fs.renameSync(tmp,DATA_FILE)}
if(scrubbedLegacyRequestIds)saveOrdersAtomic();
async function generatePdf(o){return new Promise((resolve,reject)=>{const proc=spawn('python3',[path.join(HERE,'invoice_pdf.py')],{stdio:['pipe','pipe','pipe']});const out=[],err=[];proc.stdout.on('data',d=>out.push(d));proc.stderr.on('data',d=>err.push(d));proc.on('error',reject);proc.on('close',code=>code===0?resolve(Buffer.concat(out)):reject(new Error(Buffer.concat(err).toString('utf8').slice(0,300)||'PDF_ERROR')));proc.stdin.end(JSON.stringify(o))})}
async function generateHistoryExcel(customerOrders){
 return new Promise((resolve,reject)=>{
  const proc=spawn('python3',[path.join(HERE,'history_excel.py')],{stdio:['pipe','pipe','pipe']});
  const out=[],err=[];let size=0;
  proc.stdout.on('data',d=>{size+=d.length;if(size>12_000_000)proc.kill();else out.push(d)});
  proc.stderr.on('data',d=>err.push(d));
  proc.on('error',reject);
  proc.on('close',code=>code===0&&size<=12_000_000?resolve(Buffer.concat(out)):reject(new Error('EXCEL_GENERATION_FAILED')));
  proc.stdin.end(JSON.stringify(customerOrders));
 });
}
function vnOrderMonth(iso){
 const millis=Date.parse(iso||'');
 return Number.isFinite(millis)?new Date(millis+7*60*60*1000).toISOString().slice(0,7):'';
}
async function generateQrPng(o){return new Promise((resolve,reject)=>{const proc=spawn('python3',[path.join(HERE,'invoice_qr.py')],{stdio:['pipe','pipe','pipe']});const out=[],err=[];proc.stdout.on('data',d=>out.push(d));proc.stderr.on('data',d=>err.push(d));proc.on('error',reject);proc.on('close',code=>code===0?resolve(Buffer.concat(out)):reject(new Error(Buffer.concat(err).toString('utf8').slice(0,200)||'QR_ERROR')));proc.stdin.end(JSON.stringify(o))})}
function sendHtml(res){const html=fs.readFileSync(path.join(HERE,'index.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'"});res.end(html)}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost'),p=url.pathname;
 if(req.method==='GET'&&p==='/assets/logo-satori.jpg'){const logo=path.join(HERE,'assets','logo-satori.jpg');if(!fs.existsSync(logo))return fail(res,404,'NO_LOGO','Không tìm thấy logo');res.writeHead(200,{'content-type':'image/jpeg','cache-control':'public, max-age=86400','x-content-type-options':'nosniff'});return fs.createReadStream(logo).pipe(res)}
 if(req.method==='GET'&&p==='/health')return reply(res,200,{ok:true,sandbox:true,aiProvider:'Gemini Free Tier (optional) + rules',aiConfigured:geminiConfigured(),rulesReady:true,model:MODEL,orders:orders.size,geminiProbe});
 if(req.method==='GET'&&/^\/c\/(?:demo-[ab]|[A-Za-z0-9_-]{40,96})$/.test(p))return sendHtml(res);
 if(req.method==='GET'&&p==='/admin'){const html=fs.readFileSync(path.join(HERE,'admin.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'"});return res.end(html)}
 // This route probes source-of-truth sync READINESS only. Admin-authenticated,
 // no catalogue/customer/order records returned and never any production writes.
 if(req.method==='GET'&&p==='/api/admin/source-check'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Cần đăng nhập quản trị để kiểm tra kết nối.');
  if(!rateLimit(req,'admin-source-read'))
   return fail(res,429,'RATE_LIMIT','Chỉ kiểm tra kết nối với khoảng cách phù hợp.');
  if(!readOnlyReady())
   return fail(res,503,'READ_ONLY_NOT_CONFIGURED','Chưa cấu hình khóa HMAC chỉ đọc trên Render.');
  try{
   const status=await readMinhSatori('system.status');
   const catalogue=await readMinhSatori('catalogue.list');
   if(!Number.isSafeInteger(status.revision)||status.revision!==catalogue.revision||
      !Array.isArray(catalogue.data?.products)||catalogue.data.products.length<1||
      catalogue.data?.source!=='drive-ledger:satori_catalogue_v15')
     return fail(res,409,'SOURCE_REVISION_MISMATCH','Dữ liệu nguồn chưa cùng revision hoặc chưa có bảng giá chuẩn trên Drive.');
   const parity=checkCatalogueParity(catalogue.data.products,CATALOGUE);
   return reply(res,200,{ok:true,sandbox:true,readOnly:true,
     revision:status.revision,invoiceCount:status.data?.orders??null,
     catalogueCount:catalogue.data.products.length,
     catalogueSource:catalogue.data.source,
     catalogueParity:{exactlyMatched:parity.exactlyMatched,matchedCount:parity.matchedCount,
       sourceCount:parity.sourceCount,missingCodes:parity.missingCodes,
       extraCodes:parity.extraCodes,changedCodes:parity.changedCodes},
     catalogueLiveSync:false,customerSync:false,checkoutEnabled:false,
     message:'Đã đối chiếu nguồn Drive chỉ đọc. Chưa bật tự động đồng bộ giá, khách hoặc tạo đơn thật.'});
  }catch{
   return fail(res,503,'SOURCE_PROBE_FAILED','Chưa kết nối được nguồn chuẩn qua quyền chỉ đọc. Không thay đổi dữ liệu.');
  }
 }
 // Download on owner's device: backup contains sandbox TEST data and hashed links only.
 // Restore is deliberately refused unless the entire sandbox is empty.
 if(p==='/api/admin/sandbox-backup'&&(req.method==='GET'||req.method==='POST')){
  if(!customerLinks.adminAuthorized(req))return fail(res,401,'ADMIN_AUTH_REQUIRED','Chỉ quản trị viên thử nghiệm mới được sao lưu hoặc khôi phục.');
  if(req.method==='GET'){
   const state=customerLinks.exportState();
   return reply(res,200,createSandboxBackup({...state,orders:[...orders.values()].map(o=>structuredClone(o))}));
  }
  if(orders.size||customerLinks.exportState().profiles.length||customerLinks.exportState().changeRequests.length){
   return fail(res,409,'SANDBOX_NOT_EMPTY','Chỉ khôi phục khi sandbox trống; không ghi đè khách hoặc đơn hiện có.');
  }
  const body=await bodyJSON(req,2_000_000);
  if(body?.confirmation!=='RESTORE_TEST_ONLY')return fail(res,400,'RESTORE_CONFIRMATION_REQUIRED','Cần xác nhận khôi phục dữ liệu THỬ.');
  let state;
  try{state=verifySandboxBackup(body.archive)}catch{return fail(res,400,'INVALID_SANDBOX_BACKUP','Tệp sao lưu thử không hợp lệ hoặc đã bị sửa.')}
  customerLinks.restoreState(state);
  for(const o of state.orders){orders.set(o.ref,o);idempotency.set(o.requestId,o.ref)}
  saveOrdersAtomic();
  return reply(res,200,{ok:true,sandbox:true,restoredProfiles:state.profiles.length,restoredOrders:state.orders.length,message:'Đã khôi phục dữ liệu thử, không tác động production.'});
 }
 // Owner-only order inbox, updated by the client while Admin is open.
 // Never include link tokens or the private idempotency request key in responses.
 // One-click TEST bell order. This endpoint only ever uses built-in fake profiles.
 // Repeated taps with the same requestId return the original order, never duplicate.
 if(req.method==='POST'&&p==='/api/admin/create-test-order'){
  if(!customerLinks.adminAuthorized(req))return fail(res,401,'ADMIN_AUTH_REQUIRED','Chỉ quản trị thử mới được tạo đơn mô phỏng.');
  const b=await bodyJSON(req),fixture=b?.fixture,requestId=b?.requestId;
  if(!['demo-a','demo-b'].includes(fixture)||typeof requestId!=='string'||!/^[a-z0-9-]{8,80}$/i.test(requestId)){
   return fail(res,400,'INVALID_TEST_ORDER','Chỉ được tạo đơn TEST với khách mẫu và mã chống trùng hợp lệ.');
  }
  const profile=FIXTURES[fixture],key=profile.id+'|'+requestId;
  if(idempotency.has(key))return reply(res,200,{ok:true,sandbox:true,duplicate:true,order:orders.get(idempotency.get(key))});
  // The same server-side pricing engine used by the customer quotation.
  const q=makeQuote(fixture,profile,'S500',1);
  if(!q)return fail(res,503,'TEST_QUOTE_FAILED','Không tạo được báo giá thử.');
  const o={...q,ref:'TEST-'+crypto.randomBytes(5).toString('hex').toUpperCase(),
   deliveryNote:'ĐƠN TEST CHUÔNG - KHÔNG GIAO HÀNG, KHÔNG THANH TOÁN',
   requestId:key,createdAt:new Date().toISOString(),status:'Chờ thanh toán',
   ownerTest:true,sandbox:true};
  delete o.token;
  orders.set(o.ref,o);idempotency.set(key,o.ref);
  try{saveOrdersAtomic()}catch{
   orders.delete(o.ref);idempotency.delete(key);quotes.delete(q.quoteId);
   return fail(res,503,'TEST_STORAGE_FAILED','Không lưu được đơn TEST, vui lòng thử lại.');
  }
  quotes.delete(q.quoteId);
  return reply(res,201,{ok:true,sandbox:true,duplicate:false,order:{ref:o.ref,total:o.total,createdAt:o.createdAt,ownerTest:true}});
 }
 if(req.method==='GET'&&p==='/api/admin/new-orders'){
  if(!customerLinks.adminAuthorized(req))return fail(res,401,'ADMIN_AUTH_REQUIRED','Đăng nhập quản trị để xem đơn hàng mới.');
  const all=[...orders.values()].filter(o=>o?.sandbox&&o.ref&&o.profileId);
  all.sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));
  const latest=all.slice(0,80).map(o=>({
   ref:o.ref,createdAt:o.createdAt,name:o.name,phone:o.phone,address:o.address,
   status:o.status,product:o.product,qty:o.qty,
   items:Array.isArray(o.items)?o.items.map(i=>({product:i.product,qty:i.qty,unit:i.unit})):[],
   total:o.total,vatAmount:o.vatAmount||0,deliveryNote:o.deliveryNote||''
  }));
  return reply(res,200,{ok:true,sandbox:true,confirmedOnly:true,total:all.length,
   orders:latest,notice:'Đơn thử đã xác nhận; không chứa hóa đơn production.'});
 }
 if(await customerLinks.handleAdmin(req,res,url,bodyJSON))return;
 if(req.method==='GET'&&p==='/api/history.xlsx'){
  const token=url.searchParams.get('token')||'',profile=getProfile(token);
  if(!profile)return fail(res,404,'LINK_INVALID','Không có quyền xuất lịch sử đơn hàng.');
  const month=url.searchParams.get('month')||'';
  if(month&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))
   return fail(res,400,'BAD_MONTH','Tháng xuất Excel không hợp lệ.');
  const all=[...orders.values()].filter(o=>o?.sandbox===true&&o.profileId===profile.id&&(!month||vnOrderMonth(o.createdAt)===month))
   .sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));
  if(all.length>1500)return fail(res,413,'HISTORY_TOO_LARGE','Quá nhiều đơn trong một lần xuất; hãy lọc theo tháng.');
  // Send only the scoped test-order fields to the spreadsheet generator.
  const rows=all.map(o=>({
   sandbox:true,ref:o.ref,createdAt:o.createdAt,name:o.name,product:o.product,items:o.items,
   qty:o.qty,unit:o.unit,unitPrice:o.unitPrice,discount:o.discount,total:o.total,
   shipping:o.shipping,vatAmount:o.vatAmount,status:o.status,deliveryNote:o.deliveryNote
  }));
  try{
   const file=await generateHistoryExcel(rows);
   res.writeHead(200,{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition':'attachment; filename="Satori_Lich_su_don_hang'+(month?'-'+month:'')+'.xlsx"',
    'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
   res.end(file);
  }catch{return fail(res,503,'EXCEL_FAILED','Không xuất được Excel thử; vui lòng thử lại.')}
  return;
 }
 if(req.method==='GET'&&p==='/api/history')return customerLinks.history(res,url.searchParams.get('token')||'',orders,FIXTURES);
 if(req.method==='GET'&&p==='/api/catalogue'){
  const profile=getProfile(url.searchParams.get('token')||'');if(!profile)return fail(res,403,'DEMO_LINK_REQUIRED','Chỉ hiển thị giá riêng trong link khách thử hợp lệ');
  return reply(res,200,{ok:true,sandbox:true,source:'official-default-snapshot',catalogueSync:'snapshot_only',count:CATALOGUE.length,products:CATALOGUE.map(item=>({code:item.code,name:item.name,brand:item.brand,unit:item.unit,spec:item.spec,listPrice:item.listPrice,discount:profile.discount,unitPrice:money(item.listPrice*(1-profile.discount/100))}))});
 }
 if(req.method==='GET'&&p==='/api/session'){
  const token=url.searchParams.get('token')||'';const c=getProfile(token);if(!c)return fail(res,404,'LINK_INVALID','Liên kết không hợp lệ');
  return reply(res,200,{ok:true,sandbox:true,provider:'Gemini + rules',aiConfigured:geminiConfigured(),rulesReady:true,profile:{id:c.id,name:c.name,phone:c.phone,address:c.address,discount:c.discount,ship:c.ship,vatRate:c.vatRate??0}})
 }
 if(req.method==='POST'&&p==='/api/message'){
  const b=await bodyJSON(req);const token=b?.token;const c=getProfile(token);if(!c)return fail(res,403,'INVALID_LINK','Không thể nhận diện link khách');
  if(!rateLimit(req,token))return fail(res,429,'RATE_LIMIT','Bạn đã gửi quá nhiều tin nhắn, vui lòng thử lại sau');
  const message=String(b?.message||'').trim();if(!message||message.length>500)return fail(res,400,'BAD_MESSAGE','Tin nhắn phải dài 1–500 ký tự');
  // The catalogue basket is an explicit request, not an invitation for AI to
  // guess which selected item to omit. Product codes, prices and VAT are server-owned.
  // The human-readable message is still displayed to the customer before submission.
  if(b?.cartItems!==undefined){
   if(!Array.isArray(b.cartItems)||b.cartItems.length<1||b.cartItems.length>6)
    return fail(res,400,'CART_ITEM_LIMIT','Một đơn chọn từ 1 đến tối đa 6 loại sản phẩm.');
   const unique=new Set(),requested=[];
   let totalQty=0;
   for(const item of b.cartItems){
    if(!item||typeof item!=='object'||Array.isArray(item)||
       typeof item.code!=='string'||!/^TP-\d{5}$/.test(item.code)||
       !Number.isSafeInteger(item.qty)||item.qty<1||item.qty>500||
       !productFor(item.code)||unique.has(item.code))
      return fail(res,400,'INVALID_CART','Giỏ hàng có mã sản phẩm, số lượng hoặc mặt hàng trùng không hợp lệ.');
    unique.add(item.code);totalQty+=item.qty;requested.push({sku:item.code,qty:item.qty});
   }
   if(totalQty>500)return fail(res,400,'CART_QUANTITY_LIMIT','Tổng số lượng không vượt quá 500 đơn vị.');
   // Customer identity and approved delivery destination are never editable via
   // a free-text message. Reject attempts to attach an address or phone change.
   if(identityChange(message,c))return reply(res,200,{ok:true,needsHuman:true,message:'Thay đổi người nhận, địa chỉ hoặc số điện thoại cần cửa hàng xác minh trước khi tạo báo giá.'});
   const expected='Cho tôi đặt một đơn gồm:\n'+requested.map(x=>{
    const p=productFor(x.sku);return '- '+x.qty+' '+p.unit+' '+p.name+' (Mã '+p.code+')';
   }).join('\n');
   if(message!==expected)return fail(res,400,'CART_MESSAGE_MISMATCH','Tin nhắn đã thay đổi. Hãy chọn lại giỏ hàng hoặc gửi yêu cầu bằng chat.');
   const quote=requested.length===1?
    makeQuote(token,c,requested[0].sku,requested[0].qty):
    makeMultiQuote(token,c,requested);
   if(!quote)return fail(res,400,'CART_QUOTE_FAILED','Chưa lập được báo giá đầy đủ cho giỏ hàng.');
   quote.deliveryNote='';
   sessions.delete(token);
   return reply(res,200,{ok:true,sandbox:true,parserSource:'catalogue-cart',message:'Đã nhận đủ '+requested.length+' loại sản phẩm trong một đơn. Bạn kiểm tra toàn bộ báo giá và xác nhận nhé.',quote});
  }
  const normalized=message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
  // Treat "thêm 3 thùng nữa" as an edit request, not a new independent order.
  if(/\bthem\b.*\b(nua|vao don)\b/.test(normalized))return reply(res,200,{ok:true,needMoreDetails:true,message:'Bạn muốn tăng số lượng của báo giá đang xem hay tạo đơn mới? Vui lòng nói rõ loại nước và tổng số thùng trước khi xác nhận.'});
  // A short answer to a clarification is merged with the *previous sandbox question*.
  // It never changes another customer's profile, discount, or price.
  const previous=sessions.get(token);
  let parsedMessage=message;
  if(previous?.pendingDeliveryMessage&&previous.expiresAt>Date.now()&&/^(?:(?:sau|luc|vao)\s+)?\d{1,2}\s*(?:gio|h|tieng)\s*(?:chieu|sang|trua|toi|dem|nua)$/i.test(normalized.trim())){
   const answer=normalized.trim();
   const suffix=/\bnua$/.test(answer)?'giao sau '+answer.replace(/^sau\s+/,''):'giao sau '+answer.replace(/^(luc|vao|sau)\s+/,'');
   parsedMessage=previous.pendingDeliveryMessage.replace(/(?:giao|ship)\s+sau\s+\d{1,2}\s*(?:giờ|gio|h)(?![\p{L}\p{N}])/iu,suffix);
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

  // One link = one approved recipient + phone + address. Never update from chat.
  const explicitChange=/(giao (den|toi|ve) (dia chi|noi|cho) khac|doi dia chi|dia chi moi|thay dia chi|chuyen dia chi|so dien thoai moi|doi so dien thoai|thay so dien thoai|sdt moi|doi nguoi nhan|nguoi nhan khac|doi ten nguoi nhan)/.test(normalized);
  if(explicitChange||identityChange(message,c)||identityChange(parsedMessage,c)){
   const request=customerLinks.logChangeRequest(c,message);
   // A previous draft to the old destination should not be confirmed after a change request.
   for(const [quoteId,quote] of quotes)if(quote.token===token)quotes.delete(quoteId);
   sessions.delete(token);
   return reply(res,200,{ok:true,needsHuman:true,changeRequestId:request.id,message:'Đã ghi nhận yêu cầu thay đổi thông tin và đưa vào danh sách chờ người quản trị xem xét. Link hiện tại vẫn giữ nguyên người nhận, số điện thoại và địa chỉ cũ. Cửa hàng sẽ liên hệ sau khi kiểm tra; chưa tạo hoặc thay đổi đơn.'});
  }
  const delivery=extractDeliveryIntent(parsedMessage,new Date());
  if(delivery.clarification){
   sessions.set(token,{pendingDeliveryMessage:parsedMessage,expiresAt:Date.now()+5*60_000});
   return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'DELIVERY_TIME',message:delivery.clarification});
  }
  // Every listed item must be understood; never silently drop a second SKU.
  if(/\b(khong dat|huy don|dung giao|thoi khong|chua dat)\b/.test(normalized))return reply(res,200,{ok:true,message:'Đã hiểu, mình chưa lập báo giá hay tạo đơn nào.'});
  const multi=parseMultiOrder(parsedMessage,c);
  if(multi){
   if(identityChange(parsedMessage,c))return reply(res,200,{ok:true,needsHuman:true,message:'Thay đổi địa chỉ, số điện thoại hoặc người nhận cần cửa hàng xác minh thủ công.'});
   if(multi.needMoreDetails)return reply(res,200,{ok:true,needMoreDetails:true,message:multi.message});
   const quote=makeMultiQuote(token,c,multi.items);
   if(!quote)return fail(res,400,'INVALID_QUANTITY','Số lượng hoặc quy cách của đơn nhiều sản phẩm chưa hợp lệ');
   quote.deliveryNote=normalizeDeliveryNote(delivery.deliveryNote);
   quote.requestedDeliveryAt=delivery.requestedDeliveryAt;
   sessions.delete(token);
   return reply(res,200,{ok:true,sandbox:true,parserSource:multi.source,message:'Đã tự hiểu đủ '+quote.items.length+' loại sản phẩm và lời dặn. Bạn kiểm tra toàn bộ báo giá rồi xác nhận nhé.',quote});
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
  // Idempotency may persist to disk. NEVER use the raw customer link token here.
  const idemKey=c.id+'|'+key;if(idempotency.has(idemKey))return reply(res,200,{ok:true,duplicate:true,order:orders.get(idempotency.get(idemKey))});
  const q=quotes.get(b.quoteId);if(!q||q.token!==token||q.expiresAt<Date.now())return fail(res,409,'QUOTE_EXPIRED','Báo giá hết hạn hoặc không thuộc khách này');
  if(q.profileId!==c.id||q.discount!==c.discount||q.ship!==c.ship||q.vatRate!==(c.vatRate??0)||q.address!==c.address||q.phone!==c.phone)return fail(res,409,'PROFILE_CHANGED','Thông tin khách đã thay đổi, cần lập lại báo giá');
  let deliveryNote;
  try{deliveryNote=normalizeDeliveryNote(b?.deliveryNote??q.deliveryNote)}catch{return fail(res,400,'INVALID_DELIVERY_NOTE','Lưu ý giao hàng phải là văn bản tối đa 300 ký tự')}
  const o={...q,deliveryNote,ref:'TEST-'+crypto.randomBytes(5).toString('hex').toUpperCase(),requestId:idemKey,createdAt:new Date().toISOString(),status:'Chờ thanh toán',sandbox:true};
  delete o.token; // Do not write the bearer link credential into invoice/order storage.
  orders.set(o.ref,o);idempotency.set(idemKey,o.ref);saveOrdersAtomic();quotes.delete(q.quoteId);
  return reply(res,200,{ok:true,duplicate:false,order:o});
 }
 if(req.method==='GET'&&p.startsWith('/api/invoice-qr/')){
  const ref=decodeURIComponent(p.slice('/api/invoice-qr/'.length)),token=url.searchParams.get('token'),o=orders.get(ref);
  const c=getProfile(token);
  if(!o||!c||o.profileId!==c.id)return fail(res,404,'NOT_FOUND','Không tìm thấy QR hóa đơn thử');
  try{
   const buf=await generateQrPng(o);
   res.writeHead(200,{'content-type':'image/png','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
   res.end(buf);
  }catch{return fail(res,503,'QR_FAILED','Không tạo được mã QR thử')}
  return;
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
