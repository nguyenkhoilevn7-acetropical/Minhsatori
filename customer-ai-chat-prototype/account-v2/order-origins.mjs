/**
 * Read-only provenance of WHICH V2 account placed a committed checkout.
 * Never changes invoices, ledger rows, prices, payments or PDFs.
 *
 * Evidence chain per invoice (all must hold, otherwise the invoice is omitted
 * and Android shows "Chưa xác định tài khoản đặt hàng"):
 *  - satori_v2_order_requests row is COMMITTED with ledger id + number;
 *  - request account = quote account = profile account;
 *  - canonical_intent.requestId = request_id (this is the ledger apiRequestId,
 *    re-checked against the bill by Apps Script);
 *  - no other committed row shares the ledger id OR the invoice number.
 *
 * Role provenance:
 *  - ORDER_SNAPSHOT: profile type captured in the CANONICAL_INTENT_RESERVED audit
 *    row inside the same checkout transaction (checkouts from 2026-11-06 on).
 *  - CURRENT_PROFILE: older checkouts had no snapshot, so the role is the
 *    profile's CURRENT type; Android labels it as such.
 */
import crypto from 'node:crypto';

export const originSql = `
SELECT r.ledger_invoice_id AS "ledgerInvoiceId", r.ledger_invoice_no AS "invoiceNo",
 r.account_id::text AS "accountId", r.request_id::text AS "requestId",
 r.state, r.canonical_intent->>'requestId' AS "intentRequestId",
 q.account_id::text AS "quoteAccountId", q.profile_id::text AS "quoteProfileId",
 p.account_id::text AS "profileAccountId",
 COALESCE(NULLIF(btrim(p.display_name),''), btrim(a.display_name)) AS "accountName",
 p.type AS "currentRole",
 s.n::int AS "snapshotCount", s.profile_id AS "snapshotProfileId", s.profile_type AS "snapshotRole"
FROM satori_v2_order_requests r
LEFT JOIN satori_v2_quotes q ON q.id=r.quote_id
LEFT JOIN satori_v2_profiles p ON p.id=q.profile_id
LEFT JOIN satori_v2_accounts a ON a.id=r.account_id
LEFT JOIN LATERAL (
 SELECT count(*) AS n, min(e.details->>'profileId') AS profile_id,
  min(e.details->>'profileType') AS profile_type
 FROM satori_v2_audit e
 WHERE e.event_type='CANONICAL_INTENT_RESERVED' AND e.resource_id=r.request_id::text
  AND e.account_id=r.account_id AND e.details ? 'profileType'
) s ON true
WHERE r.ledger_invoice_id IS NOT NULL AND r.ledger_invoice_no IS NOT NULL
ORDER BY r.ledger_invoice_no, r.id
LIMIT 50001`;

const bounded=(v,n)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=n;
const roles=new Set(['retail','agency','collaborator']);

export function verifiedOrderOrigins(rows){
 if(!Array.isArray(rows)||rows.length>50000)throw Error('ORIGIN_EXPORT_LIMIT');
 // Any second row for the same ledger id or the same number poisons both halves.
 const byId=new Map(),byNo=new Map();
 const count=(map,key)=>map.set(key,(map.get(key)||0)+1);
 for(const r of rows){count(byId,String(r.ledgerInvoiceId));count(byNo,String(r.invoiceNo))}
 const entries=[];
 for(const r of rows){
  if(byId.get(String(r.ledgerInvoiceId))!==1||byNo.get(String(r.invoiceNo))!==1)continue;
  if(r.state!=='COMMITTED'||!bounded(r.ledgerInvoiceId,100)||
   !Number.isSafeInteger(Number(r.invoiceNo))||Number(r.invoiceNo)<=0||
   !bounded(r.accountId,100)||r.accountId!==r.quoteAccountId||r.accountId!==r.profileAccountId||
   !bounded(r.requestId,100)||r.requestId!==r.intentRequestId||
   !bounded(r.accountName,150))continue;
  let accountRole,roleSource;
  const snapshots=Number(r.snapshotCount||0);
  if(snapshots===0){
   accountRole=r.currentRole;roleSource='CURRENT_PROFILE';
  }else if(snapshots===1&&r.snapshotProfileId===r.quoteProfileId&&roles.has(r.snapshotRole)){
   accountRole=r.snapshotRole;roleSource='ORDER_SNAPSHOT';
  }else continue; // duplicated or contradictory snapshot: not evidence
  if(!roles.has(accountRole))continue;
  entries.push({ledgerInvoiceId:r.ledgerInvoiceId,invoiceNo:String(r.invoiceNo),
   accountId:r.accountId,accountName:r.accountName,accountRole,roleSource,
   requestId:r.requestId});
 }
 return entries;
}

export async function readVerifiedOrderOrigins(pool){
 const client=await pool.connect();
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='10s'");
  const {rows}=await client.query(originSql);
  const entries=verifiedOrderOrigins(rows);
  await client.query('COMMIT');
  return {schemaVersion:1,source:'satori-v2-postgresql-committed',
   generatedAt:new Date().toISOString(),entries};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
 finally{client.release()}
}

const originNonces=new Map();
export const ORIGINS_SIGNING_CONTEXT='satori-v2-order-origins-v1';
/**
 * Server-to-server pull by the owner's Apps Script (time trigger). HMAC-SHA256 over
 * "satori-v2-order-origins-v1\nts\nnonce" with SATORI_V2_ORIGINS_SECRET, +-5 min,
 * single-use nonce. The secret must differ from the push-wake secret so a leaked
 * wake secret can never read account attribution.
 */
export function verifyOriginsRequest(signature,input,env=process.env,now=Date.now()){
 const secret=String(env.SATORI_V2_ORIGINS_SECRET||'');
 if(secret.length<32||secret===String(env.SATORI_OWNER_PUSH_WAKE_SECRET||''))
  return {ok:false,code:'ORIGINS_NOT_CONFIGURED',status:503};
 const ts=input?.ts,nonce=String(input?.nonce||'');
 if(!Number.isSafeInteger(ts)||!/^[a-f0-9]{32}$/.test(nonce)||
  !/^[a-f0-9]{64}$/.test(String(signature||'')))
  return {ok:false,code:'ORIGINS_INVALID',status:400};
 if(Math.abs(now-ts)>300_000)return {ok:false,code:'ORIGINS_EXPIRED',status:401};
 const expected=crypto.createHmac('sha256',secret)
  .update(ORIGINS_SIGNING_CONTEXT+'\n'+ts+'\n'+nonce,'utf8').digest();
 const given=Buffer.from(String(signature),'hex');
 if(given.length!==expected.length||!crypto.timingSafeEqual(given,expected))
  return {ok:false,code:'ORIGINS_FORBIDDEN',status:403};
 for(const [k,exp] of originNonces)if(exp<now)originNonces.delete(k);
 if(originNonces.has(nonce))return {ok:false,code:'ORIGINS_REPLAYED',status:409};
 if(originNonces.size>=2000)originNonces.delete(originNonces.keys().next().value);
 originNonces.set(nonce,now+600_000);
 return {ok:true};
}
