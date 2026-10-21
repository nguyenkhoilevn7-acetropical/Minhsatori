/**
 * Offline production-order preflight. NEVER calls Apps Script or sends money.
 * Caller MUST provide a server-verified customer profile, an authoritative
 * versioned Drive catalogue, and a signed confirmation workflow. Browser
 * request fields cannot assert "verified" or choose the customer's discount.
 * Result is a staged Bot API payload, NOT a committed customer order.
 */
const fail=code=>{const e=new Error(code);e.code=code;throw e};
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const sku=/^TP-[0-9]{5}$/;
export function preflightCheckout({revision,requestId,customer,source,lines,
 expectedTotal,shippingAmount=0,vatRate,confirmedByCustomer=false}){
 if(!confirmedByCustomer)fail('CONFIRMATION_REQUIRED');
 if(!int(revision,1,1e9))fail('SOURCE_REVISION_REQUIRED');
 if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))fail('INVALID_REQUEST_ID');
 if(!customer||customer.verifiedByServer!==true||!customer.profileId||
    !customer.sourceReference||customer.sourceReference.id==null||
    typeof customer.approvedMemoryId!=='string'||
    !/^[a-zA-Z0-9_-]{4,100}$/.test(customer.approvedMemoryId)||
    !int(customer.sourceReference.invoiceNo,1,1e9)||
    typeof customer.name!=='string'||customer.name.trim().length<2||
    typeof customer.location!=='string'||customer.location.trim().length<5||
    typeof customer.phone!=='string'||!/^[0-9+() .-]{8,30}$/.test(customer.phone))
   fail('CUSTOMER_NOT_VERIFIED');
 if(!int(customer.approvedDiscountPercent,0,70))fail('CUSTOMER_DISCOUNT_UNVERIFIED');
 if(![0,5,8,10].includes(vatRate))fail('VAT_POLICY_REQUIRED');
 if(!int(shippingAmount,0,1000000))fail('INVALID_SHIPPING');
 if(!Array.isArray(source)||!source.length||source.length>200)fail('SOURCE_CATALOGUE_REQUIRED');
 if(!Array.isArray(lines)||lines.length<1||lines.length>6)fail('ITEM_COUNT_INVALID');
 const catalogue=new Map();
 for(const p of source){
  if(!p||!sku.test(p.code||'')||catalogue.has(p.code)||!int(Number(p.listPrice),0,1000000000))
   fail('SOURCE_CATALOGUE_INVALID');
  catalogue.set(p.code,p);
 }
 let totalUnits=0,goodsTotal=0;const seen=new Set();
 const items=lines.map(line=>{
  if(!line||!sku.test(line.code||'')||seen.has(line.code)||!int(line.qty,1,500))
   fail('INVALID_LINE');
  seen.add(line.code);totalUnits+=line.qty;
  const p=catalogue.get(line.code);
  if(!p||!p.name||!p.unit)fail('UNKNOWN_SOURCE_PRODUCT');
  // Customer discount is supplied exclusively by the trusted identity service.
  const unitPrice=Math.round(Number(p.listPrice)*(100-customer.approvedDiscountPercent)/100);
  if(!int(unitPrice,0,1000000000))fail('INVALID_PRICE');
  goodsTotal+=unitPrice*line.qty;
  return {code:p.code,product:p.name,unit:p.unit,qty:line.qty,
   listPrice:Number(p.listPrice),unitPrice};
 });
 if(totalUnits>500||!int(goodsTotal,0,100000000000))fail('BASKET_TOO_LARGE');
 const vatAmount=Math.round(goodsTotal*vatRate/100);
 const total=goodsTotal+shippingAmount+vatAmount;
 if(!int(total,0,100000000000)||total!==expectedTotal)fail('QUOTE_STALE_OR_MISMATCH');
 return Object.freeze({
  action:'orders.create.ai',
  payload:{
   requestId,expectedRevision:revision,customerMemoryId:customer.approvedMemoryId,
   confirmedNewCustomer:false,
   customerRef:{id:customer.sourceReference.id,invoiceNo:customer.sourceReference.invoiceNo},
   order:{name:customer.name,phone:customer.phone,location:customer.location,
     items,shippingAmount,vatAmount,total,
     deliveryNote:String(customer.deliveryNote||'').slice(0,1000)}
  },
  preview:{itemCount:items.length,totalUnits,goodsTotal,shippingAmount,vatAmount,total,
   sourceRevision:revision}
 });
}
