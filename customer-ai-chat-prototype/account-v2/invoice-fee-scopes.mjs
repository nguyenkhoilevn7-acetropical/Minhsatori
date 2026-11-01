/*
 * Owner-approved V2 VAT / shipping allocation, scoped by a verified profile.
 * Uses existing append-only audit journal (no schema migration, no legacy writes).
 * Scope "all" means ALL delivery recipients of this profile, including future.
 * Scope "selected" means only explicitly selected verified address IDs.
 * A policy with scope "none" never charges. No implicit tax/fee defaults.
 */
import {isUuid} from './domain.mjs';
const EVENT='V2_INVOICE_CHARGE_POLICY_UPDATED';
const err=code=>{const e=new Error(code);e.code=code;throw e};
const requireThat=(ok,code)=>{if(!ok)err(code)};
const empty=()=>Object.freeze({revision:0,vat:{scope:'none',rateBps:0,addressIds:[]},
 shipping:{scope:'none',amountVnd:0,addressIds:[]}});
function rule(input,kind){
 requireThat(input&&typeof input==='object'&&!Array.isArray(input),'CHARGE_POLICY_INVALID');
 const {scope,addressIds}=input;
 requireThat(['none','all','selected'].includes(scope),'CHARGE_SCOPE_INVALID');
 requireThat(Array.isArray(addressIds)&&addressIds.length<=250&&
  addressIds.every(isUuid)&&new Set(addressIds).size===addressIds.length,'CHARGE_ADDRESSES_INVALID');
 if(scope==='selected')requireThat(addressIds.length>0,'CHARGE_SELECTION_REQUIRED');
 else requireThat(addressIds.length===0,'CHARGE_ADDRESSES_SCOPE_MISMATCH');
 const amount=kind==='vat'?input.rateBps:input.amountVnd;
 requireThat(Number.isSafeInteger(amount)&&amount>=0&&
  amount<=(kind==='vat'?10000:1_000_000_000),'CHARGE_AMOUNT_INVALID');
 if(kind==='vat'){
  if(scope==='none')requireThat(amount===0,'CHARGE_INACTIVE_AMOUNT');
  else requireThat(amount>0,'CHARGE_AMOUNT_REQUIRED');
  return {scope,rateBps:amount,addressIds:[...addressIds]};
 }
 // Shipping is normally owner-approved flat VND. CTV may instead use an
 // explicitly approved 8% of the discounted goods subtotal, never both.
 const rateBps=input.rateBps??0;
 requireThat(Number.isSafeInteger(rateBps)&&rateBps>=0&&rateBps<=10_000,
  'CHARGE_AMOUNT_INVALID');
 if(scope==='none')requireThat(amount===0&&rateBps===0,'CHARGE_INACTIVE_AMOUNT');
 else requireThat((amount>0)!==(rateBps>0),'CHARGE_AMOUNT_REQUIRED');
 return rateBps>0?{scope,amountVnd:0,rateBps,addressIds:[...addressIds]}:
  {scope,amountVnd:amount,addressIds:[...addressIds]};
}
export function validateInvoiceFeePolicy(input){
 requireThat(input&&typeof input==='object'&&!Array.isArray(input)&&
  isUuid(input.profileId)&&input.confirmed===true&&
  Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=0,
  'CHARGE_POLICY_UPDATE_INVALID');
 return {profileId:input.profileId,expectedRevision:input.expectedRevision,
  vat:rule(input.vat,'vat'),shipping:rule(input.shipping,'shipping')};
}
export function calculateInvoiceFees(policy,addressId){
 requireThat(isUuid(addressId),'ADDRESS_REQUIRED');
 const p=policy||empty();
 const applies=r=>r?.scope==='all'||r?.scope==='selected'&&r.addressIds.includes(addressId);
 const vatBps=applies(p.vat)?p.vat.rateBps:0;
 const shippingVnd=applies(p.shipping)?p.shipping.amountVnd:0;
 const shippingBps=applies(p.shipping)?p.shipping.rateBps??0:0;
 return shippingBps>0?{vatBps,shippingVnd,shippingBps}:{vatBps,shippingVnd};
}
/**
 * A collaborator cannot quote/submit an order without ONE applicable owner/CTV
 * approved charge for its selected delivery address.
 * Owner/retail/agency fee policies stay optional and independent.
 */
export function requireCtvChargeForAddress(profileType,policy,addressId){
 if(profileType!=='collaborator')return;
 const {vatBps,shippingVnd,shippingBps=0}=calculateInvoiceFees(policy,addressId);
 requireThat((vatBps===800&&shippingVnd===0&&shippingBps===0)||
  (vatBps===0&&shippingVnd===0&&shippingBps===800),
  'CTV_VAT_OR_SHIPPING_REQUIRED');
}
export async function readInvoiceFeePolicy(db,profileId){
 requireThat(isUuid(profileId),'PROFILE_REQUIRED');
 const result=await db.query('SELECT details FROM satori_v2_audit '+
  'WHERE event_type=$1 AND resource_id=$2 ORDER BY id DESC LIMIT 1',
  [EVENT,profileId]);
 if(!result.rows.length)return empty();
 const saved=result.rows[0].details;
 // Read fails closed. Corrupt policy may not silently waive configured charges.
 requireThat(saved&&Number.isSafeInteger(saved.revision)&&saved.revision>=1,
  'CHARGE_POLICY_CORRUPT');
 const vat=rule(saved.vat,'vat'),shipping=rule(saved.shipping,'shipping');
 return {revision:saved.revision,vat,shipping};
}
export async function saveInvoiceFeePolicy(pool,owner,input){
 const requested=validateInvoiceFeePolicy(input),client=await pool.connect();
 try{
  await client.query('BEGIN');
  // The per-profile advisory lock serializes competing owner edits.
  await client.query('SELECT pg_advisory_xact_lock($1,hashtext($2))',
   [20261030,requested.profileId]);
  const profile=await client.query('SELECT id FROM satori_v2_profiles WHERE id=$1',
   [requested.profileId]);
  requireThat(profile.rows.length===1,'PROFILE_NOT_FOUND');
  const before=await readInvoiceFeePolicy(client,requested.profileId);
  requireThat(before.revision===requested.expectedRevision,'CHARGE_POLICY_REVISION_CONFLICT');
  const ids=[...new Set([...requested.vat.addressIds,...requested.shipping.addressIds])];
  if(ids.length){
   const verified=await client.query('SELECT id FROM satori_v2_addresses '+
    'WHERE profile_id=$1 AND id=ANY($2::uuid[]) AND active=true',
    [requested.profileId,ids]);
   requireThat(verified.rows.length===ids.length,'CHARGE_ADDRESS_NOT_OWNED');
  }
  const saved={revision:before.revision+1,vat:requested.vat,shipping:requested.shipping};
  await client.query('INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) '+
   'VALUES($1,$2,$3,$4,$5)',
   [owner.id,'owner',EVENT,requested.profileId,JSON.stringify(saved)]);
  await client.query('COMMIT');
  return {ok:true,profileId:requested.profileId,...saved};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
 finally{client.release()}
}

/**
 * CTV MUST enter EXACTLY 8% for either VAT or Shipping, never both.
 * Existing owner policies remain independent, and only future quotes read edits.
 * Never trust a client-supplied VAT percentage or a different account's profile.
 */
export function validateCtvInvoiceFeeChoice(input){
 requireThat(input&&typeof input==='object'&&!Array.isArray(input)&&
  isUuid(input.profileId)&&input.confirmed===true&&
  Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=0,
  'CTV_CHARGE_UPDATE_INVALID');
 requireThat(['vat','shipping'].includes(input.choice),'CTV_CHARGE_CHOICE_REQUIRED');
 requireThat(['all','selected'].includes(input.scope),'CTV_CHARGE_SCOPE_REQUIRED');
 requireThat(input.vat==null&&input.shipping==null,'CTV_CHARGE_RAW_POLICY_FORBIDDEN');
 requireThat(input.shippingAmountVnd==null||input.shippingAmountVnd===0,
  'CTV_SHIPPING_FLAT_AMOUNT_FORBIDDEN');
 const ids=input.addressIds??[];
 requireThat(Array.isArray(ids)&&ids.length<=250&&ids.every(isUuid)&&
  new Set(ids).size===ids.length,'CTV_CHARGE_ADDRESSES_INVALID');
 const selected=input.scope==='selected'?ids:[];
 requireThat(input.scope==='selected'||ids.length===0,'CTV_CHARGE_ADDRESSES_SCOPE_MISMATCH');
 if(input.choice==='vat'){
  requireThat(input.vatBps===800,'CTV_VAT_MUST_BE_8_PERCENT');
  requireThat(input.shippingBps==null,'CTV_CANNOT_CHARGE_BOTH');
 }else{
  requireThat(input.shippingBps===800,'CTV_SHIPPING_MUST_BE_8_PERCENT');
  requireThat(input.vatBps==null,'CTV_CANNOT_CHARGE_BOTH');
 }
 const noneVat={scope:'none',rateBps:0,addressIds:[]};
 const noneShipping={scope:'none',amountVnd:0,addressIds:[]};
 const policy=validateInvoiceFeePolicy({
  profileId:input.profileId,confirmed:true,expectedRevision:input.expectedRevision,
  vat:input.choice==='vat'?{scope:input.scope,rateBps:800,addressIds:selected}:noneVat,
  shipping:input.choice==='shipping'?{scope:input.scope,
   amountVnd:0,rateBps:800,addressIds:selected}:noneShipping
 });
 return {...policy,choice:input.choice};
}
export async function saveCtvInvoiceFeeChoice(pool,actor,input){
 const requested=validateCtvInvoiceFeeChoice(input),client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1,hashtext($2))',
   [20261030,requested.profileId]);
  const profile=await client.query('SELECT id FROM satori_v2_profiles '+
   'WHERE id=$1 AND account_id=$2 AND type=$3 FOR UPDATE',
   [requested.profileId,actor.id,'collaborator']);
  requireThat(profile.rows.length===1,'CTV_CHARGE_PROFILE_FORBIDDEN');
  const before=await readInvoiceFeePolicy(client,requested.profileId);
  requireThat(before.revision===requested.expectedRevision,'CHARGE_POLICY_REVISION_CONFLICT');
  const ids=requested.choice==='vat'?requested.vat.addressIds:requested.shipping.addressIds;
  if(ids.length){
   const verified=await client.query('SELECT id FROM satori_v2_addresses '+
    'WHERE profile_id=$1 AND id=ANY($2::uuid[]) AND active=true',
    [requested.profileId,ids]);
   requireThat(verified.rows.length===ids.length,'CHARGE_ADDRESS_NOT_OWNED');
  }
  const saved={revision:before.revision+1,vat:requested.vat,shipping:requested.shipping};
  await client.query('INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) '+
   'VALUES($1,$2,$3,$4,$5)',
   [actor.id,'ctv',EVENT,requested.profileId,JSON.stringify(saved)]);
  await client.query('COMMIT');
  return {ok:true,profileId:requested.profileId,...saved};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
 finally{client.release()}
}
