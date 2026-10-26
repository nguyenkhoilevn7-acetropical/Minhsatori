/** Provider interfaces only: no default network transport and no production route. */
import {createHash} from 'node:crypto';
import {digest,reconcileSandbox} from './sandbox-ledger.mjs';
import {DomainError,isUuid} from './domain.mjs';
const check=(v,c)=>{if(!v)throw new DomainError(c)};
export const disabledCanonicalIssuer=Object.freeze({
 async issue(){throw new DomainError('CANONICAL_ISSUER_NOT_CONFIGURED')},
 async lookup(){throw new DomainError('CANONICAL_ISSUER_NOT_CONFIGURED')}
});
export const disabledDriveReader=Object.freeze({
 async read(){throw new DomainError('CANONICAL_PDF_NOT_CONFIGURED')}
});
async function ownedInvoice(c,actor,id,admin=false,lock=false){
 check(isUuid(id),'INVOICE_ID_INVALID');
 const r=await c.query('SELECT i.* FROM satori_v2_test_invoices i '+
  "JOIN satori_v2_accounts a ON a.id=$2 AND a.access_status='ACTIVE' "+
  'WHERE i.id=$1 AND ($3::boolean OR i.account_id=$2 OR i.collaborator_account_id=$2)'+(lock?' FOR UPDATE OF i':''),[id,actor.id,admin]);
 check(r.rows.length===1,'INVOICE_FORBIDDEN');return r.rows[0];
}
export async function dispatchSandboxInvoice(pool,actor,{invoiceId,idempotencyKey,admin=false},adapter=disabledCanonicalIssuer,key){
 // Server-only fixture injection. No env can turn this into production transport.
 check(adapter.testOnly===true&&typeof adapter.issue==='function'&&typeof adapter.lookup==='function','CANONICAL_ISSUER_NOT_CONFIGURED');
 check(typeof key==='string'&&key.length>=32,'SANDBOX_LEDGER_NOT_CONFIGURED');
 const c=await pool.connect();let invoice,send=false,out;
 try{
  await c.query('BEGIN');invoice=await ownedInvoice(c,actor,invoiceId,admin,true);
  // CTV may view a buyer invoice, but may not dispatch it on the buyer's behalf.
  check(admin||invoice.account_id===actor.id,'ISSUER_FORBIDDEN');
  const canonicalKey='v2-test-'+invoice.order_id;
  check(idempotencyKey===undefined||idempotencyKey===canonicalKey,'IDEMPOTENCY_KEY_CONFLICT');
  await c.query("INSERT INTO satori_v2_sandbox_outbox(invoice_id,idempotency_key,quote_digest,state) VALUES($1,$2,$3,'READY') ON CONFLICT DO NOTHING",[invoice.id,canonicalKey,digest(invoice.snapshot)]);
  out=(await c.query('SELECT * FROM satori_v2_sandbox_outbox WHERE invoice_id=$1 FOR UPDATE',[invoice.id])).rows[0];
  check(out.quote_digest===digest(invoice.snapshot),'OUTBOX_QUOTE_CHANGED');
  const prior=(await c.query('SELECT canonical_id FROM satori_v2_sandbox_receipts WHERE invoice_id=$1 AND quote_digest=$2',[invoice.id,out.quote_digest])).rows[0];
  if(prior){await c.query("UPDATE satori_v2_sandbox_outbox SET state='VERIFIED',updated_at=now() WHERE invoice_id=$1",[invoice.id]);await c.query('COMMIT');return {ok:true,testOnly:true,state:'VERIFIED',canonicalId:prior.canonical_id}}
  if(out.state==='READY'){
   await c.query("UPDATE satori_v2_sandbox_outbox SET state='ATTEMPTED',attempt_count=1,updated_at=now() WHERE invoice_id=$1",[invoice.id]);send=true;
  }
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 // Durable claim is committed BEFORE external I/O. A crash/timeout never permits a second issue call.
 const request={testOnly:true,idempotencyKey:out.idempotency_key,invoiceId:invoice.id,accountId:invoice.account_id,
  quoteDigest:out.quote_digest,quote:invoice.snapshot};
 let envelope;
 try{envelope=send?await adapter.issue(request):await adapter.lookup(request)}
 catch{envelope=null}
 if(!envelope){
  await pool.query("UPDATE satori_v2_sandbox_outbox SET state='UNCERTAIN',updated_at=now() WHERE invoice_id=$1 AND state<>'VERIFIED'",[invoice.id]);
  return {ok:false,testOnly:true,state:'UNCERTAIN',error:'ISSUER_RECONCILIATION_REQUIRED'};
 }
 // Provider verification, exact snapshot/amount identity and atomic commission entry reused.
 check(envelope.payload?.invoiceId===invoice.id&&envelope.payload?.kind==='issued','ISSUER_RECEIPT_MISMATCH');
 await reconcileSandbox(pool,actor,envelope,key);
 await pool.query("UPDATE satori_v2_sandbox_outbox SET state='VERIFIED',updated_at=now() WHERE invoice_id=$1",[invoice.id]);
 return {ok:true,testOnly:true,state:'VERIFIED',canonicalId:envelope.payload.canonicalId};
}
export async function resolveSandboxPdf(pool,actor,{invoiceId,admin=false},reader=disabledDriveReader){
 check(reader.testOnly===true&&typeof reader.read==='function','CANONICAL_PDF_NOT_CONFIGURED');
 await ownedInvoice(pool,actor,invoiceId,admin);
 const r=await pool.query('SELECT canonical_id,pdf FROM satori_v2_sandbox_receipts WHERE invoice_id=$1',[invoiceId]);
 const ref=r.rows[0];check(ref?.pdf,'CANONICAL_PDF_NOT_READY');
 // The caller supplies only the local invoice ID, never a Drive ID or arbitrary URL.
 const file=await reader.read({fileId:ref.pdf.fileId,canonicalId:ref.canonical_id});
 check(file?.fileId===ref.pdf.fileId&&file.canonicalId===ref.canonical_id&&file.mimeType==='application/pdf','PDF_IDENTITY_MISMATCH');
 check(Buffer.isBuffer(file.bytes)&&file.bytes.length>5&&file.bytes.length<=10*1024*1024&&file.bytes.subarray(0,5).toString()==='%PDF-','PDF_CONTENT_INVALID');
 check(createHash('sha256').update(file.bytes).digest('hex')===ref.pdf.sha256,'PDF_HASH_MISMATCH');
 // Revocation during a slow Drive fetch must take effect before any bytes are returned.
 await ownedInvoice(pool,actor,invoiceId,admin);
 return {testOnly:true,mimeType:'application/pdf',bytes:file.bytes,sha256:ref.pdf.sha256};
}

export const disabledPaymentReader=Object.freeze({
 async read(){throw new DomainError('CANONICAL_PAYMENT_NOT_CONFIGURED')}
});
export async function reconcileSandboxPayment(pool,actor,{invoiceId,admin=false},reader=disabledPaymentReader,key){
 check(admin,'PAYMENT_ADMIN_REQUIRED');
 check(reader.testOnly===true&&typeof reader.read==='function','CANONICAL_PAYMENT_NOT_CONFIGURED');
 await ownedInvoice(pool,actor,invoiceId,admin);
 const r=await pool.query('SELECT canonical_id,revision FROM satori_v2_sandbox_receipts WHERE invoice_id=$1',[invoiceId]);
 check(r.rows.length===1,'CANONICAL_INVOICE_NOT_READY');
 const receipt=await reader.read({invoiceId,canonicalId:r.rows[0].canonical_id,expectedRevision:r.rows[0].revision});
 check(receipt?.payload?.kind==='payment'&&receipt.payload.invoiceId===invoiceId&&receipt.payload.canonicalId===r.rows[0].canonical_id,'PAYMENT_RECEIPT_MISMATCH');
 await ownedInvoice(pool,actor,invoiceId,admin);
 return reconcileSandbox(pool,actor,receipt,key);
}
