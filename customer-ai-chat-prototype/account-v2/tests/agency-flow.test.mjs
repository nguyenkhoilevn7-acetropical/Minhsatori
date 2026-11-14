import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {interpretLegacyOrder} from '../legacy-interpret.mjs';

const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
assert.ok(inline);
const a=inline.indexOf('const demoAccountId='),b=inline.indexOf('const cookie=name=>',a);
assert.ok(a>=0&&b>a);
const context=vm.createContext({URLSearchParams,Date,Map,Set,Number,Math,String,Array,Error});
vm.runInContext(inline.slice(a,b)+
 ';globalThis.agencyHarness={demoCall,demoState,demoAgencyId,demoCtvId,demoAgencyAddress2,demoAgencyAddress3,demoCtvAddress1,demoUuid}',
 context,{timeout:1500});
const {demoCall,demoState,demoAgencyId,demoCtvId,demoAgencyAddress2,
 demoAgencyAddress3,demoCtvAddress1,demoUuid}=context.agencyHarness;
const normalized=x=>JSON.parse(JSON.stringify(x));

test('legacy Minh Satori parser parses old colloquial multi-SKU orders',async()=>{
 const result=await interpretLegacyOrder('Cho 3 thùng mãng cầu và 2 thùng ổi hồng');
 assert.ok(Array.isArray(result.suggestedItems),result.message);
 assert.deepEqual(normalized(result.suggestedItems),[
  {code:'TP-00056',qty:3},{code:'TP-00058',qty:2}]);
});
test('legacy parser refuses unknown SKUs rather than dropping part of the order',async()=>{
 const result=await interpretLegacyOrder('Cho 10 thùng Satori 500ml, 3 thùng trà sữa');
 assert.equal(result.needsClarification,true);
 assert.equal(result.suggestedItems,undefined);
});
test('agency profile owns three TEST-only destinations, collaborator owns two',()=>{
 const agency=demoState.addresses.filter(x=>x.profileId===demoAgencyId);
 const ctv=demoState.addresses.filter(x=>x.profileId===demoCtvId);
 assert.equal(agency.length,3);
 assert.equal(ctv.length,2);
 assert.equal(demoState.profiles.find(x=>x.id===demoAgencyId).type,'agency');
 assert.equal(demoState.profiles.find(x=>x.id===demoCtvId).type,'collaborator');
});
test('agent can choose address, get a discounted TEST quote, then create ONE trial order',()=>{
 const profileId=demoAgencyId;
 const before=demoCall('/api/v2/cart?profileId='+profileId,{},'GET');
 const put=demoCall('/api/v2/cart',{profileId,lines:[
  {code:'TP-00003',qty:2},{code:'TP-00001',qty:3}],expectedRevision:before.revision},'PUT');
 assert.equal(put.revision,1);
 const q=demoCall('/api/v2/quote',{profileId,addressId:demoAgencyAddress2});
 assert.equal(q.delivery.addressId,demoAgencyAddress2);
 assert.equal(q.totalVnd,Math.round(2*120000*.85)+Math.round(3*100000*.85));
 assert.equal(q.items.length,2);
 assert.equal(q.invoiceMode,'single');
 const requestId=demoUuid();
 const order=demoCall('/api/v2/test-orders',{quoteId:q.quoteId,requestId,confirmedTest:true});
 assert.equal(order.testOnly,true);
 assert.equal(order.noInvoice,true);
 assert.equal(order.state,'PENDING_INTEGRATION');
 const duplicate=demoCall('/api/v2/test-orders',{quoteId:q.quoteId,requestId,confirmedTest:true});
 assert.equal(duplicate.alreadySubmitted,true);
 assert.equal(demoCall('/api/v2/orders',{},'GET').orders.length,1);
 assert.throws(()=>demoCall('/api/v2/test-orders',{quoteId:q.quoteId,
  requestId:demoUuid(),confirmedTest:true}),/TEST_ORDER_CONFLICT/);
});
test('collaborator TEST quote computes 20% customer and 35% internal reference separately',()=>{
 demoCall('/api/v2/cart',{profileId:demoCtvId,
  lines:[{code:'TP-00003',qty:10}],expectedRevision:0},'PUT');
 const q=demoCall('/api/v2/quote',{profileId:demoCtvId,addressId:demoCtvAddress1});
 assert.equal(q.invoiceMode,'pair');
 assert.equal(q.totalVnd,960000);
 assert.equal(q.internalReference.totalVnd,780000);
 // Reference amount is not part of turnover.
 assert.notEqual(q.totalVnd+q.internalReference.totalVnd,q.totalVnd);
});
test('test quote cannot be submitted after shopping cart revision changes',()=>{
 const profileId=demoAgencyId;
 const current=demoCall('/api/v2/cart?profileId='+profileId,{},'GET');
 const q=demoCall('/api/v2/quote',{profileId,addressId:demoAgencyAddress3});
 demoCall('/api/v2/cart',{profileId,lines:[{code:'TP-00003',qty:5}],
  expectedRevision:current.revision},'PUT');
 assert.throws(()=>demoCall('/api/v2/test-orders',{quoteId:q.quoteId,
  requestId:demoUuid(),confirmedTest:true}),/QUOTE_CART_STALE/);
});
test('TEST-only controls cannot silently activate production orders',()=>{
 assert.match(html,/id="submitTestOrder"/);
 assert.match(html,/id="confirm"[^>]*disabled/);
 assert.match(html,/noInvoice:true/);
 assert.match(html,/confirmedTest:true/);
 assert.match(html,/ĐƠN THỬ/);
});
