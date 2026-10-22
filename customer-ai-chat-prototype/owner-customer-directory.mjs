/**
 * Ephemeral owner-only customer directory. Input is signed, read-only Bot API
 * responses. The output MUST NEVER feed sandbox link creation or Gemini prompts.
 */
const compact=(v,n=160)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,n);
export const foldCustomerName=v=>compact(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function directoryKey(name){
 const folded=foldCustomerName(name);
 // Owner-recognized brand family; each delivery location remains separately verified.
 if(/^traky(?:\s|$)/.test(folded))return 'brand:traky';
 return folded?'name:'+folded:'';
}
const baseName=key=>key==='brand:traky'?'Traky (các chi nhánh)':'';
const phoneOf=v=>compact(v,40).replace(/\D/g,'').replace(/^84(?=\d{9}$)/,'0');
const addressOf=v=>compact(v,300);
const dateOf=v=>compact(v,32);
const receiptOf=v=>compact(v,32);
export function directoryFromInvoices(orders,sourceComplete=true){
 const groups=new Map();
 for(const o of Array.isArray(orders)?orders:[]){
  if(!o||typeof o!=='object')continue;
  const name=compact(o.name||o.customerName,120),key=directoryKey(name);
  if(!key)continue;
  if(!groups.has(key))groups.set(key,{key,name:baseName(key)||name,aliases:new Set(),invoices:new Set(),lastDate:''});
  const g=groups.get(key);g.aliases.add(name);
  const no=receiptOf(o.invoiceNo);if(no)g.invoices.add(no);
  const date=dateOf(o.date||o.createdAt);if(date>g.lastDate)g.lastDate=date;
 }
 return [...groups.values()].map(g=>({
   key:g.key,name:g.name,aliases:[...g.aliases].sort((a,b)=>a.localeCompare(b,'vi')),
   invoiceCount:g.invoices.size,lastDate:g.lastDate,sourceComplete:!!sourceComplete
 })).sort((a,b)=>b.invoiceCount-a.invoiceCount||a.name.localeCompare(b.name,'vi'));
}
export function detailFromEvidence(requestedName,profiles,invoices,{sourceTotal=null,invoicesIncomplete=false}={}){
 const key=directoryKey(requestedName);
 if(!key)throw Error('INVALID_CUSTOMER');
 const found=new Map(),aliases=new Set(),allPhones=new Set();
 function add(row,kind){
  if(!row||typeof row!=='object')return;
  const name=compact(row.name||row.customerName,120);
  if(directoryKey(name)!==key)return; // Never merge same substring but different identity.
  const address=addressOf(row.location||row.address);
  const phone=phoneOf(row.phone||row.customerPhone);
  if(!address)return;
  aliases.add(name);if(phone)allPhones.add(phone);
  // Distinct phone/address combinations remain distinct selectable destinations.
  const identity=foldCustomerName(name)+'|'+phone+'|'+foldCustomerName(address);
  const invoiceNo=receiptOf(row.sourceInvoiceNo??row.invoiceNo);
  const date=dateOf(row.lastDate||row.date||row.createdAt);
  const last=found.get(identity);
  if(!last)found.set(identity,{name,phone,address,label:name,invoiceNos:invoiceNo?[invoiceNo]:[],lastDate:date,sourceKinds:[kind]});
  else{
   if(invoiceNo&&!last.invoiceNos.includes(invoiceNo))last.invoiceNos.push(invoiceNo);
   if(date>last.lastDate)last.lastDate=date;
   if(!last.sourceKinds.includes(kind))last.sourceKinds.push(kind);
  }
 }
 for(const p of Array.isArray(profiles)?profiles:[])add(p,'customers.search');
 for(const o of Array.isArray(invoices)?invoices:[])add(o,'orders.list');
 const places=[...found.values()].sort((a,b)=>b.lastDate.localeCompare(a.lastDate)||a.address.localeCompare(b.address,'vi'));
 // The source may contain duplicate profile entries but the UI never claims
 // complete coverage without independently accounting for source total.
 const complete=Number.isSafeInteger(sourceTotal)&&sourceTotal>=0&&places.length>=sourceTotal&&!invoicesIncomplete;
 return {key,name:baseName(key)||compact(requestedName,120),aliases:[...aliases],places,sourceTotal,
  count:places.length,complete,needsReview:allPhones.size>1||!complete,
  multipleContacts:allPhones.size>1,canIssueRealLinks:false,source:'Minh Satori Bot API • chỉ đọc'};
}
