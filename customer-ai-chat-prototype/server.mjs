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
import {parseOrder,parseRules,parseComplexOrderWithGemini,geminiConfigured,identityChange} from './free-parser.mjs';
import {makeDraftStore,contextualDraftEdit} from './unified-draft.mjs';
import {customerSuggestions} from './customer-suggestions.mjs';
import {businessReply} from './business-reply.mjs';
import {parseOneClause,parseMultiOrder,looksCompoundOrder,parseWaterClarificationBasket,waterClarificationAnswer,parseColloquialBasket,colloquialQuestion,completeColloquialFollowup} from './multi-order.mjs';
import {parseCustomerMessage,splitOrderAndNote,waterAnswer,finishWater,deliveryAnswer} from './order-with-notes.mjs';
import {CATALOGUE,productFor,productList,resolveProduct,fold} from './catalogue.mjs';
import {makeCustomerLinks} from './customer-links.mjs';
import {extractDeliveryIntent} from './delivery-intent.mjs';
import {createSandboxBackup,verifySandboxBackup} from './sandbox-backup.mjs';
import {makeDriveBackupWorker,decryptArchive} from './drive-backup.mjs';
import {readMinhSatori,readOnlyReady} from './satori-readonly.mjs';
import {checkCatalogueParity} from './catalogue-parity.mjs';
import {getGeminiVersionStatus} from './version-status.mjs';
import {parseAmendment,isAmendmentIntent,isConfirmAmend,isCancelAmend,appendDeliveryNote,latestEditableOrder,normAmend} from './order-amend.mjs';
import {ADDRESS_REPLY,ambiguousWater500,ambiguousWater500InComposite,brandAnswer,contactIntent,phoneConfirm,phoneCancel,maskPhone,trainingProposal,trainingConfirm,trainingCancel,trainingForget,makeCustomerPhraseMemory} from './conversation-understanding.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST=process.env.DEMO_BIND||'127.0.0.1';
const PORT=Number(process.env.PORT||8787);
const MODEL='gemini-3.5-flash-lite';
const DATA_DIR=path.resolve(process.env.DEMO_DATA_DIR||path.join(os.tmpdir(),'minh-satori-customer-chat-SANDBOX'));
fs.mkdirSync(DATA_DIR,{recursive:true});
const DATA_FILE=path.join(DATA_DIR,'orders.json');
let driveWorker=null;
const customerLinks=makeCustomerLinks(DATA_DIR,()=>driveWorker?.schedule());
const FIXTURES=Object.freeze({
 'demo-a':{id:'KH-DEMO-A',name:'Khách Demo A',phone:'000 000 0001',address:'123 Đường Thử Nghiệm, TP.HCM',discount:20,ship:8,favourite:'S5L',lastQty:10,uniqueFavourite:true},
 'demo-b':{id:'KH-DEMO-B',name:'Khách Demo B',phone:'000 000 0002',address:'456 Đường Mẫu, TP.HCM',discount:35,ship:8,favourite:'S500',lastQty:5,uniqueFavourite:false}
});
const sessions=new Map(),quotes=new Map(),orders=new Map(),idempotency=new Map(),rate=new Map();
const draftStore=makeDraftStore({filePath:path.join(DATA_DIR,'drafts-SANDBOX.json'),onChange:()=>driveWorker?.schedule()});
const phraseMemory=makeCustomerPhraseMemory(DATA_DIR);
const pendingBrands=new Map(),pendingPhones=new Map(),pendingTeaching=new Map(),pendingWaterOrders=new Map(),pendingColloquial=new Map(),pendingMixedOrders=new Map();
const geminiProbe={status:'not_run',elapsedMs:null};
const pendingAmends=new Map(); // profileId -> expiring unconfirmed customer proposal
const MAX_AMEND_AGE_MS=5*60_000;
function amendedReply(o,duplicate=false){
 return {ok:true,sandbox:true,amended:true,duplicate,order:o,
  message:'Đã cập nhật ghi chú giao hàng của hóa đơn '+o.ref+'. Không tạo đơn mới. Giờ giao vẫn cần cửa hàng xác nhận.'};
}
function applyAmendment(res,profile,proposalId){
 const last=latestEditableOrder(orders,profile.id);
 if(!last.order)return fail(res,409,last.reason,'Đơn vừa đặt không còn đủ điều kiện sửa tự động; vui lòng liên hệ cửa hàng.');
 const order=last.order;
 if(order.lastAmendmentId===proposalId&&/^[0-9a-f-]{36}$/.test(proposalId)){
  return reply(res,200,amendedReply(order,true));
 }
 const p=pendingAmends.get(profile.id);
 if(!p||p.id!==proposalId||p.expiresAt<Date.now()||p.ref!==order.ref)
  return fail(res,409,'AMENDMENT_EXPIRED','Đề xuất sửa đã hết hạn hoặc đơn mới đã được tạo.');
 if((order.amendmentVersion||0)!==p.version||order.deliveryNote!==p.previousNote)
  return fail(res,409,'AMENDMENT_CHANGED','Ghi chú đã thay đổi, hãy yêu cầu AI kiểm tra lại.');
 if(order.deliveryNote===p.newNote)return fail(res,409,'NOTHING_TO_UPDATE','Nội dung ghi chú không có thay đổi.');
 const updated={...order,deliveryNote:p.newNote,amendmentVersion:(order.amendmentVersion||0)+1,
   amendedAt:new Date().toISOString(),lastAmendmentId:p.id};
 orders.set(order.ref,updated);
 try{saveOrdersAtomic()}catch{
  orders.set(order.ref,order);
  return fail(res,503,'AMENDMENT_SAVE_FAILED','Chưa lưu được thay đổi. Hóa đơn vẫn giữ nội dung cũ.');
 }
 pendingAmends.delete(profile.id);
 return reply(res,200,amendedReply(updated));
}
function proposeAmendment(res,c,note,sourceMessage=''){
 const latest=latestEditableOrder(orders,c.id);
 if(!latest.order)return reply(res,200,{ok:true,sandbox:true,needsHuman:true,
  message:latest.reason==='NO_RECENT_ORDER'?'Bạn chưa có hóa đơn TEST đã xác nhận để sửa.':
  'Đơn gần nhất đã quá 24 giờ hoặc không còn ở trạng thái chờ thanh toán. Cửa hàng cần xác minh trước khi sửa.'});
 const order=latest.order;
 const typedRef=String(sourceMessage).match(/TEST-[0-9A-F]{10}/i)?.[0]?.toUpperCase();
 if(typedRef&&typedRef!==order.ref)return reply(res,200,{ok:true,needsHuman:true,
  message:'Mã hóa đơn bạn nhắc tới không phải đơn vừa đặt. Để tránh sửa nhầm đơn, vui lòng liên hệ cửa hàng xác minh.'});
 let nextNote;
 try{nextNote=normalizeDeliveryNote(appendDeliveryNote(order.deliveryNote||'',note))}
 catch{return reply(res,200,{ok:true,needsHuman:true,message:'Ghi chú mới cộng ghi chú cũ vượt quá 300 ký tự. Vui lòng liên hệ cửa hàng để điều chỉnh.'})}
 if(nextNote===order.deliveryNote)return reply(res,200,{ok:true,message:'Hóa đơn '+order.ref+' đã có ghi chú này, không cần sửa thêm.'});
 const proposal={id:crypto.randomUUID(),ref:order.ref,profileId:c.id,previousNote:order.deliveryNote||'',
  newNote:nextNote,version:order.amendmentVersion||0,expiresAt:Date.now()+MAX_AMEND_AGE_MS};
 pendingAmends.set(c.id,proposal);
 return reply(res,200,{ok:true,sandbox:true,editProposal:{
  proposalId:proposal.id,ref:proposal.ref,previousNote:proposal.previousNote,
  newNote:proposal.newNote,expiresAt:new Date(proposal.expiresAt).toISOString(),
  total:order.total,status:order.status},
  message:'Bạn có muốn sửa hóa đơn '+order.ref+' và bổ sung lưu ý giao hàng như dưới đây không? Hóa đơn chưa thay đổi; chỉ lưu khi bạn xác nhận.'});
}
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
function getProfile(token){
 // Unique anonymous browser baskets for public DEMO pages. Real signed customer
 // links remain unchanged. No personal identifying information is stored.
 if(typeof token==='string'){
  const demo=token.match(/^(demo-[ab])~([a-f0-9]{32})$/);
  if(demo)return FIXTURES[demo[1]];
 }
 return Object.hasOwn(FIXTURES,token)?FIXTURES[token]:customerLinks.getProfile(token);
}
async function bodyJSON(req,maxBytes=8_192){const chunks=[];let size=0;for await(const buf of req){size+=buf.length;if(size>maxBytes)throw new Error('PAYLOAD_TOO_LARGE');chunks.push(buf)}return safeJSON(Buffer.concat(chunks).toString('utf8'))}
function rateLimit(req,token){const now=Date.now();const key=(req.socket.remoteAddress||'localhost')+'|'+token;const list=(rate.get(key)||[]).filter(t=>now-t<60000);if(list.length>=(HOST==='127.0.0.1'&&process.env.DEMO_ISOLATED_TEST_RATE==='1'&&process.env.NODE_ENV!=='production'?100:20))return false;list.push(now);rate.set(key,list);return true}
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

function draftFailure(res,err){
 if(err?.message==='DRAFT_CONFLICT')return fail(res,409,'DRAFT_CONFLICT','Giỏ hàng đã được cập nhật ở phiên khác. Vui lòng tải lại giỏ.');
 if(err?.message==='CART_LIMIT')return fail(res,400,'CART_LIMIT','Một bill tối đa 6 sản phẩm và 500 đơn vị.');
 return fail(res,400,'INVALID_CART','Mã sản phẩm hoặc số lượng không hợp lệ.');
}
function invalidateQuotes(token){
 for(const [id,q] of quotes)if(q.token===token)quotes.delete(id);
}
function currentBasketQuote(token,profile){
 const draft=draftStore.read(token);
 if(!draft.items.length)return null;
 invalidateQuotes(token);
 const items=draft.items.map(x=>({sku:x.code,qty:x.qty}));
 const q=items.length===1?makeQuote(token,profile,items[0].sku,items[0].qty):makeMultiQuote(token,profile,items);
 if(q){q.draftRevision=draft.revision;q.deliveryNote=draft.deliveryNote||'';q.requestedDeliveryAt=draft.requestedDeliveryAt||null;}
 return q;
}
function applyChatBasket(res,token,profile,changes,revision,source,delivery){
 let draft;
 try{draft=draftStore.mutate(token,changes,revision,delivery)}catch(e){return draftFailure(res,e)}
 const quote=currentBasketQuote(token,profile);
 if(!quote)return fail(res,400,'CART_QUOTE_FAILED','Chưa tạo được báo giá cho giỏ hàng.');
 // currentBasketQuote reads persistent delivery notes directly from the draft.
 // Do not reset the note when a later add/quantity edit has no delivery text.
 sessions.delete(token);
 return reply(res,200,{ok:true,sandbox:true,parserSource:source,draft,quote,
  message:'Đã cập nhật cùng một giỏ: '+draft.items.length+' loại / '+draft.items.reduce((n,x)=>n+x.qty,0)+' đơn vị. Chưa tạo bill; bạn xác nhận báo giá cuối cùng một lần nhé.'});
}

function saveOrdersAtomic(){const data=JSON.stringify([...orders.values()],null,2);const tmp=DATA_FILE+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,data,{mode:0o600});fs.renameSync(tmp,DATA_FILE);driveWorker?.schedule()}
if(scrubbedLegacyRequestIds)saveOrdersAtomic();
// The first verified backup upload must be confirmed before a Render redeploy.
driveWorker=makeDriveBackupWorker(()=>createSandboxBackup({
 ...customerLinks.exportState(),orders:[...orders.values()].map(o=>structuredClone(o)),
 drafts:draftStore.snapshot(),phrases:phraseMemory.snapshot()}));
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
 if(req.method==='GET'&&p==='/health')return reply(res,200,{ok:true,sandbox:true,draftPersistence:true,aiProvider:'Gemini Free Tier (optional) + rules',aiConfigured:geminiConfigured(),rulesReady:true,model:MODEL,orders:orders.size,geminiProbe});
 if(req.method==='GET'&&/^\/c\/(?:demo-[ab]|[A-Za-z0-9_-]{40,96})$/.test(p))return sendHtml(res);
 if(req.method==='GET'&&p==='/admin'){const html=fs.readFileSync(path.join(HERE,'admin.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'"});return res.end(html)}
 // Compare current server code with newest GitHub commit; never deploy from here.
 if(req.method==='GET'&&p==='/api/admin/version-status'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Cần quyền quản trị để xem phiên bản hệ thống.');
  const status=await getGeminiVersionStatus();
  return reply(res,200,{ok:true,sandbox:true,...status});
 }
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
   return reply(res,200,createSandboxBackup({...state,orders:[...orders.values()].map(o=>structuredClone(o)),drafts:draftStore.snapshot(),phrases:phraseMemory.snapshot()}));
  }
  if(orders.size||customerLinks.exportState().profiles.length||customerLinks.exportState().changeRequests.length||draftStore.snapshot().length||phraseMemory.snapshot().length){
   return fail(res,409,'SANDBOX_NOT_EMPTY','Chỉ khôi phục khi sandbox trống; không ghi đè khách hoặc đơn hiện có.');
  }
  const body=await bodyJSON(req,2_000_000);
  if(body?.confirmation!=='RESTORE_TEST_ONLY')return fail(res,400,'RESTORE_CONFIRMATION_REQUIRED','Cần xác nhận khôi phục dữ liệu THỬ.');
  let state;
  try{state=verifySandboxBackup(body.archive)}catch{return fail(res,400,'INVALID_SANDBOX_BACKUP','Tệp sao lưu thử không hợp lệ hoặc đã bị sửa.')}
  customerLinks.restoreState(state);
  draftStore.restore(state.drafts||[]);
  phraseMemory.restore(state.phrases||[]);
  for(const o of state.orders){orders.set(o.ref,o);idempotency.set(o.requestId,o.ref)}
  saveOrdersAtomic();
  return reply(res,200,{ok:true,sandbox:true,restoredProfiles:state.profiles.length,restoredOrders:state.orders.length,message:'Đã khôi phục dữ liệu thử, không tác động production.'});
 }
 // Google Drive backup commands are ADMIN-only, SANDBOX-only.
 // No plaintext backup reaches Drive; AES key never leaves server.
 if(p==='/api/admin/drive-backup/status'&&req.method==='GET'){
  if(!customerLinks.adminAuthorized(req))return fail(res,401,'ADMIN_AUTH_REQUIRED','Chỉ quản trị thử được xem sao lưu.');
  return reply(res,200,{ok:true,sandbox:true,driveBackup:driveWorker.status()});
 }
 if(p==='/api/admin/drive-backup/now'&&req.method==='POST'){
  if(!customerLinks.adminAuthorized(req))return fail(res,401,'ADMIN_AUTH_REQUIRED','Chỉ quản trị thử được sao lưu.');
  try{const result=await driveWorker.syncNow();return reply(res,200,{ok:true,sandbox:true,driveBackup:result})}
  catch{return fail(res,503,'DRIVE_BACKUP_FAILED','Chưa xác minh lưu thành công trên Drive; không thay đổi dữ liệu.')}
 }
 if(p==='/api/admin/drive-backup/restore'&&req.method==='POST'){
  if(!customerLinks.adminAuthorized(req))return fail(res,401,'ADMIN_AUTH_REQUIRED','Chỉ quản trị thử được khôi phục.');
  if(orders.size||customerLinks.exportState().profiles.length||customerLinks.exportState().changeRequests.length||draftStore.snapshot().length||phraseMemory.snapshot().length)
   return fail(res,409,'SANDBOX_NOT_EMPTY','Sandbox chưa trống; không tự ghi đè hoặc hợp nhất.');
  const body=await bodyJSON(req);
  if(body?.confirmation!=='RESTORE_DRIVE_TEST_ONLY')
   return fail(res,400,'RESTORE_CONFIRMATION_REQUIRED','Cần xác nhận khôi phục dữ liệu TEST.');
  let state;
  try{state=await driveWorker.readArchive(body?.fileId)}
  catch{return fail(res,503,'DRIVE_RESTORE_INVALID','Bản sao không thể xác minh và giải mã; chưa sửa dữ liệu.')}
  customerLinks.restoreState(state);
  draftStore.restore(state.drafts||[]);
  phraseMemory.restore(state.phrases||[]);
  for(const o of state.orders){orders.set(o.ref,o);idempotency.set(o.requestId,o.ref)}
  saveOrdersAtomic();
  return reply(res,200,{ok:true,sandbox:true,restoredProfiles:state.profiles.length,
   restoredChangeRequests:state.changeRequests.length,restoredOrders:state.orders.length,
   message:'Khôi phục TEST từ Drive đã xác minh; không tác động production.'});
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
   total:o.total,vatAmount:o.vatAmount||0,deliveryNote:o.deliveryNote||'',
   amendedAt:o.amendedAt||null,amendmentVersion:o.amendmentVersion||0
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
 // Publicly share only this customer's ranked catalog SKU suggestions, never raw order history.
 if(req.method==='GET'&&p==='/api/suggestions'){
  const profile=getProfile(url.searchParams.get('token')||'');
  if(!profile)return fail(res,403,'INVALID_LINK','Liên kết khách không hợp lệ.');
  const suggestions=customerSuggestions(profile,orders.values(),3).map(item=>{
   const p=productFor(item.code);
   return {...item,unitPrice:money(p.listPrice*(1-profile.discount/100))};
  });
  return reply(res,200,{ok:true,sandbox:true,suggestions,
   source:'per-customer-test-invoice-history',historyLimitedToSandbox:true});
 }
 if(p==='/api/draft'&&(req.method==='GET'||req.method==='POST')){
  const body=req.method==='POST'?await bodyJSON(req):null;
  const token=req.method==='GET'?url.searchParams.get('token'):body?.token;
  const profile=getProfile(token);
  if(!profile)return fail(res,403,'INVALID_LINK','Không có quyền xem hoặc sửa giỏ hàng này.');
  if(req.method==='GET')return reply(res,200,{ok:true,sandbox:true,draft:draftStore.read(token)});
  if(!rateLimit(req,'draft|'+profile.id))return fail(res,429,'RATE_LIMIT','Bạn thao tác quá nhanh, vui lòng thử lại.');
  if(body?.action==='quote'){
   if(body.expectedRevision!==draftStore.read(token).revision)return fail(res,409,'DRAFT_CONFLICT','Giỏ vừa thay đổi, cần tải lại.');
   const quote=currentBasketQuote(token,profile);
   if(!quote)return fail(res,400,'EMPTY_CART','Giỏ hàng hiện chưa có sản phẩm.');
   return reply(res,200,{ok:true,sandbox:true,draft:draftStore.read(token),quote,message:'Đây là báo giá chung mới nhất của tất cả sản phẩm.'});
  }
  if(!['add','set','subtract','remove','clear'].includes(body?.action))
   return fail(res,400,'INVALID_CART','Thao tác giỏ hàng không hợp lệ.');
  let draft;
  try{draft=draftStore.mutate(token,[{action:body.action,code:body.code,qty:body.qty}],body.expectedRevision)}
  catch(err){return draftFailure(res,err)}
  invalidateQuotes(token);
  return reply(res,200,{ok:true,sandbox:true,draft,message:'Đã lưu vào cùng một giỏ hàng.'});
 }
 if(req.method==='GET'&&p==='/api/session'){
  const token=url.searchParams.get('token')||'';const c=getProfile(token);if(!c)return fail(res,404,'LINK_INVALID','Liên kết không hợp lệ');
  return reply(res,200,{ok:true,sandbox:true,provider:'Gemini + rules',aiConfigured:geminiConfigured(),rulesReady:true,profile:{id:c.id,name:c.name,phone:c.phone,address:c.address,discount:c.discount,ship:c.ship,vatRate:c.vatRate??0}})
 }
 if(req.method==='POST'&&p==='/api/order-amend/confirm'){
  const b=await bodyJSON(req),c=getProfile(b?.token);
  if(!c)return fail(res,403,'INVALID_LINK','Không có quyền sửa hóa đơn này.');
  if(!rateLimit(req,'amend|'+c.id))return fail(res,429,'RATE_LIMIT','Bạn đã xác nhận quá nhiều lần.');
  const proposalId=b?.proposalId;
  if(typeof proposalId!=='string'||!/^[0-9a-f-]{36}$/.test(proposalId))
   return fail(res,400,'INVALID_AMENDMENT','Mã đề xuất sửa không hợp lệ.');
  if(b?.confirmed!==true)return fail(res,400,'CONFIRMATION_REQUIRED','Cần xác nhận rõ ràng trước khi sửa hóa đơn.');
  return applyAmendment(res,c,proposalId);
 }
 if(req.method==='POST'&&p==='/api/message'){
  const b=await bodyJSON(req);const token=b?.token;const c=getProfile(token);if(!c)return fail(res,403,'INVALID_LINK','Không thể nhận diện link khách');
  if(!rateLimit(req,token))return fail(res,429,'RATE_LIMIT','Bạn đã gửi quá nhiều tin nhắn, vui lòng thử lại sau');
  let message=String(b?.message||'').trim();if(!message||message.length>500)return fail(res,400,'BAD_MESSAGE','Tin nhắn phải dài 1–500 ký tự');

  // Block identity changes locally BEFORE any Gemini or order write.
  const ci=contactIntent(message);
  if(ci?.address){pendingPhones.delete(token);invalidateQuotes(token);
   const request=customerLinks.logChangeRequest(c,message);
   return reply(res,200,{ok:true,needsHuman:true,changeRequestId:request.id,
   contactPolicy:'ADDRESS_REQUIRES_STAFF',draft:draftStore.read(token),message:ADDRESS_REPLY});}
  if(ci?.phone&&!phoneConfirm(message)){
   if(!ci.phoneNumber){pendingPhones.set(token,{needsNumber:true,expiresAt:Date.now()+600_000});
    return reply(res,200,{ok:true,needMoreDetails:true,
    contactPolicy:'PHONE_NEEDS_NUMBER',message:'Anh/chị vui lòng gửi số điện thoại mới gồm 10 chữ số. Em chưa thay đổi số đang lưu.'});}
   pendingPhones.set(token,{phone:ci.phoneNumber,expiresAt:Date.now()+600_000});
   return reply(res,200,{ok:true,needConfirmation:true,verificationRequired:true,
    contactPolicy:'PHONE_AWAITING_CONFIRMATION',message:'Đã nhận số mới '+maskPhone(ci.phoneNumber)+
    '. Vui lòng trả lời "Xác nhận đổi SĐT" để gửi yêu cầu xác minh. Chưa có thông tin nào được thay đổi.'});
  }
  const pp=pendingPhones.get(token);
  if(pp?.needsNumber&&pp.expiresAt>Date.now()){
   const digits=String(message).replace(/\D/g,'').replace(/^84(?=\d{9}$)/,'0');
   if(/^0\d{9}$/.test(digits)){
    pendingPhones.set(token,{phone:digits,expiresAt:Date.now()+600_000});
    return reply(res,200,{ok:true,needConfirmation:true,verificationRequired:true,
     contactPolicy:'PHONE_AWAITING_CONFIRMATION',
     message:'Đã nhận số mới '+maskPhone(digits)+'. Hãy trả lời "Xác nhận đổi SĐT" để gửi yêu cầu xác minh.'});
   }
  }
  if(pp&&pp.expiresAt>Date.now()&&phoneCancel(message)){
   pendingPhones.delete(token);return reply(res,200,{ok:true,contactPolicy:'PHONE_CANCELLED',
    message:'Đã hủy yêu cầu đổi số, thông tin giữ nguyên.'});
  }
  if(pp&&pp.expiresAt>Date.now()&&phoneConfirm(message)){
   pendingPhones.delete(token);invalidateQuotes(token);
   const request=customerLinks.logChangeRequest(c,'PHONE_CHANGE_VERIFICATION_REQUIRED:'+pp.phone);
   return reply(res,200,{ok:true,needsHuman:true,verificationRequired:true,
    contactPolicy:'PHONE_PENDING_VERIFICATION',requestId:request.id,
    message:'Yêu cầu số mới '+maskPhone(pp.phone)+' đã gửi quản trị viên để xác minh. Chưa đổi số trong hóa đơn hoặc dữ liệu khách.'});
  }
  if(pp&&pp.expiresAt<=Date.now())pendingPhones.delete(token);
  // Only a confirmed, customer-specific nickname becomes durable memory.
  const forgetAlias=trainingForget(message);
  if(forgetAlias){
   phraseMemory.forget(token,forgetAlias);driveWorker?.schedule();
   return reply(res,200,{ok:true,training:'FORGOTTEN',
    message:'Đã bỏ cách gọi "'+forgetAlias+'" khỏi bộ nhớ riêng của khách này.'});
  }
  const teaching=trainingProposal(message);
  if(teaching?.invalid)return reply(res,200,{ok:true,needMoreDetails:true,training:'INVALID_ALIAS',message:teaching.message});
  if(teaching?.code){
   pendingTeaching.set(token,{...teaching,expiresAt:Date.now()+600_000});
   return reply(res,200,{ok:true,needConfirmation:true,training:'AWAITING_CONFIRMATION',
    message:'Em hiểu "'+teaching.alias+'" là '+teaching.label+' (mã '+teaching.code+
    '). Anh/chị trả lời "Xác nhận" để ghi nhớ riêng cho lần sau, hoặc "Hủy".'});
  }
  const learn=pendingTeaching.get(token);
  if(learn&&learn.expiresAt>Date.now()&&(trainingConfirm(message)||trainingCancel(message))){
   pendingTeaching.delete(token);
   if(trainingCancel(message))return reply(res,200,{ok:true,training:'CANCELLED',message:'Đã hủy; em chưa ghi nhớ.'});
   try{phraseMemory.remember(token,learn);driveWorker?.schedule();
    return reply(res,200,{ok:true,training:'SAVED',message:'Đã ghi nhớ "'+learn.alias+'" tương ứng '+learn.code+' cho riêng khách này.'});
   }catch{return fail(res,400,'PHRASE_MEMORY_FAILED','Không lưu được cách gọi mới, hóa đơn và giỏ hàng giữ nguyên.')}
  }
  if(learn&&learn.expiresAt<=Date.now())pendingTeaching.delete(token);

  // Keep all products + instructions together while resolving ambiguity.
  // This state never writes a SKU or delivery note until every missing field
  // is confirmed; it is scoped to the customer token and draft revision.
  const waitingMixed=pendingMixedOrders.get(token);
  if(waitingMixed){
   if(waitingMixed.expiresAt<Date.now())pendingMixedOrders.delete(token);
   else if(/^(?:huy|thoi|khong dat|huy yeu cau)$/i.test(fold(message))){
    pendingMixedOrders.delete(token);
    return reply(res,200,{ok:true,clarificationCancelled:true,draft:draftStore.read(token),
     message:'Đã hủy yêu cầu chưa xác nhận. Giỏ hàng vẫn giữ nguyên.'});
   }else{
    let completed=null;
    if(waitingMixed.water){
     const answer=waterAnswer(message);
     if(answer)completed=finishWater(waitingMixed,answer);
    }else if(waitingMixed.delivery?.clarification){
     const answer=deliveryAnswer(waitingMixed.noteText,message);
     if(answer)completed={...waitingMixed,delivery:answer,kind:'order'};
    }
    if(completed?.kind==='clarify'){
     pendingMixedOrders.set(token,{...waitingMixed,water:completed.water});
     return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'MIXED_WATER',
      draft:draftStore.read(token),message:completed.water.brand?
       'Em giữ '+completed.water.qty+' thùng '+completed.water.brand+
        '. Anh/chị xác nhận dung tích 350ml, 500ml hay 1500ml?':
       'Em vẫn giữ đủ các món và lưu ý. Nước suối hãng Satori hay Hikari ạ?'});
    }
    if(completed?.kind==='order'){
     if(completed.delivery?.clarification){
      pendingMixedOrders.set(token,{...waitingMixed,items:completed.items,water:null});
      return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'MIXED_DELIVERY',
       draft:draftStore.read(token),message:completed.delivery.clarification+
        ' Em vẫn giữ toàn bộ sản phẩm, chưa cộng vào giỏ.'});
     }
     const current=draftStore.read(token);
     if(current.revision!==waitingMixed.revision||b?.expectedRevision!==current.revision){
      pendingMixedOrders.delete(token);
      return fail(res,409,'DRAFT_CONFLICT','Giỏ hàng đã thay đổi. Vui lòng tải lại và xác nhận đơn.');
     }
     pendingMixedOrders.delete(token);
     return applyChatBasket(res,token,c,completed.items.map(x=>({action:'add',code:x.sku,qty:x.qty})),
      current.revision,'mixed-order-and-notes',completed.delivery);
    }
    if(completed?.kind==='invalid')return reply(res,200,{ok:true,needMoreDetails:true,
     draft:draftStore.read(token),message:completed.message});
    // One short follow-up is not a new purchase. Never create a bill from
    // "suối 500ml", "Satori" or "14:00" when a previous order is pending.
    if(!/^(?:cho|anh lay|chi lay|them|dat|mua|lay)\s+\d/i.test(fold(message)))
     return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:waitingMixed.water?'MIXED_WATER':'MIXED_DELIVERY',
      draft:draftStore.read(token),message:waitingMixed.water?
       'Anh/chị cho em biết hãng và dung tích nước suối, ví dụ “Satori 500ml”. Em chưa thêm sản phẩm nào từ yêu cầu này.':
       'Anh/chị xác nhận giờ giao, ví dụ “2 giờ chiều” hoặc “2 tiếng nữa”. Em chưa thêm sản phẩm nào từ yêu cầu này.'});
    pendingMixedOrders.delete(token); // User started a new complete order.
   }
  }

  const waitingColloquial=pendingColloquial.get(token);
  if(waitingColloquial){
   if(waitingColloquial.expiresAt<=Date.now())pendingColloquial.delete(token);
   else{
    const resolved=completeColloquialFollowup(waitingColloquial,message);
    if(resolved){
     if(resolved.pending){
      pendingColloquial.set(token,{...resolved.pending,revision:waitingColloquial.revision,expiresAt:waitingColloquial.expiresAt});
      return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'COLLOQUIAL_PRODUCT',
       draft:draftStore.read(token),message:resolved.message});
     }
     if(resolved.items){
      const current=draftStore.read(token);
      if(current.revision!==waitingColloquial.revision||(b?.unifiedDraft===true&&b.expectedRevision!==current.revision)){
       pendingColloquial.delete(token);
       return fail(res,409,'DRAFT_CONFLICT','Giỏ đã thay đổi. Tải lại trước khi gửi thêm.');
      }
      pendingColloquial.delete(token);
      return applyChatBasket(res,token,c,resolved.items.map(x=>({action:'add',code:x.sku,qty:x.qty})),
       current.revision,resolved.source);
     }
     return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'COLLOQUIAL_PRODUCT',
      draft:draftStore.read(token),message:resolved.message});
    }
    pendingColloquial.delete(token);
   }
  }
  // Multi-turn clarifications are scoped to one browser token + basket revision.
  // Never add an incomplete phrase or a subset of a complex message.
  const pendingWater=pendingWaterOrders.get(token);
  if(pendingWater&&pendingWater.expiresAt<=Date.now())pendingWaterOrders.delete(token);
  else if(pendingWater){
   const answer=waterClarificationAnswer(message);
   if(answer){
    const water={...pendingWater.water,brand:answer.brand||pendingWater.water.brand,
     size:answer.size||pendingWater.water.size};
    const choices=water.brand&&!water.size?'350ml, 500ml hay 1500ml?':
     !water.brand?'Satori hay Hikari?':'';
    if(!water.brand||!water.size){
     pendingWaterOrders.set(token,{...pendingWater,water});
     return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'WATER_BRAND_SIZE',
      draft:draftStore.read(token),pendingItems:pendingWater.items,
      message:'Em giữ đủ '+(pendingWater.items.length+1)+' món trong yêu cầu. '+choices+
       ' Em chưa thêm hàng vào giỏ cho đến khi xác định đúng nước suối.'});
    }
    const requested=resolveProduct(water.brand+' '+water.size+'ml');
    const item=productFor(requested.sku);
    if(requested.ambiguous||!item||item.unit!=='Thùng'){
     return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'WATER_BRAND_SIZE',
      draft:draftStore.read(token),message:'Loại nước này chưa có quy cách thùng xác nhận trong danh mục. Anh/chị vui lòng chọn Satori 500ml hoặc Hikari 500ml, hoặc ghi rõ mặt hàng hợp lệ.'});
    }
    const current=draftStore.read(token);
    if(current.revision!==pendingWater.revision||b?.expectedRevision!==current.revision){
     pendingWaterOrders.delete(token);
     return fail(res,409,'DRAFT_CONFLICT','Giỏ hàng đã đổi trong lúc làm rõ sản phẩm. Vui lòng tải lại và đặt lại để tránh tính nhầm.');
    }
    pendingWaterOrders.delete(token);
    return applyChatBasket(res,token,c,[...pendingWater.items,{sku:item.code,qty:water.qty}]
      .map(i=>({action:'add',code:i.sku,qty:i.qty})),
      current.revision,'clarified-full-basket');
   }
   // A new complete order supersedes the old unanswered question.
   pendingWaterOrders.delete(token);
  }
  const pendingBrand=pendingBrands.get(token);
  const brand=pendingBrand&&pendingBrand.expiresAt>Date.now()?brandAnswer(message):null;
  if(brand){
   pendingBrands.delete(token);
   message='Cho '+pendingBrand.qty+' thùng '+brand.brand+' 500ml';
  }else{
   const uncertain=ambiguousWater500(message);
   if(uncertain){
    pendingBrands.set(token,{qty:uncertain.qty,expiresAt:Date.now()+600_000});
    return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'BRAND_500',
     choices:[{label:'Satori 500ml',code:'TP-00003'},{label:'Hikari 500ml',code:'TP-00081'}],
     draft:draftStore.read(token),message:'Em hiểu '+uncertain.qty+
     ' thùng nước suối 500ml. Anh/chị muốn Satori hay Hikari? Chỉ cần trả lời hãng; chưa thêm sản phẩm vào giỏ.'});
   }
   message=phraseMemory.expand(token,message);
   // Split the order from "Lưu ý" BEFORE any generic Gemini, edit, or
   // first-SKU parser. This prevents lost products and hallucinated 5L SKUs.
   if(b?.unifiedDraft===true){
    const candidate=parseCustomerMessage(message,c);
    // Existing product-only clarification remains backward-compatible;
    // intercept only mixed product+delivery instructions or note-only chats.
    const mixed=candidate?.noteText||(candidate?.kind==='invalid'&&splitOrderAndNote(message).noteText)?candidate:null;
    if(mixed?.kind==='invalid')return reply(res,200,{ok:true,needMoreDetails:true,
     draft:draftStore.read(token),message:mixed.message});
    if(mixed?.kind==='note-only'){
     if(identityChange(message,c))return reply(res,200,{ok:true,needsHuman:true,
      message:'Đổi địa chỉ hoặc người nhận cần liên hệ anh Nguyên hoặc anh Minh.'});
     const draft=draftStore.read(token);
     if(b?.expectedRevision!==draft.revision)return fail(res,409,'DRAFT_CONFLICT','Giỏ đã thay đổi. Hãy tải lại.');
     if(mixed.delivery?.clarification)return reply(res,200,{ok:true,needMoreDetails:true,
      draft,clarificationType:'DELIVERY_TIME',message:mixed.delivery.clarification});
     const finalNote=normalizeDeliveryNote(mixed.delivery?.deliveryNote||mixed.noteText);
     let updated;
     try{updated=draftStore.mutate(token,[{action:'note',note:finalNote,
      requestedDeliveryAt:mixed.delivery?.requestedDeliveryAt||null}],draft.revision)}
     catch(err){return draftFailure(res,err)}
     invalidateQuotes(token);
     const quote=currentBasketQuote(token,c);
     return reply(res,200,{ok:true,draft:updated,...(quote?{quote}:{}),parserSource:'delivery-note-only',
      message:'Em đã ghi nhận lưu ý: '+finalNote+'. '+(quote?'Mời xem lại báo giá của giỏ hiện tại.':
       'Giỏ chưa có sản phẩm; em sẽ giữ lưu ý này cho đơn thử tiếp theo.')});
    }
    if(mixed?.kind==='order'){
     if(identityChange(message,c))return reply(res,200,{ok:true,needsHuman:true,
      message:'Để thay đổi địa chỉ giao hàng, vui lòng liên hệ anh Nguyên hoặc anh Minh.'});
     const draft=draftStore.read(token);
     if(b.expectedRevision!==draft.revision)return fail(res,409,'DRAFT_CONFLICT','Giỏ vừa thay đổi; hãy tải lại.');
     if(mixed.water||mixed.delivery?.clarification){
      pendingMixedOrders.set(token,{...mixed,revision:draft.revision,expiresAt:Date.now()+600_000});
      const list=mixed.items.map(x=>x.qty+' '+productFor(x.sku).unit.toLowerCase()+' '+productFor(x.sku).name);
      if(mixed.water)list.unshift(mixed.water.qty+' thùng nước suối (chưa rõ loại)');
      return reply(res,200,{ok:true,needMoreDetails:true,
       clarificationType:mixed.water?'MIXED_WATER':'MIXED_DELIVERY',draft,
       pendingItems:mixed.items,
       message:'Em nhận đủ: '+list.join(', ')+
        (mixed.noteText?'. Lưu ý: '+mixed.noteText:'')+'. '+
        (mixed.water?'Anh/chị muốn nước suối Satori hay Hikari, dung tích bao nhiêu ml?':
         mixed.delivery.clarification)+' Em chưa cộng hàng nào từ yêu cầu này.'});
     }
     return applyChatBasket(res,token,c,mixed.items.map(x=>({action:'add',code:x.sku,qty:x.qty})),
      draft.revision,'mixed-order-and-notes',mixed.delivery);
    }
   }
   // New conversational cart semantics are opt-in; legacy quote-only clients
   // must keep their historical no-draft behavior and pricing tests.
   const colloquial=b?.unifiedDraft===true?parseColloquialBasket(message,c):null;
   if(colloquial?.pending){
    const draft=draftStore.read(token);
    if(b?.unifiedDraft===true&&b?.expectedRevision!==draft.revision)return fail(res,409,'DRAFT_CONFLICT','Giỏ vừa thay đổi, cần tải lại.');
    pendingColloquial.set(token,{...colloquial.pending,revision:draft.revision,expiresAt:Date.now()+600_000});
    const known=colloquial.pending.items.map(x=>x.qty+' '+productFor(x.sku).unit.toLowerCase()+' '+productFor(x.sku).name).join(', ');
    return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'COLLOQUIAL_PRODUCT',
     draft,message:(known?'Đã nhận '+known+'. ':'')+colloquialQuestion(colloquial.pending.missing)});
   }
   if(colloquial?.needMoreDetails)return reply(res,200,{ok:true,needMoreDetails:true,
    draft:draftStore.read(token),message:colloquial.message});
   if(colloquial?.items){
    const draft=draftStore.read(token);
    if(b?.unifiedDraft===true&&b?.expectedRevision!==draft.revision)return fail(res,409,'DRAFT_CONFLICT','Giỏ vừa thay đổi, cần tải lại.');
    return applyChatBasket(res,token,c,colloquial.items.map(x=>({action:'add',code:x.sku,qty:x.qty})),
     draft.revision,colloquial.source);
   }
   const incomplete=parseWaterClarificationBasket(message,c);
   if(incomplete?.pending){
    const draft=draftStore.read(token);
    if(b?.unifiedDraft===true&&b?.expectedRevision!==draft.revision)
     return fail(res,409,'DRAFT_CONFLICT','Giỏ vừa thay đổi; vui lòng tải lại trước khi tiếp tục.');
    pendingWaterOrders.set(token,{...incomplete.pending,revision:draft.revision,
     expiresAt:Date.now()+600_000});
    const summary=incomplete.pending.items.map(i=>{
     const p=productFor(i.sku);return i.qty+' '+p.unit+' '+p.name;
    }).join(', ');
    const water=incomplete.pending.water;
    return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'WATER_BRAND_SIZE',
     draft,pendingItems:incomplete.pending.items,
     message:'Em đã hiểu '+water.qty+' thùng nước suối'+
      (summary?', '+summary:'')+'. '+(water.size?'Anh/chị muốn hãng Satori hay Hikari?':
      'Nước suối là Satori hay Hikari, dung tích bao nhiêu ml?')+
      ' Em đã giữ đủ các món trong yêu cầu nhưng chưa thêm vào giỏ hoặc tạo bill.'});
   }
   if(incomplete?.needMoreDetails)return reply(res,200,{ok:true,needMoreDetails:true,
    draft:draftStore.read(token),message:incomplete.message});
   if(ambiguousWater500InComposite(message))
    return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'COMPOUND_BRAND_500',
     draft:draftStore.read(token),message:'Trong đơn có nước suối 500ml chưa rõ Satori hay Hikari. Anh/chị vui lòng ghi rõ hãng và gửi lại nguyên danh sách sản phẩm. Em chưa thêm bất cứ sản phẩm nào để tránh sót đơn.'});
  }
  // Existing basket always wins, even when an older browser omits the new opt-in.
  const existing=draftStore.read(token);
  if(existing.items.length&&b?.cartItems!==undefined)return fail(res,409,'DRAFT_ACTIVE','Giỏ hiện có sản phẩm. Vui lòng tải lại trang để tiếp tục chung một giỏ.');
  const unified=b?.unifiedDraft===true||existing.items.length>0;
  const revision=b?.unifiedDraft===true?b?.expectedRevision:existing.revision;
  if(unified&&revision!==draftStore.read(token).revision)return fail(res,409,'DRAFT_CONFLICT','Giỏ vừa thay đổi, hãy tải lại trước khi gửi.');
  // Once the customer confirmed a TEST bill, a later delivery message is an
  // amendment proposal. It NEVER mutates invoice, price or recipient on parse.
  const pending=pendingAmends.get(c.id);
  if(pending&&pending.expiresAt<=Date.now())pendingAmends.delete(c.id);
  else if(pending&&!b?.cartItems&&isConfirmAmend(message))
   return applyAmendment(res,c,pending.id);
  else if(pending&&!b?.cartItems&&isCancelAmend(message)){
   pendingAmends.delete(c.id);
   return reply(res,200,{ok:true,amendmentCancelled:true,message:'Đã hủy đề xuất sửa. Hóa đơn vẫn giữ nguyên.'});
  }
  // Clarification is bound to the latest eligible bill and expires with its
  // original amendment request. Never silently infer 14:00 from "hai giờ".
  const clarify=pendingAmends.get(c.id);
  const normalizedAnswer=normAmend(message);
  if(clarify?.clarify&&clarify.expiresAt>Date.now()&&!b?.cartItems&&
     /^(?:(?:sau|luc|vao)\s+)?\d{1,2}\s*(?:gio|h|tieng)\s*(?:chieu|sang|trua|toi|dem|nua)$/i.test(normalizedAnswer)){
   const requested=clarify.rawRequest.replace(/(?:hai|2)\s*(?:giờ|gio|h)(?![\p{L}\p{N}])/iu,message.trim());
   const parsed=parseAmendment(requested);
   if(parsed?.note)return proposeAmendment(res,c,parsed.note,requested);
   return reply(res,200,{ok:true,needMoreDetails:true,message:parsed?.clarification||'Bạn vui lòng nói rõ giờ giao.'});
  }
  if(b?.cartItems===undefined&&isAmendmentIntent(message)){
   if(identityChange(message,c))return reply(res,200,{ok:true,needsHuman:true,message:'Thay đổi địa chỉ, số điện thoại hoặc người nhận cần cửa hàng xác minh; hóa đơn chưa được sửa.'});
   const parsed=parseAmendment(message);
   if(parsed?.clarification){
    pendingAmends.set(c.id,{id:crypto.randomUUID(),clarify:true,rawRequest:message,
     expiresAt:Date.now()+MAX_AMEND_AGE_MS});
    return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'AMENDMENT_DELIVERY_TIME',message:parsed.clarification});
   }
   if(parsed?.note)return proposeAmendment(res,c,parsed.note,message);
  }
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
  if(unified){
   if(identityChange(message,c)){
    const request=customerLinks.logChangeRequest(c,message);
    return reply(res,200,{ok:true,needsHuman:true,changeRequestId:request.id,
     draft:draftStore.read(token),message:'Đổi địa chỉ, người nhận hoặc số điện thoại phải được cửa hàng xác minh. Giỏ hàng chưa thay đổi.'});
   }
   // Resolve all listed products before running single-item followups.
   // No partial checkout: one sentence is committed to one revisioned TEST basket.
   let compound=parseMultiOrder(message,c);
   if(compound?.needMoreDetails||(!compound&&looksCompoundOrder(message))){
    const structured=await parseComplexOrderWithGemini(message,c);
    if(structured?.items)compound=structured;
    else return reply(res,200,{ok:true,needMoreDetails:true,draft:draftStore.read(token),
     message:compound?.message||'Em thấy đơn có nhiều sản phẩm nhưng chưa rõ đủ số lượng hoặc quy cách. Anh/chị vui lòng nói rõ món chưa xác định; em chưa tạo bill.'});
   }
   if(compound?.items){
    const deliveryAll=extractDeliveryIntent(message,new Date());
    if(deliveryAll.clarification)return reply(res,200,{ok:true,needMoreDetails:true,
     draft:draftStore.read(token),clarificationType:'DELIVERY_TIME',message:deliveryAll.clarification});
    return applyChatBasket(res,token,c,
     compound.items.map(x=>({action:'add',code:x.sku,qty:x.qty})),
     revision,compound.source,deliveryAll);
   }
   const single=parseOneClause(message,c);
   if(single)return applyChatBasket(res,token,c,[{action:'add',code:single.sku,qty:single.qty}],
    revision,'catalogue-short-product');
   const edit=contextualDraftEdit(message,c,draftStore.read(token));
   if(edit?.clarification)return reply(res,200,{ok:true,needMoreDetails:true,draft:draftStore.read(token),message:edit.clarification});
   if(edit?.changes)return applyChatBasket(res,token,c,edit.changes,revision,'basket-followup');
  }else if(/\bthem\b.*\b(nua|vao don)\b/.test(normalized))
   return reply(res,200,{ok:true,needMoreDetails:true,message:'Vui lòng ghi rõ loại nước và số lượng cần bổ sung.'});
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
  // Factual sales answers come only from the customer's approved server data.
  // They never change price, identity, cart, invoices or delivery promises.
  const factual=businessReply(parsedMessage,c);
  if(factual)return reply(res,200,{ok:true,sandbox:true,parserSource:'verified-facts',
   intent:factual.kind,message:factual.message});
  const delivery=extractDeliveryIntent(parsedMessage,new Date());
  if(delivery.clarification){
   sessions.set(token,{pendingDeliveryMessage:parsedMessage,expiresAt:Date.now()+5*60_000});
   return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'DELIVERY_TIME',message:delivery.clarification});
  }
  // Every listed item must be understood; never silently drop a second SKU.
  if(/\b(khong dat|huy don|dung giao|thoi khong|chua dat)\b/.test(normalized))return reply(res,200,{ok:true,message:'Đã hiểu, mình chưa lập báo giá hay tạo đơn nào.'});
  let multi=parseMultiOrder(parsedMessage,c);
  if(multi?.needMoreDetails||(!multi&&looksCompoundOrder(parsedMessage))){
   const structured=await parseComplexOrderWithGemini(parsedMessage,c);
   if(structured?.items)multi=structured;
   else if(!multi)return reply(res,200,{ok:true,needMoreDetails:true,
    message:'Em thấy nhiều món trong một tin nhắn nhưng chưa rõ đủ sản phẩm và số lượng. Anh/chị nói rõ món còn thiếu nhé; chưa lập bill.'});
  }
  if(multi){
   if(identityChange(parsedMessage,c))return reply(res,200,{ok:true,needsHuman:true,message:'Thay đổi địa chỉ, số điện thoại hoặc người nhận cần cửa hàng xác minh thủ công.'});
   if(multi.needMoreDetails)return reply(res,200,{ok:true,needMoreDetails:true,message:multi.message});
   if(unified)return applyChatBasket(res,token,c,multi.items.map(x=>({action:'add',code:x.sku,qty:x.qty})),revision,multi.source,delivery);
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
  if(parsed.intent==='product_question'){
   const question=businessReply(parsedMessage,c);
   if(question)return reply(res,200,{ok:true,parserSource:parsed.source||'rules',intent:question.kind,message:question.message});
   const mentioned=resolveProduct(parsedMessage,c);
   const product=mentioned.sku&&!mentioned.ambiguous?productFor(mentioned.sku):null;
   return reply(res,200,{ok:true,parserSource:parsed.source||'rules',message:product?
    'Có '+product.name+' trong danh mục Minh Satori. Bạn chọn số lượng trong Tất cả sản phẩm để nhận báo giá theo chiết khấu và VAT của link khách.':
    'Mình hỗ trợ tư vấn các sản phẩm Satori, Hikari và Juice. Bạn mở Tất cả sản phẩm để xem quy cách, giá theo link và thêm nhiều món vào cùng giỏ hàng nhé.'});
  }
  if(parsed.intent!=='order')return reply(res,200,{ok:true,parserSource:parsed.source||'rules',
   message:'Mình là trợ lý mua bán nước Minh Satori nên chỉ hỗ trợ tư vấn sản phẩm, giá theo link khách, giỏ hàng, đơn đặt, hóa đơn và giao hàng. Bạn muốn mình hỗ trợ phần nào?'});

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
  if(unified)return applyChatBasket(res,token,c,[{action:'add',code:sku,qty}],revision,parsed.source||'rules',delivery);
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
  if(q.draftRevision!==undefined&&q.draftRevision!==draftStore.read(token).revision)return fail(res,409,'DRAFT_CONFLICT','Báo giá đã cũ vì giỏ hàng thay đổi. Vui lòng xem báo giá mới nhất.');
  let deliveryNote;
  try{deliveryNote=normalizeDeliveryNote(b?.deliveryNote??q.deliveryNote)}catch{return fail(res,400,'INVALID_DELIVERY_NOTE','Lưu ý giao hàng phải là văn bản tối đa 300 ký tự')}
  const o={...q,deliveryNote,ref:'TEST-'+crypto.randomBytes(5).toString('hex').toUpperCase(),requestId:idemKey,createdAt:new Date().toISOString(),status:'Chờ thanh toán',sandbox:true};
  delete o.token; // Do not write the bearer link credential into invoice/order storage.
  orders.set(o.ref,o);idempotency.set(idemKey,o.ref);saveOrdersAtomic();quotes.delete(q.quoteId);
  if(q.draftRevision!==undefined){draftStore.mutate(token,[{action:'clear'}],q.draftRevision);invalidateQuotes(token);}
  pendingAmends.delete(c.id); // New confirmed invoice supersedes any earlier amendment proposal.
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
  try{const buf=await generatePdf(o);const disposition=url.searchParams.get('view')==='1'?'inline':'attachment';res.writeHead(200,{'content-type':'application/pdf','content-disposition':disposition+'; filename="'+o.ref+'.pdf"','cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(buf)}catch(err){return fail(res,503,'PDF_FAILED','Không tạo được PDF. Kiểm tra python3, reportlab và font tiếng Việt.')}
  return;
 }
 return fail(res,404,'NOT_FOUND','Không có đường dẫn này');
 }catch(err){if(process.env.NODE_ENV==='test')console.error('SANDBOX_TEST_SERVER_ERROR',String(err?.stack||err).slice(0,800));return fail(res,err.message==='PAYLOAD_TOO_LARGE'?413:500,'SERVER_ERROR','Lỗi xử lý yêu cầu thử nghiệm')}
});
// TEST-ONLY one-time encrypted rescue for a confirmed pre-deploy snapshot.
// Never inject plaintext or secret keys in code, browser, chat or logs.
// Fail closed if the backup is stale. Prevent ghost/stale orders after a later restart.
function bootstrapEncryptedTestSnapshot(){
 const encoded=process.env.GEMINI_SANDBOX_BOOTSTRAP_ENCRYPTED_B64||'';
 if(!encoded)return;
 const state=customerLinks.exportState();
 if(orders.size||state.profiles.length||state.changeRequests.length||draftStore.snapshot().length||phraseMemory.snapshot().length){
  console.info('SANDBOX_BOOTSTRAP_EXISTING_STATE_PRESERVED');
  return;
 }
 try{
  if(encoded.length>6000000)throw Error('INVALID_BOOTSTRAP_SIZE');
  const key=Buffer.from(String(process.env.GEMINI_SANDBOX_DRIVE_ENCRYPTION_KEY_B64||''),'base64');
  const envelope=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
  const restored=decryptArchive(envelope,key);
  // Explicit snapshot age is checked before modifying any in-memory or on-disk data.
  const raw=Buffer.from(encoded,'base64');
  const payload=JSON.parse(raw.toString('utf8'));
  if(!payload||payload.encrypted!==true)throw Error('INVALID_BOOTSTRAP');
  // The verified archive date is in the encrypted authenticated plaintext; read it
  // only from a decrypted, independently integrity-checked snapshot.
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  const json=Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8');
  const stamp=Date.parse(JSON.parse(json)?.snapshot?.exportedAt||'');
  const age=Date.now()-stamp;
  if(!Number.isFinite(stamp)||age<0||age>90*60_000)throw Error('STALE_BOOTSTRAP');
  customerLinks.restoreState(restored);
  draftStore.restore(restored.drafts||[]);
  phraseMemory.restore(restored.phrases||[]);
  for(const o of restored.orders){orders.set(o.ref,o);idempotency.set(o.requestId,o.ref)}
  saveOrdersAtomic();
  console.info('SANDBOX_BOOTSTRAP_RESTORED','orders='+restored.orders.length,
   'drafts='+draftStore.snapshot().length,'customers='+restored.profiles.length);
 }catch(e){
  console.error('SANDBOX_BOOTSTRAP_FAILED',e?.message==='STALE_BOOTSTRAP'?'STALE_BOOTSTRAP':'INTEGRITY_OR_STORAGE_ERROR');
  throw Error('SANDBOX_BOOTSTRAP_FAILED');
 }
}
try{bootstrapEncryptedTestSnapshot()}catch{process.exit(78)}
server.listen(PORT,HOST,()=>{
 driveWorker.start();
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
