/**
 * Server-only opt-in CTV checkout gateway (not a public endpoint).
 * One trusted customer order -> two linked invoices in the SINGLE Bot API
 * orders.create.pair commit; backend policy is OFF by default for every CTV.
 * All collaborators are supported; no names/percentages hardcoded.
 *
 * The caller must connect independently OTP-authenticated resolveTrusted(),
 * current owner-approved policy read, and atomic persistent intentStore.
 * No public customer link or Gemini LLM text can select collaborator or rate.
 */
import crypto from 'node:crypto';
import {ownerPairAction} from './owner-collaborator-pairs.mjs';
const fail=code=>{const e=new Error(code);e.code=code;throw e};
const money=(p,q,d)=>Math.round(p*(100-d)/100)*q;
const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{4,100}$/.test(id);
const requestId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(id);
const endpoint=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,180}\/exec$/;
const approvalProof=new WeakSet();
function freezeTree(o){if(o&&typeof o==='object'){Object.values(o).forEach(freezeTree);Object.freeze(o)}return o}
function checks(ctx,answer){
 if(!ctx||ctx.verifiedByServer!==true||ctx.ownerVerifiedCollaboratorAssociation!==true||
    ctx.customer?.verifiedByServer!==true||!safeId(ctx.collaboratorId)||
    !safeId(ctx.sessionKey)||!ctx.customer.sourceReference||
    !Number.isSafeInteger(ctx.revision)||ctx.revision<1||
    !Array.isArray(ctx.source)||ctx.source.length<1||
    !answer||answer.revision!==ctx.revision||answer.source!=='drive-ledger:collaborator-pair-policy'||
    !answer.policy||answer.policy.collaboratorId!==ctx.collaboratorId||
    answer.policy.enabled!==true||answer.policy.reviewedByOwner!==true||
    !safeId(answer.policy.policyVersion)||
    !Number.isSafeInteger(answer.policy.customerDiscountPercent)||
    !Number.isSafeInteger(answer.policy.collaboratorDiscountPercent)||
    answer.policy.customerDiscountPercent<0||
    answer.policy.collaboratorDiscountPercent<=answer.policy.customerDiscountPercent||
    answer.policy.collaboratorDiscountPercent>70||
    !Number.isSafeInteger(answer.policy.shippingPercent)||
    answer.policy.shippingPercent<0||answer.policy.shippingPercent>30||
    ![0,5,8,10].includes(answer.policy.vatPercent))
   fail('CTV_APPROVED_POLICY_REQUIRED');
 const ref=ctx.customer.sourceReference;
 if(ref.id==null||!Number.isSafeInteger(ref.invoiceNo)||ref.invoiceNo<1||
    typeof ctx.customer.name!=='string'||ctx.customer.name.length<2||
    typeof ctx.customer.location!=='string'||ctx.customer.location.length<5||
    typeof ctx.customer.phone!=='string'||ctx.customer.phone.length<8)
   fail('CUSTOMER_NOT_VERIFIED');
 return answer.policy;
}
function quote(lines,ctx,policy){
 if(!Array.isArray(lines)||lines.length<1||lines.length>6)
  fail('CTV_INVALID_BASKET');
 const cat=new Map();
 for(const x of ctx.source){
  if(!x||!/^TP-[0-9]{5}$/.test(x.code||'')||cat.has(x.code)||
   !Number.isSafeInteger(x.listPrice)||x.listPrice<0||x.listPrice>1e9)
   fail('CTV_SOURCE_INVALID');
  cat.set(x.code,x);
 }
 let units=0,customerGoods=0,collaboratorGoods=0;
 const seen=new Set();
 const selected=lines.map(i=>{
  if(!i||!cat.has(i.code)||seen.has(i.code)||!Number.isSafeInteger(i.qty)||i.qty<1||i.qty>500)
   fail('CTV_INVALID_BASKET');
  seen.add(i.code);units+=i.qty;
  const p=cat.get(i.code);
  customerGoods+=money(p.listPrice,i.qty,policy.customerDiscountPercent);
  collaboratorGoods+=money(p.listPrice,i.qty,policy.collaboratorDiscountPercent);
  return {code:i.code,qty:i.qty};
 });
 if(units>500||customerGoods>1e11||collaboratorGoods>1e11)
  fail('CTV_INVALID_BASKET');
 const customerTotal=customerGoods+Math.round(customerGoods*policy.shippingPercent/100)+
    Math.round(customerGoods*policy.vatPercent/100);
 const collaboratorTotal=collaboratorGoods+Math.round(collaboratorGoods*policy.shippingPercent/100)+
    Math.round(collaboratorGoods*policy.vatPercent/100);
 if(!Number.isSafeInteger(customerTotal)||customerTotal>1e11||
    !Number.isSafeInteger(collaboratorTotal)||collaboratorTotal>=customerTotal)
  fail('CTV_PAIR_TOTAL_INVALID');
 return {selected,customerTotal,collaboratorTotal};
}
function uniqueContext(ctx,policy){
 return crypto.createHash('sha256').update(JSON.stringify([
  ctx.sessionKey,ctx.revision,ctx.collaboratorId,
  ctx.customer.sourceReference,ctx.customer.name,ctx.customer.phone,
  ctx.customer.location,policy.policyVersion])).digest('hex');
}
// Only the server with an owner-scoped HMAC read key can retrieve policies.
// The customer never receives a collaborator roster, policy or settlement price.
export async function readConfiguredPairPolicy(collaboratorId,options={}){
 if(!safeId(collaboratorId))fail('CTV_ID_INVALID');
 const response=await ownerPairAction('collaborators.pair.list',{},options);
 const entries=response.policies.filter(x=>x?.collaboratorId===collaboratorId);
 const partners=Array.isArray(response.collaborators)?
  response.collaborators.filter(x=>x?.id===collaboratorId&&x.active===true):[];
 if(entries.length!==1||partners.length!==1||entries[0].enabled!==true||
    entries[0].reviewedByOwner!==true)fail('CTV_PAIR_NOT_ENABLED');
 return {revision:response.revision,source:'drive-ledger:collaborator-pair-policy',
   policy:structuredClone(entries[0])};
}
export function createCollaboratorPairGateway({resolveTrusted,readPolicy,store,
 send=(approved)=>sendApprovedPair({approved}),now=Date.now,newId=()=>crypto.randomBytes(18).toString('hex')}={}){
 if(typeof resolveTrusted!=='function'||typeof readPolicy!=='function'||
    typeof send!=='function'||!store||
    !['putIfAbsent','get','claim','finish'].every(k=>typeof store[k]==='function'))
  fail('CTV_PERSISTENT_BACKEND_REQUIRED');
 const load=async session=>{
  const ctx=await resolveTrusted(session),policyResult=await readPolicy(ctx?.collaboratorId);
  return {ctx,policy:checks(ctx,policyResult)};
 };
 async function preview({session,lines,deliveryNote=''}={}){
  const {ctx,policy}=await load(session);
  if(typeof deliveryNote!=='string'||deliveryNote.length>300)
   fail('CTV_DELIVERY_NOTE_INVALID');
  const computed=quote(lines,ctx,policy),id='ctv_'+newId();
  if(!requestId(id))fail('CTV_REQUEST_ID_INVALID');
  const record={id,requestId:id,sessionKey:ctx.sessionKey,
   contextHash:uniqueContext(ctx,policy),revision:ctx.revision,
   collaboratorId:ctx.collaboratorId,expectedPolicyVersion:policy.policyVersion,
   lines:computed.selected,deliveryNote,customerTotal:computed.customerTotal,
   collaboratorTotal:computed.collaboratorTotal,expiresAt:now()+600000,status:'pending'};
  if(await store.putIfAbsent(id,record)!==true)fail('CTV_REQUEST_ID_COLLISION');
  // Browser receives only customer-facing price, never CTV internal settlement.
  return freezeTree({quoteId:id,expectedRevision:ctx.revision,total:computed.customerTotal,
   itemCount:computed.selected.length,expiresAt:record.expiresAt,
   requiresExplicitConfirmation:true,paired:true});
 }
 async function confirm({session,quoteId,confirmedByCustomer=false}={}){
  if(!requestId(quoteId)||confirmedByCustomer!==true)fail('CTV_CONFIRMATION_REQUIRED');
  const record=await store.get(quoteId);
  if(!record)fail('CTV_QUOTE_NOT_FOUND');
  // A leaked quoteId cannot act as an authentication token for an invoice.
  // Revalidate the independent customer session even for successful replays.
  const viewingContext=await resolveTrusted(session);
  if(!viewingContext||viewingContext.verifiedByServer!==true||
   viewingContext.customer?.verifiedByServer!==true||
   viewingContext.sessionKey!==record.sessionKey||
   viewingContext.collaboratorId!==record.collaboratorId)
   fail('CUSTOMER_NOT_VERIFIED');
  if(record.status==='confirmed')return freezeTree({customerInvoiceNo:record.result.customerInvoiceNo,confirmedByAuthoritativeLedger:true,duplicate:true});
  if(record.status!=='pending')fail('CTV_COMMIT_UNCERTAIN_RECONCILE');
  if(record.expiresAt<=now())fail('CTV_QUOTE_EXPIRED');
  const {ctx,policy}=await load(session);
  const computed=quote(record.lines,ctx,policy);
  if(ctx.sessionKey!==record.sessionKey||ctx.collaboratorId!==record.collaboratorId||
   uniqueContext(ctx,policy)!==record.contextHash||ctx.revision!==record.revision||
   policy.policyVersion!==record.expectedPolicyVersion||
   record.customerTotal!==computed.customerTotal||
   record.collaboratorTotal!==computed.collaboratorTotal)
   fail('CTV_QUOTE_STALE');
  const source=ctx.customer.sourceReference;
  const payload={
   requestId:record.requestId,expectedRevision:ctx.revision,
   collaboratorId:ctx.collaboratorId,expectedPolicyVersion:policy.policyVersion,
   confirmedNewCustomer:false,customerRef:{id:source.id,invoiceNo:source.invoiceNo},
   order:{name:ctx.customer.name,phone:ctx.customer.phone,location:ctx.customer.location,
    items:record.lines,deliveryNote:record.deliveryNote}
  };
  const signed=freezeTree({action:'orders.create.pair',payload});
  approvalProof.add(signed);
  if(await store.claim(quoteId,'pending','sending')!==true)
   fail('CTV_COMMIT_UNCERTAIN_RECONCILE');
  let result;
  try{result=await send(signed)}
  catch(e){
   await store.finish(quoteId,'sending','uncertain',{});
   fail('CTV_COMMIT_UNCERTAIN_RECONCILE');
  }
  if(!result?.confirmedByAuthoritativeLedger||!result.customerInvoiceNo||
     !result.collaboratorInvoiceNo){
   await store.finish(quoteId,'sending','uncertain',{});
   fail('CTV_COMMIT_UNCERTAIN_RECONCILE');
  }
  await store.finish(quoteId,'sending','confirmed',{result});
  // Never expose settlement invoice number or CTV pricing to public customer.
  return freezeTree({customerInvoiceNo:result.customerInvoiceNo,
   confirmedByAuthoritativeLedger:true,duplicate:result.duplicate===true});
 }
 return Object.freeze({preview,confirm});
}
export async function sendApprovedPair({approved,env=process.env,fetcher=fetch,
 now=Date.now,nonce=()=>crypto.randomBytes(18).toString('hex')}={}){
 // Caller must pass exact in-process immutable preflight, not a browser JSON.
 if(!approved||!approvalProof.has(approved)||approved.action!=='orders.create.pair')
  fail('CTV_PAIR_PREFLIGHT_REQUIRED');
 if(env.SATORI_CTV_PAIR_LIVE_CHECKOUT_ENABLED!=='1')fail('CTV_PAIR_LIVE_DISABLED');
 const url=String(env.SATORI_CTV_PAIR_ENDPOINT||''),keyId=String(env.SATORI_CTV_PAIR_WRITE_KEY_ID||''),
       secret=String(env.SATORI_CTV_PAIR_WRITE_SECRET||'');
 if(!endpoint.test(url)||!/^[A-Za-z0-9_-]{3,64}$/.test(keyId)||secret.length<32)
  fail('CTV_PAIR_WRITE_NOT_CONFIGURED');
 const timestamp=now(),n=nonce(),action=approved.action,payload=approved.payload;
 if(!Number.isSafeInteger(timestamp)||!/^[A-Za-z0-9_-]{16,128}$/.test(n))fail('CTV_PAIR_NONCE_INVALID');
 const signature=crypto.createHmac('sha256',secret).update([keyId,timestamp,n,action,
  JSON.stringify(payload)].join('\n'),'utf8').digest('hex');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const res=await fetcher(url,{method:'POST',signal:controller.signal,redirect:'follow',
   headers:{'content-type':'application/json'},body:JSON.stringify({
    keyId,timestamp,nonce:n,action,payload,signature})});
  if(!res?.ok)fail('CTV_PAIR_COMMIT_UNCERTAIN');
  const txt=await res.text();
  if(txt.length>30000)fail('CTV_PAIR_COMMIT_UNCERTAIN');
  const data=JSON.parse(txt);
  if(!data?.ok||data.action!==action||!data.data?.customerInvoice?.invoiceNo||
      !data.data?.collaboratorInvoice?.invoiceNo)
   fail('CTV_PAIR_COMMIT_UNCERTAIN');
  return freezeTree({confirmedByAuthoritativeLedger:true,
   duplicate:data.data.duplicate===true,customerInvoiceNo:data.data.customerInvoice.invoiceNo,
   collaboratorInvoiceNo:data.data.collaboratorInvoice.invoiceNo,revision:data.revision});
 }catch{
  fail('CTV_PAIR_COMMIT_UNCERTAIN');
 }finally{clearTimeout(timer)}
}
