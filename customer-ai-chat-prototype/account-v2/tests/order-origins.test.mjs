import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedOrderOrigins,readVerifiedOrderOrigins} from '../order-origins.mjs';
const row=(extra={})=>({ledgerInvoiceId:'fake-ledger-1',invoiceNo:900001,
 accountId:'fake-account',quoteAccountId:'fake-account',profileAccountId:'fake-account',
 requestId:'fake-request',intentRequestId:'fake-request',state:'COMMITTED',
 accountName:'CTV FAKE',accountRole:'collaborator',...extra});
test('all customer roles use exact checkout identity without delivery guesses',()=>{
 for(const role of ['collaborator','agency','retail']){
  const out=verifiedOrderOrigins([row({accountRole:role})]);
  assert.equal(out.length,1);assert.equal(out[0].accountRole,role);
  assert.equal(out[0].invoiceNo,'900001');assert.equal(out[0].accountId,'fake-account');
 }
});
test('ambiguous, incomplete, noncommitted or inconsistent relations fail closed',()=>{
 for(const change of [{state:'UNCERTAIN'},{accountId:'other'}, {quoteAccountId:'other'},
 {profileAccountId:null},{intentRequestId:'other'},{accountName:''},{accountRole:'unknown'},
 {ledgerInvoiceId:'x'.repeat(101)},{invoiceNo:0}])
  assert.deepEqual(verifiedOrderOrigins([row(change)]),[]);
 assert.deepEqual(verifiedOrderOrigins([row(),row()]),[]);
 assert.deepEqual(verifiedOrderOrigins([row(),row({state:'UNCERTAIN'})]),[]);
});
test('read uses read-only repeatable transaction, strips unrelated fields and never mutates rows',async()=>{
 const rows=[row({recipientName:'OTHER FAKE',phone:'000',discount:99})];
 const before=JSON.stringify(rows),calls=[];let released=false;
 const pool={connect:async()=>({query:async sql=>{calls.push(sql);return {rows}},release:()=>{released=true}})};
 const out=await readVerifiedOrderOrigins(pool);
 assert.match(calls[0],/READ ONLY/);assert.equal(calls.at(-1),'COMMIT');assert.ok(released);
 assert.equal(JSON.stringify(rows),before);assert.equal(out.entries[0].phone,undefined);
 assert.equal(out.source,'satori-v2-postgresql-committed');
});
test('query failure rolls back and releases without exporting a partial registry',async()=>{
 const calls=[];let released=false;
 const pool={connect:async()=>({query:async sql=>{calls.push(sql);if(sql.includes('SELECT'))throw Error('fake');return {rows:[]}},release:()=>{released=true}})};
 await assert.rejects(readVerifiedOrderOrigins(pool));assert.equal(calls.at(-1),'ROLLBACK');assert.ok(released);
});
