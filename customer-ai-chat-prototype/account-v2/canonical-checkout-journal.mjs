/**
 * Account V2 checkout -> EXISTING Minh Satori Apps Script ledger.
 * STAGED BACKEND ONLY. The public /api/v2/confirm route remains closed.
 *
 * This journal never creates another financial ledger or invoice number.
 * All writes go through createV2CanonicalRelay -> signed Bot orders.create.
 * The V2 database stores ONLY an immutable delivery intent and receipt link.
 */
import {prepareLedgerIntent,createV2CanonicalRelay,ledgerRelayConfig} from './canonical-ledger-relay.mjs';

const uuid=v=>typeof v==='string'&&
 /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const fail=code=>{const e=new Error(code);e.code=code;throw e};
const requireTrue=(valid,code)=>{if(!valid)fail(code)};
const allowed=new Set(['PENDING_INTEGRATION','RELAY_PENDING','UNCERTAIN','COMMITTED','REJECTED']);
const publicResult=row=>({
 requestId:row.request_id,state:row.state,
 ...(row.state==='COMMITTED'?{invoiceNo:Number(row.ledger_invoice_no)}:{})
});

/**
 * verifyLockedQuote(client, quote) MUST reprice the current account, cart,
 * address, catalogue and policy under this very transaction and throw if stale.
 * Never supply a browser/Gemini quote as the authoritative quote.
 */
export async function reserveCanonicalCheckout(pool,{
 accountId,quoteId,requestId,expectedRevision,customerRef=null
},verifyLockedQuote){
 requireTrue(uuid(accountId)&&uuid(quoteId)&&uuid(requestId),'CHECKOUT_ID_INVALID');
 requireTrue(Number.isSafeInteger(expectedRevision)&&expectedRevision>=1,'CHECKOUT_REVISION_REQUIRED');
 requireTrue(typeof verifyLockedQuote==='function','CHECKOUT_VERIFIER_REQUIRED');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // The same quote row serializes submissions for this purchase.
  const qr=await client.query(
   'SELECT id,account_id,profile_id,address_id,payload,cart_revision,catalogue_revision,expires_at '+
   'FROM satori_v2_quotes WHERE id=$1 AND account_id=$2 FOR UPDATE',[quoteId,accountId]);
  requireTrue(qr.rows.length===1,'CHECKOUT_QUOTE_FORBIDDEN');
  const q=qr.rows[0];
  // Check duplicates BEFORE quote expiry: a genuine past request must remain
  // discoverable after logout/login, without a new invoice being generated.
  const old=await client.query(
   'SELECT request_id,quote_id,state,canonical_intent,ledger_invoice_no '+
   'FROM satori_v2_order_requests WHERE account_id=$1 '+
   'AND (request_id=$2 OR quote_id=$3) FOR UPDATE',[accountId,requestId,quoteId]);
  if(old.rows.length){
   requireTrue(old.rows.length===1&&old.rows[0].quote_id===quoteId&&
    old.rows[0].request_id===requestId&&
    old.rows[0].canonical_intent?.requestId===requestId,
    'CHECKOUT_IDEMPOTENCY_CONFLICT');
   await client.query('COMMIT');
   return {...publicResult(old.rows[0]),alreadyReserved:true};
  }
  requireTrue(new Date(q.expires_at).getTime()>Date.now(),'CHECKOUT_QUOTE_EXPIRED');
  // Must validate authoritative price, selected delivery, active account and
  // approved policy BEFORE creating the immutable external-write intent.
  await verifyLockedQuote(client,q);
  const intent=prepareLedgerIntent({
   requestId,expectedRevision,quote:q.payload,customerRef
  });
  const inserted=await client.query(
   'INSERT INTO satori_v2_order_requests '+
   '(quote_id,account_id,request_id,state,canonical_intent) '+
   "VALUES($1,$2,$3,'PENDING_INTEGRATION',$4::jsonb) RETURNING request_id,state",
   [quoteId,accountId,requestId,JSON.stringify(intent)]);
  await client.query(
   'INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) '+
   "VALUES($1,'account','CANONICAL_INTENT_RESERVED',$2,'{}'::jsonb)",
   [accountId,requestId]);
  await client.query('COMMIT');
  return {...publicResult(inserted.rows[0]),alreadyReserved:false};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
 finally{client.release()}
}

/**
 * Claim is an atomic one-way transition: exactly one dispatcher may send
 * orders.create. A retry after crash never automatically sends it again.
 */
export async function claimCanonicalCheckout(pool,{accountId,requestId}){
 requireTrue(uuid(accountId)&&uuid(requestId),'CHECKOUT_ID_INVALID');
 const claimed=await pool.query(
  'UPDATE satori_v2_order_requests '+
  "SET state='RELAY_PENDING',submit_started_at=now(),updated_at=now() "+
  "WHERE account_id=$1 AND request_id=$2 AND state='PENDING_INTEGRATION' "+
  'AND canonical_intent IS NOT NULL '+
  'RETURNING request_id,state,canonical_intent',[accountId,requestId]);
 if(claimed.rows.length===1)return claimed.rows[0];
 return null;
}

async function accountRequest(pool,{accountId,requestId}){
 requireTrue(uuid(accountId)&&uuid(requestId),'CHECKOUT_ID_INVALID');
 const row=await pool.query(
  'SELECT request_id,state,canonical_intent,ledger_invoice_no '+
  'FROM satori_v2_order_requests WHERE account_id=$1 AND request_id=$2',
  [accountId,requestId]);
 requireTrue(row.rows.length===1,'CHECKOUT_NOT_FOUND');
 requireTrue(allowed.has(row.rows[0].state),'CHECKOUT_STATE_INVALID');
 return row.rows[0];
}

async function setOutcome(pool,{accountId,requestId},result){
 requireTrue(['UNCERTAIN','COMMITTED','REJECTED'].includes(result?.state),'CHECKOUT_RESULT_INVALID');
 const invoice=result?.invoice;
 if(result.state==='COMMITTED'){
  requireTrue(invoice&&Number.isSafeInteger(invoice.invoiceNo)&&invoice.invoiceNo>0&&
   Number.isSafeInteger(invoice.total)&&invoice.total>=0&&
   (typeof invoice.id==='string'||Number.isSafeInteger(invoice.id)),
   'CHECKOUT_RECEIPT_INVALID');
 }
 const updated=await pool.query(
  'UPDATE satori_v2_order_requests SET state=$3, '+
  'ledger_invoice_no=$4,ledger_invoice_id=$5,ledger_invoice_total=$6, '+
  'last_reconciled_at=now(),updated_at=now() '+
  "WHERE account_id=$1 AND request_id=$2 AND state IN ('RELAY_PENDING','UNCERTAIN') "+
  'RETURNING request_id,state,ledger_invoice_no',
  [accountId,requestId,result.state,invoice?.invoiceNo??null,
   invoice?String(invoice.id):null,invoice?.total??null]);
 if(updated.rows.length===1)return publicResult(updated.rows[0]);
 return publicResult(await accountRequest(pool,{accountId,requestId}));
}

/**
 * Single submission only. The result UNCERTAIN may mean the ledger COMMITTED
 * despite a lost HTTP reply. Only exact requestId readback may resolve it.
 */
export async function dispatchCanonicalCheckout(pool,{accountId,requestId},{
 env,fetcher
}={}){
 // Fail BEFORE claiming when server-side writer is missing or not isolated.
 ledgerRelayConfig(env);
 const current={accountId,requestId};
 const claimed=await claimCanonicalCheckout(pool,current);
 if(!claimed)return publicResult(await accountRequest(pool,current));
 const relay=createV2CanonicalRelay({env,fetcher});
 try{
  const result=await relay.submit(claimed.canonical_intent);
  return await setOutcome(pool,current,result);
 }catch{
  // Do not expose financial details or blindly retry writes after an exception.
  await setOutcome(pool,current,{state:'UNCERTAIN'});
  return {requestId,state:'UNCERTAIN'};
 }
}

/** Read-only reconciliation, including cases where SQL commit was interrupted. */
export async function reconcileCanonicalCheckout(pool,{accountId,requestId},{
 env,fetcher
}={}){
 const current={accountId,requestId};
 const saved=await accountRequest(pool,current);
 if(saved.state==='COMMITTED'||saved.state==='REJECTED'||
    saved.state==='PENDING_INTEGRATION')return publicResult(saved);
 requireTrue(saved.canonical_intent?.requestId===requestId,'CHECKOUT_INTENT_MISSING');
 const relay=createV2CanonicalRelay({env,fetcher});
 try{
  const invoice=await relay.findIntent(saved.canonical_intent);
  if(invoice)return await setOutcome(pool,current,{state:'COMMITTED',invoice});
 }catch{
  // A failed read is NOT proof that no canonical invoice exists.
 }
 return await setOutcome(pool,current,{state:'UNCERTAIN'});
}
