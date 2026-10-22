/**
 * Owner-only preview of two price documents for ONE collaborator delivery.
 * No invoice is written here. A genuine pair requires a future atomic
 * server-side Bot API action; NEVER issue two ordinary orders.create.ai calls.
 *
 * The policy is a trusted, specifically owner-approved server record;
 * neither the browser nor conversational AI chooses rates or partner.
 */
const fail=code=>{const e=new Error(code);e.code=code;throw e};
const validInt=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{4,100}$/.test(v);
const money=n=>validInt(n,0,1e11);
export function previewCollaboratorPair({policy,customer,source,lines,vatRate,shippingAmount=0,
 ownerSessionVerified=false}={}){
 if(ownerSessionVerified!==true)fail('COLLABORATOR_OWNER_SESSION_REQUIRED');
 if(!customer?.verifiedByServer||!id(customer.profileId)||
    !id(customer.approvedMemoryId)||customer.profileId!==policy?.approvedProfileId||
    customer.approvedMemoryId!==policy?.approvedMemoryId||
    !customer.sourceReference||String(customer.sourceReference.id)!==String(policy?.sourceOrderId)||
    customer.sourceReference.invoiceNo!==policy?.sourceInvoiceNo)
  fail('COLLABORATOR_CUSTOMER_BINDING_REQUIRED');
 if(policy?.source!=='server:owner-approved-collaborator-pair'||
    policy?.reviewedByOwner!==true||policy?.enabled!==true||
    !id(policy.collaboratorId)||!id(policy.approvalId)||
    policy.customerDiscountPercent!==20||policy.collaboratorDiscountPercent!==35||
    !validInt(policy.rulesVersion,1,1000000))
  fail('COLLABORATOR_PAIR_APPROVAL_REQUIRED');
 if(![0,5,8,10].includes(vatRate)||!validInt(shippingAmount,0,1000000))
  fail('COLLABORATOR_FEES_NOT_APPROVED');
 if(!Array.isArray(source)||source.length===0||source.length>200||
    !Array.isArray(lines)||lines.length<1||lines.length>6)
  fail('COLLABORATOR_INVALID_BASKET');
 const catalogue=new Map();
 for(const p of source){
  if(!p||!/^TP-[0-9]{5}$/.test(p.code||'')||catalogue.has(p.code)||
     !validInt(p.listPrice,0,1000000000)||typeof p.name!=='string'||
     !p.name.trim()||typeof p.unit!=='string'||!p.unit.trim())
   fail('COLLABORATOR_CATALOGUE_INVALID');
  catalogue.set(p.code,p);
 }
 const seen=new Set();let count=0,customerGoods=0,collaboratorGoods=0;
 const priceLines=lines.map(x=>{
  if(!x||seen.has(x.code)||!validInt(x.qty,1,500)||!catalogue.has(x.code))
   fail('COLLABORATOR_INVALID_BASKET');
  seen.add(x.code);count+=x.qty;
  const product=catalogue.get(x.code);
  const priceCustomer=Math.round(product.listPrice*0.80);
  const priceCollaborator=Math.round(product.listPrice*0.65);
  customerGoods+=priceCustomer*x.qty;
  collaboratorGoods+=priceCollaborator*x.qty;
  return {code:product.code,product:product.name,unit:product.unit,qty:x.qty,
   listPrice:product.listPrice,customerUnitPrice:priceCustomer,
   collaboratorUnitPrice:priceCollaborator};
 });
 if(count>500||!money(customerGoods)||!money(collaboratorGoods))
  fail('COLLABORATOR_INVALID_BASKET');
 function bill(goodsTotal,discountPercent){
  const vatAmount=Math.round(goodsTotal*vatRate/100);
  const total=goodsTotal+vatAmount+shippingAmount;
  if(!money(total))fail('COLLABORATOR_TOTAL_INVALID');
  return {discountPercent,goodsTotal,vatAmount,shippingAmount,total};
 }
 const customerBill=bill(customerGoods,20);
 const collaboratorBill=bill(collaboratorGoods,35);
 if(collaboratorBill.total>customerBill.total)
  fail('COLLABORATOR_PRICE_INVERSION');
 return freeze({kind:'collaborator_pair_preview',approvalId:policy.approvalId,
  rulesVersion:policy.rulesVersion,collaboratorId:policy.collaboratorId,
  physicalOrderCount:1,deliveryQuantity:count,priceViewCount:2,
  customerBill,collaboratorBill,priceDifference:customerBill.total-collaboratorBill.total,
  products:priceLines,requiresAtomicPairCommit:true,
  realWritesEnabled:false});
}
