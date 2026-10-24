import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const admin=readFileSync(new URL('../admin.html',import.meta.url),'utf8');

test('unnecessary CTV spread calculator is completely removed from admin',()=>{
 for(const id of ['ctvLiveProduct','ctvLiveQty','ctvLiveResult','ctvCalculateLive'])
  assert.doesNotMatch(admin,new RegExp('id="'+id+'"'));
 assert.doesNotMatch(admin,/Tính tiền khách và chênh lệch CTV/);
 assert.doesNotMatch(admin,/ctvCalculateLive/);
 assert.doesNotMatch(admin,/ctvCatalogueProducts/);
});

test('CTV recipient form, pricing read, and policy controls are retained',()=>{
 for(const id of ['independentCtvLedger','ctvReadLive','ctvLiveProductCount',
  'ctvLiveRevision','ctvLedgerName','ctvReceiverName','ctvReceiverPhone',
  'ctvReceiverAddress','ctvCustomerPct','ctvPartnerPct',
  'ctvAddReceiverDraft','ctvReceiversLive'])
  assert.match(admin,new RegExp('id="'+id+'"'));
 assert.match(admin,/ctvCatalogueLoaded=true/);
 assert.match(admin,/data-admin-tab="ctv-ledger"/);
 assert.match(admin,/Thông tin người nhận thêm ở đây vẫn là/);
});

test('every admin inline script still parses',()=>{
 const scripts=[...admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
 assert.ok(scripts.length>0);
 for(const [i,s] of scripts.entries())
  new vm.Script(s[1],{filename:'admin-inline-'+i+'.js'});
});
