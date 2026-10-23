/**
 * Owner-only, READ-ONLY customer directory. A buyer's invoices are not addresses.
 * Purchase count and invoice number must never determine delivery location identity.
 */
const compact=(v,n=160)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,n);
export const foldCustomerName=v=>compact(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function directoryKey(name){
 const folded=foldCustomerName(name);
 if(/^traky(?:\s|$)/.test(folded))return 'brand:traky';
 return folded?'name:'+folded:'';
}
const baseName=key=>key==='brand:traky'?'Traky (các chi nhánh)':'';
const phoneOf=v=>compact(v,40).replace(/\D/g,'').replace(/^84(?=\d{9}$)/,'0');
const addressOf=v=>compact(v,300);
const dateOf=v=>compact(v,32);
const receiptOf=v=>compact(v,32);
const verifiedRef=row=>{
 const invoiceNo=Number(row?.sourceInvoiceNo??row?.invoiceNo);
 const id=row?.ref?.id??row?.id;
 return Number.isSafeInteger(invoiceNo)&&invoiceNo>0&&id!=null?{id,invoiceNo}:null;
};
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
 let matchingSourceProfiles=0;
 function add(row,kind){
  if(!row||typeof row!=='object')return;
  const name=compact(row.name||row.customerName,120);
  if(directoryKey(name)!==key)return;
  const address=addressOf(row.location||row.address);
  const phone=phoneOf(row.phone||row.customerPhone);
  if(!address)return;
  if(kind==='customers.search')matchingSourceProfiles++;
  aliases.add(name);if(phone)allPhones.add(phone);
  // Identity is a PHYSICAL DELIVERY POINT within an owner-reviewed agency.
  // Phone can change; repeat orders never create a new destination.
  const identity=key+'|'+foldCustomerName(address);
  const no=receiptOf(row.sourceInvoiceNo??row.invoiceNo);
  const ref=verifiedRef(row),date=dateOf(row.lastDate||row.date||row.createdAt);
  let place=found.get(identity);
  if(!place){
   place={id:identity,name,phone:phone||'',address,label:name,
    invoiceNos:[],references:[],phones:[],ordersObserved:0,lastDate:date,sourceKinds:[],
    missingContact:false};
   found.set(identity,place);
  }
  if(no&&!place.invoiceNos.includes(no))place.invoiceNos.push(no);
  if(ref&&!place.references.some(x=>x.id===ref.id&&x.invoiceNo===ref.invoiceNo))
   place.references.push(ref);
  if(phone&&!place.phones.includes(phone))place.phones.push(phone);
  if(!phone)place.missingContact=true;
  if(!place.phone&&phone)place.phone=phone;
  if(date>place.lastDate){place.lastDate=date;if(phone)place.phone=phone}
  if(!place.sourceKinds.includes(kind))place.sourceKinds.push(kind);
  if(kind==='orders.list')place.ordersObserved++;
 }
 for(const p of Array.isArray(profiles)?profiles:[])add(p,'customers.search');
 for(const o of Array.isArray(invoices)?invoices:[])add(o,'orders.list');
 const places=[...found.values()].map(p=>{
  const reviewReasons=[];
  if(!p.phone)reviewReasons.push('MISSING_PHONE');
  if(!p.references.length)reviewReasons.push('MISSING_HISTORIC_REFERENCE');
  if(p.phones.length>1)reviewReasons.push('MULTIPLE_CONTACTS_REVIEW');
  // Historical source may be malformed or ambiguous; do not discard valid alternatives.
  if(p.missingContact)reviewReasons.push('HISTORIC_PHONE_MISSING');
  return {...p,needsReview:reviewReasons.length>0,reviewReasons,
   approvedCandidate:p.references.length>0&&!!p.phone,
   purchaseCount:p.ordersObserved};
 }).sort((a,b)=>b.lastDate.localeCompare(a.lastDate)||a.address.localeCompare(b.address,'vi'));
 // Compare *source profile rows* to sourceTotal, NOT unique delivery points:
 // several source records may correctly collapse into one physical address.
 const complete=Number.isSafeInteger(sourceTotal)&&sourceTotal>=0&&
   matchingSourceProfiles>=sourceTotal&&!invoicesIncomplete;
 return {key,name:baseName(key)||compact(requestedName,120),aliases:[...aliases],
  places,sourceTotal,sourceProfilesObserved:matchingSourceProfiles,
  count:places.length,complete,needsReview:places.some(p=>p.needsReview)||!complete,
  multipleContacts:allPhones.size>1,
  canIssueRealLinks:false, // issuance is a separate authenticated write-scoped API
  source:'Minh Satori Bot API • chỉ đọc'};
}
