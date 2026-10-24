/**
 * Owner-only, READ-ONLY customer directory. A buyer's invoices are not addresses.
 * Purchase count and invoice number must never determine delivery location identity.
 */
const compact=(v,n=160)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,n);
export const foldCustomerName=v=>compact(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function directoryKey(name){
 const folded=foldCustomerName(name);
 if(/^traky(?:\s|$)/.test(folded))return 'brand:traky';
 // Tracy is a different literal brand from Traky; do NOT merge them.
 return folded?'name:'+folded:'';
}
// The UI label is not a valid invoice/customer search term. Search by the
// literal source-family prefix but group all matching branch names only
// after receiving exact ledger records.
export function directorySourceQuery(name){
 return directoryKey(name)==='brand:traky'?'Traky':compact(name,120);
}
const baseName=key=>key==='brand:traky'?'Traky (các chi nhánh)':'';
const phoneOf=v=>compact(v,40).replace(/\D/g,'').replace(/^84(?=\d{9}$)/,'0');
const addressOf=v=>compact(v,300);
// Group by the physical delivery point, never by phone number or invoice number.
// A street-number + street-name is stronger than optional wards, postcodes,
// or delivery-time instructions; keep building/block identity for nonstreet sites.
export function physicalAddressKey(value){
 const raw=addressOf(value).split(/\s+[—–]\s+/)[0].trim();
 const segments=raw.split(',').map(x=>x.trim()).filter(Boolean);
 const numbered=segments.find(x=>/^(?:\d+[A-Za-z]?|[A-Za-z]\d+-\d+|[Ss][oố]\s+\d+)(?:\s|[.-]|$)/.test(x))||
  segments.map(x=>x.split(/\s+-\s+(?=\d)/).pop()).find(x=>/^(?:\d+[A-Za-z]?)(?:\s|[.-]|$)/.test(x));
 if(numbered){
  const street=foldCustomerName(numbered)
   .replace(/\b(?:duong|d)\b/g,' ').replace(/\s+/g,' ').trim();
  return 'street:'+street;
 }
 return 'site:'+foldCustomerName(raw);
}
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
  if(!groups.has(key))groups.set(key,{key,name:baseName(key)||name,aliases:new Set(),
   invoices:new Set(),destinations:new Map(),lastDate:''});
  const g=groups.get(key);g.aliases.add(name);
  const no=receiptOf(o.invoiceNo);if(no)g.invoices.add(no);
  const address=addressOf(o.location||o.address);
  if(address){
   const addressKey=physicalAddressKey(address);
   if(!g.destinations.has(addressKey))
    g.destinations.set(addressKey,{address,phones:new Set(),invoiceNos:new Set()});
   const place=g.destinations.get(addressKey),phone=phoneOf(o.phone||o.customerPhone);
   if(phone)place.phones.add(phone);
   if(no)place.invoiceNos.add(no);
  }
  const date=dateOf(o.date||o.createdAt);if(date>g.lastDate)g.lastDate=date;
 }
 return [...groups.values()].map(g=>({
   key:g.key,name:g.name,aliases:[...g.aliases].sort((a,b)=>a.localeCompare(b,'vi')),
   invoiceCount:g.invoices.size,lastDate:g.lastDate,sourceComplete:!!sourceComplete,
   // Summary from the SAME invoice scope as the list. One physical address
   // counts once even across repeat orders and multiple contact numbers.
   deliveryLocationCount:g.destinations.size,
   deliveryLocations:[...g.destinations.values()].map(p=>({
    address:p.address,invoiceCount:p.invoiceNos.size,
    contactCount:p.phones.size
   })).sort((a,b)=>a.address.localeCompare(b.address,'vi'))
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
  const identity=key+'|'+physicalAddressKey(address);
  const no=receiptOf(row.sourceInvoiceNo??row.invoiceNo);
  const ref=verifiedRef(row),date=dateOf(row.lastDate||row.date||row.createdAt);
  let place=found.get(identity);
  if(!place){
   place={id:identity,name,phone:phone||'',address,label:name,
    invoiceNos:[],references:[],sourceRows:[],phones:[],ordersObserved:0,lastDate:date,sourceKinds:[],
    missingContact:false};
   found.set(identity,place);
  }
  if(no&&!place.invoiceNos.includes(no))place.invoiceNos.push(no);
  if(ref&&!place.references.some(x=>String(x.id)===String(ref.id)&&x.invoiceNo===ref.invoiceNo)){
   place.references.push(ref);
   // Keep each source's OWN contact information with its exact record ref.
   // A later phone from another invoice must not be paired with this ref.
   place.sourceRows.push({ref,name,phone,address,date,kind});
  }
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
