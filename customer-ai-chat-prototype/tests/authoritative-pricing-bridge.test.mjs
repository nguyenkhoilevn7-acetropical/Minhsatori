import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fetchOwnerApprovedPrice,makeProductionCustomerResolver} from '../authoritative-pricing-bridge.mjs';
import {createRealInvoiceCoordinator} from '../real-invoice-coordinator.mjs';
import {isPreflightCheckoutResult} from '../checkout-preflight.mjs';

const url='https://script.google.com/macros/s/FAKE_ENDPOINT_1234567890abcdefghij/exec';
const secret='FAKE_ONLY_LOCAL_UNIT_TEST_0123456789_LONG_SECRET';
const env={SATORI_CHECKOUT_ENDPOINT:url,SATORI_REAL_CHECKOUT_KEY_ID:'gemini_server',
 SATORI_REAL_CHECKOUT_SECRET:secret};
const request={customerMemoryId:'memory001',
 customerRef:{id:91234,invoiceNo:799}};
const policy={ok:true,action:'pricing.eligibility',revision:113,data:{
 revision:113,source:'drive-ledger:owner-approved-pricing',
 verifiedByServer:true,pricingApprovedByOwner:true,customerLoginVerified:false,
 customerMemoryId:'memory001',profile:{name:'Synthetic Test Customer',
  phone:'0900000000',location:'123 Fake Street',
  approvedDiscountPercent:45,vatRate:0,shippingAmount:0,
  sourceReference:{id:91234,invoiceNo:799}}
}};
let upstream=policy,requests=0;
const fetcher=async(gotUrl,options)=>{
 requests++;
 assert.equal(gotUrl,url);
 const body=JSON.parse(options.body);
 assert.equal(body.action,'pricing.eligibility');
 assert.deepEqual(body.payload,request);
 assert.equal(body.keyId,'gemini_server');
 assert.equal(body.signature,crypto.createHmac('sha256',secret).update([
  body.keyId,body.timestamp,body.nonce,body.action,
  JSON.stringify(body.payload)].join('\n'),'utf8').digest('hex'));
 return {ok:true,text:async()=>JSON.stringify(upstream)};
};
const opts={...request,env,fetcher,now:()=>1792700000000,
 nonce:()=> 'fake_nonce_1234567890abcdef'};
let approved=await fetchOwnerApprovedPrice(opts);
assert.equal(approved.revision,113);
assert.equal(approved.approvedDiscountPercent,45);
assert.equal(approved.name,'Synthetic Test Customer');
assert.equal(Object.isFrozen(approved),true);
async function error(code,fn){
 await assert.rejects(fn,e=>e?.code===code,'expected '+code);
}
upstream={...policy,data:{...policy.data,customerLoginVerified:true}};
await error('OWNER_PRICING_NOT_APPROVED',()=>fetchOwnerApprovedPrice(opts));
upstream={...policy,data:{...policy.data,customerMemoryId:'different'}};
await error('OWNER_PRICING_RESPONSE_INVALID',()=>fetchOwnerApprovedPrice(opts));
upstream=policy;
await error('APPROVED_PRICING_KEY_NOT_CONFIGURED',()=>fetchOwnerApprovedPrice({...opts,
 env:{...env,SATORI_REAL_CHECKOUT_SECRET:''}}));
await error('INVALID_ELIGIBILITY_QUERY',()=>fetchOwnerApprovedPrice({...opts,
 customerRef:{id:91234,invoiceNo:0}}));
const catalogue={revision:113,data:{source:'drive-ledger:satori_catalogue_v15',
 products:[{code:'TP-00003',name:'Satori 500 ml',
  unit:'Thùng',listPrice:98000}]}};
let authorized=true,revision=113;
const authenticateSession=async handle=>
 authorized&&handle==='otp-ok'?
  {active:true,assurance:'otp',sessionKey:'approvedsession001',
   customerMemoryId:'memory001',customerRef:request.customerRef}:null;
const resolveTrusted=makeProductionCustomerResolver({authenticateSession,
 fetchPricing:async()=>approved,
 readCatalogue:async()=>({...catalogue,revision})});
await error('CUSTOMER_AUTHENTICATION_REQUIRED',()=>resolveTrusted({verifiedByServer:true,
 active:true,customerMemoryId:'memory001'}));
await error('CUSTOMER_AUTHENTICATION_REQUIRED',()=>resolveTrusted('demo-a'));
let ctx=await resolveTrusted('otp-ok');
assert.equal(ctx.verifiedByServer,true);
assert.equal(ctx.customer.approvedDiscountPercent,45);
revision=114;
await error('PRICE_OR_CATALOGUE_STALE',()=>resolveTrusted('otp-ok'));
revision=113;
const store=new Map(),tx={
 putIfAbsent:async(id,row)=>{if(store.has(id))return false;store.set(id,{...row});return true},
 get:async(id)=>store.get(id)?structuredClone(store.get(id)):null,
 claim:async(id,from,to)=>{let x=store.get(id);if(x?.status!==from)return false;x.status=to;return true},
 finish:async(id,from,to,fields)=>{let x=store.get(id);assert.equal(x.status,from);x.status=to;Object.assign(x,fields)}
};
let sends=0;
const coordinator=createRealInvoiceCoordinator({
 resolveTrusted,intentStore:tx,now:()=>1792700000000,newId:()=> 'a'.repeat(32),
 send:async({mode,checkout})=>{
  sends++;assert.equal(mode,'real');assert.equal(isPreflightCheckoutResult(checkout),true);
  assert.equal(checkout.payload.order.items[0].unitPrice,53900);
  return {invoiceNo:900,revision:114,confirmedByAuthoritativeLedger:true,
   requestId:checkout.payload.requestId};
 }
});
const quote=await coordinator.preview({session:'otp-ok',lines:[{code:'TP-00003',qty:10}]});
assert.equal(quote.total,539000);
assert.equal(sends,0);
authorized=false;
await error('CUSTOMER_AUTHENTICATION_REQUIRED',()=>coordinator.confirm({session:'otp-ok',
 quoteId:quote.quoteId,confirmedByCustomer:true}));
authorized=true;
const result=await coordinator.confirm({session:'otp-ok',
 quoteId:quote.quoteId,confirmedByCustomer:true});
assert.equal(result.invoiceNo,900);assert.equal(sends,1);
assert.equal((await coordinator.confirm({session:'otp-ok',
 quoteId:quote.quoteId,confirmedByCustomer:true})).duplicate,true);
assert.equal(sends,1);
console.log('PASS owner-approved HMAC pricing + real OTP resolver + current catalogue + one signed Gemini invoice + safe dedupe (ALL FAKE, zero network)');
