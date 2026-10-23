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
import {listLocations,chosenLocation,matchLocation,foldLocation,effectiveLocationDiscount} from './delivery-locations.mjs';
import {extractDeliveryIntent} from './delivery-intent.mjs';
import {createSandboxBackup,verifySandboxBackup} from './sandbox-backup.mjs';
import {makeDriveBackupWorker,decryptArchive} from './drive-backup.mjs';
import {readMinhSatori,readOnlyReady} from './satori-readonly.mjs';
import {ownerLiveLookup} from './owner-live-lookup.mjs';
import {ownerPairAction,probeOwnerPairRead,ownerPairConfigReadiness} from './owner-collaborator-pairs.mjs';
import {createOwnerRealInvoice} from './owner-live-invoice.mjs';
import {createOriginalPdfGateway} from './original-pdf-gateway.mjs';
import {createProductionPrivateLinks} from './production-private-links.mjs';
import {createCollaboratorSingleLink} from './collaborator-single-link.mjs';
import {screenMonthlyCustomers} from './owner-customer-screening.mjs';
import {directoryFromInvoices,detailFromEvidence} from './owner-customer-directory.mjs';
import {observedRealCustomerDiscounts} from './owner-review-pricing.mjs';
import {checkCatalogueParity} from './catalogue-parity.mjs';
import {auditDriveCatalogue} from './catalogue-drive-audit.mjs';
import {getGeminiVersionStatus} from './version-status.mjs';
import {parseAmendment,isAmendmentIntent,isConfirmAmend,isCancelAmend,appendDeliveryNote,latestEditableOrder,normAmend} from './order-amend.mjs';
import {ADDRESS_REPLY,ambiguousWater500,ambiguousWater500InComposite,brandAnswer,contactIntent,phoneConfirm,phoneCancel,maskPhone,trainingProposal,trainingConfirm,trainingCancel,trainingForget,makeCustomerPhraseMemory} from './conversation-understanding.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST=process.env.DEMO_BIND||'127.0.0.1';
const PORT=Number(process.env.PORT||8787);
const MODEL='gemini-3.5-flash-lite';
// Emergency preview is isolated/ephemeral: Gemini chat and draft only.
const EMERGENCY_PREVIEW=process.env.GEMINI_SANDBOX_EMERGENCY_DEMO_ONLY==='1';
const OWNER_ONLY_PILOT=process.env.GEMINI_OWNER_ONLY_REAL_PILOT==='1';
const ownerInvoice=createOwnerRealInvoice();
const ownerPdfGateway=createOriginalPdfGateway();
const realPrivateLinks=createProductionPrivateLinks({source:ownerInvoice.source,bot:ownerInvoice.bot});
if(realPrivateLinks.readiness().configured){
 // Non-mutating scope probe: orders.create with no requestId always fails
 // validation before Google Drive backup or ledger writes.
 void realPrivateLinks.probeWriteScope()
  .then(()=>console.info('SATORI_AGENCY_SINGLE_INVOICE_WRITE_SCOPE', 'PASS'))
  .catch(e=>console.warn('SATORI_AGENCY_SINGLE_INVOICE_WRITE_SCOPE', String(e?.code||'NOT_VERIFIED')));
}else console.info('SATORI_AGENCY_SINGLE_INVOICE_WRITE_SCOPE','DISABLED');

const ctvSingleLink=createCollaboratorSingleLink({
 policyList:()=>ownerPairAction('collaborators.pair.list',{}),
 invoiceSource:ownerInvoice.source,
 createPair:payload=>ownerPairAction('orders.create.pair',payload),
 invoiceLookup:async invoiceNo=>{
  const result=await ownerInvoice.bot('orders.list',{query:String(invoiceNo),limit:100});
  if(!Array.isArray(result.data?.orders)||result.data?.totalMatches>100)
   throw Error('CTV_INVOICE_SEARCH_INCOMPLETE');
  return result.data.orders;
 }
});
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
function deliveryProfile(profile,locationId){
 const points=listLocations(profile);
 const location=locationId?chosenLocation(profile,locationId):points.length===1?points[0]:null;
 if(!location)return {...profile,recipient:'',phone:'',address:'Chưa chọn điểm giao',deliveryLocationId:null,locationRequired:true};
 return {...profile,recipient:location.recipient,phone:location.phone,address:location.address,
  discount:effectiveLocationDiscount(profile,location),
  deliveryLocationId:location.id,locationLabel:location.label,locationRequired:false};
}
async function bodyJSON(req,maxBytes=8_192){const chunks=[];let size=0;for await(const buf of req){size+=buf.length;if(size>maxBytes)throw new Error('PAYLOAD_TOO_LARGE');chunks.push(buf)}return safeJSON(Buffer.concat(chunks).toString('utf8'))}
function rateLimit(req,token){const now=Date.now();const key=(req.socket.remoteAddress||'localhost')+'|'+token;const list=(rate.get(key)||[]).filter(t=>now-t<60000);if(list.length>=(HOST==='127.0.0.1'&&process.env.DEMO_ISOLATED_TEST_RATE==='1'&&process.env.NODE_ENV!=='production'?100:20))return false;list.push(now);rate.set(key,list);return true}
function money(v){return Math.round(v)}
function normalizeDeliveryNote(value){if(value==null)return '';if(typeof value!=='string'||value.length>300)throw new Error('INVALID_DELIVERY_NOTE');return value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()}

// Pricing, discounts, identity and persistence are server-owned; AI only parses messages.
function makeQuote(token,profile,sku,qty){
 if(!productFor(sku)||!Number.isSafeInteger(qty)||qty<1||qty>500)return null;
 const product=productFor(sku);const unitPrice=money(product.listPrice*(1-profile.discount/100));const subtotal=qty*unitPrice;const shipping=money(subtotal*profile.ship/100);const vatRate=profile.vatRate??0;const vatAmount=money(subtotal*vatRate/100);const q={quoteId:crypto.randomUUID(),profileId:profile.id,sku,qty,name:profile.name,recipient:profile.recipient||profile.name,deliveryLocationId:profile.deliveryLocationId||null,locationLabel:profile.locationLabel||null,locationRequired:!!profile.locationRequired,phone:profile.phone,address:profile.address,discount:profile.discount,ship:profile.ship,unitPrice,product:product.name,code:product.code,unit:product.unit,spec:product.spec,listPrice:product.listPrice,subtotal,shipping,vatRate,vatAmount,total:subtotal+shipping+vatAmount,expiresAt:Date.now()+10*60_000,token};quotes.set(q.quoteId,q);return q;
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
 const q={quoteId:crypto.randomUUID(),profileId:profile.id,sku:'MULTI',qty:totalQty,name:profile.name,recipient:profile.recipient||profile.name,deliveryLocationId:profile.deliveryLocationId||null,locationLabel:profile.locationLabel||null,locationRequired:!!profile.locationRequired,phone:profile.phone,address:profile.address,discount:profile.discount,ship:profile.ship,product:items.length+' loại sản phẩm',unit:'đơn vị',items,subtotal,shipping,vatRate,vatAmount,total:subtotal+shipping+vatAmount,expiresAt:Date.now()+10*60_000,token};
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
 const destination=deliveryProfile(profile,draft.locationId);
 const q=items.length===1?makeQuote(token,destination,items[0].sku,items[0].qty):makeMultiQuote(token,destination,items);
 if(q){q.draftRevision=draft.revision;q.deliveryNote=draft.deliveryNote||'';q.requestedDeliveryAt=draft.requestedDeliveryAt||null;}
 return q;
}
/* Spoken complete order vs. explicit top-up: a full itemized order is an
 * absolute basket snapshot, not a delta from a previous chat/session.
 * Only "thêm / bổ sung / cộng thêm" deliberately increments quantities.
 * A single newly named item updates that SKU without deleting other products.
 */
function chatBasketChanges(message,items){
 const phrase=fold(message);
 const isTopUp=/^(?:(?:cho|lay)\s+(?:(?:em|anh|chi|toi|minh)\s+)?)?(?:them|bo sung|cong them)\b/.test(phrase);
 if(isTopUp)return items.map(x=>({action:'add',code:x.sku,qty:x.qty}));
 if(items.length>1||/\b(?:don moi|dat lai tu dau|lam don moi)\b/.test(phrase))
  return [{action:'replace',items:items.map(x=>({code:x.sku,qty:x.qty}))}];
 return items.map(x=>({action:'set',code:x.sku,qty:x.qty}));
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
  message:(changes.some(x=>x.action==='replace')?'Đã thay giỏ cũ bằng đơn mới chính xác: ':'Đã cập nhật cùng một giỏ: ')+draft.items.length+' loại / '+draft.items.reduce((n,x)=>n+x.qty,0)+' đơn vị. Chưa tạo bill; bạn xác nhận báo giá cuối cùng một lần nhé.'});
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
// Keep the sandbox/production boundary permanently visible without consuming the chat viewport.
// Full, explicit warnings remain accessible through the native details disclosure.
const PREVIEW_BANNER='<aside id="satoriPreviewBanner" class="satori-preview-banner" role="status" aria-label="Môi trường thử nghiệm"><span class="satori-preview-label">🧪 SANDBOX · Chỉ chat và báo giá thử; KHÔNG tạo hóa đơn thật.</span><details id="satoriPreviewDetails"><summary>Chi tiết</summary><p>Chế độ thử Gemini tạm thời, hồ sơ đại lý nhiều địa chỉ là dữ liệu mẫu. Dữ liệu thử có thể mất khi Render khởi động lại. KHÔNG xác nhận hóa đơn, KHÔNG đồng bộ production.</p></details></aside>';
function previewHtml(name){
 const html=fs.readFileSync(path.join(HERE,name),'utf8');
 return EMERGENCY_PREVIEW?html.replace('<body>','<body>'+PREVIEW_BANNER):html;
}
function sendHtml(res){const html=previewHtml('index.html');res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'"});res.end(html)}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost'),p=url.pathname;
 // Headless PDF generation is a private HMAC service for the OWNER's
 // Apps Script scheduler. It uses the website's exact pdfmake definition;
 // never exposes real customer data to a public/Gemini route.
 if(req.method==='POST'&&p==='/api/internal/original-pdf'){
  if(!ownerPdfGateway.configured())return fail(res,404,'NOT_FOUND','Not found');
  try{
   const input=await bodyJSON(req,75_000);
   const pdf=await ownerPdfGateway.process(input);
   return reply(res,200,pdf);
  }catch(e){
   const code=String(e?.message||'');
   const known=new Set(['PDF_RENDER_BAD_REQUEST','PDF_RENDER_AUTH_FAILED',
     'PDF_RENDER_REPLAYED','PDF_RENDER_VERSION_MISMATCH',
     'PDF_ORDER_TOTAL_MISMATCH','PDF_ORDER_INVALID','PDF_RENDER_TIMEOUT',
     'PDF_RENDER_OUTPUT_INVALID','PDF_INVALID_BYTES']);
   const safe=known.has(code)?code:'PDF_RENDER_FAILED';
   return fail(res,400,safe,'Không thể tạo PDF đã xác thực.');
  }
 }
 // When the OWNER opens the old "Xem trải nghiệm đặt hàng" deep link
 // from a pre-update Android APK, send it to the authenticated owner UI.
 // This is navigation only; NO customer API, order URL or auth bypass is opened.
 if(OWNER_ONLY_PILOT&&req.method==='GET'&&/^\/c\/demo-[ab]$/.test(p)){
  res.writeHead(302,{'location':'/admin','cache-control':'no-store',
   'referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
  return res.end();
 }
 // Owner real pilot is a sealed, admin-only path. Public customer/chat/bearer
 // URLs are completely blocked when this mode is enabled (not just hidden).
 if(OWNER_ONLY_PILOT&&!(
   p==='/health'||p==='/admin'||p==='/admin/'||
   p==='/assets/logo-satori.jpg'||p.startsWith('/api/admin/')||
   (realPrivateLinks.readiness().configured===true&&
    (p==='/real'||p==='/real/'||
     /^\/api\/real\/(?:catalogue|quote|confirm)$/.test(p)))||
   (ctvSingleLink.readiness().enabled===true&&
    (p==='/ctv'||p==='/ctv/'||/^\/api\/ctv\/(?:catalogue|quote|confirm|pdf\/(?:customer|collaborator))$/.test(p)))
 ))return fail(res,403,'OWNER_ONLY_NO_CUSTOMER_ACCESS',
    'Tính năng này đang được chủ tài khoản kiểm thử. Khách chưa được sử dụng.');
 // Private customer invitations can be issued ONLY after the owner has approved
 // an exact historical address and pricing policy. The public page is useless
 // without a second 160-bit access code provided out of band.
 if(req.method==='GET'&&(p==='/real'||p==='/real/')){
  if(!realPrivateLinks.readiness().configured)
   return fail(res,503,'REAL_LINKS_NOT_ENABLED','Chưa bật link khách thật.');
  const html=fs.readFileSync(path.join(HERE,'real-checkout.html'),'utf8');
  res.writeHead(200,{'content-type':'text/html; charset=utf-8',
   'cache-control':'no-store','referrer-policy':'no-referrer',
   'x-content-type-options':'nosniff','x-frame-options':'DENY',
   'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"});
  return res.end(html);
 }
 // The public CTV portal is one link per marked account, never per location.
 // It exposes no raw source ledger and no internal 35% invoice to recipients.
 if(req.method==='GET'&&(p==='/ctv'||p==='/ctv/')){
  if(!ctvSingleLink.readiness().enabled)
   return fail(res,503,'CTV_PORTAL_NOT_READY','Chưa thể cấp link CTV thật.');
  const html=fs.readFileSync(path.join(HERE,'ctv-order.html'),'utf8');
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
   'referrer-policy':'no-referrer','x-content-type-options':'nosniff',
   'x-frame-options':'DENY',
   'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"});
  return res.end(html);
 }
 if(req.method==='GET'&&p==='/api/admin/ctv-links/readiness'){
  if(!customerLinks.adminAuthorized(req))return fail(res,401,'ADMIN_AUTH_REQUIRED','Cần xác thực quản trị.');
  return reply(res,200,{ok:true,...ctvSingleLink.readiness()});
 }
 if(req.method==='POST'&&p==='/api/admin/ctv-links/issue'){
  if(!customerLinks.adminAuthorized(req))return fail(res,401,'ADMIN_AUTH_REQUIRED','Chỉ chủ tài khoản được cấp link CTV.');
  if(!rateLimit(req,'owner-ctv-link-issue'))return fail(res,429,'RATE_LIMIT','Thao tác quá nhanh.');
  try{
   const input=await bodyJSON(req,1024);
   return reply(res,200,{ok:true,...await ctvSingleLink.issue(input)});
  }catch(e){return fail(res,409,e?.code||'CTV_LINK_ISSUE_FAILED',
   'CTV chưa được phê duyệt đầy đủ hoặc Bot API chưa có quyền; chưa cấp link.')}
 }
 if(req.method==='POST'&&/^\/api\/ctv\/(?:catalogue|quote|confirm|pdf\/(?:customer|collaborator))$/.test(p)){
  if(!ctvSingleLink.readiness().enabled)
   return fail(res,503,'CTV_NOT_READY','Cổng CTV chưa được bật.');
  if(!rateLimit(req,'ctv-private:'+p))return fail(res,429,'RATE_LIMIT','Thử lại sau.');
  try{
   const input=await bodyJSON(req,12000);
   if(p==='/api/ctv/catalogue')return reply(res,200,{ok:true,...await ctvSingleLink.catalogue(input)});
   if(p==='/api/ctv/quote')return reply(res,200,{ok:true,...await ctvSingleLink.quote(input)});
   if(p==='/api/ctv/confirm')return reply(res,200,{ok:true,...await ctvSingleLink.confirm(input)});
   const role=p.endsWith('/customer')?'customer':'collaborator';
   const pdfData=await ctvSingleLink.invoiceForPdf(input,role);
   const buf=await generatePdf(pdfData);
   res.writeHead(200,{'content-type':'application/pdf','cache-control':'private, no-store',
    'referrer-policy':'no-referrer','x-content-type-options':'nosniff',
    'content-disposition':'inline; filename="MinhSatori-'+role+'-'+pdfData.invoiceNo+'.pdf"'});
   return res.end(buf);
  }catch(e){
   const unknown=e?.code==='CTV_COMMIT_UNCERTAIN_CHECK_LEDGER';
   return fail(res,unknown?503:409,e?.code||'CTV_ACTION_FAILED',
    unknown?'Trạng thái ghi hóa đơn chưa rõ: không gửi lại, cần đối chiếu sổ.':
    'Yêu cầu bị từ chối: kiểm tra quyền CTV, điểm giao hoặc báo giá.');
  }
 }
 if(p==='/api/admin/real-links/readiness'&&req.method==='GET'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Yêu cầu đăng nhập chủ tài khoản.');
  return reply(res,200,{ok:true,...realPrivateLinks.readiness()});
 }
 if(p==='/api/admin/real-links/issue'&&req.method==='POST'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Chỉ chủ tài khoản có quyền cấp link.');
  if(!rateLimit(req,'owner-real-link-issue'))
   return fail(res,429,'RATE_LIMIT','Thao tác quá nhanh.');
  try{
   const input=await bodyJSON(req,12000);
   const result=await realPrivateLinks.issue(input);
   return reply(res,200,result);
  }catch(e){
   return fail(res,409,e?.code||'REAL_LINK_ISSUE_FAILED',
    'Không cấp được link: cần đúng hóa đơn gốc, địa chỉ và giá chủ tài khoản duyệt.');
  }
 }
 if(req.method==='POST'&&/^\/api\/real\/(?:catalogue|quote|confirm|interpret)$/.test(p)){
  if(!realPrivateLinks.readiness().configured)
   return fail(res,503,'REAL_LINKS_NOT_ENABLED','Hệ thống đặt hàng thật chưa được bật.');
  if(!rateLimit(req,'private-real-checkout:'+p))
   return fail(res,429,'RATE_LIMIT','Vui lòng thử lại sau.');
  try{
   const input=await bodyJSON(req,12000);
   let result;
   if(p==='/api/real/catalogue')result=await realPrivateLinks.catalogue(input);
   if(p==='/api/real/interpret'){
    const profile=await realPrivateLinks.catalogue(input); // First verify link, PIN and destination.
    const message=String(input.message||'').trim();
    if(!profile.customer||message.length<3||message.length>500||
       identityChange(message,profile.customer))
     return fail(res,400,'REAL_CHAT_NEEDS_CLARIFICATION','Vui lòng chọn địa chỉ trong danh sách và chỉ nhập tên/số lượng sản phẩm.');
    let match=parseMultiOrder(message,{}),source='rules';
    if(match?.needMoreDetails)match=null;
    if(!match){
     const ai=await parseComplexOrderWithGemini(message,{});
     if(ai?.items){match=ai;source=ai.source}
    }
    let lines=match?.items?.map(i=>({code:productFor(i.sku)?.code,qty:i.qty}));
    if(!lines||!lines.length){
     const parsed=await parseOrder(message,{});
     if(parsed?.intent!=='order'||parsed.needMoreDetails||parsed.needsHuman||
        !productFor(parsed.sku)||!Number.isSafeInteger(parsed.qty)||parsed.qty<1)
      return reply(res,200,{ok:true,needsClarification:true,parserSource:parsed?.source||'rules',
       message:'Em cần tên sản phẩm và số lượng rõ ràng, ví dụ: 2 thùng Satori 500ml. Chưa tạo hóa đơn.'});
     lines=[{code:productFor(parsed.sku).code,qty:parsed.qty}];
     source=parsed.source||'rules';
    }
    if(lines.length>6||lines.some(x=>!x.code||!Number.isSafeInteger(x.qty)||x.qty<1||x.qty>500||
       !profile.products.some(p=>p.code===x.code))||
       lines.reduce((n,x)=>n+x.qty,0)>500)
     return fail(res,400,'REAL_CHAT_PRODUCT_INVALID','Sản phẩm hoặc số lượng không hợp lệ theo danh mục hiện tại.');
    result={production:true,items:lines,parserSource:source,
      message:'Đã hiểu yêu cầu. Anh/chị kiểm tra sản phẩm và số lượng trong giỏ, sau đó xem báo giá để xác nhận.'};
   }
   if(p==='/api/real/quote')result=await realPrivateLinks.quote(input);
   if(p==='/api/real/confirm')result=await realPrivateLinks.confirm(input);
   return reply(res,200,{ok:true,...result});
  }catch(e){
   const code=e?.code||'REAL_CHECKOUT_UNAVAILABLE';
   const uncertain=code==='REAL_WRITE_UNCERTAIN_RECONCILE_WITH_OWNER';
   return fail(res,uncertain?503:409,code,uncertain?
    'Chưa xác minh trạng thái lưu hóa đơn thật. Không gửi lại; hãy liên hệ Minh Satori đối chiếu.':
    'Không thể thực hiện giao dịch thật; hãy xác minh mã, điểm giao hoặc báo giá lại.');
  }
 }
 if(p==='/api/admin/owner-live/readiness'&&req.method==='GET'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Đăng nhập quản trị để xem điều kiện tạo đơn.');
  return reply(res,200,{ok:true,...ownerInvoice.readiness()});
 }
 if(p==='/api/admin/owner-live/preview'&&req.method==='POST'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Chỉ chủ tài khoản được lập báo giá.');
  if(!rateLimit(req,'owner-live-preview'))return fail(res,429,'RATE_LIMIT','Thử lại sau ít phút.');
  try{
   const input=await bodyJSON(req,4096);
   const quote=await ownerInvoice.preview({authenticated:true,invoiceNo:input?.invoiceNo,
    message:input?.message,discountPercent:input?.discountPercent,
    shippingPercent:input?.shippingPercent,vatPercent:input?.vatPercent});
   return reply(res,200,{ok:true,ownerOnly:true,...quote});
  }catch(e){
   return fail(res,409,e?.code||'OWNER_PREVIEW_FAILED',
     'Chưa tạo báo giá thật. Kiểm tra quyền Bot API, bảng giá và thông tin khách.');
  }
 }
 if(p==='/api/admin/owner-live/confirm'&&req.method==='POST'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Chỉ chủ tài khoản được duyệt ghi hóa đơn.');
  if(!rateLimit(req,'owner-live-confirm'))return fail(res,429,'RATE_LIMIT','Thử lại sau ít phút.');
  try{
   const input=await bodyJSON(req,7000);
   const receipt=await ownerInvoice.confirm({authenticated:true,quoteToken:input?.quoteToken,
    confirmedByOwner:input?.confirmation==='OWNER_APPROVES_REAL_INVOICE'});
   return reply(res,200,{ok:true,ownerOnly:true,...receipt});
  }catch(e){
   return fail(res,409,e?.code||'OWNER_COMMIT_UNCERTAIN_RECONCILE',
     'Chưa xác nhận được ghi đơn. Không bấm gửi lại khi trạng thái chưa rõ; hãy đối chiếu sổ thật.');
  }
 }

 if(EMERGENCY_PREVIEW&&req.method!=='GET'&&!(req.method==='POST'&&
   (p==='/api/message'||p==='/api/draft'))&&
   !(['POST','PATCH','DELETE'].includes(req.method)&&
      /^\/api\/admin\/customers(?:\/KH-SANDBOX-[0-9a-f-]{36}(?:\/(?:locations(?:\/[a-zA-Z0-9-]{1,70})?|rotate|revoke))?)?$/.test(p))){
  return fail(res,503,'PREVIEW_ONLY_NO_WRITES',
   'Đang dùng chế độ thử Gemini. Chưa cho tạo hóa đơn hoặc thay đổi hồ sơ khách.');
 }
 if(req.method==='GET'&&p==='/assets/logo-satori.jpg'){const logo=path.join(HERE,'assets','logo-satori.jpg');if(!fs.existsSync(logo))return fail(res,404,'NO_LOGO','Không tìm thấy logo');res.writeHead(200,{'content-type':'image/jpeg','cache-control':'public, max-age=86400','x-content-type-options':'nosniff'});return fs.createReadStream(logo).pipe(res)}
 if(req.method==='GET'&&p==='/health')return reply(res,200,{ok:true,sandbox:true,ready:!EMERGENCY_PREVIEW,demoOnly:EMERGENCY_PREVIEW,mode:EMERGENCY_PREVIEW?'sandbox_emergency_preview':'sandbox_isolated',orderSubmissionEnabled:!EMERGENCY_PREVIEW,durableStorage:false,draftPersistence:!EMERGENCY_PREVIEW,productionCheckoutEnabled:false,ownerPilotMode:OWNER_ONLY_PILOT,ownerPilotReady:ownerInvoice.readiness().enabled,productionLaunchReady:false,aiProvider:'Gemini Free Tier (optional) + rules',aiConfigured:geminiConfigured(),rulesReady:true,model:MODEL,orders:orders.size,geminiProbe});
 if(req.method==='GET'&&/^\/c\/(?:demo-[ab]|[A-Za-z0-9_-]{40,96})$/.test(p))return sendHtml(res);
 if(req.method==='GET'&&(p==='/admin'||p==='/admin/')){const html=previewHtml('admin.html');res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'"});return res.end(html)}
 // Compare current server code with newest GitHub commit; never deploy from here.
 // Read-only CTV scope diagnostics; only authenticated admin, no secrets,
 // no policies or PII. Still works in emergency preview without write access.
 if(req.method==='GET'&&p==='/api/admin/collaborator-pairs/readiness'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Cần quyền quản trị.');
  return reply(res,200,{ok:true,probe:await probeOwnerPairRead(),
   credentials:ownerPairConfigReadiness(),
   linkIssuance:ctvSingleLink.readiness(),
   // Credential presence does not prove Apps Script scope or successful write.
   writesEnabled:false,customerAccessEnabled:ctvSingleLink.readiness().enabled===true});
 }
 // Scoped owner-only CTV policy controls. Never call this from customer chat.
 // Until deployment has explicit separate keys, read fails closed and writes
 // remain disabled. Gemini/public customer link credentials are never accepted.
 if(p==='/api/admin/collaborator-pairs'&&req.method==='GET'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Cần quyền quản trị để xem cấu hình CTV.');
  try{
   const policies=await ownerPairAction('collaborators.pair.list',{});
   return reply(res,200,{ok:true,source:'owner-approved-bot-api',...policies});
  }catch(e){
   return fail(res,503,e?.code||'CTV_PAIR_NOT_READY','Chưa xác minh được cấu hình hóa đơn đôi trên Bot API.');
  }
 }
 // Generic, owner-only account activation: ANY verified ledger customer may
 // become a CTV. One CTV has one link, multiple owner-approved destinations.
 // No personal names, discounts, or addresses are hard-coded.
 if(p==='/api/admin/ctv-activate'&&req.method==='POST'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Chỉ quản trị viên được duyệt CTV.');
  if(EMERGENCY_PREVIEW)
   return fail(res,503,'PREVIEW_ONLY_NO_WRITES','Không ghi quyền CTV trong bản xem thử.');
  if(!rateLimit(req,'owner-ctv-activate'))
   return fail(res,429,'RATE_LIMIT','Thao tác quá nhanh.');
  let input;
  try{input=await bodyJSON(req,6000)}catch{return fail(res,400,'INVALID_REQUEST','Thông tin duyệt CTV sai.')}
  if(!input||input.confirmation!=='OWNER_ACTIVATES_COLLABORATOR'||
     !Number.isSafeInteger(input.sourceInvoiceNo)||input.sourceInvoiceNo<1||
     !Array.isArray(input.destinationInvoiceNos)||
     input.destinationInvoiceNos.length<1||input.destinationInvoiceNos.length>20||
     input.destinationInvoiceNos.some(n=>!Number.isSafeInteger(n)||n<1)||
     new Set(input.destinationInvoiceNos).size!==input.destinationInvoiceNos.length||
     ![input.customerDiscountPercent,input.collaboratorDiscountPercent,input.shippingPercent].every(Number.isSafeInteger)||
     input.customerDiscountPercent<0||input.customerDiscountPercent>70||
     input.collaboratorDiscountPercent<=input.customerDiscountPercent||input.collaboratorDiscountPercent>70||
     input.shippingPercent<0||input.shippingPercent>30||
     ![0,5,8,10].includes(input.vatPercent))
   return fail(res,400,'CTV_SETUP_INVALID','Cần duyệt đúng CTV, điểm giao, hai mức CK, phí giao và VAT.');
  const credentialState=ownerPairConfigReadiness(),linkState=ctvSingleLink.readiness();
  if(credentialState.configure.ready!==true||credentialState.mark.ready!==true||
     credentialState.orderWrite.ready!==true||linkState.enabled!==true)
   return fail(res,503,'CTV_ACTIVATION_NOT_READY',
    'Thiếu cấu hình HMAC quyền duyệt/ghi hoặc khóa link CTV. Chưa ghi CTV và không tạo khách mới.');
  try{
   // Read scope must work before making any write. This is not a TEST invoice.
   await ownerPairAction('collaborators.pair.list',{});
   const numbers=[...new Set([input.sourceInvoiceNo,...input.destinationInvoiceNos])];
   // Apps Script serializes Bot API reads behind a script lock. Avoid
   // flooding the single deployment with 2*N concurrent requests when a CTV
   // selects many verified destinations (each source lookup reads a catalogue
   // and invoice). Read in small batches; no ledger writes occur here.
   const verified=[];
   for(let i=0;i<numbers.length;i+=2){
    const batch=await Promise.all(numbers.slice(i,i+2).map(n=>ownerInvoice.source(n)));
    verified.push(...batch);
   }
   const revision=verified[0].revision;
   if(verified.some(x=>x.revision!==revision))
    return fail(res,409,'CTV_SOURCE_CHANGED','Sổ kế toán thay đổi trong lúc kiểm tra.');
   const original=verified[0].customer;
   // Additional destinations may have different recipient or branch names,
   // but ONLY references explicitly reviewed by the owner may be used.
   const destinations=input.destinationInvoiceNos.map(n=>{
    const src=verified[numbers.indexOf(n)].customer;
    return {id:src.id,invoiceNo:n};
   });
   // Fail closed on an attempt to relabel another existing CTV using
   // the same canonical source invoice without owner review.
   const marked=await ownerPairAction('collaborators.mark',{
    requestId:'ctv_mark_'+crypto.randomBytes(16).toString('hex'),
    expectedRevision:revision,customerRef:{id:original.id,invoiceNo:input.sourceInvoiceNo},
    enabled:true,confirmed:true
   });
   // After mark, use the authoritative revision returned by the committed
   // ledger. Bot API validates EACH destination before storing the policy.
   const configured=await ownerPairAction('collaborators.pair.configure',{
    requestId:'ctv_policy_'+crypto.randomBytes(16).toString('hex'),
    expectedRevision:marked.revision,collaboratorId:marked.collaboratorId,
    enabled:true,confirmed:true,
    authorizedDestinations:destinations,rotateLink:false,
    customerDiscountPercent:input.customerDiscountPercent,
    collaboratorDiscountPercent:input.collaboratorDiscountPercent,
    shippingPercent:input.shippingPercent,vatPercent:input.vatPercent
   });
   let invitation=null;
   try{invitation=await ctvSingleLink.issue({collaboratorId:marked.collaboratorId})}
   catch{} // A policy can be approved before link/read/write launch gates are ready.
   return reply(res,200,{ok:true,production:true,collaboratorId:marked.collaboratorId,
    revision:configured.revision,authorizedDestinations:destinations.length,
    policyConfigured:true,linkEnabled:Boolean(invitation),
    ... (invitation?{invitation}:{}),
    message:invitation?'Đã cấp 1 link CTV dùng cho mọi điểm giao được duyệt.':
     'Đã lưu vai trò và hai chiết khấu, nhưng chưa phát hành link vì cổng CTV chưa sẵn sàng.'});
  }catch(e){
   // A fixed category helps diagnose failed source validation without logging
   // names, addresses, HMAC credentials, or customer invoice details.
   const category=String(e?.code||'CTV_SETUP_UNCERTAIN_RECONCILE').replace(/[^A-Z0-9_]/g,'').slice(0,64);
   console.warn('CTV_OWNER_ACTIVATION_FAILED',category||'CTV_SETUP_UNCERTAIN_RECONCILE');
   return fail(res,409,e?.code||'CTV_SETUP_UNCERTAIN_RECONCILE',
    'Chưa xác minh trạng thái kích hoạt CTV. Không bấm lặp; kiểm tra chính sách trong sổ thật.');
  }
 }
 if(p==='/api/admin/collaborator-pairs/configure'&&req.method==='POST'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Cần quyền quản trị để bật/tắt hóa đơn đôi.');
  // Emergency sandbox never accepts owner policy writes, even if a key exists.
  if(EMERGENCY_PREVIEW)
   return fail(res,503,'PREVIEW_ONLY_NO_WRITES','Chế độ xem thử không cho sửa cấu hình thật.');
  const x=await bodyJSON(req);
  const allowed=['collaboratorId','enabled','customerDiscountPercent',
   'collaboratorDiscountPercent','shippingPercent','vatPercent','expectedRevision',
   'requestId','confirmed','destinationInvoiceNos'];
  if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!allowed.includes(k))||
   !/^[A-Za-z0-9_-]{4,100}$/.test(x.collaboratorId||'')||
   !/^[A-Za-z0-9_-]{8,100}$/.test(x.requestId||'')||
   !Number.isSafeInteger(x.expectedRevision)||x.expectedRevision<1||
   typeof x.enabled!=='boolean'||x.confirmed!==true||
   !Number.isSafeInteger(x.customerDiscountPercent)||x.customerDiscountPercent<0||x.customerDiscountPercent>70||
   !Number.isSafeInteger(x.collaboratorDiscountPercent)||x.collaboratorDiscountPercent<0||x.collaboratorDiscountPercent>70||
   x.collaboratorDiscountPercent<=x.customerDiscountPercent||
   !Number.isSafeInteger(x.shippingPercent)||x.shippingPercent<0||x.shippingPercent>30||
   ![0,5,8,10].includes(x.vatPercent))
   return fail(res,400,'CTV_PAIR_POLICY_INVALID','Cần mã CTV, quyền duyệt và các tỷ lệ hợp lệ.');
  if(x.enabled&&(!Array.isArray(x.destinationInvoiceNos)||
     x.destinationInvoiceNos.length<1||x.destinationInvoiceNos.length>20||
     x.destinationInvoiceNos.some(n=>!Number.isSafeInteger(n)||n<1)||
     new Set(x.destinationInvoiceNos).size!==x.destinationInvoiceNos.length))
   return fail(res,400,'CTV_DESTINATIONS_REQUIRED','Chọn 1–20 điểm giao thật không trùng trước khi bật.');
  if(x.destinationInvoiceNos!==undefined&&!Array.isArray(x.destinationInvoiceNos))
   return fail(res,400,'CTV_DESTINATIONS_INVALID','Danh sách điểm giao không hợp lệ.');
  try{
   const {destinationInvoiceNos,...payload}=x;
   if(x.enabled){
    // Explicit owner-selected invoice evidence, verified via existing HMAC read.
    // The Bot API revalidates the same references within a revision-locked write.
    // Apps Script reads share a single ScriptLock. Preserve destination order
    // and limit concurrency instead of flooding it with 2*N simultaneous Bot calls.
    const sources=[];
    for(let i=0;i<destinationInvoiceNos.length;i+=2){
     const batch=await Promise.all(destinationInvoiceNos.slice(i,i+2)
      .map(no=>ownerInvoice.source(no)));
     sources.push(...batch);
    }
    if(sources.some(s=>s.revision!==x.expectedRevision))
     return fail(res,409,'CTV_SOURCE_CHANGED','Sổ thật đã cập nhật: đọc lại CTV rồi xác nhận.');
    payload.authorizedDestinations=sources.map((source,i)=>({
     id:source.customer.id,invoiceNo:destinationInvoiceNos[i]
    }));
   }
   const out=await ownerPairAction('collaborators.pair.configure',payload);
   return reply(res,200,{ok:true,source:'owner-approved-bot-api',...out});
  }catch(e){
   // Fixed-category server diagnostic only; no personal data, HMAC, or invoice refs.
   const category=String(e?.code||'CTV_PAIR_NOT_READY').replace(/[^A-Z0-9_]/g,'').slice(0,64);
   console.warn('CTV_OWNER_POLICY_SAVE_FAILED',category||'CTV_PAIR_NOT_READY');
   return fail(res,503,e?.code||'CTV_PAIR_NOT_READY','Chưa lưu được chính sách thật. Không tự thử lại hoặc báo đã duyệt khi thất bại.');
  }
 }

 if(req.method==='GET'&&p==='/api/admin/version-status'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Cần quyền quản trị để xem phiên bản hệ thống.');
  const status=await getGeminiVersionStatus();
  return reply(res,200,{ok:true,sandbox:true,...status});
 }
 // Operational launch preflight: metadata only, never expose credentials or PII.
 // This isolated app cannot be promoted to a real checkout by setting a flag.
 // An audited authenticated-customer, approved-price, durable-storage and
 // source-verified Bot API integration must land before changing these gates.
 if(req.method==='GET'&&p==='/api/admin/production-readiness'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Chỉ quản trị viên được kiểm tra điều kiện production.');
  const backupState=driveWorker.status();
  const gates={
   productionCheckoutWired:false,
   verifiedCustomerIdentityWired:false,
   authoritativeCatalogPriceSyncWired:false,
   approvedCustomerDiscountWired:false,
   durableTransactionalStoreWired:false,
   // A running process is NOT proof of a verified restore. Require a separate
   // isolated restore acceptance before checking this gate.
   sandboxRestoreValidated:false,
   sandboxDriveBackupBridgeConfigured:backupState.configured===true,
   sandboxDriveBackupReadbackVerified:Boolean(backupState.lastVerifiedUploadAt),
   readOnlyBotTransportConfigured:readOnlyReady()
  };
  const blockers=Object.entries(gates).filter(([,passed])=>!passed).map(([name])=>name);
  return reply(res,200,{ok:true,sandbox:true,productionLaunchReady:false,
   productionCheckoutEnabled:false,demoOnly:EMERGENCY_PREVIEW,
   gates,blockers,
   message:'Hệ thống này chỉ dùng thử. Không được bật tạo đơn thật trước khi hoàn tất các cổng kiểm chứng.'});
 }
 // Owner-only production READ access. Read it directly from the authoritative
 // Bot API on each request; never copy PII to the ephemeral sandbox disk.
 // This is separate from the public Gemini chat and cannot create/change bills.
 if(req.method==='GET'&&p==='/api/admin/live-search'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Cần đăng nhập quản trị để xem hóa đơn thật.');
  if(!rateLimit(req,'admin-production-read'))
   return fail(res,429,'RATE_LIMIT','Vui lòng giảm tần suất tra cứu.');
  if(!readOnlyReady())
   return fail(res,503,'READ_ONLY_NOT_CONFIGURED','Chưa cấu hình kết nối Bot API quyền chỉ đọc trên Render.');
  let search;
  try{search=ownerLiveLookup(url.searchParams)}
  catch{return fail(res,400,'LIVE_SEARCH_INVALID','Cần tên hoặc số hóa đơn hợp lệ, hoặc chọn một tháng để xem.')}
  try{
   const latest=await readMinhSatori(search.action,search.payload);
   const result=latest?.data;
   if(!Number.isSafeInteger(latest.revision)||!result||typeof result!=='object')
    return fail(res,503,'LIVE_SOURCE_INVALID','Nguồn dữ liệu chưa trả về phiên bản hợp lệ.');
   if(search.kind==='invoices'){
    const rows=Array.isArray(result.orders)?result.orders:null;
    if(!rows)return fail(res,503,'LIVE_SOURCE_INVALID','Nguồn hóa đơn không trả về đúng cấu trúc.');
    return reply(res,200,{ok:true,readOnly:true,source:'Minh Satori Bot API',
     revision:latest.revision,totalMatches:result.totalMatches,shown:rows.length,
     truncated:Number(result.totalMatches)>rows.length,invoices:rows});
   }
   const profiles=result.profiles;
   if(!profiles||!Array.isArray(profiles.profiles))
    return fail(res,503,'LIVE_SOURCE_INVALID','Nguồn khách hàng không trả về đúng cấu trúc.');
   return reply(res,200,{ok:true,readOnly:true,source:'Minh Satori Bot API',
    revision:latest.revision,totalMatches:profiles.total,shown:profiles.profiles.length,
    truncated:Number(profiles.total)>profiles.profiles.length,profiles:profiles.profiles});
  }catch{return fail(res,503,'LIVE_SOURCE_UNAVAILABLE','Không thể truy xuất dữ liệu thật. Không dùng dữ liệu mẫu thay thế.')}
 }

 // Owner-triggered, one-calendar-month customer screening. This only interprets
 // the already-authorized READ-ONLY orders.list response. No real customer data
 // is stored in sandbox files, used in Gemini prompts, or sent to public routes.
 // No approval persistence and no customer-link creation is wired here.
 if(req.method==='GET'&&p==='/api/admin/live-screen'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Chỉ chủ tài khoản được sàng lọc khách.');
  if(!rateLimit(req,'admin-production-read'))
   return fail(res,429,'RATE_LIMIT','Vui lòng giảm tần suất truy vấn.');
  if(!readOnlyReady())
   return fail(res,503,'READ_ONLY_NOT_CONFIGURED','Chưa cấu hình nguồn chỉ đọc.');
  const month=url.searchParams.get('month')||'';
  let lookup;
  try{lookup=ownerLiveLookup(new URLSearchParams({kind:'invoices',month}));}
  catch{return fail(res,400,'INVALID_MONTH','Chọn một tháng hợp lệ để sàng lọc.')}
  try{
   const source=await readMinhSatori(lookup.action,lookup.payload);
   if(!Number.isSafeInteger(source.revision)||!Array.isArray(source.data?.orders))
    return fail(res,503,'LIVE_SOURCE_INVALID','Nguồn hóa đơn chưa hợp lệ.');
   const totalMatches=Number(source.data.totalMatches);
   // Unknown counts must be treated as incomplete; no approval should be inferred.
   const incomplete=!Number.isSafeInteger(totalMatches)||totalMatches>source.data.orders.length;
   const candidates=screenMonthlyCustomers(source.data.orders,{truncated:incomplete});
   return reply(res,200,{ok:true,readOnly:true,reviewOnly:true,month,
    revision:source.revision,totalMatches:Number.isFinite(totalMatches)?totalMatches:null,
    shown:source.data.orders.length,truncated:incomplete,
    candidates,productionLinkEnabled:false,approvalsStored:false});
  }catch{return fail(res,503,'LIVE_SCREEN_UNAVAILABLE','Chưa thể sàng lọc tháng này; không áp dụng dữ liệu mẫu.')}
 }

 // Signed-in owner only: ephemeral, read-only directory. No sandbox persistence.
 if(req.method==='GET'&&p==='/api/admin/customer-directory'){
  if(!customerLinks.adminAuthorized(req))
   return fail(res,401,'ADMIN_AUTH_REQUIRED','Chỉ quản trị được xem danh bạ khách thật.');
  if(!rateLimit(req,'admin-directory-read'))
   return fail(res,429,'RATE_LIMIT','Vui lòng đợi trước khi đọc lại.');
  if(!readOnlyReady())
   return fail(res,503,'READ_ONLY_NOT_CONFIGURED','Chưa kết nối sổ kế toán chỉ đọc.');
  const mode=url.searchParams.get('mode');
  const monthFromOffset=n=>{
   const vn=new Date(Date.now()+7*3600000);
   return new Date(Date.UTC(vn.getUTCFullYear(),vn.getUTCMonth()-n,1)).toISOString().slice(0,7);
  };
  const monthLookup=(month,query='')=>ownerLiveLookup(new URLSearchParams({kind:'invoices',month,...(query?{query}:{})}));
  try{
   if(mode==='list'){
    const months=[monthFromOffset(0),monthFromOffset(1),monthFromOffset(2)];
    const snapshots=await Promise.all(months.map(async m=>{
     const l=monthLookup(m),r=await readMinhSatori(l.action,l.payload);
     if(!Number.isSafeInteger(r.revision)||!Array.isArray(r.data?.orders))throw Error('INVALID_SCHEMA');
     return r;
    }));
    if(snapshots.some(x=>x.revision!==snapshots[0].revision))
     return fail(res,409,'SOURCE_REVISION_CHANGED','Sổ kế toán đã thay đổi, vui lòng tải lại.');
    const full=snapshots.every(x=>Number.isSafeInteger(x.data.totalMatches)&&x.data.totalMatches<=x.data.orders.length);
    return reply(res,200,{ok:true,readOnly:true,reviewOnly:true,
     months,sourceComplete:full,revision:snapshots[0].revision,
     customers:directoryFromInvoices(snapshots.flatMap(x=>x.data.orders),full),
     realCustomerLinkIssuanceEnabled:false});
   }
   if(mode==='detail'){
    const name=String(url.searchParams.get('name')||'').trim();
    if(name.length<2||name.length>120||/[\u0000-\u001f]/.test(name))
     return fail(res,400,'INVALID_CUSTOMER_QUERY','Tên khách cần từ 2 đến 120 ký tự.');
    const response=await readMinhSatori('customers.search',{query:name,limit:20});
    if(!Number.isSafeInteger(response.revision)||!Array.isArray(response.data?.profiles?.profiles))
     throw Error('INVALID_SCHEMA');
    const raw=response.data.profiles,found=raw.profiles;
    const sourceTotal=Number.isSafeInteger(raw.total)?raw.total:null;
    let selected=detailFromEvidence(name,found,[],{sourceTotal});
    let scannedMonths=0,scanIncomplete=false,invoiceRows=[];
    {
     const months=Array.from({length:12},(_,i)=>monthFromOffset(i));
     // Even when customers.search is complete, check the last three months
     // of invoices to surface *evidence* for owner-reviewed discounts.
     for(let at=0;at<months.length&&(at===0||!selected.complete);at+=3){
      const lookups=months.slice(at,at+3).map(m=>monthLookup(m,name));
      const results=await Promise.all(lookups.map(l=>readMinhSatori(l.action,l.payload)));
      if(results.some(r=>r.revision!==response.revision||!Array.isArray(r.data?.orders)))
       return fail(res,409,'SOURCE_REVISION_CHANGED','Sổ kế toán vừa thay đổi. Hãy tải lại.');
      for(const r of results){
       scannedMonths++;
       invoiceRows.push(...r.data.orders);
       if(!Number.isSafeInteger(r.data.totalMatches)||r.data.totalMatches>r.data.orders.length)
        scanIncomplete=true;
      }
      selected=detailFromEvidence(name,found,invoiceRows,{sourceTotal,invoicesIncomplete:scanIncomplete});
     }
    }
    const pricingEvidence=observedRealCustomerDiscounts(invoiceRows,name);
    return reply(res,200,{ok:true,readOnly:true,reviewOnly:true,revision:response.revision,
     scannedMonths,selected,pricingEvidence,realCustomerLinkIssuanceEnabled:false,
     note:selected.complete?'Đã đối chiếu hồ sơ hiện có theo tên.':'Chưa thu thập đủ điểm giao; cần xác minh, không cấp link.'});
   }
   return fail(res,400,'INVALID_DIRECTORY_MODE','Chọn danh sách hoặc chi tiết.');
  }catch{
   return fail(res,503,'DIRECTORY_SOURCE_UNAVAILABLE','Không thể tải danh bạ thật. Không dùng dữ liệu giả thay thế.');
  }
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
   const audit=auditDriveCatalogue(status,catalogue,CATALOGUE);
   return reply(res,200,{ok:true,sandbox:true,readOnly:true,
     revision:status.revision,invoiceCount:status.data?.orders??null,
     catalogueCount:catalogue.data.products.length,
     catalogueSource:catalogue.data.source,
     catalogueParity:{exactlyMatched:parity.exactlyMatched,matchedCount:parity.matchedCount,
       sourceCount:parity.sourceCount,missingCodes:parity.missingCodes,
       extraCodes:parity.extraCodes,changedCodes:parity.changedCodes},
     cataloguePriceAudit:{sourceRevision:audit.revision,exactlyMatched:audit.exactlyMatched,
       differences:audit.differences,productionWriteEnabled:false},
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
   ref:o.ref,createdAt:o.createdAt,name:o.name,recipient:o.recipient||o.name,locationLabel:o.locationLabel||null,phone:o.phone,address:o.address,
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
  const token=url.searchParams.get('token')||'';const profile=getProfile(token);if(!profile)return fail(res,403,'DEMO_LINK_REQUIRED','Chỉ hiển thị giá riêng trong link khách thử hợp lệ');
  const priced=deliveryProfile(profile,draftStore.read(token).locationId);
  return reply(res,200,{ok:true,sandbox:true,source:'official-default-snapshot',catalogueSync:'snapshot_only',locationRequired:priced.locationRequired,count:CATALOGUE.length,products:CATALOGUE.map(item=>({code:item.code,name:item.name,brand:item.brand,unit:item.unit,spec:item.spec,listPrice:item.listPrice,discount:priced.locationRequired?null:priced.discount,unitPrice:priced.locationRequired?null:money(item.listPrice*(1-priced.discount/100))}))});
 }
 // Publicly share only this customer's ranked catalog SKU suggestions, never raw order history.
 if(req.method==='GET'&&p==='/api/suggestions'){
  const profile=getProfile(url.searchParams.get('token')||'');
  if(!profile)return fail(res,403,'INVALID_LINK','Liên kết khách không hợp lệ.');
  const priced=deliveryProfile(profile,draftStore.read(url.searchParams.get('token')||'').locationId);
  const suggestions=customerSuggestions(profile,orders.values(),3).map(item=>{
   const p=productFor(item.code);
   return {...item,unitPrice:priced.locationRequired?null:money(p.listPrice*(1-priced.discount/100))};
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
  if(body?.action==='destination'){
   const selected=chosenLocation(profile,body.locationId);
   if(!selected)return fail(res,400,'INVALID_DESTINATION','Địa chỉ chưa thuộc đại lý này.');
   let draft;
   try{draft=draftStore.mutate(token,[{action:'destination',locationId:selected.id}],body.expectedRevision)}
   catch(err){return draftFailure(res,err)}
   invalidateQuotes(token);
   return reply(res,200,{ok:true,sandbox:true,draft,selectedLocation:selected,
    message:'Đã chọn '+selected.label+'. Địa chỉ sẽ được kiểm tra lại khi xác nhận đơn.'});
  }
  if(body?.action==='quote'){
   if(body.expectedRevision!==draftStore.read(token).revision)return fail(res,409,'DRAFT_CONFLICT','Giỏ vừa thay đổi, cần tải lại.');
   const quote=currentBasketQuote(token,profile);
   if(!quote)return fail(res,400,'EMPTY_CART','Giỏ hàng hiện chưa có sản phẩm.');
   if(quote.locationRequired)return fail(res,409,'LOCATION_REQUIRED','Chọn điểm giao trước khi xác nhận báo giá.');
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
  return reply(res,200,{ok:true,sandbox:true,demoOnly:EMERGENCY_PREVIEW,orderSubmissionEnabled:!EMERGENCY_PREVIEW,provider:'Gemini + rules',aiConfigured:geminiConfigured(),rulesReady:true,profile:{id:c.id,name:c.name,phone:c.phone,address:c.address,locations:listLocations(c),multipleDeliveryLocations:listLocations(c).length>1,discount:c.discount,ship:c.ship,vatRate:c.vatRate??0}})
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
  // Only approved, unambiguous destinations may be selected by name in chat.
  const locationHit=matchLocation(c,message);
  if(locationHit.status==='ambiguous')
   return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'DELIVERY_LOCATION',
    draft:draftStore.read(token),message:'Có nhiều điểm giao trùng tên. Anh/chị chọn trong Tất cả địa chỉ ạ.'});
  if(locationHit.status==='matched'&&listLocations(c).length>1){
   const oldDraft=draftStore.read(token);
   if(oldDraft.locationId!==locationHit.location.id){
    if(b.expectedRevision!==oldDraft.revision)return fail(res,409,'DRAFT_CONFLICT','Giỏ vừa thay đổi. Hãy tải lại trước khi chọn địa chỉ.');
    const updated=draftStore.mutate(token,[{action:'destination',locationId:locationHit.location.id}],oldDraft.revision);
    b.expectedRevision=updated.revision;invalidateQuotes(token);
   }
   const label=foldLocation(locationHit.location.label),spoken=foldLocation(message);
   if([label,'giao '+label,'giao ve '+label,'ship '+label].includes(spoken))
    return reply(res,200,{ok:true,sandbox:true,draft:draftStore.read(token),
     message:'Đã chọn '+locationHit.location.label+'. Anh/chị muốn đặt sản phẩm nào ạ?'});
  }

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
       'Em mặc định nước suối Satori. Anh/chị muốn dung tích 350ml, 500ml hay 1500ml?'});
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
    const water={...pendingWater.water,brand:answer.brand||pendingWater.water.brand||'satori',
     size:answer.size||pendingWater.water.size};
    const choices=!water.size?'Satori dung tích 350ml, 500ml hay 1500ml?':'';
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
        (mixed.water?'Em mặc định Satori. Anh/chị muốn nước suối 350ml, 500ml hay 1500ml?':
         mixed.delivery.clarification)+' Em chưa cộng hàng nào từ yêu cầu này.'});
     }
     return applyChatBasket(res,token,c,chatBasketChanges(message,mixed.items),
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
     draft,message:(known?'Đã ghi nhận '+known+'. ':'')+
      colloquialQuestion(colloquial.pending.missing)});
   }
   if(colloquial?.needMoreDetails)return reply(res,200,{ok:true,needMoreDetails:true,
    draft:draftStore.read(token),message:colloquial.message});
   if(colloquial?.items){
    const draft=draftStore.read(token);
    if(b?.unifiedDraft===true&&b?.expectedRevision!==draft.revision)return fail(res,409,'DRAFT_CONFLICT','Giỏ vừa thay đổi, cần tải lại.');
    return applyChatBasket(res,token,c,chatBasketChanges(message,colloquial.items),
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
      (summary?', '+summary:'')+'. Em mặc định Satori. Anh/chị muốn dung tích 350ml, 500ml hay 1500ml?'+
      ' Em đã giữ đủ các món trong yêu cầu nhưng chưa thêm vào giỏ hoặc tạo bill.'});
   }
   if(incomplete?.needMoreDetails)return reply(res,200,{ok:true,needMoreDetails:true,
    draft:draftStore.read(token),message:incomplete.message});
   if(ambiguousWater500InComposite(message))
    return reply(res,200,{ok:true,needMoreDetails:true,clarificationType:'COMPOUND_BRAND_500',
     draft:draftStore.read(token),message:'Có món nước suối chưa xác định rõ quy cách. Mặc định là Satori; anh/chị vui lòng ghi rõ dung tích để tránh thiếu sản phẩm.'});
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
     chatBasketChanges(message,compound.items),
     revision,compound.source,deliveryAll);
   }
   // A natural-language multi-product order must be all-or-nothing.
   // If the whole parser could not resolve every clause, never fall back to
   // a single recognized SKU and silently discard an unknown line.
   const requestedClauses=fold(message).split(/\s*[,;\n]\s*|\s+(?:va|voi)\s+/u).filter(Boolean);
   if(requestedClauses.length>1&&requestedClauses.filter(part=>/\b\d{1,3}\b/.test(part)).length>1){
    return reply(res,200,{ok:true,needMoreDetails:true,draft:draftStore.read(token),
     message:'Em chưa nhận diện đủ tất cả món trong yêu cầu. Vui lòng nói rõ từng loại nước; giỏ hiện tại chưa thay đổi.'});
   }
   const single=parseOneClause(message,c);
   if(single)return applyChatBasket(res,token,c,chatBasketChanges(message,[single]),
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
   if(unified)return applyChatBasket(res,token,c,chatBasketChanges(parsedMessage,multi.items),revision,multi.source,delivery);
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
   return reply(res,200,{ok:true,needMoreDetails:true,message:fields?.reason==='UNSUPPORTED'?'Sản phẩm này chưa có trong danh mục Minh Satori. Bạn vui lòng chọn trong Tất cả sản phẩm.':!sku||parsed.reason==='PRODUCT_AMBIGUOUS'?(/\bsuoi\b/.test(normalized)&&!/\bhikari\b/.test(normalized)?'Em mặc định nước suối Satori. Anh/chị muốn loại 350ml, 500ml hay 1500ml?':'Bạn muốn đặt sản phẩm nào? Có thể chọn Premium 450ml, Hikari, Satori hoặc xem Tất cả sản phẩm.'):'Bạn muốn đặt bao nhiêu '+(productFor(sku)?.unit||'đơn vị')+'?'});
  }
  if(unified)return applyChatBasket(res,token,c,chatBasketChanges(parsedMessage,[{sku,qty}]),revision,parsed.source||'rules',delivery);
  const quote=makeQuote(token,c,sku,qty);if(!quote)return fail(res,400,'INVALID_QUANTITY','Chỉ chấp nhận tối đa 500 thùng một đơn');
  quote.deliveryNote=normalizeDeliveryNote(delivery.deliveryNote);
  quote.requestedDeliveryAt=delivery.requestedDeliveryAt;
  sessions.delete(token);
  return reply(res,200,{ok:true,sandbox:true,parserSource:parsed.source||'rules',message:'Mình đã lập báo giá theo cấu hình khách THỬ. Bạn xem lại và xác nhận nhé.',quote});
 }
 if(req.method==='POST'&&p==='/api/confirm'){
  const b=await bodyJSON(req),token=b?.token,c=getProfile(token);if(!c)return fail(res,403,'INVALID_LINK','Không có quyền');
  const key=String(b.requestId||'');if(!/^[a-z0-9-]{8,80}$/i.test(key))return fail(res,400,'BAD_REQUEST_ID','Thiếu mã chống gửi trùng');
  // Idempotency survives restart. NEVER use the raw bearer customer link token.
  const idemKey=c.id+'|'+key;if(idempotency.has(idemKey))return reply(res,200,{ok:true,duplicate:true,order:orders.get(idempotency.get(idemKey))});
  const q=quotes.get(b.quoteId);
  if(q&&q.token!==token)return fail(res,409,'QUOTE_EXPIRED','Báo giá không thuộc khách này.');
  const statedRev=b?.expectedDraftRevision;
  const claimedRev=Number.isSafeInteger(statedRev)&&statedRev>=0?statedRev:null;
  if(q&&q.draftRevision!==undefined&&claimedRev!==null&&q.draftRevision!==claimedRev)
   return fail(res,409,'DRAFT_CONFLICT','Báo giá và phiên bản giỏ hàng không khớp.');
  // Two phones may generate different quoteIds and requestIds for one shared
  // server draft. Return the already committed TEST invoice for that revision
  // even when the old quote was invalidated after the first confirmation.
  const verifiedRev=q?.draftRevision!==undefined?q.draftRevision:claimedRev;
  if(Number.isSafeInteger(verifiedRev)&&verifiedRev>=0){
   const prior=[...orders.values()].find(o=>o.profileId===c.id&&o.draftRevision===verifiedRev);
   if(prior)return reply(res,200,{ok:true,sandbox:true,duplicate:true,order:prior});
  }
  if(!q||q.expiresAt<Date.now())return fail(res,409,'QUOTE_EXPIRED','Báo giá hết hạn hoặc không thuộc khách này');
  const approved=q.deliveryLocationId?chosenLocation(c,q.deliveryLocationId):
    listLocations(c).length===1?listLocations(c)[0]:null;
   if(!approved||q.locationRequired)return fail(res,409,'LOCATION_REQUIRED','Chưa chọn điểm giao chính xác. Vui lòng chọn trong Tất cả địa chỉ.');
   if(q.profileId!==c.id||q.discount!==effectiveLocationDiscount(c,approved)||q.ship!==c.ship||
      q.vatRate!==(c.vatRate??0)||q.address!==approved.address||
      q.phone!==approved.phone||(q.recipient!==undefined&&q.recipient!==approved.recipient))
    return fail(res,409,'PROFILE_CHANGED','Thông tin điểm giao hoặc giá đã đổi. Vui lòng lập lại báo giá.');
  if(q.draftRevision!==undefined&&q.draftRevision!==draftStore.read(token).revision)return fail(res,409,'DRAFT_CONFLICT','Báo giá đã cũ vì giỏ hàng thay đổi. Vui lòng xem báo giá mới nhất.');
  let deliveryNote;
  try{deliveryNote=normalizeDeliveryNote(b?.deliveryNote??q.deliveryNote)}catch{return fail(res,400,'INVALID_DELIVERY_NOTE','Lưu ý giao hàng phải là văn bản tối đa 300 ký tự')}
  const o={...q,deliveryNote,ref:'TEST-'+crypto.randomBytes(5).toString('hex').toUpperCase(),requestId:idemKey,createdAt:new Date().toISOString(),status:'Chờ thanh toán',sandbox:true};
  delete o.token; // Do not write the bearer link credential into invoice/order storage.
  orders.set(o.ref,o);idempotency.set(idemKey,o.ref);
  try{saveOrdersAtomic()}
  catch{
   // A failed disk commit must not leave a successful-looking in-memory order.
   orders.delete(o.ref);idempotency.delete(idemKey);
   return fail(res,503,'TEST_STORAGE_FAILED','Chưa lưu được đơn thử an toàn. Vui lòng thử lại.');
  }
  quotes.delete(q.quoteId);
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
  if(key.length!==32)throw Error('BOOTSTRAP_AES_KEY_SIZE');
  let envelope;
  try{envelope=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'))}
  catch{throw Error('BOOTSTRAP_ENVELOPE_JSON_INVALID')}
  let restored;
  try{restored=decryptArchive(envelope,key)}
  catch(err){
   const category=String(err?.message||'');
   if(category==='INVALID_BACKUP_ENVELOPE')throw Error('BOOTSTRAP_ENVELOPE_INVALID');
   if(category==='INVALID_SANDBOX_BACKUP')throw Error('BOOTSTRAP_CHECKSUM_OR_SCHEMA_INVALID');
   throw Error('BOOTSTRAP_AES_AUTH_OR_CORRUPT_CIPHERTEXT');
  }
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
  // Only bounded fixed categories; never print secrets, ciphertext or raw errors.
  const codes=new Set(['STALE_BOOTSTRAP','BOOTSTRAP_AES_KEY_SIZE',
   'BOOTSTRAP_ENVELOPE_JSON_INVALID','BOOTSTRAP_ENVELOPE_INVALID',
   'BOOTSTRAP_CHECKSUM_OR_SCHEMA_INVALID','BOOTSTRAP_AES_AUTH_OR_CORRUPT_CIPHERTEXT',
   'INVALID_BOOTSTRAP_SIZE']);
  console.error('SANDBOX_BOOTSTRAP_FAILED',codes.has(e?.message)?e.message:'INTEGRITY_OR_STORAGE_ERROR');
  throw Error('SANDBOX_BOOTSTRAP_FAILED');
 }
}
try{bootstrapEncryptedTestSnapshot()}catch{process.exit(78)}
// Verify credentials and scopes against the real, read-only Bot API once at boot.
// The request filters cannot match any real customer. Neither customer records,
// HMAC secrets nor upstream error bodies are logged or persisted in the sandbox.
async function verifyOwnerReadOnlyAtBoot(){
 if(!readOnlyReady())return;
 try{
  const status=await readMinhSatori('system.status');
  const probe='unlikely-gemini-readonly-probe-20261022-no-real-record';
  const orders=await readMinhSatori('orders.list',{query:probe,limit:1});
  const customers=await readMinhSatori('customers.search',{query:probe,limit:1});
  if(!Number.isSafeInteger(status.revision)||
     !Number.isSafeInteger(status.data?.orders)||
     orders.revision!==status.revision||customers.revision!==status.revision||
     !Array.isArray(orders.data?.orders)||
     !Array.isArray(customers.data?.profiles?.profiles))throw Error('RESPONSE_SCHEMA');
  console.info('SATORI_OWNER_LIVE_READONLY_VERIFIED',
   'revision='+status.revision,'invoices='+status.data.orders,
   'scopes=orders_read_customers_read');
 }catch(e){
  // Only a fixed diagnostic class, no upstream response bodies or personal data.
  const code=String(e?.message||'');
  const category=code==='READ_ONLY_UPSTREAM_ERROR'?'UPSTREAM_AUTH_OR_PERMISSION':
   code.startsWith('READ_ONLY_UPSTREAM_HTTP_')?'UPSTREAM_HTTP':
   code==='RESPONSE_SCHEMA'?'SCHEMA_MISMATCH':
   code==='READ_ONLY_RESPONSE_TOO_LARGE'?'OVERSIZE':'NETWORK_OR_TIMEOUT';
  console.warn('SATORI_OWNER_LIVE_READONLY_NOT_VERIFIED',category);
 }
}
server.listen(PORT,HOST,()=>{
 driveWorker.start();
 if(readOnlyReady())void verifyOwnerReadOnlyAtBoot();
 // A real non-mutating HMAC probe, using already-configured owner read key.
 // Reports FORBIDDEN if Apps Script has not granted the CTV read scope.
 if(readOnlyReady())void probeOwnerPairRead().then(x=>
  console.info('SATORI_CTV_POLICY_READ_PROBE',x.reason,
   x.ready?'revision='+x.revision:'not_ready',
   x.ready?'active_policies='+x.activePolicies:'no_policy_read'));

 // Only boolean readiness / fixed codes. NEVER log HMAC values or key IDs.
 const ctvCredentials=ownerPairConfigReadiness(),ctvLink=ctvSingleLink.readiness();
 console.info('SATORI_CTV_CONFIGURATION_READINESS',
  'read='+ctvCredentials.read.reason,
  'configure='+ctvCredentials.configure.reason,
  'orderWrite='+ctvCredentials.orderWrite.reason,
  'approveCredentials='+ctvCredentials.approveCredentials.reason,
  'orderCredentials='+ctvCredentials.orderCredentials.reason,
  'link='+String(ctvLink.reason||'CONFIGURED'));
 const pilot=ownerInvoice.readiness();
 if(OWNER_ONLY_PILOT&&pilot.enabled===true){
  void ownerInvoice.probeWriter().then(proof=>{
   console.info('SATORI_OWNER_HMAC_LIVE_PROBE',
    'PASS', 'revision='+proof.revision,
    'invoices='+proof.invoiceCount,
    'products='+proof.catalogueProducts);
  }).catch(e=>{
   // Do not expose signed responses, clients, credentials or customer records.
   const safe=new Set(['FORBIDDEN','AUTH_FAILED','CATALOGUE_NOT_PERSISTED',
    'OWNER_BOT_UPSTREAM_REJECTED','OWNER_BOT_UNCERTAIN',
    'OWNER_BOT_RESPONSE_INVALID','OWNER_WRITER_READ_SCHEMA_INVALID']);
   console.warn('SATORI_OWNER_HMAC_LIVE_PROBE','NOT_READY',
    safe.has(e?.code)?e.code:'OTHER');
  });
 }
 console.info('SATORI_OWNER_PILOT_STATUS',
  'enabled='+Number(OWNER_ONLY_PILOT),
  'configured='+Number(pilot.enabled===true),
  'reason='+(pilot.reason||'CONFIGURED'));
 console.info('SATORI_OWNER_LIVE_READONLY_CONFIGURED',Number(readOnlyReady()));
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
