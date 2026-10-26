/** Signed sandbox reconciliation contract. No network calls or production issuance. */
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {isUuid,DomainError} from './domain.mjs';
import {customerQuote} from './commissions.mjs';
const check=(v,c)=>{if(!v)throw new DomainError(c)};
const stable=v=>JSON.stringify(v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])));
export const digest=v=>createHash('sha256').update(stable(v)).digest('hex');
export function verifyEnvelope(envelope,key,now=Date.now()){
 check(typeof key==='string'&&key.length>=32,'SANDBOX_LEDGER_NOT_CONFIGURED');
 const p=envelope?.payload,s=envelope?.signature;
 check(p&&p.testOnly===true&&p.version===1,'SANDBOX_RECEIPT_REQUIRED');
 check(typeof s==='string'&&/^[a-f0-9]{64}$/.test(s),'RECEIPT_SIGNATURE_INVALID');
 const expected=createHmac('sha256',key).update(stable(p)).digest();
 check(timingSafeEqual(expected,Buffer.from(s,'hex')),'RECEIPT_SIGNATURE_INVALID');
 check(Number.isSafeInteger(p.expiresAt)&&p.expiresAt>now&&p.expiresAt<=now+300000,'RECEIPT_EXPIRED');
 check(isUuid(p.invoiceId),'INVOICE_ID_INVALID');
 return p;
}
function pdfReference(pdf){
 if(pdf==null)return null;
 check(pdf&&Object.keys(pdf).every(k=>['fileId','sha256','mimeType'].includes(k))&&
  /^[A-Za-z0-9_-]{10,200}$/.test(pdf.fileId)&&/^[a-f0-9]{64}$/.test(pdf.sha256)&&pdf.mimeType==='application/pdf','PDF_PROVENANCE_INVALID');
 return pdf;
}
export async function reconcileSandbox(pool,actor,envelope,key){
 const p=verifyEnvelope(envelope,key),hash=digest(p);
 check(['issued','payment'].includes(p.kind),'RECEIPT_KIND_INVALID');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  // Ownership/snapshot originates from accepted server-side test order, never caller fields.
  const r=await c.query('SELECT i.*,r.quote_id FROM satori_v2_test_invoices i JOIN satori_v2_order_requests r ON r.id=i.order_id '+
   'WHERE i.id=$1 FOR UPDATE OF i',[p.invoiceId]);
  check(r.rows.length===1,'TEST_INVOICE_NOT_FOUND');const i=r.rows[0],q=i.snapshot;
  const existing=(await c.query('SELECT * FROM satori_v2_sandbox_receipts WHERE invoice_id=$1',[i.id])).rows[0];
  if(p.kind==='issued'){
   check(/^TEST-[A-Za-z0-9_-]{1,100}$/.test(p.canonicalId)&&/^TEST-[A-Za-z0-9_-]{1,100}$/.test(p.invoiceNumber),'TEST_CANONICAL_ID_REQUIRED');
   check(p.quoteDigest===digest(q)&&p.totalVnd===q.totalVnd&&p.currency==='VND','CANONICAL_QUOTE_MISMATCH');
   const pdf=pdfReference(p.pdf);
   if(existing){check(existing.receipt_digest===hash,'CANONICAL_RECEIPT_CONFLICT');await c.query('COMMIT');return {ok:true,testOnly:true,replayed:true,revision:existing.revision}}
   await c.query('INSERT INTO satori_v2_sandbox_receipts(invoice_id,canonical_id,invoice_number,quote_digest,receipt_digest,pdf) VALUES($1,$2,$3,$4,$5,$6)',
    [i.id,p.canonicalId,p.invoiceNumber,p.quoteDigest,hash,pdf]);
   if(q.commission){
    const m=q.commission;
    check(Number.isSafeInteger(m.commissionVnd)&&m.commissionVnd>=0&&m.basis==='goods-only','COMMISSION_SNAPSHOT_INVALID');
    await c.query("INSERT INTO satori_v2_sandbox_commission_ledger(invoice_id,collaborator_account_id,amount_vnd,basis) VALUES($1,$2,$3,'goods-only')",
     [i.id,m.collaboratorAccountId,m.commissionVnd]);
   }
  }else{
   check(existing&&existing.canonical_id===p.canonicalId,'CANONICAL_INVOICE_MISMATCH');
   check(isUuid(p.eventId)&&Number.isSafeInteger(p.paidVnd)&&p.paidVnd>=0&&p.paidVnd<=q.totalVnd,'PAYMENT_AMOUNT_INVALID');
   const prior=(await c.query('SELECT event_digest,revision FROM satori_v2_sandbox_payment_events WHERE event_id=$1',[p.eventId])).rows[0];
   if(prior){check(prior.event_digest===hash,'PAYMENT_EVENT_CONFLICT');await c.query('COMMIT');return {ok:true,testOnly:true,replayed:true,revision:prior.revision}}
   check(p.expectedRevision===existing.revision,'PAYMENT_REVISION_CONFLICT');
   check(p.verified===true,'PAYMENT_NOT_VERIFIED');
   const revision=existing.revision+1;
   await c.query('INSERT INTO satori_v2_sandbox_payment_events(event_id,invoice_id,event_digest,previous_paid_vnd,paid_vnd,revision) VALUES($1,$2,$3,$4,$5,$6)',
    [p.eventId,i.id,hash,existing.paid_vnd,p.paidVnd,revision]);
   await c.query('UPDATE satori_v2_sandbox_receipts SET paid_vnd=$2,revision=$3,verified_at=now() WHERE invoice_id=$1',[i.id,p.paidVnd,revision]);
  }
  await c.query("INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) VALUES($1,'owner','SANDBOX_LEDGER_RECONCILED',$2,$3)",
   [actor.id,i.id,JSON.stringify({kind:p.kind,receiptDigest:hash,testOnly:true})]);
  await c.query('COMMIT');return {ok:true,testOnly:true,replayed:false,revision:p.kind==='issued'?1:existing.revision+1};
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
export async function sandboxHistory(pool,actor,{admin=false,id=null}={}){
 if(id!==null)check(isUuid(id),'INVOICE_ID_INVALID');
 const r=await pool.query('SELECT i.id,i.order_id,i.account_id,i.collaborator_account_id,i.snapshot,s.canonical_id,s.invoice_number,s.paid_vnd,s.revision,s.pdf,s.verified_at,'+
  'l.amount_vnd FROM satori_v2_test_invoices i JOIN satori_v2_sandbox_receipts s ON s.invoice_id=i.id '+
  'LEFT JOIN satori_v2_sandbox_commission_ledger l ON l.invoice_id=i.id '+
  'WHERE ($2::boolean OR i.account_id=$1 OR i.collaborator_account_id=$1) AND ($3::uuid IS NULL OR i.id=$3) ORDER BY i.created_at DESC,i.id DESC LIMIT 100',[actor.id,admin,id]);
 if(id)check(r.rows.length===1,'INVOICE_FORBIDDEN');
 const events=id?(await pool.query('SELECT previous_paid_vnd AS "previousPaidVnd",paid_vnd AS "paidVnd",revision,created_at AS "verifiedAt" FROM satori_v2_sandbox_payment_events WHERE invoice_id=$1 ORDER BY revision',[id])).rows:[];
 return {ok:true,testOnly:true,limit:100,...(id?{paymentEvents:events.map(e=>({...e,previousPaidVnd:Number(e.previousPaidVnd),paidVnd:Number(e.paidVnd)}))}:{}),invoices:r.rows.map(i=>{
  const paid=Number(i.paid_vnd),total=i.snapshot.totalVnd;
  return {id:i.id,orderId:i.order_id,...customerQuote(i.snapshot),canonicalId:i.canonical_id,invoiceNumber:i.invoice_number,
   revision:i.revision,verifiedAt:i.verified_at,paidVnd:paid,dueVnd:total-paid,
   paymentStatus:paid===total?'PAID':paid===0?'UNPAID':'PARTIAL',paymentVerified:true,
   pdf:i.pdf?{...i.pdf,provenance:'signed-sandbox-receipt',downloadAvailable:false}:null,
   ...((admin||i.collaborator_account_id===actor.id)?{commissionVnd:i.amount_vnd===null?null:Number(i.amount_vnd),
    commissionState:paid===total?'PAYMENT_VERIFIED_NOT_SETTLED':'PROVISIONAL',companyProfitVnd:null}:{})};
 })};
}
