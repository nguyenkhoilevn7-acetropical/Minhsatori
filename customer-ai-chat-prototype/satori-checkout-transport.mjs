/**
 * Server-only, opt-in HMAC transport from validated Gemini checkout to Bot API.
 *
 * NEVER expose this module's credentials to browsers or APKs. There is no
 * automatic retry after an uncertain POST; reconcile the same requestId first.
 * This transport is not imported by the live server until customer identity,
 * canonical pricing and TEST ledger E2E have all been verified.
 */
import crypto from 'node:crypto';
import {isPreflightCheckoutResult} from './checkout-preflight.mjs';

const endpointPattern=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,180}\/exec$/;
const allowedErrors=new Set(['REVISION_CONFLICT','REQUEST_ID_CONFLICT','REUSED_REQUEST_ID',
 'FORBIDDEN','AUTH_FAILED','AI_PRICING_NOT_APPROVED','AI_PRICE_MISMATCH',
 'TEST_LEDGER_NOT_CONFIGURED','TEST_ORDER_REQUIRES_SANDBOX','INVALID_STATE',
 'TOTAL_MISMATCH','ORDER_CHANGED','PROFILE_CONFIRMATION_REQUIRED']);
function failure(code){
 const e=new Error(code);e.code=code;return e;
}
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(value);

function getConfig(mode,env){
 if(!['test','real'].includes(mode))throw failure('INVALID_CHECKOUT_MODE');
 const enabled=mode==='test'?env.SATORI_TEST_CHECKOUT_ENABLED:env.SATORI_REAL_CHECKOUT_ENABLED;
 if(enabled!=='1')throw failure('CHECKOUT_DISABLED');
 const endpoint=String(env.SATORI_CHECKOUT_ENDPOINT||'').trim();
 const keyId=String((mode==='test'?env.SATORI_TEST_CHECKOUT_KEY_ID:env.SATORI_REAL_CHECKOUT_KEY_ID)||'');
 const secret=String((mode==='test'?env.SATORI_TEST_CHECKOUT_SECRET:env.SATORI_REAL_CHECKOUT_SECRET)||'');
 if(!endpointPattern.test(endpoint)||!/^[A-Za-z0-9_-]{3,64}$/.test(keyId)||secret.length<32)
  throw failure('CHECKOUT_NOT_CONFIGURED');
 return {endpoint,keyId,secret};
}
function validatePayload(mode,checkout){
 if(!checkout||typeof checkout!=='object'||Array.isArray(checkout))throw failure('INVALID_CHECKOUT');
 const payload=mode==='test'?checkout:checkout.payload;
 const action=mode==='test'?'orders.create.test':'orders.create.ai';
 if(mode==='real'&&checkout.action!=='orders.create.ai')throw failure('INVALID_CHECKOUT_ACTION');
 // Never accept an object reconstructed from browser JSON as permission to
 // sign a real invoice. It must be the exact immutable server preflight result.
 if(mode==='real'&&!isPreflightCheckoutResult(checkout))throw failure('PREFLIGHT_REQUIRED');
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||
    !Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<0||
    !safeId(payload.requestId)||!payload.order||typeof payload.order!=='object')
  throw failure('INVALID_CHECKOUT_PAYLOAD');
 if(mode==='test'){
  if(!payload.confirmedSynthetic||payload.order.isTest!==true)
   throw failure('TEST_REQUIRED');
 }else{
  if(payload.expectedRevision<1||!payload.customerMemoryId||
      !payload.customerRef||payload.confirmedNewCustomer!==false)
   throw failure('UNVERIFIED_REAL_CHECKOUT');
  if(payload.order.isTest===true||payload.order.testMode===true||
    ['test','sandbox'].includes(String(payload.order.environment||'').toLowerCase()))
   throw failure('TEST_ORDER_REQUIRES_SANDBOX');
 }
 return {action,payload};
}

/**
 * The caller must supply output of preflightCheckout() from server-owned
 * profile and Drive catalogue, NOT direct untrusted browser JSON.
 */
export async function sendApprovedCheckout({mode,checkout,env=process.env,
 fetcher=fetch,clock=Date.now,nonce=()=>crypto.randomBytes(18).toString('hex')}={}){
 const {endpoint,keyId,secret}=getConfig(mode,env);
 const {action,payload}=validatePayload(mode,checkout);
 const timestamp=clock(),nonceValue=nonce();
 if(!Number.isSafeInteger(timestamp)||!/^[A-Za-z0-9_-]{16,128}$/.test(nonceValue))
  throw failure('INVALID_SIGNED_REQUEST');
 const canonical=[keyId,timestamp,nonceValue,action,JSON.stringify(payload)].join('\n');
 const signature=crypto.createHmac('sha256',secret).update(canonical,'utf8').digest('hex');
 const body={keyId,timestamp,nonce:nonceValue,action,payload,signature};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 let response;
 try{
  response=await fetcher(endpoint,{
   method:'POST',headers:{'content-type':'application/json'},
   signal:controller.signal,redirect:'follow',body:JSON.stringify(body)
  });
 }catch{
  // A lost response can mean the server already committed. Never create a
  // new requestId or automatically send again.
  throw failure('COMMIT_UNCERTAIN');
 }finally{clearTimeout(timer)}
 if(!response?.ok)throw failure('COMMIT_UNCERTAIN');
 let parsed;
 try{
  const text=await response.text();
  if(text.length>200000)throw failure('RESPONSE_TOO_LARGE');
  parsed=JSON.parse(text);
 }catch{throw failure('COMMIT_UNCERTAIN')}
 if(!parsed?.ok){
  const code=String(parsed?.error?.code||'');
  throw failure(allowedErrors.has(code)?code:'UPSTREAM_REJECTED');
 }
 if(parsed.action!==action||!parsed.data?.order||!parsed.data.order.invoiceNo)
  throw failure('COMMIT_UNCERTAIN');
 return Object.freeze({
  action,requestId:payload.requestId,invoiceNo:parsed.data.order.invoiceNo,
  duplicate:parsed.data.duplicate===true,revision:parsed.revision,
  confirmedByAuthoritativeLedger:true
 });
}
