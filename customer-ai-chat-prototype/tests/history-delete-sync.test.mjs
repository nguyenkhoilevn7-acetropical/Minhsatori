import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const client=readFileSync(new URL('../real-gemini-adapter.js',import.meta.url),'utf8');

function reconcileWithMock(orders,revision,complete){
 const start=client.indexOf(' function forgetVerifiedMissing(');
 const end=client.indexOf(' function persistVerifiedHistory(',start);
 assert.ok(start>=0&&end>start,'reconciliation functions must exist');
 const extracted=client.slice(start,end);
 const run=new Function('orders','revision','complete','sessionInvoices',
  'recentReceipts','savedRecord','unreadInvoices','persistRecentReceipts',
  'writeSession','unreadKey','submittedStorageKey','lastReceipt','document',
  'cachedHistory','historyOrders','readLocal','writeLocal','historyKey',
  'updateInvoiceBadge','validNo',
  extracted+'\nreturn reconcileHistoryWithDrive(orders,revision,complete);');
 const session=new Set([5950]),recent=new Map([[5950,{revision:115}]]),
  unread=new Set([5950]),writes=[];
 const saved={orderId:'preserve-idempotency',invoiceNo:5950,invoiceNos:[5950],
  revision:115,overview:{invoiceNo:5950}};
 const cached=[{invoiceNo:5950,total:304128,date:'24/10/2026'}];
 const previous=JSON.stringify({revision:110,savedAt:Date.now(),orders:cached});
 run(orders,revision,complete,session,recent,saved,unread,
  ()=>writes.push('persist'),()=>writes.push('session'),'unread','submitted',
  null,{querySelectorAll:()=>[]},cached,orders,
  ()=>previous,()=>writes.push('local'),'history',
  ()=>{},n=>Number.isSafeInteger(n)&&n>0);
 return {session,recent,unread,saved,writes};
}

test('client reconciles website deletions, but not incomplete or stale source',()=>{
 const partial=reconcileWithMock([],120,false);
 assert.equal(partial.session.has(5950),true);
 assert.equal(partial.writes.length,0);
 const stale=reconcileWithMock([],114,true);
 assert.equal(stale.session.has(5950),true);
 const current=reconcileWithMock([{invoiceNo:5950}],120,true);
 assert.equal(current.session.has(5950),true);
 const removed=reconcileWithMock([],120,true);
 assert.equal(removed.session.has(5950),false);
 assert.equal(removed.unread.size,0);
 assert.equal(removed.saved.deleted,true);
 assert.equal(removed.saved.orderId,'preserve-idempotency');
});

test('history refreshes on open and automatically while visible',()=>{
 assert.match(client,/loadInvoiceHistory\(true,true\)/);
 assert.match(client,/document\.addEventListener\('visibilitychange',refreshOpenHistory\)/);
 assert.match(client,/setInterval\(\(\)=>\{/);
 assert.match(client,/if\(d\.complete\)persistVerifiedHistory\(historyOrders,d\.revision\)/);
 assert.match(client,/readCachedHistory\(\)/);
 assert.match(client,/historyError/);
 new vm.Script(client,{filename:'real-gemini-adapter.js'});
});
