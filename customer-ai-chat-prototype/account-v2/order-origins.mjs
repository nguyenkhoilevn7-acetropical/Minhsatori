/** Read-only provenance from authenticated checkout receipts; never changes invoices. */
export const originSql = `
SELECT r.ledger_invoice_id AS "ledgerInvoiceId", r.ledger_invoice_no AS "invoiceNo",
 r.account_id::text AS "accountId", r.request_id::text AS "requestId",
 r.state, r.canonical_intent->>'requestId' AS "intentRequestId",
 q.account_id::text AS "quoteAccountId", p.account_id::text AS "profileAccountId",
 COALESCE(NULLIF(btrim(p.display_name),''), btrim(a.display_name)) AS "accountName",
 p.type AS "accountRole"
FROM satori_v2_order_requests r
LEFT JOIN satori_v2_quotes q ON q.id=r.quote_id
LEFT JOIN satori_v2_profiles p ON p.id=q.profile_id
LEFT JOIN satori_v2_accounts a ON a.id=r.account_id
WHERE r.ledger_invoice_id IS NOT NULL AND r.ledger_invoice_no IS NOT NULL
ORDER BY r.ledger_invoice_no, r.id
LIMIT 50001`;
const bounded=(v,n)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=n;
const roles=new Set(['retail','agency','collaborator']);
export function verifiedOrderOrigins(rows){
 if(!Array.isArray(rows)||rows.length>50000)throw Error('ORIGIN_EXPORT_LIMIT');
 const groups=new Map();
 for(const row of rows){
  const key=JSON.stringify([row.ledgerInvoiceId,String(row.invoiceNo)]);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(row);
 }
 const entries=[];
 for(const group of groups.values()){
  if(group.length!==1)continue;
  const r=group[0];
  if(r.state!=='COMMITTED'||!bounded(r.ledgerInvoiceId,100)||
   !Number.isSafeInteger(Number(r.invoiceNo))||Number(r.invoiceNo)<=0||
   !bounded(r.accountId,100)||r.accountId!==r.quoteAccountId||r.accountId!==r.profileAccountId||
   !bounded(r.requestId,100)||r.requestId!==r.intentRequestId||
   !bounded(r.accountName,150)||!roles.has(r.accountRole))continue;
  entries.push({ledgerInvoiceId:r.ledgerInvoiceId,invoiceNo:String(r.invoiceNo),
   accountId:r.accountId,accountName:r.accountName,accountRole:r.accountRole,
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
