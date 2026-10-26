/** V2 commission grants and synthetic invoice read model. Never calls the legacy ledger. */
import {isUuid,DomainError} from './domain.mjs';
const check=(v,c)=>{if(!v)throw new DomainError(c)};
const bps=v=>Number.isInteger(v)&&v>=0&&v<=10000;
export function validateGrant(input,{customerOnly=false}={}){
 check(input?.confirmed===true,'CONFIRMATION_REQUIRED');
 check(isUuid(input.profileId),'PROFILE_REQUIRED');
 check(Number.isInteger(input.expectedRevision)&&input.expectedRevision>=0,'GRANT_REVISION_REQUIRED');
 check(bps(input.customerBps),'CUSTOMER_DISCOUNT_INVALID');
 if(customerOnly){
  check(Object.keys(input).every(k=>['profileId','expectedRevision','customerBps','confirmed'].includes(k)),
   'CTV_CANNOT_CHANGE_ADMIN_GRANT');
  return input;
 }
 check(isUuid(input.collaboratorAccountId)&&typeof input.enabled==='boolean','CTV_GRANT_INVALID');
 check(bps(input.collaboratorBps)&&bps(input.minCustomerBps)&&bps(input.maxCustomerBps),'CTV_RATE_INVALID');
 check(input.minCustomerBps<=input.customerBps&&input.customerBps<=input.maxCustomerBps&&
  input.maxCustomerBps<=input.collaboratorBps,'CTV_DISCOUNT_OUT_OF_RANGE');
 return input;
}
export async function saveGrant(pool,actor,input,{admin=false}={}){
 validateGrant(input,{customerOnly:!admin});
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  // Same lock as quote confirmation: price changes cannot race confirmation.
  const profile=await c.query('SELECT id FROM satori_v2_profiles WHERE id=$1 FOR UPDATE',[input.profileId]);
  check(profile.rows.length===1,'PROFILE_FORBIDDEN');
  const old=await c.query('SELECT * FROM satori_v2_commission_grants WHERE profile_id=$1 FOR UPDATE',[input.profileId]);
  const g=old.rows[0];
  if(!admin){
   check(g&&g.enabled&&g.collaborator_account_id===actor.id,'CTV_GRANT_FORBIDDEN');
   check(input.customerBps>=g.min_customer_bps&&input.customerBps<=g.max_customer_bps,'CTV_DISCOUNT_OUT_OF_RANGE');
  }else{
   const ctv=await c.query("SELECT a.id FROM satori_v2_accounts a WHERE a.id=$1 AND a.access_status='ACTIVE' "+
    "AND EXISTS(SELECT 1 FROM satori_v2_profiles p WHERE p.account_id=a.id AND p.type='collaborator')",
    [input.collaboratorAccountId]);
   check(ctv.rows.length===1,'CTV_ACCOUNT_NOT_ACTIVE');
  }
  check((g?.revision||0)===input.expectedRevision,'GRANT_REVISION_CONFLICT');
  let result;
  if(admin)result=await c.query('INSERT INTO satori_v2_commission_grants '+
   '(profile_id,collaborator_account_id,enabled,collaborator_bps,customer_bps,min_customer_bps,max_customer_bps) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(profile_id) DO UPDATE SET '+
   'collaborator_account_id=EXCLUDED.collaborator_account_id,enabled=EXCLUDED.enabled,'+
   'collaborator_bps=EXCLUDED.collaborator_bps,customer_bps=EXCLUDED.customer_bps,'+
   'min_customer_bps=EXCLUDED.min_customer_bps,max_customer_bps=EXCLUDED.max_customer_bps,'+
   'revision=satori_v2_commission_grants.revision+1,updated_at=now() RETURNING revision',
   [input.profileId,input.collaboratorAccountId,input.enabled,input.collaboratorBps,input.customerBps,
    input.minCustomerBps,input.maxCustomerBps]);
  else result=await c.query('UPDATE satori_v2_commission_grants SET customer_bps=$2,revision=revision+1,'+
   'updated_at=now() WHERE profile_id=$1 RETURNING revision',[input.profileId,input.customerBps]);
  await c.query('INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) VALUES($1,$2,$3,$4,$5)',
   [actor.id,admin?'owner':'collaborator','COMMISSION_POLICY_VERSIONED',input.profileId,
    JSON.stringify({before:g||null,after:{...input,revision:result.rows[0].revision}})]);
  await c.query('COMMIT');return {ok:true,revision:result.rows[0].revision};
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
export async function grantFor(pool,profileId){
 const r=await pool.query('SELECT g.* FROM satori_v2_commission_grants g '+
  'JOIN satori_v2_accounts a ON a.id=g.collaborator_account_id '+
  "WHERE g.profile_id=$1 AND g.enabled=true AND a.access_status='ACTIVE'",[profileId]);
 return r.rows[0]||null;
}
export function commissionQuote(quote,grant){
 if(!grant)return quote;
 check(bps(grant.customer_bps)&&bps(grant.collaborator_bps)&&grant.customer_bps<=grant.collaborator_bps,'CTV_RATE_INVALID');
 const items=quote.items.map(line=>{
  const unitPrice=Math.round(line.listPrice*(10000-grant.customer_bps)/10000);
  const internalUnitPrice=Math.round(line.listPrice*(10000-grant.collaborator_bps)/10000);
  return {...line,discountBps:grant.customer_bps,unitPrice,lineTotal:unitPrice*line.qty,internalUnitPrice};
 });
 const goodsVnd=items.reduce((sum,l)=>sum+l.lineTotal,0);
 const settlementGoodsVnd=items.reduce((sum,l)=>sum+l.internalUnitPrice*l.qty,0);
 check(bps(quote.vatBps),'COMMISSION_TAX_CONFIGURATION_REQUIRED');
 const vatVnd=Math.round(goodsVnd*quote.vatBps/10000);
 return {...quote,items,goodsVnd,vatVnd,totalVnd:goodsVnd+quote.shippingVnd+vatVnd,invoiceMode:'single',
  internalReference:null,
  commission:{collaboratorAccountId:grant.collaborator_account_id,grantVersion:grant.revision,
   customerBps:grant.customer_bps,collaboratorBps:grant.collaborator_bps,
   settlementGoodsVnd,commissionVnd:goodsVnd-settlementGoodsVnd,basis:'goods-only',companyProfitVnd:null}};
}
/** Explicit allowlist: no cost, settlement, commission or future private fields leak to retail. */
export function customerQuote(q){
 return {currency:q.currency,catalogueRevision:q.catalogueRevision,policyVersion:q.policyVersion,
  addressId:q.addressId,profileId:q.profileId,delivery:q.delivery,invoiceMode:'single',
  items:q.items.map(l=>({code:l.code,name:l.name,unit:l.unit,qty:l.qty,listPrice:l.listPrice,
   discountBps:l.discountBps,unitPrice:l.unitPrice,lineTotal:l.lineTotal,policyVersion:l.policyVersion})),
  goodsVnd:q.goodsVnd,shippingVnd:q.shippingVnd,vatVnd:q.vatVnd,totalVnd:q.totalVnd,
  savingsVnd:q.items.reduce((n,l)=>n+l.listPrice*l.qty,0)-q.goodsVnd};
}
export async function recordTestInvoice(c,{orderId,accountId,snapshot}){
 await c.query('INSERT INTO satori_v2_test_invoices(order_id,account_id,collaborator_account_id,snapshot) '+
  'VALUES($1,$2,$3,$4) ON CONFLICT(order_id) DO NOTHING',
  [orderId,accountId,snapshot.commission?.collaboratorAccountId||null,JSON.stringify(snapshot)]);
}
export async function listTestInvoices(pool,actor,{admin=false,id=null,month=null}={}){
 if(id)check(isUuid(id),'INVOICE_ID_INVALID');
 if(month)check(/^\d{4}-(0[1-9]|1[0-2])$/.test(month),'MONTH_INVALID');
 const r=await pool.query('SELECT i.*,s.settled_at FROM satori_v2_test_invoices i '+
  'LEFT JOIN satori_v2_test_settlements s ON s.invoice_id=i.id '+
  'WHERE ($2::boolean OR i.account_id=$1 OR i.collaborator_account_id=$1) '+
  'AND ($3::uuid IS NULL OR i.id=$3) '+
  "AND ($4::text IS NULL OR to_char(i.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM')=$4) "+
  'ORDER BY i.created_at DESC LIMIT 250',[actor.id,admin,id,month]);
 if(id)check(r.rows.length===1,'INVOICE_FORBIDDEN');
 return r.rows.map(i=>({id:i.id,orderId:i.order_id,testOnly:true,issuedAt:i.created_at,
  status:'TEST_ONLY',...customerQuote(i.snapshot),
  ...((admin||i.collaborator_account_id===actor.id)?{commission:i.snapshot.commission||null,
   settledAt:i.settled_at}: {})}));
}

export async function commissionReport(pool,actor,{admin=false,month}={}){
 check(typeof month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month),'MONTH_INVALID');
 const r=await pool.query(`SELECT i.collaborator_account_id AS "collaboratorAccountId",
 COUNT(*)::int AS "orderCount",SUM((i.snapshot->>'goodsVnd')::bigint)::text AS "salesGoodsVnd",
 SUM((i.snapshot->'commission'->>'commissionVnd')::bigint)::text AS "commissionVnd",
 COALESCE(SUM((i.snapshot->'commission'->>'commissionVnd')::bigint)
 FILTER(WHERE s.invoice_id IS NOT NULL),0)::text AS "settledCommissionVnd",
 COALESCE(SUM((i.snapshot->'commission'->>'commissionVnd')::bigint)
 FILTER(WHERE s.invoice_id IS NULL),0)::text AS "unsettledCommissionVnd"
 FROM satori_v2_test_invoices i LEFT JOIN satori_v2_test_settlements s ON s.invoice_id=i.id
 WHERE ($2::boolean OR i.collaborator_account_id=$1) AND i.collaborator_account_id IS NOT NULL
 AND to_char(i.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM')=$3
 GROUP BY i.collaborator_account_id`,[actor.id,admin,month]);
 return {ok:true,testOnly:true,month,companyProfitVnd:null,reports:r.rows};
}
