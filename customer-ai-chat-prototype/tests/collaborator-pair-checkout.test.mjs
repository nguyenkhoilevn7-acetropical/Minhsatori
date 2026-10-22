import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createCollaboratorPairGateway,readConfiguredPairPolicy,
 sendApprovedPair} from '../collaborator-pair-checkout.mjs';
const policy={collaboratorId:'ctv-01',enabled:true,reviewedByOwner:true,
 policyVersion:'policy_version_001',customerDiscountPercent:20,
 collaboratorDiscountPercent:35,shippingPercent:8,vatPercent:0};
const env={SATORI_CTV_PAIR_ENDPOINT:'https://script.google.com/macros/s/FAKE_API_12345678901234567890/exec',
 SATORI_CTV_PAIR_READ_KEY_ID:'ctv_read_client',
 SATORI_CTV_PAIR_READ_SECRET:'FAKE_LOCAL_HMAC_TEST_0123456789012345678901'};
let listed=0;
const ownerResponse=await readConfiguredPairPolicy('ctv-01',{env,
 now:()=>1792700000000,nonce:()=> 'fake_ctv_nonce_1234567890abcdef',
 fetcher:async(url,req)=>{
  listed++;const body=JSON.parse(req.body);
  assert.equal(body.action,'collaborators.pair.list');
  assert.equal(body.signature,crypto.createHmac('sha256',env.SATORI_CTV_PAIR_READ_SECRET)
   .update([body.keyId,body.timestamp,body.nonce,body.action,
    JSON.stringify(body.payload)].join('\n')).digest('hex'));
  return {ok:true,text:async()=>JSON.stringify({ok:true,action:body.action,
   revision:113,data:{policies:[policy],
    collaborators:[{id:'ctv-01',name:'Synthetic CTV',active:true}]}})};
 }});
assert.equal(ownerResponse.policy.customerDiscountPercent,20);
assert.equal(listed,1);

const source=[{code:'TP-00003',listPrice:98000,name:'Nước Satori 500ml',unit:'Thùng'}];
const customer={verifiedByServer:true,sourceReference:{id:10,invoiceNo:90},
 name:'Synthetic customer',phone:'0900000000',location:'123 Test Road'};
const ctx={revision:113,verifiedByServer:true,ownerVerifiedCollaboratorAssociation:true,
 collaboratorId:'ctv-01',sessionKey:'server_session_1111',customer,source};
let trust=ctx,config=ownerResponse;
const records=new Map();
const store={
 putIfAbsent:async(id,record)=>{if(records.has(id))return false;records.set(id,structuredClone(record));return true},
 get:async id=>structuredClone(records.get(id)||null),
 claim:async(id,from,to)=>{const x=records.get(id);if(x?.status!==from)return false;x.status=to;return true},
 finish:async(id,from,to,data)=>{let x=records.get(id);assert.equal(x.status,from);x.status=to;Object.assign(x,data)}
};
let submits=0;
const gateway=createCollaboratorPairGateway({
 resolveTrusted:async sess=>sess==='OTP_SESSION'?trust:null,
 readPolicy:async()=>config,store,
 newId:()=> '12345678901234567890123456789012',now:()=>1792700000000,
 send:async approved=>{
  submits++;assert.equal(approved.action,'orders.create.pair');
  assert.equal(Object.isFrozen(approved),true);
  assert.equal(approved.payload.collaboratorId,'ctv-01');
  assert.equal(approved.payload.order.items[0].qty,10);
  assert.equal(approved.payload.expectedRevision,113);
  return {confirmedByAuthoritativeLedger:true,duplicate:false,
   customerInvoiceNo:9001,collaboratorInvoiceNo:9002};
 }
});
async function error(code,fn){await assert.rejects(fn,e=>e?.code===code,'expected '+code)}
const quote=await gateway.preview({session:'OTP_SESSION',lines:[{code:'TP-00003',qty:10}]});
assert.equal(quote.total,846720,'20% buyer discount and 8% freight');
assert.equal(JSON.stringify(quote).includes('687960'),false,'CTV net price must stay private');
assert.equal(submits,0,'preview never writes');
await error('CTV_CONFIRMATION_REQUIRED',()=>gateway.confirm({
 session:'OTP_SESSION',quoteId:quote.quoteId}));
const confirmed=await gateway.confirm({session:'OTP_SESSION',quoteId:quote.quoteId,
 confirmedByCustomer:true});
assert.equal(confirmed.customerInvoiceNo,9001);assert.equal(submits,1);
assert.equal(JSON.stringify(confirmed).includes('9002'),false,'never give customer internal bill number');
const again=await gateway.confirm({session:'OTP_SESSION',quoteId:quote.quoteId,
 confirmedByCustomer:true});
assert.equal(again.duplicate,true);assert.equal(submits,1);
assert.equal(JSON.stringify(again).includes('9002'),false,'retry must not expose CTV invoice');

config={...ownerResponse,policy:{...policy,enabled:false}};
await error('CTV_APPROVED_POLICY_REQUIRED',()=>gateway.preview({
 session:'OTP_SESSION',lines:[{code:'TP-00003',qty:1}]}));
config=ownerResponse;trust={...ctx,ownerVerifiedCollaboratorAssociation:false};
await error('CTV_APPROVED_POLICY_REQUIRED',()=>gateway.preview({
 session:'OTP_SESSION',lines:[{code:'TP-00003',qty:1}]}));
trust=ctx;
await error('CTV_PAIR_PREFLIGHT_REQUIRED',()=>sendApprovedPair({
 approved:{action:'orders.create.pair',payload:{}},
 env:{SATORI_CTV_PAIR_LIVE_CHECKOUT_ENABLED:'1'}}));
assert.equal(submits,1);
console.log('PASS HMAC owner-CTV 20/35 policy, server-only linked 2-bill checkout, one commit, customer-only receipt, no automatic replay (ALL FAKE)');
