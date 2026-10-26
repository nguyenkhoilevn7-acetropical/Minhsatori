// Isolated PostgreSQL + fake provider. Never calls Apps Script or Google Drive.
import assert from 'node:assert/strict';import {createHash,createHmac,randomUUID} from 'node:crypto';import pg from 'pg';
import {reconcileSandboxPayment,dispatchSandboxInvoice,resolveSandboxPdf} from '../canonical-adapters.mjs';
const uri=process.env.SATORI_V2_CI_DATABASE_URL||'';
assert.ok(uri.includes('127.0.0.1')&&uri.endsWith('/satori_v2_ci'));
let pool=new pg.Pool({connectionString:uri,max:20});
const one=async(q,p=[])=>(await pool.query(q,p)).rows[0];
const key='synthetic-adapter-key-not-live-123456789';
const stable=v=>JSON.stringify(v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])));
try{
 const original=await one('SELECT * FROM satori_v2_test_invoices WHERE collaborator_account_id IS NOT NULL LIMIT 1');
 const q=await one('INSERT INTO satori_v2_quotes(account_id,profile_id,address_id,payload,cart_revision,catalogue_revision,expires_at) SELECT account_id,profile_id,address_id,payload,cart_revision,catalogue_revision,expires_at FROM satori_v2_quotes WHERE id=(SELECT quote_id FROM satori_v2_order_requests WHERE id=$1) RETURNING id',[original.order_id]);
 const order=await one('INSERT INTO satori_v2_order_requests(quote_id,account_id,request_id) VALUES($1,$2,$3) RETURNING id',[q.id,original.account_id,randomUUID()]);
 const i=await one('INSERT INTO satori_v2_test_invoices(order_id,account_id,collaborator_account_id,snapshot) VALUES($1,$2,$3,$4) RETURNING *',[order.id,original.account_id,original.collaborator_account_id,original.snapshot]);
 const actor={id:i.account_id},ctv={id:i.collaborator_account_id};
 const bytes=Buffer.from('%PDF-1.4\nSYNTHETIC CONTRACT BYTES ONLY\n%%EOF');
 const pdf={fileId:'SYNTHETIC_DRIVE_FILE_123',mimeType:'application/pdf',sha256:createHash('sha256').update(bytes).digest('hex')};
 let sends=0,lookups=0,stored=null,release;
 const barrier=new Promise(r=>{release=r});
 const adapter={testOnly:true,async issue(req){sends++;
  const payload={version:1,testOnly:true,kind:'issued',invoiceId:req.invoiceId,canonicalId:'TEST-'+randomUUID(),invoiceNumber:'TEST-'+randomUUID(),quoteDigest:req.quoteDigest,totalVnd:req.quote.totalVnd,currency:'VND',pdf,expiresAt:Date.now()+240000};
  stored={payload,signature:createHmac('sha256',key).update(stable(payload)).digest('hex')};
  await barrier;throw Error('provider committed, network response lost');
 },async lookup(){lookups++;return null}};
 await assert.rejects(dispatchSandboxInvoice(pool,ctv,{invoiceId:i.id},adapter,key),/ISSUER_FORBIDDEN/);
 const first=dispatchSandboxInvoice(pool,actor,{invoiceId:i.id},adapter,key);
 for(let n=0;n<100&&!stored;n++)await new Promise(r=>setTimeout(r,10));assert.ok(stored);
 const retries=await Promise.all(Array.from({length:20},()=>dispatchSandboxInvoice(pool,actor,{invoiceId:i.id},adapter,key)));
 assert.ok(retries.every(r=>r.state==='UNCERTAIN'));release();assert.equal((await first).state,'UNCERTAIN');assert.equal(sends,1);
 await pool.end();pool=new pg.Pool({connectionString:uri});
 adapter.lookup=async()=>{lookups++;return stored};
 assert.equal((await dispatchSandboxInvoice(pool,actor,{invoiceId:i.id},adapter,key)).state,'VERIFIED');
 assert.equal(sends,1);assert.ok(lookups>=21);
 await assert.rejects(dispatchSandboxInvoice(pool,actor,{invoiceId:i.id,idempotencyKey:'different'},adapter,key),/KEY_CONFLICT/);
 assert.equal((await dispatchSandboxInvoice(pool,actor,{invoiceId:i.id},adapter,key)).state,'VERIFIED');assert.equal(sends,1);
 assert.equal((await one('SELECT attempt_count FROM satori_v2_sandbox_outbox WHERE invoice_id=$1',[i.id])).attempt_count,1);
 const reader={testOnly:true,async read(ref){return {...ref,mimeType:'application/pdf',bytes}}};
 assert.deepEqual((await resolveSandboxPdf(pool,actor,{invoiceId:i.id},reader)).bytes,bytes);
 assert.deepEqual((await resolveSandboxPdf(pool,ctv,{invoiceId:i.id},reader)).bytes,bytes);
 await assert.rejects(resolveSandboxPdf(pool,{id:randomUUID()},{invoiceId:i.id},reader),/FORBIDDEN/);
 await assert.rejects(resolveSandboxPdf(pool,actor,{invoiceId:i.id},{testOnly:true,read:async ref=>({...ref,mimeType:'application/pdf',bytes:Buffer.from('%PDF-wrong')})}),/HASH_MISMATCH/);
 await assert.rejects(resolveSandboxPdf(pool,actor,{invoiceId:i.id},{testOnly:true,read:async ref=>({...ref,canonicalId:'TEST-wrong',mimeType:'application/pdf',bytes})}),/IDENTITY_MISMATCH/);
 await assert.rejects(resolveSandboxPdf(pool,actor,{invoiceId:i.id},{testOnly:true,read:async ref=>{
  await pool.query("UPDATE satori_v2_accounts SET access_status='SUSPENDED' WHERE id=$1",[actor.id]);return {...ref,mimeType:'application/pdf',bytes};
 }}),/FORBIDDEN/);
 await pool.query("UPDATE satori_v2_accounts SET access_status='ACTIVE' WHERE id=$1",[actor.id]);
 const paymentReader={testOnly:true,async read(ref){
  const payload={version:1,testOnly:true,kind:'payment',...ref,eventId:randomUUID(),paidVnd:300000,verified:true,expiresAt:Date.now()+240000};
  return {payload,signature:createHmac('sha256',key).update(stable(payload)).digest('hex')};
 }};
 await assert.rejects(reconcileSandboxPayment(pool,actor,{invoiceId:i.id},paymentReader,key),/ADMIN_REQUIRED/);
 assert.equal((await reconcileSandboxPayment(pool,actor,{invoiceId:i.id,admin:true},paymentReader,key)).revision,2);
 assert.equal(Number((await one('SELECT paid_vnd FROM satori_v2_sandbox_receipts WHERE invoice_id=$1',[i.id])).paid_vnd),300000);
 await assert.rejects(reconcileSandboxPayment(pool,actor,{invoiceId:i.id,admin:true},{testOnly:true,read:async()=>stored},key),/PAYMENT_RECEIPT_MISMATCH/);
 console.log('PASS durable single-send outbox, uncertain timeout, concurrent retries, restart reconciliation, immutable key, PDF hash/identity/tenant/revocation');
}finally{await pool.end()}
