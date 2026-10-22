/**
 * Minh Satori — owner-only candidate builder from previously read invoices.
 * Pure function. No production writes, no link/token creation, no Gemini calls,
 * no logging, no persistence. All monetary policy remains pending owner review.
 */
const fold=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/\s+/g,' ').trim();
const digits=s=>String(s??'').replace(/\D/g,'');
const amount=n=>Number.isFinite(Number(n))&&Number(n)>=0?Number(n):0;
const usableRate=n=>{
 if(n===null||n===undefined||n==='')return null;
 const v=Number(n);
 return Number.isFinite(v)&&v>=0&&v<=70?Math.round(v*100)/100:null;
};
function priceEvidence(line,invoice){
 const explicit=usableRate(line?.discountPercent??line?.discount??invoice?.discountPercent);
 if(explicit!==null)return {rate:explicit,source:'explicit'};
 const listed=Number(line?.listPrice),charged=Number(line?.unitPrice);
 if(Number.isFinite(listed)&&listed>0&&Number.isFinite(charged)&&charged>=0&&charged<=listed){
  const derived=usableRate((1-charged/listed)*100);
  if(derived!==null)return {rate:derived,source:'derived'};
 }
 return null;
}
function dateValue(o){
 const s=String(o?.date||'');
 const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
 return m?m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'):s;
}
export function customerReviewCandidates(invoices,{complete=true}={}){
 if(!Array.isArray(invoices)||invoices.length>2400)throw Error('INVALID_REVIEW_SOURCE');
 const grouped=new Map(),seen=new Set();
 for(const order of invoices){
  if(!order||typeof order!=='object'||['Đã hủy','Không Tính'].includes(order.status))continue;
  const name=String(order.name||'').trim().slice(0,120);
  const phone=String(order.phone||'').trim().slice(0,30);
  const address=String(order.location||'').trim().slice(0,300);
  if(name.length<2||address.length<5)continue;
  const id=String(order.id??''),no=String(order.invoiceNo??'');
  const invoiceKey=id&&no?id+'|'+no:no?'no:'+no:null;
  if(invoiceKey&&seen.has(invoiceKey))continue;
  if(invoiceKey)seen.add(invoiceKey);
  // Same name with different phone => independent people, never silently merge.
  // A missing phone is also isolated per address.
  const phoneKey=digits(phone).slice(-10);
  const key=fold(name)+'|'+(phoneKey.length>=9?phoneKey:'unknown:'+fold(address));
  let g=grouped.get(key);
  if(!g){
   g={name,phone,address,invoiceCount:0,historyTotal:0,lastDate:'',
      sourceInvoiceNos:[],locationMap:new Map(),rateEvidence:[],rateBySku:new Map()};
   grouped.set(key,g);
  }
  g.invoiceCount++;
  g.historyTotal+=amount(order.total);
  if(no&&g.sourceInvoiceNos.length<25)g.sourceInvoiceNos.push(no);
  const dt=dateValue(order);
  if(dt>=g.lastDate){g.lastDate=dt;g.name=name;g.phone=phone;g.address=address;}
  const locKey=fold(address);
  if(!g.locationMap.has(locKey))g.locationMap.set(locKey,{address,phone,name,invoiceCount:0});
  g.locationMap.get(locKey).invoiceCount++;
  const lines=Array.isArray(order.items)?order.items:[];
  for(const line of lines){
   if(!line||typeof line!=='object')continue;
   const ev=priceEvidence(line,order);
   if(!ev)continue;
   const sku=String(line.code||line.product||line.name||'unknown').trim().slice(0,100);
   g.rateEvidence.push({...ev,sku,invoiceNo:no});
   if(!g.rateBySku.has(sku))g.rateBySku.set(sku,new Set());
   g.rateBySku.get(sku).add(ev.rate);
  }
 }
 return [...grouped.values()].map(g=>{
  const rates=[...new Set(g.rateEvidence.map(e=>e.rate))];
  const explicit=g.rateEvidence.filter(e=>e.source==='explicit');
  const consistent=rates.length===1;
  // Suggest only a consistent rate with explicit evidence. Derived estimates
  // may be shown as evidence but never silently prefilled as authorized prices.
  const suggestedRate=consistent&&explicit.length>0?rates[0]:null;
  const flags=[];
  if(!complete)flags.push('INCOMPLETE_SOURCE');
  if(digits(g.phone).length<9)flags.push('PHONE_MISSING');
  if(g.locationMap.size>1)flags.push('MULTIPLE_ADDRESSES');
  if(!g.rateEvidence.length)flags.push('DISCOUNT_NOT_FOUND');
  else if(!consistent)flags.push('DISCOUNT_CONFLICT');
  else if(!explicit.length)flags.push('DISCOUNT_DERIVED_ONLY');
  return {
   name:g.name,phone:g.phone,address:g.address,
   locations:[...g.locationMap.values()],
   invoiceCount:g.invoiceCount,historyTotal:Math.round(g.historyTotal),
   lastDate:g.lastDate,sourceInvoiceNos:g.sourceInvoiceNos,
   suggestedDiscountPercent:suggestedRate,
   discountEvidence:g.rateEvidence.slice(0,30),
   pricePolicies:[...g.rateBySku.entries()].map(([sku,values])=>({sku,rates:[...values]})),
   reviewFlags:flags,status:'pending_owner_review',linkCreated:false
  };
 }).sort((a,b)=>b.invoiceCount-a.invoiceCount||b.lastDate.localeCompare(a.lastDate));
}
