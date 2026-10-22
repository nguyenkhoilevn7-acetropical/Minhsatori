/**
 * Internal-only Gemini production eligibility bridge.
 *
 * The identity verifier must be a real independent OTP/OAuth provider.
 * A sandbox bearer link or browser-submitted verifiedByServer flag is NOT proof.
 * Bot API policies come from Apps Script's HMAC protected pricing.eligibility
 * and catalogue.list. Never expose the signed credentials to web/Android.
 *
 * No production endpoint imports this module until the real OTP provider,
 * durable quote store and dedicated Bot credentials are provisioned.
 */
import crypto from 'node:crypto';
const refuse=code=>{const e=new Error(code);e.code=code;throw e};
const endpoint=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,180}\/exec$/;
const memoryId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{4,100}$/.test(v);
const refOk=v=>v&&(['number','string'].includes(typeof v.id))&&String(v.id).length>0
 &&Number.isSafeInteger(v.invoiceNo)&&v.invoiceNo>0;
const contextCheck=(v)=>v&&v.ok===true&&v.action==='pricing.eligibility'&&
 Number.isSafeInteger(v.revision)&&v.revision>0&&
 v.data?.verifiedByServer===true&&v.data?.pricingApprovedByOwner===true&&
 v.data?.customerLoginVerified===false&&
 v.data?.source==='drive-ledger:owner-approved-pricing'&&
 v.revision===v.data.revision;
function safeConfig(env){
 const url=String(env.SATORI_CHECKOUT_ENDPOINT||'').trim();
 const keyId=String(env.SATORI_REAL_CHECKOUT_KEY_ID||'').trim();
 const secret=String(env.SATORI_REAL_CHECKOUT_SECRET||'');
 if(!endpoint.test(url)||!/^[A-Za-z0-9_-]{3,64}$/.test(keyId)||secret.length<32)
  refuse('APPROVED_PRICING_KEY_NOT_CONFIGURED');
 return {url,keyId,secret};
}
export async function fetchOwnerApprovedPrice({customerMemoryId,customerRef,
 env=process.env,fetcher=fetch,now=Date.now,nonce=()=>crypto.randomBytes(18).toString('hex')}={}){
 if(!memoryId(customerMemoryId)||!refOk(customerRef))
  refuse('INVALID_ELIGIBILITY_QUERY');
 const {url,keyId,secret}=safeConfig(env);
 const timestamp=now(),n=nonce(),action='pricing.eligibility';
 if(!Number.isSafeInteger(timestamp)||!/^[a-zA-Z0-9_-]{16,128}$/.test(n))
  refuse('INVALID_HMAC_NONCE');
 const payload={customerMemoryId,customerRef:{id:customerRef.id,invoiceNo:customerRef.invoiceNo}};
 const signature=crypto.createHmac('sha256',secret)
  .update([keyId,timestamp,n,action,JSON.stringify(payload)].join('\n'),'utf8').digest('hex');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{
  const result=await fetcher(url,{method:'POST',redirect:'follow',
   headers:{'content-type':'application/json'},
   signal:controller.signal,body:JSON.stringify({keyId,timestamp,nonce:n,action,payload,signature})});
  if(!result?.ok)refuse('OWNER_PRICING_UNAVAILABLE');
  const raw=await result.text();
  if(raw.length>15000)refuse('OWNER_PRICING_RESPONSE_INVALID');
  let verified;
  try{verified=JSON.parse(raw)}catch{refuse('OWNER_PRICING_RESPONSE_INVALID')}
  if(!contextCheck(verified))refuse('OWNER_PRICING_NOT_APPROVED');
  const data=verified.data,p=data.profile;
  if(data.customerMemoryId!==customerMemoryId||!refOk(p?.sourceReference)||
     String(p.sourceReference.id)!==String(customerRef.id)||
     p.sourceReference.invoiceNo!==customerRef.invoiceNo||
     !Number.isSafeInteger(p.approvedDiscountPercent)||p.approvedDiscountPercent<0||
     p.approvedDiscountPercent>70||![0,5,8,10].includes(p.vatRate)||
     !Number.isSafeInteger(p.shippingAmount)||p.shippingAmount<0||
     p.shippingAmount>1000000||typeof p.name!=='string'||p.name.length<2||
     typeof p.phone!=='string'||p.phone.length<8||
     typeof p.location!=='string'||p.location.length<5)
   refuse('OWNER_PRICING_RESPONSE_INVALID');
  return Object.freeze({revision:verified.revision,
   approvedMemoryId:customerMemoryId,
   name:p.name,phone:p.phone,location:p.location,
   sourceReference:Object.freeze({...p.sourceReference}),
   approvedDiscountPercent:p.approvedDiscountPercent,
   vatRate:p.vatRate,shippingAmount:p.shippingAmount});
 }catch(e){
  if(e?.code)throw e;
  refuse('OWNER_PRICING_UNAVAILABLE');
 }finally{clearTimeout(timer)}
}

export function makeProductionCustomerResolver({authenticateSession,fetchPricing,readCatalogue}={}){
 if(typeof authenticateSession!=='function'||
    typeof fetchPricing!=='function'||typeof readCatalogue!=='function')
  refuse('PRODUCTION_AUTH_BACKEND_REQUIRED');
 return async function resolveTrusted(opaqueSession){
  // This MUST be a session checked by the independent OTP/OAuth backend.
  // Never take a client-submitted JSON identity or SANDBOX link at face value.
  const identity=await authenticateSession(opaqueSession);
  if(!identity||identity.active!==true||
   !['otp','oauth_mfa'].includes(identity.assurance)||
   !memoryId(identity.customerMemoryId)||!refOk(identity.customerRef)||
   !memoryId(identity.sessionKey))
   refuse('CUSTOMER_AUTHENTICATION_REQUIRED');
  const [p,cat]=await Promise.all([
   fetchPricing({customerMemoryId:identity.customerMemoryId,customerRef:identity.customerRef}),
   readCatalogue()
  ]);
  if(!Number.isSafeInteger(p?.revision)||p.revision<1||
   !Number.isSafeInteger(cat?.revision)||cat.revision!==p.revision||
   cat.data?.source!=='drive-ledger:satori_catalogue_v15'||
   !Array.isArray(cat.data?.products)||cat.data.products.length<1||
   p.approvedMemoryId!==identity.customerMemoryId||
   String(p.sourceReference?.id)!==String(identity.customerRef.id)||
   p.sourceReference?.invoiceNo!==identity.customerRef.invoiceNo)
   refuse('PRICE_OR_CATALOGUE_STALE');
  return Object.freeze({
   sessionKey:identity.sessionKey,revision:p.revision,
   verifiedByServer:true,pricingApprovedByOwner:true,
   source:cat.data.products,vatRate:p.vatRate,shippingAmount:p.shippingAmount,
   customer:Object.freeze({verifiedByServer:true,profileId:identity.customerMemoryId,
    approvedMemoryId:p.approvedMemoryId,
    sourceReference:p.sourceReference,name:p.name,phone:p.phone,location:p.location,
    approvedDiscountPercent:p.approvedDiscountPercent})
  });
 };
}
