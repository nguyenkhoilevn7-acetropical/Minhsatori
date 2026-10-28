import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareLedgerIntent,assertSameLedgerInvoice,
 createV2CanonicalRelay,ledgerRelayConfig} from '../canonical-ledger-relay.mjs';

const secret='FAKE_ONLY_LOCAL_HMAC_KEY_0123456789012345';
const env={
 SATORI_V2_CANONICAL_WRITES_ENABLED:'1',
 SATORI_V2_CANONICAL_WRITE_ENDPOINT:'https://script.google.com/macros/s/FAKE_ISOLATED_ACCOUNT_V2_TEST_ONLY_00001/exec',
 SATORI_V2_CANONICAL_WRITE_KEY_ID:'test-v2-writer',
 SATORI_V2_CANONICAL_WRITE_SECRET:secret,
 SATORI_READ_KEY_ID:'read-only-key'
};
const quote={
 currency:'VND',profileId:'11111111-1111-4111-8111-111111111111',
 addressId:'22222222-2222-4222-8222-222222222222',
 invoiceMode:'single',catalogueRevision:176,policyVersion:5,
 delivery:{addressId:'22222222-2222-4222-8222-222222222222',
  recipientName:'Khách hàng giả lập',recipientPhone:'0901234567',
  address:'123 Đường kiểm thử, TP. HCM'},
 items:[
  {code:'TP-00003',name:'Satori 500ml',unit:'thùng',qty:10,
   unitPrice:80000,listPrice:100000,lineTotal:800000},
  {code:'TP-00058',name:'Ổi hồng',unit:'thùng',qty:2,
   unitPrice:40000,listPrice:50000,lineTotal:80000},
  {code:'TP-00077',name:'Mãng cầu',unit:'thùng',qty:3,
   unitPrice:60000,listPrice:75000,lineTotal:180000}
 ],goodsVnd:1060000,shippingVnd:0,vatVnd:0,totalVnd:1060000,
 deliveryRequest:{deliveryNote:'Khách yêu cầu giao sau 2 giờ nữa',requestedDeliveryAt:null}
};
const requestId='4e2bdbac-037d-445d-a4bb-0ab075a7d000';
const intent=prepareLedgerIntent({quote,requestId,expectedRevision:176});

function fakeBot({dropReply=false,loseWrite=false,duplicate=false,mismatch=false}={}){
 let stored=duplicate?{id:17000000001,invoiceNo:5980,...intent.order}:null;
 if(mismatch&&stored)stored={...stored,total:stored.total+1};
 let writes=0,reads=0,actions=[];
 const fetcher=async(url,options)=>{
  assert.equal(url,env.SATORI_V2_CANONICAL_WRITE_ENDPOINT);
  assert.equal(options.method,'POST');
  const body=JSON.parse(options.body);
  assert.equal(body.keyId,env.SATORI_V2_CANONICAL_WRITE_KEY_ID);
  const mac=crypto.createHmac('sha256',secret).update([
   body.keyId,body.timestamp,body.nonce,body.action,JSON.stringify(body.payload)
  ].join('\n')).digest('hex');
  assert.equal(body.signature,mac,'only signed fake calls');
  actions.push(body.action);
  if(body.action==='orders.findByRequestId'){
   reads++;
   if(stored?.apiRequestId&&stored.apiRequestId!==body.payload.requestId)
    throw Error('wrong fake id');
   const data=stored?{state:'COMMITTED',found:true,order:stored}:
    {state:'NOT_FOUND',found:false};
   return {ok:true,text:async()=>JSON.stringify({
    ok:true,action:body.action,revision:176,data
   })};
  }
  if(body.action==='system.status')
   return {ok:true,text:async()=>JSON.stringify({
    ok:true,action:body.action,revision:176,data:{orders:124}
   })};
  if(body.action==='orders.create'){
   if(loseWrite)throw Error('fake upstream unavailable before write');
   assert.equal(body.payload.requestId,requestId);
   writes++;
   stored={id:17000000001,invoiceNo:5980,apiRequestId:requestId,...body.payload.order};
   if(dropReply)throw Error('fake dropped reply after canonical write');
   return {ok:true,text:async()=>JSON.stringify({
    ok:true,action:body.action,revision:177,
    data:{order:stored,duplicate:false}
   })};
  }
  throw Error('unexpected bot action');
 };
 return {fetcher,stats:()=>({writes,reads,actions})};
}

test('10+2+3 V2 quote maps exact validated pricing, note and recipient; no AI price control',()=>{
 assert.equal(intent.order.items.length,3);
 assert.deepEqual(intent.order.items.map(i=>i.qty),[10,2,3]);
 assert.equal(intent.order.total,1060000);
 assert.equal(intent.order.deliveryNote,quote.deliveryRequest.deliveryNote);
 assert.equal(intent.confirmedNewCustomer,true);
 assert.equal(intent.customerRef,undefined);
 const ctv=prepareLedgerIntent({quote:{...quote,invoiceMode:'pair',
  internalReference:{totalVnd:810000}},requestId,expectedRevision:176});
 assert.equal(ctv.order.total,quote.totalVnd);
 assert.equal(ctv.order.items.length,3);
 assert.equal(ctv.order.internalReference,undefined);
 for(const invalid of [
  {...quote,totalVnd:1000000},
  {...quote,items:[{...quote.items[0],lineTotal:1}]},
  {...quote,items:[{...quote.items[0],unitPrice:130000}]},
  {...quote,delivery:{...quote.delivery,recipientPhone:'unknown'}}
 ]){
  assert.throws(()=>prepareLedgerIntent({quote:invalid,requestId,expectedRevision:176}));
 }
});
test('healthy signed create produces one exact canonical invoice and survives readback',async()=>{
 const bot=fakeBot(),relay=createV2CanonicalRelay({env,fetcher:bot.fetcher});
 const result=await relay.submit(intent);
 assert.equal(result.state,'COMMITTED');
 assert.equal(result.invoice.invoiceNo,5980);
 assert.equal(bot.stats().writes,1);
 assert.deepEqual(bot.stats().actions,[
  'orders.findByRequestId','system.status','orders.create','orders.findByRequestId']);
});
test('lost HTTP response AFTER canonical write reconciles via SAME requestId, no retry',async()=>{
 const bot=fakeBot({dropReply:true}),relay=createV2CanonicalRelay({env,fetcher:bot.fetcher});
 const result=await relay.submit(intent);
 assert.equal(result.state,'COMMITTED');
 assert.equal(result.invoice.total,1060000);
 assert.equal(bot.stats().writes,1,'must never repeat write with a fresh requestId');
});
test('pre-existing same requestId replays as one confirmed invoice with zero writes',async()=>{
 const bot=fakeBot({duplicate:true}),relay=createV2CanonicalRelay({env,fetcher:bot.fetcher});
 const result=await relay.submit(intent);
 assert.equal(result.state,'COMMITTED');
 assert.equal(result.duplicate,true);
 assert.equal(bot.stats().writes,0);
 assert.deepEqual(bot.stats().actions,['orders.findByRequestId']);
});
test('unavailable write returns UNCERTAIN; never say it was paid or committed',async()=>{
 const bot=fakeBot({loseWrite:true}),relay=createV2CanonicalRelay({env,fetcher:bot.fetcher});
 const result=await relay.submit(intent);
 assert.equal(result.state,'UNCERTAIN');
 assert.equal(bot.stats().writes,0);
 assert.equal('invoice' in result,false);
});
test('mismatched stored identity refuses automatic reconciliation',async()=>{
 const bot=fakeBot({duplicate:true,mismatch:true});
 await assert.rejects(
  ()=>createV2CanonicalRelay({env,fetcher:bot.fetcher}).submit(intent),
  {code:'LEDGER_READBACK_MISMATCH'});
 assert.equal(bot.stats().writes,0);
});
test('HMAC writer is always distinct from catalogue reader and completely disabled by default',()=>{
 assert.throws(()=>ledgerRelayConfig({}),{code:'LEDGER_RELAY_DISABLED'});
 assert.throws(()=>ledgerRelayConfig({...env,SATORI_READ_KEY_ID:'test-v2-writer'}),
  {code:'LEDGER_WRITER_MUST_BE_SEPARATE'});
 assert.throws(()=>ledgerRelayConfig({...env,SATORI_V2_CANONICAL_WRITE_SECRET:''}),
  {code:'LEDGER_RELAY_NOT_CONFIGURED'});
 const source=readFileSync(new URL('../canonical-ledger-relay.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/console\.log|localStorage|orders\.create\.ai|process\.env/);
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 assert.match(router,/REAL_CHECKOUT_GATE_NOT_VERIFIED/);
 assert.doesNotMatch(router,/from '\.\/canonical-ledger-relay\.mjs'/,
  'source is intentionally unwired until V2 durable request journal and approvals');
});
