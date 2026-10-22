import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {preflightCheckout} from '../checkout-preflight.mjs';
import {sendApprovedCheckout} from '../satori-checkout-transport.mjs';
const endpoint='https://script.google.com/macros/s/TEST_SANDBOX_CHECKOUT_ENDPOINT_123456789/exec';
const env={
 SATORI_CHECKOUT_ENDPOINT:endpoint,
 SATORI_TEST_CHECKOUT_KEY_ID:'test_client',
 SATORI_TEST_CHECKOUT_SECRET:'SANDBOX_NOT_A_REAL_SECRET_012345678900',
 SATORI_REAL_CHECKOUT_KEY_ID:'real_client',
 SATORI_REAL_CHECKOUT_SECRET:'FAKE_REAL_SECRET_ONLY_FOR_UNIT_TEST_123456',
 SATORI_TEST_CHECKOUT_ENABLED:'1',
 SATORI_REAL_CHECKOUT_ENABLED:'0'
};
const testOrder={expectedRevision:0,requestId:'test-order-draft-001',confirmedSynthetic:true,
 order:{name:'TEST Sample customer',isTest:true,
  items:[{code:'TP-00003',qty:2,unitPrice:98000}],total:196000}};
let networkCalls=0;
function mockedResponse({duplicate=false,action='orders.create.test',ok=true,error}={}){
 return {ok:true,text:async()=>JSON.stringify(ok?
  {ok:true,action,revision:1,data:{order:{invoiceNo:action==='orders.create.test'?'TEST-000001':800},duplicate}}:
  {ok:false,error:{code:error||'AUTH_FAILED'}})};
}
const fetcher=async(url,options)=>{
 networkCalls++;
 assert.equal(url,endpoint);
 assert.equal(options.method,'POST');
 const o=JSON.parse(options.body);
 assert.match(o.nonce,/^[A-Za-z0-9_-]{16,128}$/);
 const secret=o.action==='orders.create.test'?env.SATORI_TEST_CHECKOUT_SECRET:env.SATORI_REAL_CHECKOUT_SECRET;
 const signature=crypto.createHmac('sha256',secret).update([
  o.keyId,o.timestamp,o.nonce,o.action,JSON.stringify(o.payload)].join('\n'),'utf8').digest('hex');
 assert.equal(o.signature,signature,'correct server-only HMAC over exact payload');
 return mockedResponse({action:o.action});
};
const opts={env,fetcher,clock:()=>1792610000000,nonce:()=> 'fake_nonce_1234567890ABCDEFG'};
const receipt=await sendApprovedCheckout({mode:'test',checkout:testOrder,...opts});
assert.equal(receipt.invoiceNo,'TEST-000001');
assert.equal(receipt.action,'orders.create.test');
assert.equal(receipt.confirmedByAuthoritativeLedger,true);
assert.equal(receipt.requestId,testOrder.requestId);
assert.equal(networkCalls,1);
assert.equal(JSON.stringify(receipt).includes('SECRET'),false);
const dedup=await sendApprovedCheckout({mode:'test',checkout:testOrder,...opts,
 fetcher:async()=>{networkCalls++;return mockedResponse({duplicate:true})}});
assert.equal(dedup.duplicate,true,'server dedupe receipt acknowledged');
assert.equal(networkCalls,2,'each explicit call exactly one POST');
const catalog=[{code:'TP-00003',name:'Satori 500 ml',unit:'Thùng',listPrice:98000}];
const customer={verifiedByServer:true,profileId:'trusted_100',approvedMemoryId:'approved_100',
 sourceReference:{id:101,invoiceNo:101},name:'Khách hàng kiểm thử',phone:'0900000000',
 location:'123 Đường Giả Lập, HCM',approvedDiscountPercent:20};
const approved=preflightCheckout({revision:112,requestId:'real-test-001',customer,source:catalog,
 lines:[{code:'TP-00003',qty:2}],expectedTotal:156800,shippingAmount:0,vatRate:0,confirmedByCustomer:true});
const realEnv={...env,SATORI_REAL_CHECKOUT_ENABLED:'1'};
const real=await sendApprovedCheckout({mode:'real',checkout:approved,...opts,env:realEnv});
assert.equal(real.action,'orders.create.ai');
assert.equal(real.invoiceNo,800);
assert.equal(networkCalls,3);
async function error(code,payload){
 let got=null;
 try{await sendApprovedCheckout(payload)}catch(e){got=e.code||e.message}
 assert.equal(got,code,'expected '+code);
}
const failed={mode:'test',checkout:testOrder,...opts,fetcher:async()=>{networkCalls++;throw Error('mock lost response')}};
await error('COMMIT_UNCERTAIN',failed);
assert.equal(networkCalls,4,'never retries a potentially committed invoice by itself');
await error('COMMIT_UNCERTAIN',{mode:'test',checkout:testOrder,...opts,
 fetcher:async()=>{networkCalls++;return mockedResponse({action:'orders.list'})}});
await error('AUTH_FAILED',{mode:'test',checkout:testOrder,...opts,
 fetcher:async()=>{networkCalls++;return mockedResponse({ok:false,error:'AUTH_FAILED'})}});
await error('REVISION_CONFLICT',{mode:'test',checkout:testOrder,...opts,
 fetcher:async()=>{networkCalls++;return mockedResponse({ok:false,error:'REVISION_CONFLICT'})}});
await error('CHECKOUT_DISABLED',{mode:'real',checkout:approved,...opts});
await error('CHECKOUT_NOT_CONFIGURED',{mode:'test',checkout:testOrder,...opts,
 env:{...env,SATORI_TEST_CHECKOUT_SECRET:''}});
await error('TEST_REQUIRED',{mode:'test',checkout:{...testOrder,order:{...testOrder.order,isTest:false}},...opts});
await error('UNVERIFIED_REAL_CHECKOUT',{mode:'real',checkout:{...approved,payload:{...approved.payload,confirmedNewCustomer:true}},
 ...opts,env:realEnv});
await error('TEST_ORDER_REQUIRES_SANDBOX',{mode:'real',
 checkout:{...approved,payload:{...approved.payload,order:{...approved.payload.order,isTest:true}}},...opts,env:realEnv});
await error('INVALID_CHECKOUT_MODE',{mode:'pretend',checkout:testOrder,...opts});
console.log('PASS TEST/real scoped checkout HMAC and uncertain-commit fail-closed checks; all in-memory fake requests');
