// Real PostgreSQL, fake signed canonical receipts only. Zero provider requests.
import assert from 'node:assert/strict';import {createHmac,randomUUID} from 'node:crypto';import pg from 'pg';
import {reconcileSandbox,sandboxHistory,digest} from '../sandbox-ledger.mjs';
const uri=process.env.SATORI_V2_CI_DATABASE_URL||'';
assert.ok(uri.includes('127.0.0.1')&&uri.endsWith('/satori_v2_ci'));
let pool=new pg.Pool({connectionString:uri,max:20});
const key='fixture-only-not-a-real-key-123456789';
const stable=v=>JSON.stringify(v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])));
const sign=payload=>({payload,signature:createHmac('sha256',key).update(stable(payload)).digest('hex')});
try{
 const i=(await pool.query("SELECT * FROM satori_v2_test_invoices WHERE collaborator_account_id IS NOT NULL LIMIT 1")).rows[0];assert.ok(i);
 const owner={id:i.account_id},ctv={id:i.collaborator_account_id},foreign={id:randomUUID()};
 const issued={version:1,testOnly:true,kind:'issued',invoiceId:i.id,canonicalId:'TEST-'+randomUUID(),invoiceNumber:'TEST-9001',
  quoteDigest:digest(i.snapshot),currency:'VND',totalVnd:i.snapshot.totalVnd,expiresAt:Date.now()+240000,
  pdf:{fileId:'SYNTHETIC_FILE_ONLY_123456',sha256:'a'.repeat(64),mimeType:'application/pdf'}};
 await assert.rejects(reconcileSandbox(pool,owner,sign({...issued,totalVnd:1}),key),/QUOTE_MISMATCH/);
 await assert.rejects(reconcileSandbox(pool,owner,sign({...issued,pdf:{...issued.pdf,url:'https://invalid.example'}}),key),/PDF_PROVENANCE/);
 const replies=await Promise.all(Array.from({length:100},()=>reconcileSandbox(pool,owner,sign(issued),key)));
 assert.equal(replies.filter(r=>!r.replayed).length,1);
 assert.equal(Number((await pool.query('SELECT count(*) FROM satori_v2_sandbox_receipts WHERE invoice_id=$1',[i.id])).rows[0].count),1);
 assert.equal(Number((await pool.query('SELECT count(*) FROM satori_v2_sandbox_commission_ledger WHERE invoice_id=$1',[i.id])).rows[0].count),1);
 await assert.rejects(reconcileSandbox(pool,owner,sign({...issued,canonicalId:'TEST-other'}),key),/CONFLICT/);
 const buyer=await sandboxHistory(pool,owner,{id:i.id});assert.equal(buyer.invoices[0].paymentStatus,'UNPAID');
 assert.doesNotMatch(JSON.stringify(buyer),/commissionVnd|companyProfit|settlementGoods/);
 assert.equal((await sandboxHistory(pool,ctv,{id:i.id})).invoices[0].commissionVnd,150000);
 await assert.rejects(sandboxHistory(pool,foreign,{id:i.id}),/FORBIDDEN/);
 assert.equal((await sandboxHistory(pool,foreign)).invoices.length,0);
 assert.equal((await sandboxHistory(pool,foreign,{admin:true,id:i.id})).invoices.length,1);
 const payment=(paidVnd,expectedRevision)=>sign({version:1,testOnly:true,kind:'payment',invoiceId:i.id,canonicalId:issued.canonicalId,
  eventId:randomUUID(),paidVnd,expectedRevision,verified:true,expiresAt:Date.now()+240000});
 const partial=payment(300000,1);await reconcileSandbox(pool,owner,partial,key);
 assert.equal((await reconcileSandbox(pool,owner,partial,key)).replayed,true);
 await assert.rejects(reconcileSandbox(pool,owner,payment(800000,1),key),/REVISION_CONFLICT/);
 await assert.rejects(reconcileSandbox(pool,owner,payment(99999999,2),key),/AMOUNT_INVALID/);
 assert.equal((await sandboxHistory(pool,owner,{id:i.id})).invoices[0].dueVnd,500000);
 const unverified=payment(800000,2);unverified.payload.verified=false;
 await assert.rejects(reconcileSandbox(pool,owner,sign(unverified.payload),key),/NOT_VERIFIED/);
 await reconcileSandbox(pool,owner,payment(800000,2),key);
 assert.equal((await sandboxHistory(pool,owner,{id:i.id})).invoices[0].paymentStatus,'PAID');
 await reconcileSandbox(pool,owner,payment(0,3),key); // verified reversal, never delete the prior events
 await pool.end();pool=new pg.Pool({connectionString:uri});
 const restored=(await sandboxHistory(pool,owner,{id:i.id})).invoices[0];
 assert.equal(restored.paymentStatus,'UNPAID');assert.equal(restored.dueVnd,800000);assert.equal(restored.revision,4);
 assert.equal(restored.pdf.downloadAvailable,false);
 assert.equal(Number((await pool.query('SELECT count(*) FROM satori_v2_sandbox_payment_events WHERE invoice_id=$1',[i.id])).rows[0].count),3);
 console.log('PASS signed sandbox single invoice/commission, 100 replays, PDF provenance, account isolation, partial/full/reversed payment, rollback and reconnect');
}finally{await pool.end()}
