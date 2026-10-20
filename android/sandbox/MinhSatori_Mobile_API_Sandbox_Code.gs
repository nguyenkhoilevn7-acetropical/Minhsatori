/** MINH SATORI — MOBILE API — SANDBOX ONLY
 * Prepared from PR #9 on 2026-10-20. Keep this file in an ISOLATED Apps Script project.
 * Zero production access: readState_ and write() refuse any Drive file other than
 * the dedicated THREE-FAKE-INVOICE sandbox Drive file below.
 *
 * Required Script Properties (values must be entered in Project Settings):
 *   STATE_FILE_ID                        = 1Iemws0kQqpFi1Vt9DGKfVJxBf8zptv0Y
 *   SATORI_ANDROID_OWNER_EMAIL           = Google account email that owns sandbox
 *   SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON = ["<Android OAuth Client ID>"]
 *
 * Deploy ONLY as Google Apps Script Web app under OWNER's account.
 * Endpoint for APK: https://script.google.com/macros/s/<deployment-id>/exec
 * No secrets or OAuth access tokens should be pasted in GitHub or chat.
 * Do NOT copy this sandbox file into the production Apps Script project.
 */
var SATORI_MOBILE_SANDBOX_FILE_ID = '1Iemws0kQqpFi1Vt9DGKfVJxBf8zptv0Y';
function readState_() {
  var cfg = PropertiesService.getScriptProperties();
  var fileId = cfg.getProperty('STATE_FILE_ID');
  if (fileId !== SATORI_MOBILE_SANDBOX_FILE_ID) {
    throw new Error('SANDBOX_ONLY: blocked access to any other Drive file');
  }
  var data = DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  var state = JSON.parse(data);
  if (!state || !Number.isInteger(state.revision) || !state.values ||
      typeof state.values.satori_orders_v15 !== 'string') {
    throw new Error('SANDBOX_ONLY: invalid state format');
  }
  return state;
}
/* PART 1: Accounting core (read-only calculations) */

(function(root){
'use strict';
const key=o=>String(o.__syncId||String(o.id)+'|'+String(o.invoiceNo));
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/[^a-z0-9/]+/g,' ').trim().replace(/\s+/g,' ');
const number=v=>Number.isFinite(Number(v))?Number(v):0;
const active=o=>!['Đã hủy','Không Tính'].includes(o.status);
const statusClass=o=>({'Đã TT Satori':'text-emerald-400','Đã thanh toán':'text-emerald-400','Chưa thanh toán':'text-amber-400','Không Tính':'text-indigo-400','Đã hủy':'text-rose-400'}[o.status]||'text-slate-400')+' font-semibold';
const paid=o=>o.status==='Đã thanh toán'||!!o.customerPaidAt;
const items=o=>o.items?.length?o.items:[o];
const goods=o=>items(o).reduce((s,i)=>s+number(i.qty)*number(i.unitPrice),0);
const listed=o=>items(o).reduce((s,i)=>s+number(i.qty)*number(i.listPrice),0);
const total=o=>o.total!==undefined?number(o.total):goods(o)+number(o.shippingAmount)+number(o.vatAmount);
function basket(o){
 const map=new Map();
 for(const i of items(o)){
  const key=norm(i.code||i.product||i.name)+'|'+norm(i.unit||'Thùng');
  if(!key.split('|')[0]||number(i.qty)<=0)return '';
  map.set(key,(map.get(key)||0)+number(i.qty));
 }
 return JSON.stringify([...map].sort((a,b)=>a[0].localeCompare(b[0])));
}
function pairOrders(all){
 const groups=new Map(),pairs=[],review=[],byId=new Map();
 for(const o of all.filter(active)){
  const name=norm(o.name),b=basket(o);
  if(!name||['khach vang lai','khach zalo'].includes(name)||!b)continue;
  const key=name+'|'+b;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);
 }
 for(const rows of groups.values()){
  if(rows.length<2)continue;
  if(rows.length!==2){review.push({orders:rows,reason:'Có nhiều hơn 2 đơn cùng người nhận và giỏ hàng; chưa tự ghép để tránh trả lời trùng.'});continue;}
  const [a,b]=rows;
  if(norm(a.location)&&norm(b.location)&&norm(a.location)!==norm(b.location)){review.push({orders:rows,reason:'Cùng tên và hàng nhưng khác địa chỉ giao.'});continue;}
  if(a.collaboratorId&&b.collaboratorId&&a.collaboratorId!==b.collaboratorId){review.push({orders:rows,reason:'Hai đơn thuộc hai cộng tác viên khác nhau.'});continue;}
  if(total(a)===total(b)){review.push({orders:rows,reason:'Hai hóa đơn bằng tiền; không phát sinh chênh lệch, cần kiểm tra trùng đơn.'});continue;}
  const high=total(a)>total(b)?a:b,low=high===a?b:a;
  const p={id:key(high)+'::'+key(low),high,low,profit:Math.round(total(high)-total(low)),collaboratorId:high.collaboratorId||low.collaboratorId||'',basis:'Giá trị hóa đơn cao − thấp (gồm VAT/ship theo hóa đơn)'};
  pairs.push(p);byId.set(key(high),p);byId.set(key(low),p);
 }
 return {pairs,review,byId};
}
function calculate(all,partners){
 const pairing=pairOrders(all),partnersById=new Map(partners.map(p=>[String(p.id),p]));
 const uncertain=new Set(pairing.review.flatMap(x=>x.orders.map(o=>key(o))));
 const rows=all.map(o=>{
  const pair=pairing.byId.get(key(o)),secondary=pair?.low===o;
  const partnerId=pair?.collaboratorId||o.collaboratorId||'',partner=partnersById.get(String(partnerId));
  const discount=number(o.collaboratorDiscountPercent??partner?.discountPercent);
  const base=Math.round(listed(o)*(1-discount/100));
  const raw=pair?(secondary?0:pair.profit):partnerId?Math.round(goods(o)-base):0;
  const eligible=active(o)&&!secondary&&!uncertain.has(key(o));
  const profit=eligible?raw:0,settled=number(o.collaboratorPaid);
  return {order:o,pair,secondary,partnerId,partner,discount,base,eligible,review:uncertain.has(key(o)),profit,settled,due:eligible?Math.max(0,profit-settled):0,customerPaid:paid(o),satoriPaid:o.status==='Đã TT Satori'||!!o.satoriPaidAt,basis:pair?pair.basis:partnerId?'Tiền hàng bán − giá niêm yết × (1 − CK CTV); không gồm VAT/ship':'Chưa gắn cộng tác viên'};
 });
 return {...pairing,rows,partners:partners.map(p=>{const pr=rows.filter(r=>r.partnerId===p.id&&r.eligible);return {...p,count:pr.length,profit:pr.reduce((s,r)=>s+r.profit,0),settled:pr.reduce((s,r)=>s+r.settled,0),due:pr.reduce((s,r)=>s+r.due,0)};})};
}
// Group imported Satori lines before matching. Invoice and order IDs have separate namespaces.
function groupCompanyRows(rows){
 const parents=rows.map((_,i)=>i),seen=new Map();
 const find=i=>parents[i]===i?i:(parents[i]=find(parents[i]));
 const code=v=>{const s=String(v??'').trim().toUpperCase().replace(/\s+/g,' ');return /^(?:|0|-|N\/A|NULL|KHONG CO)$/.test(s)?'':s;};
 rows.forEach((r,i)=>{
  const ids=[code(r.invoice)&&'invoice:'+code(r.invoice),code(r.ref)&&'order:'+code(r.ref)].filter(Boolean);
  if(!ids.length&&code(r.doc))ids.push('document:'+code(r.doc));
  for(const id of ids){if(seen.has(id))parents[find(i)]=find(seen.get(id));else seen.set(id,i);}
 });
 const groups=new Map();rows.forEach((r,i)=>{const k=find(i);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);});
 return [...groups.values()].map((list,i)=>{const unique=f=>[...new Set(list.map(r=>code(r[f])).filter(Boolean))];const invoices=unique('invoice'),refs=unique('ref');return {id:invoices.length?'invoice:'+invoices[0]:refs.length?'order:'+refs[0]:'row:'+i,rows:list,invoices,refs};});
}
// Reconciliation only: accent-insensitive keyword overlap, with a house-number guard.
function addressSimilarity(left,right){
 const prepare=value=>{
  let text=norm(value).replace(/\b([pq])(?=\d)/g,'$1 ').replace(/\b(?:tp\s*)?ho chi minh\b|\btp\s*hcm\b|\btphcm\b|\bhcm\b|\bviet nam\b/g,' ')
   .replace(/\b(?:thanh pho|thi xa|thi tran|quan|huyen|phuong|xa|tp|q|p)\b.*$/,' ')
   .replace(/\b(?:thanh pho|thi xa|thi tran|quan|huyen|phuong|xa|tp|q|p|duong|street|so|dia chi|viet nam)\b/g,' ')
   .replace(/\//g,' ').replace(/\s+/g,' ').trim();
  const house=text.match(/^(?:hem\s+|ngo\s+)?(\d+[a-z]?(?:\s+\d+[a-z]?)*)(?=\s|$)/)?.[1]||'';
  return {house,tokens:[...new Set(text.split(' ').filter(Boolean))]};
 };
 const a=prepare(left),b=prepare(right),common=a.tokens.filter(t=>b.tokens.includes(t));
 const score=a.tokens.length&&b.tokens.length?2*common.length/(a.tokens.length+b.tokens.length):0;
 const houseConflict=!!a.house&&!!b.house&&a.house!==b.house;
 const words=common.filter(t=>/[a-z]/.test(t));
 const sufficient=words.length>=2 || (words.length>=1&&common.some(t=>/^\d/.test(t))) || (!!a.house&&a.house===b.house&&common.length>=2);
 return {score,percent:Math.round(score*100),common,houseConflict,matched:score>=0.45&&sufficient&&!houseConflict};
}
function identityMatch(companies,locals){
 const key=v=>norm(v).replace(/^hd\s*/,'').replace(/\s/g,'').replace(/^0+(?=\d)/,'');
 const codes=d=>[d.ref,d.invoice,...(d.rows||[]).flatMap(r=>[r.invoice,r.ref])].map(key).filter(Boolean);
 const matchedLocal=new Set();
 const rows=companies.map(a=>{
  const ac=codes(a);
  const comparisons=locals.map((b,j)=>{const similarity=(a.addresses?.length?a.addresses:[a.address]).map(v=>addressSimilarity(v,b.address)).sort((x,y)=>Number(y.matched)-Number(x.matched)||y.score-x.score)[0];return {b,j,code:ac.some(c=>codes(b).includes(c)),address:similarity.matched,similarity};});
  const candidates=comparisons.filter(x=>x.code||x.address);
  candidates.forEach(x=>matchedLocal.add(x.j));
  const unique=candidates.length===1?candidates[0].b:null;
  const basis=[...new Set(candidates.flatMap(x=>[x.code?'mã hóa đơn':'',x.address?'từ khóa địa chỉ ≥45%':'']).filter(Boolean))];
  const evidence=candidates.filter(x=>x.address).map(x=>'HĐ '+(x.b.invoice||x.b.ref||'nội bộ')+': '+x.similarity.percent+'% · từ trùng: '+x.similarity.common.join(', '));
  return {company:a.rows||[],local:candidates.flatMap(x=>x.b.rows||[]),source:a,companyAmount:a.amount??null,localAmount:unique?.amount??null,delta:unique&&a.amount!=null&&unique.amount!=null?a.amount-unique.amount:null,status:candidates.length?'Khớp':'Không khớp',category:candidates.length?'matched':'unmatched',basis,addressMatches:candidates.filter(x=>x.address).map(x=>({invoice:x.b.invoice||x.b.ref||'',percent:x.similarity.percent,common:x.similarity.common})),detail:(a.groupDetail?a.groupDetail+' ':'')+(candidates.length?'Khớp '+basis.join(' hoặc ')+'. '+evidence.join('; ')+(candidates.length>1?' · Có '+candidates.length+' hóa đơn nội bộ phù hợp; liệt kê tất cả, không tự bù trừ tiền.':'')+(a.error?' · Dữ liệu phụ: '+a.error:''):'Không có mã hóa đơn trùng hoặc địa chỉ đạt 45% từ khóa phù hợp. Địa chỉ khác số nhà không tự ghép. Tên, SĐT, ngày, hàng, số lượng và tiền không quyết định kết quả.')};
 });
 locals.forEach((b,j)=>{if(!matchedLocal.has(j))rows.push({company:[],local:b.rows||[],source:null,companyAmount:null,localAmount:b.amount??null,delta:null,status:'Chưa có trong Excel',category:'localOnly',basis:[],detail:'Đơn nội bộ không có mã hoặc từ khóa địa chỉ khớp trong Excel (ngưỡng 45%).'});});
 return rows;
}
// Shared payment evidence lives once in the existing synced orders payload.
function resolveReceipt(receipt,all){
 if(receipt.data||receipt.url)return receipt;
 if(!receipt.sharedReceiptId)return receipt;
 const asset=all.flatMap(o=>o.paymentReceipts||[]).find(r=>r.id===receipt.sharedReceiptId&&(r.data||r.url));
 return asset?{...asset,...receipt,data:asset.data,url:asset.url,mime:asset.mime}:receipt;
}
function preserveReceiptAssets(next,previous){
 const assets=new Map(previous.flatMap(o=>o.paymentReceipts||[]).filter(r=>r.data||r.url).map(r=>[r.id,r]));
 const present=new Set(next.flatMap(o=>o.paymentReceipts||[]).filter(r=>r.data||r.url).map(r=>r.id));
 return next.map(o=>{let changed=false;const paymentReceipts=(o.paymentReceipts||[]).map(r=>{const id=r.sharedReceiptId;if(id&&!present.has(id)&&assets.has(id)){changed=true;present.add(id);return {...assets.get(id),...r,data:assets.get(id).data,url:assets.get(id).url,mime:assets.get(id).mime};}return r;});return changed?{...o,paymentReceipts}:o;});
}
function customerMatches(o,query){
 const q=norm(query);if(!q)return true;
 const values=[o.name,o.phone,o.customerCode,o.customerId,o.clientCode];
 if(values.some(v=>norm(v).includes(q)))return true;
 const digits=String(query).replace(/\D/g,'');return digits.length>=5&&String(o.phone||'').replace(/\D/g,'').includes(digits);
}
function paymentGroup(all,ids,{id,target,markPaid=true,receipt=null,at,scope=''}){
 if(!['customer','satori'].includes(target)||!id||!at)throw Error('Nhóm thanh toán không hợp lệ.');
 const selected=new Set(ids.map(String));if(!selected.size)throw Error('Chọn ít nhất một hóa đơn.');
 for(const k of selected){const found=all.filter(o=>key(o)===k);if(found.length!==1||!active(found[0]))throw Error('Có bill đã đổi hoặc không còn hợp lệ. Mở lại nhóm trước khi lưu.');if(!markPaid&&!(target==='customer'?paid(found[0]):found[0].status==='Đã TT Satori'||found[0].satoriPaidAt))throw Error('Có bill chưa ghi thanh toán cho bên đã chọn. Bật ghi đã thanh toán hoặc bỏ chọn bill đó.');}
 let owner=true;
 return all.map(o=>{
  if(!selected.has(key(o)))return o;
  const group={id,target,at,scope},next={...o,updatedAt:Date.parse(at),paymentGroups:[...(o.paymentGroups||[]).filter(g=>g.id!==id),group]};
  if(markPaid&&target==='customer'){next.customerPaidAt=o.customerPaidAt||at;if(o.status!=='Đã TT Satori')next.status='Đã thanh toán';}
  if(markPaid&&target==='satori'){if(paid(o))next.customerPaidAt=o.customerPaidAt||at;next.satoriPaidAt=o.satoriPaidAt||at;next.status='Đã TT Satori';}
  if(receipt&&!next.paymentReceipts?.some(r=>r.id===receipt.id)){
   const meta={...receipt,groupId:id,party:target,sharedReceiptId:receipt.id};
   if(!owner){delete meta.data;delete meta.url;}owner=false;
   next.paymentReceipts=[...(o.paymentReceipts||[]),meta];
  }
  return next;
 });
}

root.SatoriAccountingCore={key,norm,number,active,statusClass,paid,resolveReceipt,preserveReceiptAssets,customerMatches,paymentGroup,items,goods,listed,total,basket,pairOrders,calculate,groupCompanyRows,addressSimilarity,identityMatch};
})(typeof window!=='undefined'?window:globalThis);






/* PART 2: Authorized HMAC bot core (unused without explicit bot credentials) */
/**
 * Minh Satori bot integration — staging only.
 * Add to the SAME Google Apps Script project as readState_()/driveCommit().
 * The shared getScriptLock prevents lost updates between bots and website.
 * This GitHub branch is NOT deployed, and contains no credentials.
 */
var SatoriBotApi=(function(){
'use strict';
var ORDER_KEY='satori_orders_v15';
var SCOPES={'system.status':'orders:read','orders.list':'orders:read',
 'debt.summary':'debt:read','customers.search':'customers:read','orders.create':'orders:write','orders.update':'orders:write','orders.delete':'orders:delete','orders.restore':'orders:write','trash.list':'orders:read',
 'payments.markCustomerPaid':'payments:write'};
function fail(code,message){var e=new Error(message);e.code=code;throw e;}
function need(x,code,message){if(!x)fail(code,message);}
function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function norm(v){return String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().replace(/\btreky\b/g,'traky').trim();}
function money(v){var n=Number(v);need(Number.isFinite(n)&&n>=0&&n<=1e11,'INVALID_AMOUNT','Số tiền không hợp lệ');return n;}
function signed(secret,data){return Utilities.computeHmacSha256Signature(data,secret,Utilities.Charset.UTF_8).map(function(b){return ('0'+(b&255).toString(16)).slice(-2)}).join('');}
function equalSig(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;var x=0;for(var i=0;i<64;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
function auth(o){
 need(o&&typeof o==='object'&&!Array.isArray(o),'INVALID_REQUEST','Dữ liệu không hợp lệ');
 need(/^[a-zA-Z0-9_-]{3,64}$/.test(o.keyId||'')&&/^[a-zA-Z0-9_-]{16,128}$/.test(o.nonce||''),'AUTH_FAILED','Không thể xác thực');
 need(Number.isSafeInteger(o.timestamp)&&Math.abs(Date.now()-o.timestamp)<300000,'EXPIRED','Yêu cầu hết hạn');
 need(Object.prototype.hasOwnProperty.call(SCOPES,o.action),'INVALID_ACTION','Lệnh không hỗ trợ');
 var all=JSON.parse(PropertiesService.getScriptProperties().getProperty('SATORI_BOT_CLIENTS_JSON')||'{}');
 var client=Object.prototype.hasOwnProperty.call(all,o.keyId)?all[o.keyId]:null;
 need(client&&client.enabled!==false&&typeof client.secret==='string'&&client.secret.length>=32,'AUTH_FAILED','Không thể xác thực');
 need(Array.isArray(client.scopes)&&client.scopes.includes(SCOPES[o.action]),'FORBIDDEN','Bot không có quyền');
 var p=o.payload==null?{}:o.payload;
 need(p&&typeof p==='object'&&!Array.isArray(p),'INVALID_REQUEST','Payload không hợp lệ');
 var msg=[o.keyId,o.timestamp,o.nonce,o.action,JSON.stringify(p)].join('\n');
 need(equalSig(signed(client.secret,msg),o.signature),'AUTH_FAILED','Không thể xác thực');
 return {action:o.action,payload:p,nonce:o.keyId+':'+o.nonce};
}
function state(){
 var x=readState_();need(Number.isInteger(x.revision)&&x.values&&typeof x.values[ORDER_KEY]==='string','INVALID_STATE','Dữ liệu Drive không hợp lệ');return x;
}
function rows(s){var x=JSON.parse(s.values[ORDER_KEY]);need(Array.isArray(x),'INVALID_STATE','Dữ liệu hóa đơn hỏng');return x;}
function version(s,p){need(Number.isInteger(p.expectedRevision),'REVISION_REQUIRED','Thiếu expectedRevision');need(s.revision===p.expectedRevision,'REVISION_CONFLICT','Dữ liệu vừa được cập nhật, hãy đọc lại');}
function visible(o){return {id:o.id,invoiceNo:o.invoiceNo,date:o.date,name:o.name,phone:o.phone,location:o.location,items:o.items||[],product:o.product||'',qty:o.qty||0,total:o.total,status:o.status,customerPaidAt:o.customerPaidAt||null,apiPaymentRequestId:o.apiPaymentRequestId||'',shippingAmount:o.shippingAmount||0,vatAmount:o.vatAmount||0,deliveryNote:o.deliveryNote||'',updatedAt:o.updatedAt||null,deliveryDate:o.deliveryDate||null};}
function iso(date){
 var m=String(date||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!m)return /^\d{4}-\d{2}-\d{2}$/.test(date)?date:'';
 var d=new Date(Date.UTC(+m[3],+m[2]-1,+m[1]));
 if(d.getUTCFullYear()!==+m[3]||d.getUTCMonth()+1!==+m[2]||d.getUTCDate()!==+m[1])return '';
 return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
}
function select(all,p){
 var q=norm(p.query||''),digits=String(p.query||'').replace(/\D/g,'');
 return all.filter(function(o){
  if(q&&![o.name,o.phone,o.customerCode,o.customerId,o.clientCode,o.invoiceNo].some(function(v){return norm(v).includes(q)})&&!(digits.length>=5&&String(o.phone||'').replace(/\D/g,'').includes(digits)))return false;
  if(p.status&&o.status!==p.status)return false;
  var date=iso(o.date);if((p.from||p.to)&&(!date||(p.from&&date<p.from)||(p.to&&date>p.to)))return false;
  return true;
 });
}
function active(o){return !['Đã hủy','Không Tính'].includes(o.status);}
function paid(o){return o.status==='Đã thanh toán'||!!o.customerPaidAt;}

function locKey(o){
 return [norm(o.name),norm(o.location).replace(/[^a-z0-9]+/g,' ').trim(),String(o.phone||'').replace(/\D/g,'').slice(-9)].join('|');
}
function searchProfiles(all,p){
 var q=norm(p.query||''),needle=String(p.phone||'').replace(/\D/g,'');
 need(q.length>=2||needle.length>=7,'INVALID_QUERY','Cần tên từ 2 ký tự hoặc số điện thoại từ 7 chữ số');
 var a={};
 all.forEach(function(o){
   if(q&&!norm(o.name).includes(q)&&!norm(o.location).includes(q))return;
   if(needle&&!String(o.phone||'').replace(/\D/g,'').includes(needle))return;
   var k=locKey(o),t=Number(o.timestamp||o.id)||0,g=a[k];
   if(!g)a[k]=g={key:k,name:o.name,phone:o.phone||'',location:o.location||'',count:0,
      ref:{id:o.id,invoiceNo:o.invoiceNo},lastDate:o.date,sourceInvoiceNo:o.invoiceNo,timestamp:t};
   g.count++;
   if(t>g.timestamp){g.ref={id:o.id,invoiceNo:o.invoiceNo};g.lastDate=o.date;g.sourceInvoiceNo=o.invoiceNo;g.timestamp=t}
 });
 var list=Object.keys(a).map(function(k){return a[k]}).sort(function(a,b){return b.timestamp-a.timestamp});
 return {total:list.length,requiresSelection:list.length>1,profiles:list.slice(0,Math.min(100,Math.max(1,Number(p.limit)||50)))};
}
function checkProfile(all,o,p){
 if(p.customerRef){
   var r=p.customerRef;
   var refs=all.filter(function(v){return String(v.id)===String(r.id)&&Number(v.invoiceNo)===Number(r.invoiceNo)});
   need(refs.length===1,'PROFILE_CHANGED','Khách tham chiếu không còn hợp lệ');
   var v=refs[0];
   need(norm(v.name)===norm(o.name)&&norm(v.location)===norm(o.location)&&
      String(v.phone||'').replace(/\D/g,'')===String(o.phone||'').replace(/\D/g,''),
      'PROFILE_MISMATCH','Tên, địa chỉ hoặc số điện thoại chưa khớp điểm giao đã chọn');
 } else {
   need(p.confirmedNewCustomer===true,'PROFILE_CONFIRMATION_REQUIRED','Chọn đúng điểm giao hoặc xác nhận khách mới');
   need(String(o.location||'').trim().length>=5,'INVALID_ORDER','Khách mới phải có địa chỉ');
 }
}
function removeOrder(s,all,p){
 need(p.confirmed===true,'CONFIRMATION_REQUIRED','Chưa xác nhận xóa hóa đơn');
 need(/^[a-zA-Z0-9_-]{8,100}$/.test(String(p.requestId||'')),
  'INVALID_REQUEST','Thiếu requestId chống thao tác lặp');
 var trash=JSON.parse(s.values.satori_trash_bin_v15||'[]');
 var previous=trash.find(function(t){return t.apiDeleteRequestId===p.requestId});
 if(previous)return {modified:false,result:{duplicate:true,deleted:true,invoiceNo:previous.order.invoiceNo}};
 version(s,p);
 need(Number.isSafeInteger(p.invoiceNo)&&p.invoiceNo>0&&p.id!==undefined,
   'INVALID_ORDER','Cần số hóa đơn và ID');
 need(String(p.expectedName||'').trim().length>=2&&Number.isFinite(p.expectedTotal),
   'CONFIRMATION_REQUIRED','Cần tên khách và tổng tiền để xác nhận');
 var found=all.filter(function(o){return Number(o.invoiceNo)===p.invoiceNo&&String(o.id)===String(p.id)});
 need(found.length===1,'INVALID_ORDER','Hóa đơn không còn tồn tại hoặc mã bị trùng');
 var o=found[0];
 need(norm(o.name)===norm(p.expectedName)&&Number(o.total)===p.expectedTotal,
   'ORDER_CHANGED','Tên khách hoặc tổng tiền đã khác');
 need(!['Đã thanh toán','Đã TT Satori'].includes(o.status)&&!o.customerPaidAt,
   'PAID_ORDER_PROTECTED','Không được xóa hóa đơn đã thu tiền qua Bot');
 var exists=all.some(function(v){return v.apiRequestId===p.requestId})||
     trash.some(function(t){return t.order&&t.order.apiRequestId===p.requestId});
 need(!exists,'REUSED_REQUEST_ID','Mã yêu cầu đã được dùng cho thao tác khác');
 var now=Date.now();
 trash.unshift({order:o,deletedAt:now,
   deletedDateStr:Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','dd/MM/yyyy HH:mm'),
   expiresAt:now+30*86400000,apiDeleteRequestId:p.requestId});
 all.splice(all.indexOf(o),1);
 var deleted=JSON.parse(s.values.satori_deleted_invoice_nos||'[]');
 if(!deleted.some(function(v){return Number(v)===Number(o.invoiceNo)}))deleted.push(o.invoiceNo);
 return {modified:true,extras:{satori_trash_bin_v15:JSON.stringify(trash),
   satori_deleted_invoice_nos:JSON.stringify(deleted)},
   result:{deleted:true,id:o.id,invoiceNo:o.invoiceNo,restorable:true}};
}
function create(s,all,p){
 var req=String(p.requestId||'');need(/^[a-zA-Z0-9_-]{8,100}$/.test(req),'INVALID_REQUEST','Thiếu requestId hợp lệ');
 var old=all.find(function(o){return o.apiRequestId===req});if(old)return {modified:false,result:{order:visible(old),duplicate:true}};
 var bin=JSON.parse(s.values.satori_trash_bin_v15||'[]');
 need(!bin.some(function(t){return t.order&&t.order.apiRequestId===req}),'REUSED_REQUEST_ID','Đơn cũ đã chuyển vào thùng rác');
 version(s,p);
 var o=p.order;need(o&&typeof o==='object'&&String(o.name||'').trim().length>=2,'INVALID_ORDER','Thiếu tên khách');
 need(Array.isArray(o.items)&&o.items.length>0&&o.items.length<=50,'INVALID_ORDER','Danh sách sản phẩm không hợp lệ');
 var name=String(o.name).trim(),phone=String(o.phone||''),location=String(o.location||'');
 need(name.length<=150&&phone.length<=60&&location.length<=500,'INVALID_ORDER','Thông tin khách quá dài');
 checkProfile(all,o,p);
 var items=o.items.map(function(i){
  need(i&&String(i.product||i.name||'').trim().length>=2,'INVALID_ITEM','Thiếu tên sản phẩm');
  var qty=Number(i.qty),price=money(i.unitPrice);need(Number.isSafeInteger(qty)&&qty>0&&qty<=100000,'INVALID_ITEM','Sai số lượng');
  var list=i.listPrice==null?price:money(i.listPrice);
  return {id:Utilities.getUuid(),code:String(i.code||'').slice(0,50),product:String(i.product||i.name).slice(0,200),
   unit:String(i.unit||'Thùng').slice(0,30),qty:qty,unitPrice:price,listPrice:list,discountAmount:list-price,subtotal:Math.round(qty*price)};
 });
 var goods=Math.round(items.reduce(function(v,i){return v+i.qty*i.unitPrice},0));
 var ship=money(o.shippingAmount==null?0:o.shippingAmount),vat=money(o.vatAmount==null?0:o.vatAmount),total=Math.round(goods+ship+vat);
 need(total<=1e11,'INVALID_AMOUNT','Tổng tiền vượt giới hạn');
 if(o.total!==undefined)need(money(o.total)===total,'TOTAL_MISMATCH','Tổng tiền không khớp');
 var reserved=JSON.parse(s.values.satori_deleted_invoice_nos||'[]');
 var history=all.map(function(o){return Number(o.invoiceNo)||0})
  .concat(bin.map(function(t){return Number(t.order&&t.order.invoiceNo)||0}))
  .concat(reserved.map(function(n){return Number(n)||0}));
 var invoice=1+history.reduce(function(a,b){return Math.max(a,b)},0);
 need(Number.isSafeInteger(invoice)&&invoice>0,'INVALID_ORDER','Không thể cấp số hóa đơn mới');
 var id=Date.now();while(all.some(function(i){return String(i.id)===String(id)})||bin.some(function(t){return String(t.order&&t.order.id)===String(id)}))id++;
 var next={id:id,__syncId:Utilities.getUuid(),apiRequestId:req,invoiceNo:invoice,
  deliveryDate:String(o.deliveryDate||'').slice(0,10)||null,
  date:Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','dd/MM/yyyy'),timestamp:Date.now(),
  name:name,phone:phone,location:location,items:items,
  product:items.map(function(i){return i.product+' x'+i.qty}).join(', '),qty:items.reduce(function(v,i){return v+i.qty},0),
  goodsTotal:goods,shippingAmount:ship,vatAmount:vat,vat:vat?'yes':'no',total:total,status:'Chưa thanh toán',source:'bot_api',deliveryNote:String(o.deliveryNote||'').slice(0,1000)};
 all.unshift(next);return {modified:true,result:{order:visible(next),duplicate:false}};
}

function updateOrder(s,all,p){
 need(p.confirmed===true,'CONFIRMATION_REQUIRED','Cần xác nhận sửa hóa đơn');
 var req=String(p.requestId||'');
 need(/^[a-zA-Z0-9_-]{8,100}$/.test(req),'INVALID_REQUEST','Thiếu requestId');
 var repeated=all.find(function(o){return o.apiUpdateRequestId===req});
 if(repeated)return {modified:false,result:{order:visible(repeated),duplicate:true}};
 version(s,p);
 need(Number.isSafeInteger(p.invoiceNo)&&p.id!=null,'INVALID_ORDER','Thiếu mã hóa đơn');
 var matches=all.filter(function(o){return o.invoiceNo===p.invoiceNo&&String(o.id)===String(p.id)});
 need(matches.length===1,'ORDER_CHANGED','Hóa đơn đã thay đổi hoặc không tìm thấy');
 var old=matches[0];
 need(!paid(old)&&old.status!=='Đã TT Satori','PAID_ORDER_PROTECTED',
    'Hóa đơn đã thanh toán không được sửa tiền hàng qua API');
 need(norm(old.name)===norm(p.expectedName)&&Number(old.total)===Number(p.expectedTotal),
    'ORDER_CHANGED','Tên hoặc số tiền đã khác, hãy tải lại');
 var o=p.order;
 need(o&&typeof o==='object'&&String(o.name||'').trim().length>=2,'INVALID_ORDER','Thiếu tên khách');
 var name=String(o.name).trim(),phone=String(o.phone||'').trim(),location=String(o.location||'').trim();
 need(name.length<=150&&phone.length<=60&&location.length<=500,'INVALID_ORDER','Thông tin khách quá dài');
 need(Array.isArray(o.items)&&o.items.length>=1&&o.items.length<=50,'INVALID_ORDER','Thiếu danh sách hàng');
 var items=o.items.map(function(i){
  need(i&&String(i.product||i.name||'').trim().length>=2,'INVALID_ITEM','Thiếu sản phẩm');
  var qty=Number(i.qty),price=money(i.unitPrice);need(Number.isSafeInteger(qty)&&qty>0&&qty<=100000,'INVALID_ITEM','Sai số lượng');
  var list=i.listPrice==null?price:money(i.listPrice);
  return {id:Utilities.getUuid(),code:String(i.code||'').slice(0,50),product:String(i.product||i.name).slice(0,200),
   unit:String(i.unit||'Thùng').slice(0,30),qty:qty,unitPrice:price,listPrice:list,
   discountAmount:list-price,subtotal:Math.round(qty*price)};
 });
 var goods=items.reduce(function(v,i){return v+i.subtotal},0);
 var ship=money(o.shippingAmount==null?0:o.shippingAmount),vat=money(o.vatAmount==null?0:o.vatAmount);
 var total=Math.round(goods+ship+vat);
 need(total<=1e11,'INVALID_AMOUNT','Tổng tiền quá lớn');
 if(o.total!==undefined)need(money(o.total)===total,'TOTAL_MISMATCH','Tổng không khớp');
 var next=Object.assign({},old,{name:name,phone:phone,location:location,items:items,
  product:items.map(function(i){return i.product+' x'+i.qty}).join(', '),
  qty:items.reduce(function(v,i){return v+i.qty},0),goodsTotal:goods,
  shippingAmount:ship,vatAmount:vat,vat:vat?'yes':'no',total:total,
  deliveryNote:String(o.deliveryNote||'').slice(0,1000),
  deliveryDate:o.deliveryDate?String(o.deliveryDate).slice(0,10):old.deliveryDate,
  apiUpdateRequestId:req,updatedAt:Date.now()});
 all[all.indexOf(old)]=next;return {modified:true,result:{order:visible(next),duplicate:false}};
}
function restoreOrder(s,all,p){
 need(p.confirmed===true,'CONFIRMATION_REQUIRED','Chưa xác nhận khôi phục hóa đơn');
 need(/^[a-zA-Z0-9_-]{8,100}$/.test(String(p.requestId||'')),'INVALID_REQUEST','Thiếu requestId chống khôi phục lặp');
 var previous=all.find(function(o){return o.apiRestoreRequestId===p.requestId});
 if(previous){
  need(String(previous.id)===String(p.id)&&Number(previous.invoiceNo)===p.invoiceNo,'REUSED_REQUEST_ID','Mã yêu cầu đã dùng cho hóa đơn khác');
  return {modified:false,result:{restored:true,duplicate:true,order:visible(previous)}};
 }
 version(s,p);
 need(Number.isSafeInteger(p.invoiceNo)&&p.invoiceNo>0&&p.id!==undefined,'INVALID_ORDER','Cần số hóa đơn và ID');
 need(String(p.expectedName||'').trim().length>=2&&Number.isFinite(p.expectedTotal),'CONFIRMATION_REQUIRED','Cần tên khách và tổng tiền xác nhận');
 var trash=JSON.parse(s.values.satori_trash_bin_v15||'[]');
 need(Array.isArray(trash),'INVALID_STATE','Dữ liệu thùng rác hỏng');
 var found=trash.filter(function(t){return t.order&&String(t.order.id)===String(p.id)&&Number(t.order.invoiceNo)===p.invoiceNo});
 need(found.length===1,'TRASH_NOT_FOUND','Hóa đơn không còn trong thùng rác hoặc mã không duy nhất');
 var item=found[0],o=item.order,now=Date.now();
 need(Number.isFinite(item.deletedAt)&&item.deletedAt<=now&&now-item.deletedAt<30*86400000&&(!item.expiresAt||item.expiresAt>now),'TRASH_EXPIRED','Hóa đơn đã hết thời hạn khôi phục 30 ngày');
 need(norm(o.name)===norm(p.expectedName)&&Number(o.total)===p.expectedTotal,'ORDER_CHANGED','Tên khách hoặc tổng tiền đã thay đổi');
 need(!all.some(function(v){return String(v.id)===String(o.id)||Number(v.invoiceNo)===p.invoiceNo}),'RESTORE_CONFLICT','Trùng ID hoặc số hóa đơn đang có; không ghi đè');
 need(!all.some(function(v){return v.apiRequestId===p.requestId})&&!trash.some(function(t){return t.apiDeleteRequestId===p.requestId||t.order&&(t.order.apiRequestId===p.requestId||t.order.apiRestoreRequestId===p.requestId)}),'REUSED_REQUEST_ID','Mã yêu cầu đã dùng cho thao tác khác');
 var restored=Object.assign({},o,{apiRestoreRequestId:p.requestId,updatedAt:now});
 all.unshift(restored);trash.splice(trash.indexOf(item),1);
 var deleted=JSON.parse(s.values.satori_deleted_invoice_nos||'[]');
 need(Array.isArray(deleted),'INVALID_STATE','Dữ liệu số hóa đơn đã xóa hỏng');
 deleted=deleted.filter(function(n){return Number(n)!==p.invoiceNo});
 return {modified:true,extras:{satori_trash_bin_v15:JSON.stringify(trash),satori_deleted_invoice_nos:JSON.stringify(deleted)},result:{restored:true,duplicate:false,order:visible(restored)}};
}
function markPaid(s,all,p){
 need(Number.isSafeInteger(p.invoiceNo)&&p.invoiceNo>0,'INVALID_ORDER','Thiếu số hóa đơn');
 var match=all.filter(function(o){return Number(o.invoiceNo)===p.invoiceNo});
 need(match.length===1&&active(match[0]),'INVALID_ORDER','Hóa đơn không duy nhất hoặc đã hủy');
 var old=match[0];
 // Native callers bind the customer's payment to an exact invoice ID as well
 // as invoice number. Legacy ChatGPT Bot calls can omit ID for compatibility.
 if(p.id!==undefined&&p.id!==null){
  need(String(old.id)===String(p.id),'ORDER_CHANGED',
    'Hóa đơn đã thay đổi ID; tải lại trước khi xác nhận thanh toán');
 }
 // Verify confirmation and amount even on a repeated request. A lost mobile
 // response must not turn a successful payment into a revision conflict.
 need(p.confirmed===true,'CONFIRMATION_REQUIRED','Cần xác nhận thực nhận tiền');
 if(p.amount!==undefined)need(money(p.amount)===money(old.total),'TOTAL_MISMATCH','Tiền thanh toán không khớp');
 // Mobile callers supply a durable requestId; legacy Bot callers may omit it.
 // Never attribute another device's payment to this request after a lost reply.
 var paymentRequestId=p.requestId==null?'':String(p.requestId);
 if(paymentRequestId){
  need(/^[a-zA-Z0-9_-]{8,100}$/.test(paymentRequestId),
   'INVALID_REQUEST','Mã xác nhận thanh toán không hợp lệ');
  // Native requests must be bound to the invoice ID and the exact amount.
  // Historic Bot requests without requestId retain their original contract.
  need(p.id!==undefined&&p.id!==null&&String(p.id)===String(old.id),
   'ORDER_CHANGED','Thiếu hoặc không khớp ID hóa đơn để xác nhận thanh toán');
  need(p.amount!==undefined,'INVALID_AMOUNT',
   'Ứng dụng phải gửi chính xác tổng tiền hóa đơn');
 }
 if(paid(old))return {modified:false,result:{order:visible(old),alreadyPaid:true}};
 version(s,p);
 var updated=Object.assign({},old,{customerPaidAt:new Date().toISOString(),updatedAt:Date.now()});
 if(paymentRequestId)updated.apiPaymentRequestId=paymentRequestId;
 if(updated.status!=='Đã TT Satori')updated.status='Đã thanh toán';
 all[all.indexOf(old)]=updated;return {modified:true,result:{order:visible(updated),alreadyPaid:false}};
}
function read(s,action,p){
 var all=rows(s);
 if(action==='trash.list'){
  var now=Date.now(),bin=JSON.parse(s.values.satori_trash_bin_v15||'[]');
  need(Array.isArray(bin),'INVALID_STATE','Dữ liệu thùng rác hỏng');
  var q=norm(p.query||'');
  var candidates=bin.filter(function(t){return t.order&&Number.isFinite(t.deletedAt)&&t.deletedAt<=now&&now-t.deletedAt<30*86400000&&(!t.expiresAt||t.expiresAt>now)});
  if(q)candidates=candidates.filter(function(t){var o=t.order;return [o.invoiceNo,o.name,o.phone,o.location].some(function(v){return norm(v).includes(q)})});
  return {revision:s.revision,totalMatches:candidates.length,invoices:candidates.slice(0,Math.min(100,Math.max(1,Number(p.limit)||30))).map(function(t){return {order:visible(t.order),deletedAt:t.deletedAt,expiresAt:t.expiresAt||t.deletedAt+30*86400000}})};
 }
  if(action==='system.status')return {revision:s.revision,updatedAt:s.updatedAt,orders:all.length};
 if(action==='customers.search')return {revision:s.revision,profiles:searchProfiles(all,p)};
 var found=select(all,p);
 if(action==='orders.list')return {revision:s.revision,totalMatches:found.length,orders:found.slice(0,Math.min(100,Math.max(1,Number(p.limit)||30))).map(visible)};
 if(action==='debt.summary'){
  need(typeof SatoriAccountingCore!=='undefined','CONFIG_MISSING','Thiếu AccountingCore.gs cho công nợ');
  var ledger=SatoriAccountingCore.calculate(all,[]),secondary=new Set(ledger.rows.filter(function(r){return r.secondary}).map(function(r){return r.order}));
  var excluded=found.filter(function(o){return active(o)&&secondary.has(o)}).length;
  found=found.filter(function(o){return active(o)&&!secondary.has(o)});var owed=found.filter(function(o){return !paid(o)});
  return {revision:s.revision,orders:found.length,unpaidCount:owed.length,
   excludedReferenceCount:excluded,reviewCount:ledger.rows.filter(function(r){return r.review&&found.includes(r.order)}).length,
   total:found.reduce(function(n,o){return n+Number(o.total||0)},0),
   due:owed.reduce(function(n,o){return n+Number(o.total||0)},0),
   unpaidInvoices:owed.slice(0,100).map(visible),truncated:owed.length>100};
 }
 fail('INVALID_ACTION','Lệnh không hỗ trợ');
}
function write(s,action,p){
 var all=rows(s),result=action==='orders.create'?create(s,all,p):action==='orders.update'?updateOrder(s,all,p):action==='orders.restore'?restoreOrder(s,all,p):action==='orders.delete'?removeOrder(s,all,p):markPaid(s,all,p);
 if(!result.modified)return {revision:s.revision,data:result.result};
 var props=PropertiesService.getScriptProperties(),fileId=props.getProperty('STATE_FILE_ID');
 need(!!fileId,'CONFIG_MISSING','Thiếu STATE_FILE_ID');
 if (fileId !== SATORI_MOBILE_SANDBOX_FILE_ID) fail('SANDBOX_ONLY','Refusing to write to non-sandbox Drive file');
 var file=DriveApp.getFileById(fileId);
 var backup=file.makeCopy('MinhSatori_API_PreWrite_'+new Date().toISOString().replace(/[:.]/g,'-'));
 need(backup&&backup.getId(),'BACKUP_FAILED','Không tạo được bản sao trước ghi');
 var backedUp=JSON.parse(backup.getBlob().getDataAsString());
 need(JSON.stringify(backedUp)===JSON.stringify(s),'BACKUP_FAILED','Bản sao trước ghi không khớp dữ liệu hiện tại');
 var next={revision:s.revision+1,values:Object.assign({},s.values),updatedAt:new Date().toISOString()};
 next.values[ORDER_KEY]=JSON.stringify(all);
 if(result.extras)Object.keys(result.extras).forEach(function(k){next.values[k]=result.extras[k]});
 file.setContent(JSON.stringify(next));
 var check=state();need(check.revision===next.revision&&check.values[ORDER_KEY]===next.values[ORDER_KEY]&&
  (!result.extras||Object.keys(result.extras).every(function(k){return check.values[k]===result.extras[k]})),
  'COMMIT_UNVERIFIED','Chưa xác minh được ghi dữ liệu');
 return {revision:next.revision,data:result.result,backupCreated:true};
}
function handle(e){
 try{
  var raw=e&&e.postData&&e.postData.contents;
  need(typeof raw==='string'&&raw.length<=100000,'INVALID_REQUEST','Request quá lớn');
  var identity=auth(JSON.parse(raw)),lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
   var cache=CacheService.getScriptCache(),key='satoriapi:'+identity.nonce;
   need(!cache.get(key),'REPLAYED','Lệnh đã sử dụng');
   var s=state(),isWrite=identity.action==='orders.create'||identity.action==='orders.update'||identity.action==='orders.restore'||identity.action==='orders.delete'||identity.action==='payments.markCustomerPaid';
   var result=isWrite?write(s,identity.action,identity.payload):{revision:s.revision,data:read(s,identity.action,identity.payload)};
   cache.put(key,'1',600);
   return json({ok:true,action:identity.action,revision:result.revision,data:result.data,backupCreated:!!result.backupCreated});
  }finally{lock.releaseLock()}
 }catch(err){return json({ok:false,error:{code:err.code||'ERROR',message:err.code?err.message:'Không xử lý được; kiểm tra nhật ký hệ thống'}})}
}
function executeVerified(action,payload,nonce) {
 need(Object.prototype.hasOwnProperty.call(SCOPES,action),'INVALID_ACTION','Lệnh không hỗ trợ');
 need(typeof nonce==='string'&&/^[A-Za-z0-9_-]{12,100}$/.test(nonce),
   'INVALID_REQUEST','Thiếu mã yêu cầu');
 var p=payload||{};
 need(p&&typeof p==='object'&&!Array.isArray(p),'INVALID_REQUEST','Payload không hợp lệ');
 var lock=LockService.getScriptLock();lock.waitLock(30000);
 try {
  var cache=CacheService.getScriptCache(),key='satorimobile:'+nonce;
  need(!cache.get(key),'REPLAYED','Không gửi lặp thao tác');
  var s=state(),writeAction=['orders.create','orders.update','orders.delete',
   'orders.restore','payments.markCustomerPaid'].includes(action);
  var result=writeAction?write(s,action,p):{revision:s.revision,data:read(s,action,p)};
  cache.put(key,'1',600);
  return {ok:true,action:action,revision:result.revision,data:result.data,
    backupCreated:!!result.backupCreated};
 }finally{lock.releaseLock()}
}
return {handle:handle,executeVerified:executeVerified};
})();
function doPost(e){return e&&e.parameter&&e.parameter.route==='android'?SatoriMobileApi.handle(e):SatoriBotApi.handle(e)}



/* PART 3: Android OAuth mobile endpoint */
/**
 * Minh Satori Android owner API.
 * Put in the SAME Apps Script project/deployment as BotApi.gs + readState_().
 * Requires Google OAuth access token from Android Google Identity, never an
 * HMAC secret in the APK. Existing HMAC doPost route remains unchanged.
 *
 * Script Properties (set manually in server project; never commit secret values):
 *  SATORI_ANDROID_OWNER_EMAIL — the authorized business owner's email.
 *  SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON — JSON array of OAuth client IDs
 *  issued to authorized Android signing certificate/package (and optional
 *  trusted OAuth clients).
 *  SATORI_ANDROID_STAFF_PERMISSIONS_JSON — optional map of verified staff
 *  emails to allowed scopes, e.g. {"staff@example.com":["orders:read","orders:write"]}.
 *  Owner has full access; nonlisted staff are denied. Configure ONLY server-side.
 * Needs UrlFetchApp scope and the script's existing Drive API permissions.
 *
 * IMPORTANT: deploying the GitHub files does NOT deploy Apps Script;
 * update a staging GAS deployment first, then deploy production separately.
 */
var SatoriMobileApi=(function(){
'use strict';
function fail(code,message){var ex=new Error(message);ex.code=code;throw ex;}
function need(value,code,message){if(!value)fail(code,message);}
function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function props(){return PropertiesService.getScriptProperties();}
var ACTION_SCOPES={
 'mobile.snapshot':'orders:read','mobile.trash':'orders:delete',
 'system.status':'orders:read','orders.list':'orders:read',
 'customers.search':'customers:read','debt.summary':'debt:read',
 'orders.create':'orders:write','orders.update':'orders:write',
 'orders.delete':'orders:delete','orders.restore':'orders:write',
 'payments.markCustomerPaid':'payments:write'
};
function verifyOwner(accessToken){
 need(typeof accessToken==='string'&&accessToken.length>=20&&accessToken.length<=4096,
   'AUTH_FAILED','Thiếu phiên đăng nhập Google');
 var config=props();
 var owner=String(config.getProperty('SATORI_ANDROID_OWNER_EMAIL')||'').trim().toLowerCase();
 var clients;
 try{clients=JSON.parse(config.getProperty('SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON')||'[]')}
 catch(e){clients=[]}
 need(owner&&Array.isArray(clients)&&clients.length>0&&clients.length<=20,
   'MOBILE_NOT_CONFIGURED','Ứng dụng chưa được chủ sở hữu kích hoạt trên Apps Script');
 // Google tokeninfo checks token validity, expiry, issued app ID and scopes.
 var url='https://oauth2.googleapis.com/tokeninfo?access_token='+encodeURIComponent(accessToken);
 var verified=UrlFetchApp.fetch(url,{method:'get',muteHttpExceptions:true,followRedirects:false});
 need(verified.getResponseCode()===200,'AUTH_FAILED','Phiên Google không hợp lệ hoặc đã hết hạn');
 var info=JSON.parse(verified.getContentText());
 var audience=String(info.aud||info.issued_to||info.audience||'');
 need(clients.includes(audience),'FORBIDDEN','Ứng dụng Android chưa được cấp quyền');
 need(Number(info.expires_in)>0,'AUTH_FAILED','Phiên Google đã hết hạn');
 var scopes=String(info.scope||'').split(/\s+/);
 need(scopes.includes('https://www.googleapis.com/auth/userinfo.email')||
      scopes.includes('email'), 'FORBIDDEN','Phiên Google chưa cấp quyền kiểm tra email');
 // The authenticated profile is fetched server-to-server with the bearer token;
 // NEVER trust an email sent by the phone.
 var profileResponse=UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/userinfo',{
   method:'get',muteHttpExceptions:true,followRedirects:false,
   headers:{Authorization:'Bearer '+accessToken}
 });
 need(profileResponse.getResponseCode()===200,'AUTH_FAILED','Không xác minh được tài khoản Google');
 var profile=JSON.parse(profileResponse.getContentText());
 need(profile.email_verified===true,'FORBIDDEN','Tài khoản Google chưa xác minh email');
 var email=String(profile.email||'').trim().toLowerCase();
 need(typeof profile.sub==='string'&&profile.sub.length>0&&profile.sub.length<=200,
      'AUTH_FAILED','Không xác minh được định danh tài khoản Google');
 var ownerAccess=email===owner;
 var staff={};
 try{staff=JSON.parse(config.getProperty('SATORI_ANDROID_STAFF_PERMISSIONS_JSON')||'{}')}
 catch(e){fail('MOBILE_NOT_CONFIGURED','Danh sách quyền nhân viên không hợp lệ')}
 need(staff&&typeof staff==='object'&&!Array.isArray(staff),
      'MOBILE_NOT_CONFIGURED','Danh sách quyền nhân viên không hợp lệ');
 var permitted=Object.prototype.hasOwnProperty.call(staff,email)?staff[email]:null;
 if(!ownerAccess){
   need(Array.isArray(permitted)&&permitted.length>0&&permitted.length<=10&&
      permitted.every(function(scope){
        return typeof scope==='string'&&Object.values(ACTION_SCOPES).includes(scope);
      }), 'FORBIDDEN','Tài khoản không thuộc nhân viên được cấp quyền Minh Satori');
 }
 return {email:email,subject:String(profile.sub||''),
         owner:ownerAccess,scopes:ownerAccess?null:permitted};
}
function handle(e){
 try{
  var raw=e&&e.postData&&e.postData.contents;
  need(typeof raw==='string'&&raw.length>=2&&raw.length<=120000,
    'INVALID_REQUEST','Dữ liệu gửi lên không hợp lệ');
  var request=JSON.parse(raw);
  need(request&&request.kind==='satori-android-v1'&&typeof request.action==='string',
    'INVALID_REQUEST','Sai giao thức Android');
  var verified=verifyOwner(request.accessToken);
  var action=request.action;
  need(Object.prototype.hasOwnProperty.call(ACTION_SCOPES,action),
       'INVALID_ACTION','Lệnh không hỗ trợ');
  need(verified.owner||verified.scopes.includes(ACTION_SCOPES[action]),
       'FORBIDDEN','Nhân viên chưa được cấp quyền thực hiện thao tác này');
  if(action==='mobile.snapshot'||action==='mobile.trash'){
    var lock=LockService.getScriptLock();lock.waitLock(30000);
    try{
      var state=readState_();
      need(state&&Number.isInteger(state.revision)&&state.values&&
       typeof state.values.satori_orders_v15==='string','INVALID_STATE',
       'Dữ liệu hóa đơn chưa sẵn sàng');
      if(action==='mobile.snapshot'){
        var allowedActions=Object.keys(ACTION_SCOPES).filter(function(a){
          return verified.owner||verified.scopes.includes(ACTION_SCOPES[a]);
        });
        var values={satori_orders_v15:state.values.satori_orders_v15,
          satori_catalogue_v15:state.values.satori_catalogue_v15||'[]'};
        // AI customer memory includes receiver addresses and phone numbers.
        // Never disclose to staff with only orders:read; require customers:read.
        if(verified.owner||verified.scopes.includes('customers:read')){
          values.satori_ai_customer_memory=state.values.satori_ai_customer_memory||'[]';
        }
        return json({ok:true,action:action,revision:state.revision,
         data:{revision:state.revision,updatedAt:state.updatedAt,
          actorId:verified.subject,allowedActions:allowedActions,values:values}});
      }
      var bin=JSON.parse(state.values.satori_trash_bin_v15||'[]');
      return json({ok:true,action:action,revision:state.revision,data:{
       orders:bin.filter(function(t){var now=Date.now();return t&&t.order&&
        Number.isFinite(t.deletedAt)&&t.deletedAt<=now&&now-t.deletedAt<30*86400000&&
        (!t.expiresAt||t.expiresAt>now)}).slice(0,100).map(function(t){
        return {id:t.order.id,invoiceNo:t.order.invoiceNo,name:t.order.name,
        total:t.order.total,deletedAt:t.deletedAt,expiresAt:t.expiresAt,
        deleteRequestId:t.apiDeleteRequestId||''};
       })}});
    }finally{lock.releaseLock()}
  }
  need(['orders.create','orders.update','orders.delete','orders.restore',
        'payments.markCustomerPaid','system.status','orders.list',
        'customers.search','debt.summary'].includes(action),
       'INVALID_ACTION','Lệnh không hỗ trợ');
  var nonce=String(request.nonce||'');
  var outcome=SatoriBotApi.executeVerified(action,request.payload||{},nonce);
  return json(outcome);
 }catch(error){
   var recognized=typeof error.code==='string';
   return json({ok:false,error:{code:recognized?error.code:'ERROR',
    message:recognized?error.message:'Không thực hiện được tác vụ; vui lòng tải lại và thử lại'}});
 }
}
return {handle:handle,verifyOwner:verifyOwner};
})();

