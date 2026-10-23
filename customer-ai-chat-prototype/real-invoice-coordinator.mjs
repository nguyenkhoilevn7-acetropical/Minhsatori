/**
 * Gemini real-invoice coordinator. SOURCE-ONLY; NOT connected to public routes.
 *
 * All four collaborators must be injected from authenticated SERVER services:
 * - resolveTrusted(session) independently validates the customer and approved policy
 *   against the owner's authoritative backend (never accepts browser "verified" flags).
 * - intentStore is a DURABLE, atomic store shared across instances/devices.
 * - send is the server-only, scoped-HMAC Bot API transport.
 *
 * Explicitly at-most-one POST per intent. An uncertain response freezes the intent
 * pending owner-side reconciliation. No automatic retry can create a second invoice.
 */
import crypto from 'node:crypto';
import {preflightCheckout} from './checkout-preflight.mjs';
import {sendApprovedCheckout} from './satori-checkout-transport.mjs';

const reject=(code)=>{const e=new Error(code);e.code=code;throw e};
const clean=v=>typeof v==='string'?v.trim():'';
const safeId=v=>/^[A-Za-z0-9_-]{8,100}$/.test(v||'');
const qtyOk=n=>Number.isSafeInteger(n)&&n>=1&&n<=500;
const expiresInMs=10*60_000;
const canonical = value=>JSON.stringify(value);
const fingerprint=(value)=>crypto.createHash('sha256').update(canonical(value)).digest('hex');

function trusted(raw){
 if(!raw||raw.verifiedByServer!==true||raw.pricingApprovedByOwner!==true||
    !safeId(raw.sessionKey)||!raw.customer||!Number.isSafeInteger(raw.revision)||raw.revision<1||
    !Array.isArray(raw.source)||!raw.source.length||
    ![0,5,8,10].includes(raw.vatRate)||!Number.isSafeInteger(raw.shippingAmount)||
    raw.shippingAmount<0||raw.shippingAmount>1_000_000)
  reject('TRUSTED_CONTEXT_UNAVAILABLE');
 if(raw.customer.verifiedByServer!==true)reject('CUSTOMER_UNVERIFIED');
 return raw;
}
function basket(lines,ctx){
 if(!Array.isArray(lines)||!lines.length||lines.length>6)reject('INVALID_CART');
 const sourceByCode=new Map(ctx.source.map(p=>[p.code,p]));
 if(sourceByCode.size!==ctx.source.length)reject('CATALOGUE_DUPLICATE');
 const seen=new Set();
 let units=0,total=0;
 for(const line of lines){
  if(!line||typeof line.code!=='string'||seen.has(line.code)||!qtyOk(line.qty))
    reject('INVALID_CART');
  const item=sourceByCode.get(line.code);
  if(!item||!Number.isSafeInteger(item.listPrice)||item.listPrice<0||
     item.listPrice>1_000_000_000)reject('CATALOGUE_CHANGED');
  seen.add(line.code);units+=line.qty;
  total+=Math.round(item.listPrice*(100-ctx.customer.approvedDiscountPercent)/100)*line.qty;
 }
 if(units>500||total>100_000_000_000)reject('INVALID_CART');
 const vatAmount=Math.round(total*ctx.vatRate/100);
 return {goodsTotal:total,vatAmount,shippingAmount:ctx.shippingAmount,
   total:total+vatAmount+ctx.shippingAmount,units};
}
function contextIdentity(ctx){
 // No secrets or customer addresses are returned to a browser.
 return fingerprint({
  sessionKey:ctx.sessionKey,profileId:ctx.customer.profileId,
  memoryId:ctx.customer.approvedMemoryId,
  customerRef:ctx.customer.sourceReference,
  name:ctx.customer.name,phone:ctx.customer.phone,location:ctx.customer.location,
  discount:ctx.customer.approvedDiscountPercent,
  vatRate:ctx.vatRate,shipping:ctx.shippingAmount
 });
}
export function createRealInvoiceCoordinator({
 resolveTrusted, intentStore, send=sendApprovedCheckout,
 now=Date.now, newId=()=>crypto.randomBytes(18).toString('hex')
}={}){
 if(typeof resolveTrusted!=='function'||!intentStore||
  !['putIfAbsent','get','claim','finish'].every(k=>typeof intentStore[k]==='function')||
  typeof send!=='function')reject('DURABLE_BACKEND_REQUIRED');

 async function preview({session,lines,deliveryNote=''}={}){
  // session is an opaque, authenticated server session handle, not a URL bearer
  // from the old SANDBOX customer links.
  const ctx=trusted(await resolveTrusted(session));
  if(typeof deliveryNote!=='string'||deliveryNote.length>300)reject('INVALID_DELIVERY_NOTE');
  const price=basket(lines,ctx);
  const id='ai_'+newId();
  if(!safeId(id))reject('INVALID_GENERATED_ID');
  const quote={
    quoteId:id,requestId:id,sessionKey:ctx.sessionKey,
    contextHash:contextIdentity(ctx),revision:ctx.revision,
    lines:structuredClone(lines),deliveryNote,
    total:price.total,expiresAt:now()+expiresInMs,status:'pending'
  };
  // Validate with exact Bot API preflight math, but never expose this signed
  // capability. User confirmation happens in confirm(), not in preview().
  preflightCheckout({revision:ctx.revision,requestId:id,customer:{...ctx.customer,deliveryNote},
   source:ctx.source,lines:quote.lines,expectedTotal:price.total,
   shippingAmount:ctx.shippingAmount,vatRate:ctx.vatRate,
   confirmedByCustomer:true});
  if(await intentStore.putIfAbsent(id,quote)!==true)reject('INTENT_ID_COLLISION');
  return Object.freeze({quoteId:id,revision:ctx.revision,items:lines.map(x=>({code:x.code,qty:x.qty})),
   goodsTotal:price.goodsTotal,shippingAmount:price.shippingAmount,vatAmount:price.vatAmount,
   total:price.total,expiresAt:quote.expiresAt,requiresExplicitConfirmation:true});
 }

 async function confirm({session,quoteId,confirmedByCustomer=false}={}){
  if(!safeId(quoteId)||confirmedByCustomer!==true)reject('CONFIRMATION_REQUIRED');
  const item=await intentStore.get(quoteId);
  if(!item)reject('QUOTE_NOT_FOUND');
  // Quote IDs are not authentication tokens. Revalidate the server-side owner/
  // customer session BEFORE returning a confirmed receipt, not just on first send.
  const ctx=trusted(await resolveTrusted(session));
  if(ctx.sessionKey!==item.sessionKey||contextIdentity(ctx)!==item.contextHash)
   reject('CUSTOMER_OR_PRICE_CHANGED');
  // Already confirmed quotes are not resent to the Bot API, and uncertain
  // quotes are frozen until an authorised reconciliation using the SAME id.
  if(item.status==='confirmed')return Object.freeze({...item.receipt,duplicate:true});
  if(item.status!=='pending')reject('COMMIT_UNCERTAIN_RECONCILE');
  if(item.expiresAt<=now())reject('QUOTE_EXPIRED');
  if(ctx.revision!==item.revision)reject('QUOTE_STALE');
  const price=basket(item.lines,ctx);
  if(price.total!==item.total)reject('QUOTE_STALE');
  const checkout=preflightCheckout({
   revision:ctx.revision,requestId:item.requestId,
   customer:{...ctx.customer,deliveryNote:item.deliveryNote},
   source:ctx.source,lines:item.lines,expectedTotal:item.total,
   shippingAmount:ctx.shippingAmount,vatRate:ctx.vatRate,
   confirmedByCustomer:true
  });
  // claim() must be atomic across processes. From this point NO automatic
  // retries, even after HTTP timeout, worker crash or a dropped response.
  if(await intentStore.claim(quoteId,'pending','sending')!==true)
   reject('COMMIT_UNCERTAIN_RECONCILE');
  let receipt;
  try{receipt=await send({mode:'real',checkout});}
  catch(e){
   await intentStore.finish(quoteId,'sending','uncertain',{errorCode:'REQUIRES_RECONCILIATION'});
   throw e?.code==='COMMIT_UNCERTAIN'?e:reject('COMMIT_UNCERTAIN_RECONCILE');
  }
  if(!receipt?.confirmedByAuthoritativeLedger||!receipt.invoiceNo)
   reject('COMMIT_UNCERTAIN_RECONCILE');
  await intentStore.finish(quoteId,'sending','confirmed',{receipt});
  return Object.freeze(receipt);
 }
 return Object.freeze({preview,confirm});
}
