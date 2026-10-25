import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {calculateQuote} from '../domain.mjs';
import {assertCurrentQuote} from '../quote-freshness.mjs';
const ids=Array.from({length:4},()=>randomUUID());
const [accountId,profileId,addressId,policyId]=ids;
const profile={id:profileId,accountId,type:'collaborator'};
const address={id:addressId,profileId,active:true,label:'Nhà khách',
 recipientName:'Hà Minh Nguyệt',recipientPhone:'0900000000',
 address:'752 Sư Vạn Hạnh, Quận 10'};
const catalogue=[{code:'TP-00001',name:'Nước suối',unit:'thùng',listPrice:100000,active:true}];
const cart=[{code:'TP-00001',qty:10}];
const policies=[{id:policyId,profileId,addressId:null,productCode:null,enabled:true,
 discountBps:2000,collaboratorBps:3500,invoiceMode:'pair',version:1}];
const context=()=>({accountId,profile,address,cart,catalogue,policies,catalogueRevision:1});
const snapshot=()=>calculateQuote(context());
const rejects=(change,code='QUOTE_CHANGED_REQUOTE_REQUIRED')=>
 assert.throws(()=>assertCurrentQuote({...context(),snapshot:snapshot(),...change}),{code});

test('exact same authoritative quote can be confirmed in the isolated pilot',()=>{
 assert.equal(assertCurrentQuote({...context(),snapshot:snapshot()}),true);
});
test('owner changes discount or policy version after quote: require re-quote',()=>{
 rejects({policies:[{...policies[0],discountBps:2500}]});
 rejects({policies:[{...policies[0],version:2,id:randomUUID()}]});
 rejects({policies:[{...policies[0],enabled:false}]});
 rejects({policies:[{...policies[0],invoiceMode:'single',collaboratorBps:null}]});
});
test('inactive or edited recipient address cannot reuse an earlier quote',()=>{
 rejects({address:{...address,active:false}});
 rejects({address:{...address,address:'Địa chỉ mới Quận 3'}});
 rejects({address:{...address,recipientPhone:'0911111111'}});
});
test('changed cart, quantity or catalogue price needs a new quote',()=>{
 rejects({cart:[{code:'TP-00001',qty:9}]});
 rejects({catalogue:[{...catalogue[0],listPrice:200000}]});
 rejects({catalogueRevision:2});
});
test('new higher-specificity policy overrides old quote and is rejected',()=>{
 rejects({policies:[...policies,{...policies[0],id:randomUUID(),
  productCode:'TP-00001',discountBps:4000,version:2}]});
});
test('tampered, empty or invalid snapshots fail closed',()=>{
 rejects({snapshot:{...snapshot(),totalVnd:0}});
 rejects({snapshot:null},'QUOTE_SNAPSHOT_INVALID');
});
