import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {createOwnerRealInvoice} from '../owner-live-invoice.mjs';
const endpoint='https://script.google.com/macros/s/FAKE_12345678901234567890123456789012/exec';
const keyId='owner_trial_writer',secret='FAKE_HMAC_SIGNING_012345678901234567890123456789';
const env={GEMINI_OWNER_ONLY_REAL_PILOT:'1',GEMINI_SANDBOX_EMERGENCY_DEMO_ONLY:'0',
 SATORI_OWNER_CHECKOUT_ENDPOINT:endpoint,SATORI_OWNER_CHECKOUT_KEY_ID:keyId,
 SATORI_OWNER_CHECKOUT_SECRET:secret,CUSTOMER_LINKS_ADMIN_TOKEN:'FAKE_ADMIN_SECRET_01234567890123456789012',
 SATORI_READ_KEY_ID:'readonly_key'};
const customer={id:99901,invoiceNo:5920,name:'Khách giả TEST',phone:'0900000000',
 location:'123 Đường thử nghiệm, HCM',total:50000,items:[]};
const catalogue={revision:113,source:'drive-ledger:satori_catalogue_v15',
 products:[{code:'TP-00003',name:'Nước Satori 500ml',unit:'Thùng',listPrice:98000}]};
let revision=113,postCount=0,createCount=0,lastWrite=null,networkUncertain=false;
const fetcher=async(url,options)=>{
 assert.equal(url,endpoint);
 postCount++;
 const body=JSON.parse(options.body);
 assert.equal(body.keyId,keyId);
 assert.equal(body.signature,crypto.createHmac('sha256',secret).update([
  body.keyId,body.timestamp,body.nonce,body.action,
  JSON.stringify(body.payload)].join('\n')).digest('hex'));
 if(body.action==='system.status')return {ok:true,text:async()=>JSON.stringify({
  ok:true,action:body.action,revision,data:{revision,orders:115}})};
 if(body.action==='catalogue.list')return {ok:true,text:async()=>JSON.stringify({
  ok:true,action:body.action,revision,data:{...catalogue,revision}})};
 if(body.action==='orders.list'){
  const probing=body.payload.query==='GEMINI_OWNER_PROBE_NO_MATCH_20261023';
  if(!probing)assert.equal(body.payload.query,'5920');
  return {ok:true,text:async()=>JSON.stringify({ok:true,action:body.action,
    revision,data:{revision,totalMatches:probing?0:1,orders:probing?[]:[customer]}})};
 }
 if(body.action==='orders.create'){
  createCount++;lastWrite=body.payload;
  if(networkUncertain)throw Error('fake timeout');
  assert.equal(body.payload.expectedRevision,113);
  assert.equal(body.payload.confirmedNewCustomer,false);
  assert.deepEqual(body.payload.customerRef,{id:99901,invoiceNo:5920});
  assert.equal(body.payload.order.items[0].unitPrice,78400);
  assert.equal(body.payload.order.items[0].qty,10);
  assert.equal(body.payload.order.total,846720);
  assert.equal(body.payload.order.deliveryNote,'giao sớm giúp anh');
  revision=114;
  return {ok:true,text:async()=>JSON.stringify({
   ok:true,action:body.action,revision,
   data:{duplicate:false,order:{name:customer.name,phone:customer.phone,
    location:customer.location,total:846720,invoiceNo:5921}}})};
 }
 throw Error('unrecognized fake action '+body.action);
};
let nextQuoteId=0;
const engine=createOwnerRealInvoice({env,fetcher,now:()=>1792700000000,
 newId:()=>String(++nextQuoteId).padStart(32,'0')});
assert.equal(engine.readiness().enabled,true);
const probe=await engine.probeWriter();
assert.equal(probe.verified,true);
assert.equal(probe.invoiceCount,115);
assert.equal(probe.catalogueProducts,1);
// Existing server-side bot credential names may already be provisioned.
// Never allow the separate read-only identity to act as the writer.
const reused={...env,SATORI_OWNER_CHECKOUT_ENDPOINT:'',
 SATORI_OWNER_CHECKOUT_KEY_ID:'',SATORI_OWNER_CHECKOUT_SECRET:'',
 SATORI_BOT_API_URL:endpoint,SATORI_BOT_KEY_ID:keyId,SATORI_BOT_SECRET:secret};
assert.equal(createOwnerRealInvoice({env:reused,fetcher}).readiness().enabled,true);
assert.equal(createOwnerRealInvoice({env:{...reused,SATORI_BOT_KEY_ID:'readonly_key'},
 fetcher}).readiness().enabled,false);

async function error(code,fn){await assert.rejects(fn,e=>e?.code===code,code)}
await error('OWNER_AUTH_REQUIRED',()=>engine.preview({invoiceNo:5920}));
await error('OWNER_PRICE_APPROVAL_REQUIRED',()=>engine.preview({authenticated:true,invoiceNo:5920,
 message:'Cho anh 10 thùng nước Satori 500ml',discountPercent:20}));
const preview=await engine.preview({authenticated:true,invoiceNo:5920,
 message:'Cho anh 10 thùng nước Satori 500ml, giao sớm giúp anh',
 discountPercent:20,shippingPercent:8,vatPercent:0});
assert.equal(preview.total,846720);
assert.equal(preview.items[0].code,'TP-00003');
assert.equal(preview.productionWrite,false);
assert.equal(createCount,0,'preview never creates real invoice');
assert.equal(preview.quoteToken.includes('0900000000'),false,'quote PII encrypted');
await error('OWNER_CONFIRMATION_REQUIRED',()=>engine.confirm({authenticated:true,
 quoteToken:preview.quoteToken}));
await error('OWNER_QUOTE_INVALID',()=>engine.confirm({authenticated:true,
 quoteToken:preview.quoteToken+'x',confirmedByOwner:true}));
const receipt=await engine.confirm({authenticated:true,quoteToken:preview.quoteToken,
 confirmedByOwner:true});
assert.equal(receipt.invoiceNo,5921);
assert.equal(receipt.revision,114);
assert.equal(createCount,1,'one real write request');
assert.equal(lastWrite.order.name,customer.name);
const repeated=await engine.confirm({authenticated:true,quoteToken:preview.quoteToken,
 confirmedByOwner:true});
assert.equal(repeated.duplicate,true);
assert.equal(createCount,1,'same confirmation must never create a second bill');
revision=113;
const preview2=await engine.preview({authenticated:true,invoiceNo:5920,
 message:'Cho anh 10 thùng nước Satori 500ml',
 discountPercent:20,shippingPercent:8,vatPercent:0});
revision=114;
await error('OWNER_QUOTE_STALE',()=>engine.confirm({authenticated:true,
 quoteToken:preview2.quoteToken,confirmedByOwner:true}));
assert.equal(createCount,1);
const unsafe=createOwnerRealInvoice({env:{...env,SATORI_OWNER_CHECKOUT_KEY_ID:'readonly_key'},fetcher});
assert.equal(unsafe.readiness().enabled,false,'read key must never be writer');
const previewMode=createOwnerRealInvoice({env:{...env,GEMINI_SANDBOX_EMERGENCY_DEMO_ONLY:'1'},fetcher});
assert.equal(previewMode.readiness().enabled,false,'emergency cannot write');
await error('OWNER_REAL_PILOT_DISABLED',()=>previewMode.preview({
 authenticated:true,invoiceNo:5920,message:'10 thùng suối 500',
 discountPercent:20,shippingPercent:8}));
const admin=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
const scripts=[...admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
for(const [,src] of scripts)new vm.Script(src,{filename:'owner-admin'});
for(const name of ['ownerLiveCheck','ownerLivePreview','ownerLiveConfirm',
 'ownerMessage','ownerRef','ownerDiscount','ownerShip','ownerVat'])
 assert.ok(admin.includes('id="'+name+'"'));
const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
assert.ok(server.includes("p==='/api/admin/owner-live/confirm'"));
assert.ok(server.includes("OWNER_ONLY_NO_CUSTOMER_ACCESS"));
console.log('PASS owner Gemini spoken order -> real Bot API invoice, explicit quote/confirm, encrypted state, source price, HMAC, deny public, no write in preview, dedupe (FAKE only)');
