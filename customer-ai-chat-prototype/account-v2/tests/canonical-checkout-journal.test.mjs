import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareLedgerIntent} from '../canonical-ledger-relay.mjs';
import {claimCanonicalCheckout,dispatchCanonicalCheckout,
 reconcileCanonicalCheckout,reserveCanonicalCheckout} from '../canonical-checkout-journal.mjs';

const accountId='11111111-1111-4111-8111-111111111111';
const profileId='22222222-2222-4222-8222-222222222222';
const addressId='33333333-3333-4333-8333-333333333333';
const quoteId='44444444-4444-4444-8444-444444444444';
const requestId='55555555-5555-4555-8555-555555555555';
const quote={currency:'VND',invoiceMode:'single',profileId,addressId,
 delivery:{addressId,recipientName:'Người nhận kiểm thử',
  recipientPhone:'0901234567',address:'123 Đường kiểm thử, TP HCM'},
 items:[{code:'TP-00003',name:'Satori 500ml',unit:'thùng',
  qty:10,unitPrice:80000,listPrice:100000,lineTotal:800000}],
 goodsVnd:800000,shippingVnd:0,vatVnd:0,totalVnd:800000};
const intent=prepareLedgerIntent({quote,requestId,expectedRevision:177});
const env={SATORI_V2_CANONICAL_WRITES_ENABLED:'1',
 SATORI_V2_CANONICAL_WRITE_ENDPOINT:
  'https://script.google.com/macros/s/FAKE_CANONICAL_TEST_SERVER_000000001/exec',
 SATORI_V2_CANONICAL_WRITE_KEY_ID:'v2-fake-writer',
 SATORI_V2_CANONICAL_WRITE_SECRET:'FAKE_HMAC_SECRET_FOR_TESTS_ONLY_01234567890',
 SATORI_READ_KEY_ID:'read-only'};

function fakeStore(state='PENDING_INTEGRATION'){
 const row={request_id:requestId,state,canonical_intent:intent,
  ledger_invoice_no:null};
 let claimed=0;
 return {row,stats:()=>({claimed}),async query(sql,args){
  if(sql.startsWith('UPDATE satori_v2_order_requests')&&
    sql.includes("state='PENDING_INTEGRATION'")){
   if(row.state!=='PENDING_INTEGRATION')return {rows:[]};
   row.state='RELAY_PENDING';claimed++;
   return {rows:[{...row}]};
  }
  if(sql.startsWith('UPDATE satori_v2_order_requests')&&
    sql.includes('SET state=$3')){
   if(!['RELAY_PENDING','UNCERTAIN'].includes(row.state))return {rows:[]};
   row.state=args[2];row.ledger_invoice_no=args[3];
   return {rows:[{...row}]};
  }
  if(sql.startsWith('SELECT request_id,state,canonical_intent')){
   assert.equal(args[0],accountId);
   assert.equal(args[1],requestId);
   return {rows:[{...row}]};
  }
  throw Error('unexpected fake SQL: '+sql.slice(0,75));
 }};
}
function fakeBot({throwOnWrite=false,alreadyCommitted=false}={}){
 let writes=0;
 let stored=alreadyCommitted?{
  id:'canonical-verified-id',invoiceNo:5990,...intent.order}:null;
 return {stats:()=>({writes}),fetcher:async(_url,opts)=>{
  const req=JSON.parse(opts.body);
  let data;
  if(req.action==='orders.findByRequestId')data=stored?
   {state:'COMMITTED',found:true,order:stored}:
   {state:'NOT_FOUND',found:false};
  else if(req.action==='system.status')data={orders:125};
  else if(req.action==='orders.create'){
   writes++;
   if(throwOnWrite)throw Error('fake outage before commit');
   stored={id:'canonical-verified-id',invoiceNo:5990,...req.payload.order};
   data={order:stored};
  }else throw Error('unexpected fake action');
  return {ok:true,text:async()=>JSON.stringify({ok:true,action:req.action,
   revision:req.action==='orders.create'?178:177,data})};
 }};
}

test('one atomic claim only; 100 concurrent callers cannot all dispatch a write',async()=>{
 const pool=fakeStore();
 const candidates=await Promise.all(Array.from({length:100},()=>
  claimCanonicalCheckout(pool,{accountId,requestId})));
 assert.equal(candidates.filter(Boolean).length,1);
 assert.equal(pool.stats().claimed,1);
 assert.equal(pool.row.state,'RELAY_PENDING');
});

test('real bridge only returns COMMITTED after exact canonical readback',async()=>{
 const pool=fakeStore(),bot=fakeBot();
 const output=await dispatchCanonicalCheckout(pool,{accountId,requestId},
  {env,fetcher:bot.fetcher});
 assert.equal(output.state,'COMMITTED');
 assert.equal(output.invoiceNo,5990);
 assert.equal(pool.row.ledger_invoice_no,5990);
 assert.equal(bot.stats().writes,1);
 const again=await dispatchCanonicalCheckout(pool,{accountId,requestId},
  {env,fetcher:bot.fetcher});
 assert.equal(again.state,'COMMITTED');
 assert.equal(bot.stats().writes,1);
});

test('unavailable Bot write becomes UNCERTAIN; retry cannot create second invoice',async()=>{
 const pool=fakeStore(),bot=fakeBot({throwOnWrite:true});
 const first=await dispatchCanonicalCheckout(pool,{accountId,requestId},
  {env,fetcher:bot.fetcher});
 assert.equal(first.state,'UNCERTAIN');
 const next=await dispatchCanonicalCheckout(pool,{accountId,requestId},
  {env,fetcher:bot.fetcher});
 assert.equal(next.state,'UNCERTAIN');
 assert.equal(bot.stats().writes,1);
 // Read-only reconciliation does not submit an order while upstream is absent.
 const read=await reconcileCanonicalCheckout(pool,{accountId,requestId},
  {env,fetcher:bot.fetcher});
 assert.equal(read.state,'UNCERTAIN');
 assert.equal(bot.stats().writes,1);
});

test('uncertain lost-response can be reconciled by exact requestId, zero new writes',async()=>{
 const pool=fakeStore('UNCERTAIN'),bot=fakeBot({alreadyCommitted:true});
 const got=await reconcileCanonicalCheckout(pool,{accountId,requestId},
  {env,fetcher:bot.fetcher});
 assert.equal(got.state,'COMMITTED');
 assert.equal(got.invoiceNo,5990);
 assert.equal(bot.stats().writes,0);
});

test('missing writer config fails before claim and never creates an invoice',async()=>{
 const pool=fakeStore();
 await assert.rejects(()=>dispatchCanonicalCheckout(pool,{accountId,requestId},
  {env:{},fetcher:()=>{throw Error('must not call')}}),
  {code:'LEDGER_RELAY_DISABLED'});
 assert.equal(pool.stats().claimed,0);
});

test('reservation requires explicit in-transaction authoritative verifier',async()=>{
 let invoked=0,inserted=0;
 const quoteRow={id:quoteId,account_id:accountId,payload:quote,
  expires_at:new Date(Date.now()+60000).toISOString()};
 const client={release(){},async query(sql,args){
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
  if(sql.startsWith('SELECT id,account_id,profile_id,address_id,payload'))
   return {rows:[quoteRow]};
  if(sql.startsWith('SELECT request_id,quote_id,state,canonical_intent'))
   return {rows:[]};
  if(sql.startsWith('INSERT INTO satori_v2_order_requests')){
   inserted++;return {rows:[{request_id:requestId,state:'PENDING_INTEGRATION'}]};
  }
  if(sql.startsWith('INSERT INTO satori_v2_audit'))return {rows:[]};
  throw Error('unexpected fake SQL');
 }};
 const pool={connect:async()=>client};
 await assert.rejects(()=>reserveCanonicalCheckout(pool,{
  accountId,quoteId,requestId,expectedRevision:177}),{code:'CHECKOUT_VERIFIER_REQUIRED'});
 const result=await reserveCanonicalCheckout(pool,{
  accountId,quoteId,requestId,expectedRevision:177},async(_client,q)=>{
   invoked++;assert.equal(q.id,quoteId);
  });
 assert.equal(invoked,1);
 assert.equal(inserted,1);
 assert.equal(result.state,'PENDING_INTEGRATION');
});

test('pilot migration is staged but checkout HTTP route still safely disabled',()=>{
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const migrator=readFileSync(new URL('../migrate.mjs',import.meta.url),'utf8');
 assert.match(router,/REAL_CHECKOUT_GATE_NOT_VERIFIED/);
 assert.match(migrator,/20261028_canonical_checkout_journal\.sql/);
 assert.doesNotMatch(router,/from '\.\/canonical-checkout-journal\.mjs'/);
});
