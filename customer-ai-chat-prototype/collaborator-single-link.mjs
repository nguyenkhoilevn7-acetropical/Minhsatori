/**
 * One owner-approved invitation per collaborator, with many approved delivery
 * destinations. A single order commits TWO linked invoices atomically via the
 * authoritative Bot API (customer + collaborator settlement).
 *
 * Customer-only presentations MUST be generated from customerInvoiceForShare.
 * The internal bill is returned exclusively to the authenticated CTV portal.
 */
import crypto from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{code})};
const idRx=/^[A-Za-z0-9_-]{4,100}$/;
const codeRx=/^TP-[0-9]{5}$/;
const text=v=>String(v??'').trim();
const digits=v=>text(v).replace(/\D/g,'');
const hmac=(key,purpose,value)=>crypto.createHmac('sha256',key).update(purpose+'\0'+value).digest('hex');
const equal=(a,b)=>{const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)};
const integer=(v,min=0,max=1e11)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const money=(sum,percent)=>Math.round(sum*(100-percent)/100);
const vatAndShipping=(goods,policy)=>({
 shipping:Math.round(goods*policy.shippingPercent/100),
 vat:Math.round(goods*policy.vatPercent/100)
});
const authorizedRefs=p=>Array.isArray(p.authorizedDestinations)?p.authorizedDestinations:[];
export const customerInvoiceForShare=x=>{
 if(x?.pairRole!=='customer'||!integer(x.invoiceNo,1)||!integer(x.total))fail('CUSTOMER_INVOICE_REQUIRED');
 // Deliberately remove internal CTV identifiers, the paired invoice number,
 // private percentage, profit and settlement fields before any share/export.
 return {invoiceNo:x.invoiceNo,date:x.date||'',name:x.name,phone:x.phone||'',
  location:x.location,items:Array.isArray(x.items)?x.items.map(i=>({
   product:i.product,code:i.code,unit:i.unit,qty:i.qty,unitPrice:i.unitPrice,
   subtotal:i.subtotal})):[],
  total:x.total,shippingAmount:x.shippingAmount||0,vatAmount:x.vatAmount||0,
  deliveryNote:x.deliveryNote||'',deliveryDate:x.deliveryDate||null,
  status:x.status||'Chưa thanh toán'};
};
export function createCollaboratorSingleLink({
 env=process.env,policyList,invoiceSource,createPair,invoiceLookup,
 now=Date.now,random=crypto.randomBytes,
 origin='https://minh-satori-customer-ai-gemini.onrender.com'
}={}){
 if(![policyList,invoiceSource,createPair,invoiceLookup].every(x=>typeof x==='function'))
  fail('CTV_DEPENDENCIES_MISSING');
 function secret(){
  const raw=text(env.GEMINI_CTV_LINK_SECRET);
  if(env.GEMINI_COLLABORATOR_SINGLE_LINKS_ENABLED!=='1'||
     env.SATORI_CTV_PAIR_ORDER_ENABLED!=='1'||
     !/^[A-Za-z0-9_-]{3,64}$/.test(text(env.SATORI_CTV_PAIR_WRITE_KEY_ID))||
     text(env.SATORI_CTV_PAIR_WRITE_SECRET).length<32||
     env.GEMINI_SANDBOX_EMERGENCY_DEMO_ONLY==='1'||raw.length<32)
   fail('CTV_LINKS_NOT_READY');
  return crypto.createHash('sha256').update('MINH-SATORI-CTV-ONE-LINK-V1\0'+raw).digest();
 }
 function readiness(){
  try{secret();return {enabled:true,oneLinkPerCollaborator:true,invoicePairWriteConfigured:true}}
  catch(e){return {enabled:false,reason:e.code||'CTV_DISABLED'}}
 }
 async function current(id){
  if(!idRx.test(id))fail('CTV_INVALID_ID');
  const state=await policyList();
  if(!integer(state?.revision,1)||!Array.isArray(state?.collaborators)||!Array.isArray(state?.policies))
   fail('CTV_LEDGER_UNAVAILABLE');
  const people=state.collaborators.filter(p=>p.id===id&&p.active===true);
  const rules=state.policies.filter(p=>p.collaboratorId===id&&p.enabled===true&&p.reviewedByOwner===true);
  if(people.length!==1||rules.length!==1)fail('CTV_NOT_ACTIVE');
  const policy=rules[0],places=authorizedRefs(policy);
  if(!text(policy.linkEpoch)||!text(policy.policyVersion)||
     !integer(policy.customerDiscountPercent,0,70)||
     !integer(policy.collaboratorDiscountPercent,0,70)||
     policy.collaboratorDiscountPercent<=policy.customerDiscountPercent||
     !integer(policy.shippingPercent,0,30)||![0,5,8,10].includes(policy.vatPercent)||
     places.length<1||places.length>20)fail('CTV_POLICY_INCOMPLETE');
  if(places.some(p=>p?.id==null||!integer(p.invoiceNo,1)||
     !text(p.name)||!text(p.location)||digits(p.phone).length<8))
   fail('CTV_LOCATION_INVALID');
  return {revision:state.revision,person:people[0],policy,places};
 }
 function tokenFor(id,epoch){
  const k=secret(),body=Buffer.from(id).toString('base64url');
  return {token:body+'.'+hmac(k,'link',id+'|'+epoch),
   pin:hmac(k,'pin',id+'|'+epoch).slice(0,32)};
 }
 async function authenticate({token,accessCode}){
  if(typeof token!=='string'||token.length>400||typeof accessCode!=='string'||
     accessCode.length!==32)fail('CTV_ACCESS_DENIED');
  const a=token.split('.');
  if(a.length!==2||!/^[A-Za-z0-9_-]+$/.test(a[0])||!/^[a-f0-9]{64}$/.test(a[1]))
   fail('CTV_ACCESS_DENIED');
  let id;
  try{id=Buffer.from(a[0],'base64url').toString('utf8')}catch{fail('CTV_ACCESS_DENIED')}
  if(!idRx.test(id))fail('CTV_ACCESS_DENIED');
  const data=await current(id),credential=tokenFor(id,data.policy.linkEpoch);
  if(!equal(token,credential.token)||!equal(accessCode,credential.pin))
   fail('CTV_ACCESS_DENIED');
  return {id,...data};
 }
 async function issue({collaboratorId}={}){
  const data=await current(String(collaboratorId||'')),credential=tokenFor(collaboratorId,data.policy.linkEpoch);
  return {production:true,collaboratorId,oneLink:true,
   url:origin.replace(/\/$/,'')+'/ctv/#'+credential.token,
   accessCode:credential.pin,deliveryLocations:data.places.length,
   customerDiscountPercent:data.policy.customerDiscountPercent,
   collaboratorDiscountPercent:data.policy.collaboratorDiscountPercent,
   message:'Chỉ cấp link và mã truy cập cho đúng CTV; không gửi mã cho khách nhận hàng.'};
 }
 function placeFor(data,ref){
  if(ref==null||ref.id==null||!integer(ref.invoiceNo,1))fail('CTV_LOCATION_REQUIRED');
  const matches=data.places.filter(x=>String(x.id)===String(ref.id)&&x.invoiceNo===ref.invoiceNo);
  if(matches.length!==1)fail('CTV_LOCATION_NOT_APPROVED');
  return matches[0];
 }
 async function verifiedSource(place){
  const src=await invoiceSource(place.invoiceNo);
  if(String(src.customer.id)!==String(place.id)||
    src.customer.name!==place.name||
    digits(src.customer.phone)!==digits(place.phone)||
    src.customer.location!==place.location)fail('CTV_LOCATION_SOURCE_CHANGED');
  return src;
 }
 async function catalogue(input){
  const data=await authenticate(input);
  const src=await verifiedSource(data.places[0]);
  return {production:true,collaborator:{id:data.id,name:data.person.name},
   customerDiscountPercent:data.policy.customerDiscountPercent,
   destinations:data.places.map(p=>({id:p.id,invoiceNo:p.invoiceNo,name:p.name,phone:p.phone,location:p.location})),
   products:[...src.products.values()].map(p=>({
    code:p.code,name:p.name,unit:p.unit,listPrice:p.listPrice,
    customerUnitPrice:money(p.listPrice,data.policy.customerDiscountPercent)}))};
 }
 function basket(policy,products,requested){
  if(!Array.isArray(requested)||requested.length<1||requested.length>6)fail('CTV_BASKET_INVALID');
  const seen=new Set(),items=[];let customerGoods=0,partnerGoods=0,count=0;
  for(const line of requested){
   if(!line||!codeRx.test(line.code)||seen.has(line.code)||!integer(line.qty,1,500))
    fail('CTV_BASKET_INVALID');
   seen.add(line.code);count+=line.qty;
   const p=products.get(line.code);
   if(!p||!integer(p.listPrice)||!p.name||!p.unit)fail('CTV_CATALOGUE_INVALID');
   items.push({code:p.code,product:p.name,unit:p.unit,qty:line.qty});
   customerGoods+=money(p.listPrice,policy.customerDiscountPercent)*line.qty;
   partnerGoods+=money(p.listPrice,policy.collaboratorDiscountPercent)*line.qty;
  }
  if(count>500||!integer(customerGoods)||!integer(partnerGoods)||partnerGoods>=customerGoods)
   fail('CTV_BASKET_INVALID');
  const customerExtra=vatAndShipping(customerGoods,policy);
  const partnerExtra=vatAndShipping(partnerGoods,policy);
  return {items,customerGoods,partnerGoods,
   customerTotal:customerGoods+customerExtra.shipping+customerExtra.vat,
   collaboratorTotal:partnerGoods+partnerExtra.shipping+partnerExtra.vat,
   commission:customerGoods-partnerGoods};
 }
 function seal(payload){
  const iv=random(12),enc=crypto.createCipheriv('aes-256-gcm',secret(),iv);
  enc.setAAD(Buffer.from('CTV-ORDER-QUOTE-V1'));
  const body=Buffer.concat([enc.update(JSON.stringify(payload)),enc.final()]);
  return [iv,enc.getAuthTag(),body].map(x=>x.toString('base64url')).join('.');
 }
 function unseal(value){
  if(typeof value!=='string'||value.length>8000)fail('CTV_QUOTE_INVALID');
  try{
   const parts=value.split('.');if(parts.length!==3)throw Error('PARSE');
   const iv=Buffer.from(parts[0],'base64url'),tag=Buffer.from(parts[1],'base64url');
   if(iv.length!==12||tag.length!==16)throw Error('FORMAT');
   const dec=crypto.createDecipheriv('aes-256-gcm',secret(),iv);
   dec.setAAD(Buffer.from('CTV-ORDER-QUOTE-V1'));dec.setAuthTag(tag);
   return JSON.parse(Buffer.concat([dec.update(Buffer.from(parts[2],'base64url')),dec.final()]).toString());
  }catch{fail('CTV_QUOTE_INVALID')}
 }
 async function quote(input){
  const data=await authenticate(input);
  const place=placeFor(data,input.destination),src=await verifiedSource(place);
  const note=text(input.deliveryNote);
  if(note.length>300||/[\u0000-\u001f\u007f]/.test(note))fail('CTV_NOTE_INVALID');
  const price=basket(data.policy,src.products,input.items);
  const q={type:'ctv-quote',id:data.id,policyVersion:data.policy.policyVersion,
   sourceRevision:src.revision,ref:{id:place.id,invoiceNo:place.invoiceNo},
   requestId:'ctv_order_'+random(18).toString('hex'),issuedAt:now(),expiresAt:now()+600000,
   items:price.items,note,prices:price};
  return {production:true,customer:{name:place.name,phone:place.phone,location:place.location},
   ...price,quoteToken:seal(q),expiresAt:new Date(q.expiresAt).toISOString(),
   confirmationRequired:true};
 }
 async function confirm(input){
  const data=await authenticate(input);
  if(input.confirmation!=='CTV_CONFIRMS_BOTH_REAL_INVOICES')fail('CTV_CONFIRMATION_REQUIRED');
  const q=unseal(input.quoteToken);
  if(q?.type!=='ctv-quote'||q.id!==data.id||
     !integer(q.expiresAt,1)||q.expiresAt<=now()||q.expiresAt>now()+600000||
     !/^ctv_order_[a-f0-9]{36}$/.test(q.requestId||'')||
     q.policyVersion!==data.policy.policyVersion)fail('CTV_QUOTE_STALE');
  const place=placeFor(data,q.ref),src=await verifiedSource(place);
  if(src.revision!==q.sourceRevision)fail('CTV_QUOTE_STALE');
  const priced=basket(data.policy,src.products,q.items);
  if(JSON.stringify(priced)!==JSON.stringify(q.prices))fail('CTV_QUOTE_STALE');
  let response;
  try{
   response=await createPair({
    requestId:q.requestId,expectedRevision:src.revision,
    collaboratorId:data.id,expectedPolicyVersion:data.policy.policyVersion,
    customerRef:{id:place.id,invoiceNo:place.invoiceNo},
    confirmedNewCustomer:false,
    order:{name:place.name,phone:place.phone,location:place.location,
     items:priced.items,deliveryNote:q.note}
   });
  }catch{fail('CTV_COMMIT_UNCERTAIN_CHECK_LEDGER')}
  const customer=response?.customerInvoice,partner=response?.collaboratorInvoice;
  if(customer?.pairRole!=='customer'||partner?.pairRole!=='collaborator'||
     customer.collaboratorId!==data.id||partner.collaboratorId!==data.id||
     !customer.pairGroupId||customer.pairGroupId!==partner.pairGroupId||
     customer.total!==priced.customerTotal||partner.total!==priced.collaboratorTotal)
   fail('CTV_COMMIT_UNCERTAIN_CHECK_LEDGER');
  return {production:true,realPairSaved:true,
   customerInvoice:customerInvoiceForShare(customer),
   // CTV settlement details are available ONLY under authenticated CTV PIN.
   collaboratorInvoice:{invoiceNo:partner.invoiceNo,name:data.person.name,
    total:partner.total,role:'collaborator',discountPercent:data.policy.collaboratorDiscountPercent},
   commission:priced.commission,pairSaved:true,
   message:'Hai hóa đơn đã ghi cùng một cặp vào sổ Drive, bản nội bộ chỉ dành cho CTV.'};
 }
 async function invoiceForPdf(input,role){
  const data=await authenticate(input);
  if(!integer(input.invoiceNo,1)||!['customer','collaborator'].includes(role))
   fail('CTV_INVOICE_INVALID');
  const rows=await invoiceLookup(input.invoiceNo);
  const found=rows.filter(o=>o.invoiceNo===input.invoiceNo&&o.pairRole===role&&o.collaboratorId===data.id);
  if(found.length!==1)fail('CTV_INVOICE_FORBIDDEN');
  const inv=found[0];
  if(role==='customer')return customerInvoiceForShare(inv);
  // The private settlement PDF is released only after collaborator PIN auth.
  return {invoiceNo:inv.invoiceNo,date:inv.date,name:data.person.name,
   phone:inv.phone,location:inv.location,items:inv.items,
   total:inv.total,shippingAmount:inv.shippingAmount,vatAmount:inv.vatAmount,
   deliveryNote:inv.deliveryNote,status:inv.status};
 }
 return Object.freeze({readiness,issue,authenticate,catalogue,quote,confirm,invoiceForPdf});
}
