/*
 * Minh Satori Account Ordering V2 — PURE pricing/ownership domain.
 * Does not access BotApi, Drive, private agency links or production invoices.
 * AI output is never used as an authoritative price, identity, or permission.
 */
export class DomainError extends Error {
 constructor(code){super(code);this.name='DomainError';this.code=code}
}
const ensure=(condition,code)=>{if(!condition)throw new DomainError(code)};
export const isUuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isSku=value=>typeof value==='string'&&/^TP-[0-9]{5}$/.test(value);
export const isMoney=value=>Number.isSafeInteger(value)&&value>=0&&value<=1_000_000_000;
const bps=value=>Number.isInteger(value)&&value>=0&&value<=10_000;
const string=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
export function validateAddress(input){
 ensure(input&&typeof input==='object'&&!Array.isArray(input),'ADDRESS_REQUIRED');
 ensure(string(input.label,70)&&string(input.recipientName,120)&&string(input.address,400),'ADDRESS_FIELDS_REQUIRED');
 const phone=String(input.recipientPhone||'').replace(/[ ()\-.]/g,'');
 ensure(/^\+?[0-9]{9,15}$/.test(phone),'PHONE_INVALID');
 return {label:input.label.trim(),recipientName:input.recipientName.trim(),recipientPhone:phone,address:input.address.trim()};
}
// Changes to an approved delivery point are owner-only and versioned.
// A previous quote never changes its historical delivery snapshot.
export function validateAdminProfileEdit(input){
 ensure(input&&typeof input==='object'&&!Array.isArray(input),'PROFILE_UPDATE_INVALID');
 ensure(isUuid(input.profileId),'PROFILE_REQUIRED');
 ensure(input.confirmed===true,'OWNER_CONFIRMATION_REQUIRED');
 ensure(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=1&&
  input.expectedRevision<2_147_483_647,'PROFILE_REVISION_REQUIRED');
 ensure(string(input.name,120),'NAME_INVALID');
 const phone=String(input.phone||'').replace(/[ ()\-.]/g,'');
 ensure(!phone||/^\+?[0-9]{9,15}$/.test(phone),'PHONE_INVALID');
 return {profileId:input.profileId,name:input.name.trim(),phone,expectedRevision:input.expectedRevision};
}
export function validateAdminAddressEdit(input){
 ensure(input&&typeof input==='object'&&!Array.isArray(input),'ADDRESS_UPDATE_INVALID');
 ensure(isUuid(input.profileId)&&isUuid(input.addressId),'ADDRESS_ID_REQUIRED');
 ensure(input.confirmed===true,'OWNER_CONFIRMATION_REQUIRED');
 ensure(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=1&&
  input.expectedRevision<2_147_483_647,'ADDRESS_REVISION_REQUIRED');
 ensure(typeof input.active==='boolean','ADDRESS_ACTIVE_REQUIRED');
 return {...validateAddress(input),profileId:input.profileId,addressId:input.addressId,
  active:input.active,expectedRevision:input.expectedRevision};
}
export function normalizeCart(input){
 ensure(Array.isArray(input)&&input.length>0&&input.length<=40,'CART_INVALID');
 const map=new Map();
 for(const entry of input){
  ensure(entry&&isSku(entry.code),'SKU_INVALID');
  ensure(Number.isSafeInteger(entry.qty)&&entry.qty>=1&&entry.qty<=500,'QUANTITY_INVALID');
  map.set(entry.code,(map.get(entry.code)||0)+entry.qty);
 }
 ensure(map.size<=30&&[...map.values()].every(x=>x<=500),'CART_TOO_LARGE');
 ensure([...map.values()].reduce((n,x)=>n+x,0)<=500,'CART_TOO_LARGE');
 return [...map].map(([code,qty])=>({code,qty})).sort((a,b)=>a.code.localeCompare(b.code));
}
export function selectPolicy({profileId,addressId,code,policies=[],at=Date.now()}){
 ensure(isUuid(profileId)&&isUuid(addressId)&&isSku(code),'POLICY_CONTEXT_INVALID');
 const match=policies.filter(p=>{
  if(!p||p.enabled!==true||p.profileId!==profileId)return false;
  if(p.addressId!=null&&p.addressId!==addressId)return false;
  if(p.productCode!=null&&p.productCode!==code)return false;
  if(p.validFrom&&Date.parse(p.validFrom)>at)return false;
  if(p.validUntil&&Date.parse(p.validUntil)<=at)return false;
  return true;
 }).map(p=>({...p,_specificity:Number(p.addressId!=null)*2+Number(p.productCode!=null)}))
 .sort((a,b)=>b._specificity-a._specificity||b.version-a.version);
 if(!match.length)return {discountBps:0,collaboratorBps:null,invoiceMode:'single',version:0,policyId:null};
 const best=match[0];
 ensure(bps(best.discountBps)&&Number.isSafeInteger(best.version)&&best.version>=1,'POLICY_INVALID');
 ensure(best.invoiceMode==='single'||best.invoiceMode==='pair','POLICY_INVALID');
 ensure(best.invoiceMode!=='pair'||bps(best.collaboratorBps),'COLLABORATOR_RATE_REQUIRED');
 const duplicate=match[1];
 if(duplicate&&duplicate._specificity===best._specificity&&duplicate.version===best.version)
  throw new DomainError('POLICY_AMBIGUOUS');
 return {discountBps:best.discountBps,collaboratorBps:best.invoiceMode==='pair'?best.collaboratorBps:null,
  invoiceMode:best.invoiceMode,version:best.version,policyId:best.id||null};
}
function percentPrice(price,discountBps){
 // Per-unit VND rounding. Integer-only multiplication: price <= 1e9.
 return Math.round(price*(10_000-discountBps)/10_000);
}
export function calculateQuote({accountId,profile,address,catalogue,cart,policies=[],catalogueRevision,vatBps=0,
 shippingVnd=0,at=Date.now()}){
 ensure(isUuid(accountId)&&profile&&isUuid(profile.id)&&isUuid(profile.accountId)&&
  profile.accountId===accountId&&['retail','agency','collaborator'].includes(profile.type),'PROFILE_FORBIDDEN');
 ensure(address&&isUuid(address.id)&&address.profileId===profile.id&&address.active===true,'ADDRESS_FORBIDDEN');
 // Snapshot the verified contact at quote creation; later edits cannot mutate
 // what will be signed and recorded as the historical delivery destination.
 const deliveryInput=validateAddress({
  label:address.label,recipientName:address.recipientName,
  recipientPhone:address.recipientPhone,address:address.address
 });
 const delivery=Object.freeze({addressId:address.id,...deliveryInput});
 ensure(Number.isSafeInteger(catalogueRevision)&&catalogueRevision>=1,'CATALOGUE_NOT_AUTHORITATIVE');
 ensure(bps(vatBps)&&isMoney(shippingVnd),'CHARGES_INVALID');
 ensure(Array.isArray(catalogue)&&catalogue.length>0,'CATALOGUE_NOT_READY');
 const products=new Map();
 for(const product of catalogue){
  ensure(product&&isSku(product.code)&&string(product.name,180)&&string(product.unit,40)&&
   isMoney(product.listPrice)&&!products.has(product.code),'CATALOGUE_INVALID');
  products.set(product.code,product);
 }
 const lines=normalizeCart(cart);
 let goods=0,collabGoods=0,pair=false,policyVersion=0;
 const priced=lines.map(line=>{
  const product=products.get(line.code);
  ensure(product&&product.active!==false,'PRODUCT_UNAVAILABLE');
  const policy=selectPolicy({profileId:profile.id,addressId:address.id,code:line.code,policies,at});
  ensure(policy.invoiceMode!=='pair'||profile.type==='collaborator','PAIR_NOT_AUTHORIZED');
  if(pair&&policy.invoiceMode!=='pair')throw new DomainError('MIXED_INVOICE_POLICY');
  if(policy.invoiceMode==='pair'&&pricedModeConflict(lines,policies,profile.id,address.id,at))throw new DomainError('MIXED_INVOICE_POLICY');
  if(policy.invoiceMode==='pair')pair=true;
  const unitPrice=percentPrice(product.listPrice,policy.discountBps);
  const internalUnitPrice=policy.invoiceMode==='pair'?percentPrice(product.listPrice,policy.collaboratorBps):null;
  goods+=unitPrice*line.qty;
  if(internalUnitPrice!=null)collabGoods+=internalUnitPrice*line.qty;
  policyVersion=Math.max(policyVersion,policy.version);
  return {code:line.code,name:product.name,unit:product.unit,qty:line.qty,listPrice:product.listPrice,
    discountBps:policy.discountBps,unitPrice,lineTotal:unitPrice*line.qty,
    policyId:policy.policyId,policyVersion:policy.version,internalUnitPrice};
 });
 ensure(Number.isSafeInteger(goods)&&goods<=100_000_000_000,'ORDER_TOTAL_TOO_LARGE');
 const vatVnd=Math.round(goods*vatBps/10_000),total=goods+shippingVnd+vatVnd;
 ensure(Number.isSafeInteger(total)&&total<=100_000_000_000,'ORDER_TOTAL_TOO_LARGE');
 const summary={currency:'VND',catalogueRevision,policyVersion,addressId:address.id,profileId:profile.id,
  delivery,items:priced,goodsVnd:goods,shippingVnd,vatBps,vatVnd,totalVnd:total,
  invoiceMode:'single'};
 if(pair){
  ensure(collabGoods<=goods,'CTV_DISCOUNT_OUT_OF_RANGE');
  summary.commission={settlementGoodsVnd:collabGoods,commissionVnd:goods-collabGoods,basis:'goods-only',companyProfitVnd:null};
  const internalVatVnd=Math.round(collabGoods*vatBps/10_000);
  summary.internalReference={goodsVnd:collabGoods,vatVnd:internalVatVnd,
    shippingVnd,totalVnd:collabGoods+shippingVnd+internalVatVnd,
    note:'CTV settlement reference only; never double-count revenue; one order = one invoice'};
 }
 return Object.freeze(summary);
}
function pricedModeConflict(lines,policies,profileId,addressId,at){
 return lines.some(l=>selectPolicy({profileId,addressId,code:l.code,policies,at}).invoiceMode!=='pair');
}
