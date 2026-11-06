import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {verifiedOrderOrigins,readVerifiedOrderOrigins,verifyOriginsRequest,
 ORIGINS_SIGNING_CONTEXT} from '../order-origins.mjs';

const row=(extra={})=>({ledgerInvoiceId:'fake-ledger-1',invoiceNo:900001,
 accountId:'fake-account',quoteAccountId:'fake-account',profileAccountId:'fake-account',
 quoteProfileId:'fake-profile',requestId:'fake-request',intentRequestId:'fake-request',
 state:'COMMITTED',accountName:'CTV FAKE',currentRole:'collaborator',
 snapshotCount:0,snapshotProfileId:null,snapshotRole:null,...extra});

test('all three roles export exact checkout identity; old checkouts say CURRENT_PROFILE',()=>{
 for(const role of ['collaborator','agency','retail']){
  const [out]=verifiedOrderOrigins([row({currentRole:role})]);
  assert.deepEqual(out,{ledgerInvoiceId:'fake-ledger-1',invoiceNo:'900001',
   accountId:'fake-account',accountName:'CTV FAKE',accountRole:role,
   roleSource:'CURRENT_PROFILE',requestId:'fake-request'});
 }
});

test('checkout-time role snapshot wins over a later profile change',()=>{
 const [out]=verifiedOrderOrigins([row({currentRole:'agency',snapshotCount:1,
  snapshotProfileId:'fake-profile',snapshotRole:'collaborator'})]);
 assert.equal(out.accountRole,'collaborator');assert.equal(out.roleSource,'ORDER_SNAPSHOT');
});

test('duplicated, foreign-profile or invalid snapshots are not evidence',()=>{
 for(const change of [{snapshotCount:2,snapshotProfileId:'fake-profile',snapshotRole:'retail'},
  {snapshotCount:1,snapshotProfileId:'other-profile',snapshotRole:'retail'},
  {snapshotCount:1,snapshotProfileId:'fake-profile',snapshotRole:'owner'}])
  assert.deepEqual(verifiedOrderOrigins([row(change)]),[]);
});

test('ambiguous, incomplete, noncommitted or inconsistent relations fail closed',()=>{
 for(const change of [{state:'UNCERTAIN'},{accountId:'other'},{quoteAccountId:'other'},
  {profileAccountId:null},{intentRequestId:'other'},{requestId:''},{accountName:''},
  {accountName:' padded'},{currentRole:'unknown'},{ledgerInvoiceId:'x'.repeat(101)},
  {invoiceNo:0},{invoiceNo:'abc'}])
  assert.deepEqual(verifiedOrderOrigins([row(change)]),[],JSON.stringify(change));
});

test('a second row for the same ledger id OR the same number poisons both',()=>{
 assert.deepEqual(verifiedOrderOrigins([row(),row()]),[]);
 assert.deepEqual(verifiedOrderOrigins([row(),row({state:'UNCERTAIN'})]),[]);
 assert.deepEqual(verifiedOrderOrigins([row(),row({invoiceNo:900002})]),[]);
 assert.deepEqual(verifiedOrderOrigins([row(),row({ledgerInvoiceId:'fake-ledger-2'})]),[]);
 const ok=verifiedOrderOrigins([row(),row({ledgerInvoiceId:'fake-ledger-2',invoiceNo:900002})]);
 assert.equal(ok.length,2);
});

test('read uses read-only repeatable transaction, strips unrelated fields and never mutates rows',async()=>{
 const rows=[row({recipientName:'OTHER FAKE',phone:'000',discount:99})];
 const before=JSON.stringify(rows),calls=[];let released=false;
 const pool={connect:async()=>({query:async sql=>{calls.push(sql);return {rows}},release:()=>{released=true}})};
 const out=await readVerifiedOrderOrigins(pool);
 assert.match(calls[0],/READ ONLY/);assert.equal(calls.at(-1),'COMMIT');assert.ok(released);
 for(const sql of calls)assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
 assert.equal(JSON.stringify(rows),before);assert.equal(out.entries[0].phone,undefined);
 assert.equal(out.source,'satori-v2-postgresql-committed');
});

test('query failure rolls back and releases without exporting a partial registry',async()=>{
 const calls=[];let released=false;
 const pool={connect:async()=>({query:async sql=>{calls.push(sql);if(sql.includes('SELECT'))throw Error('fake');return {rows:[]}},release:()=>{released=true}})};
 await assert.rejects(readVerifiedOrderOrigins(pool));assert.equal(calls.at(-1),'ROLLBACK');assert.ok(released);
});

const secret='s'.repeat(40);
const sign=(ts,nonce,key=secret)=>crypto.createHmac('sha256',key)
 .update(ORIGINS_SIGNING_CONTEXT+'\n'+ts+'\n'+nonce).digest('hex');
const nonce=()=>crypto.randomBytes(16).toString('hex');

test('signed pull: valid once, then replay, expiry, wrong key and bad shape are refused',()=>{
 const env={SATORI_V2_ORIGINS_SECRET:secret,SATORI_OWNER_PUSH_WAKE_SECRET:'w'.repeat(40)};
 const now=1_800_000_000_000,n=nonce();
 assert.deepEqual(verifyOriginsRequest(sign(now,n),{ts:now,nonce:n},env,now),{ok:true});
 assert.equal(verifyOriginsRequest(sign(now,n),{ts:now,nonce:n},env,now).code,'ORIGINS_REPLAYED');
 const m=nonce();
 assert.equal(verifyOriginsRequest(sign(now,m),{ts:now,nonce:m},env,now+301_000).code,'ORIGINS_EXPIRED');
 const k=nonce();
 assert.equal(verifyOriginsRequest(sign(now,k,'x'.repeat(40)),{ts:now,nonce:k},env,now).code,'ORIGINS_FORBIDDEN');
 assert.equal(verifyOriginsRequest('zz',{ts:now,nonce:k},env,now).code,'ORIGINS_INVALID');
 assert.equal(verifyOriginsRequest(sign(now,k),{ts:String(now),nonce:k},env,now).code,'ORIGINS_INVALID');
});

test('pull is disabled when the secret is missing, short, or reuses the wake secret',()=>{
 const now=1_800_000_000_000,n=nonce();
 for(const env of [{},{SATORI_V2_ORIGINS_SECRET:'short'},
  {SATORI_V2_ORIGINS_SECRET:secret,SATORI_OWNER_PUSH_WAKE_SECRET:secret}])
  assert.equal(verifyOriginsRequest(sign(now,n),{ts:now,nonce:n},env,now).code,'ORIGINS_NOT_CONFIGURED');
});

test('router exposes the signed pull before cookie auth and keeps owner endpoint',()=>{
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const pull=router.indexOf("pathname==='/api/v2/origins/export'");
 assert.ok(pull>0&&pull<router.indexOf('const actor=await auth(req,pool)'));
 assert.match(router.slice(pull,pull+600),/verifyOriginsRequest\(req\.headers\['x-satori-origins-signature'\]/);
 assert.match(router,/'\/api\/v2\/admin\/order-origins'[\s\S]{0,80}owner\(actor\)/);
});
