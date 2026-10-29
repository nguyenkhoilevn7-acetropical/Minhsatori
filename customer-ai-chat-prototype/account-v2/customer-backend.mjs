/**
 * Standalone V2 CRM data access. No old /real, /ctv, Apps Script,
 * customer invoice tables, cleartext passwords or client-side Admin authority.
 */
import {validateCustomerProfile,validateCustomerStatus,validateOwnerRolePricing} from './customer-management.mjs';
import {readMinhSatori} from '../satori-readonly.mjs';
import {validateAddress} from './domain.mjs';
import {groupHistoricalAddresses,normalizedDeliveryAddress} from './legacy-address-dedupe.mjs';
export class CrmError extends Error{
 constructor(code,status=400){super(code);this.code=code;this.status=status}
}
const check=(value,code,status=400)=>{if(!value)throw new CrmError(code,status)};
const isUuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s);
const isRev=v=>Number.isSafeInteger(v)&&v>=1&&v<2147483647;
const checked=fn=>{
 try{return fn()}
 catch(e){if(e instanceof CrmError)throw e;throw new CrmError(e.code||e.message||'CUSTOMER_INPUT_INVALID',400)}
};
const audit=(c,accountId,action,id,details={})=>c.query(
 'INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) VALUES($1,$2,$3,$4,$5)',
 [accountId,'owner',action,id,JSON.stringify(details)]);
async function tx(pool,task){
 const c=await pool.connect();
 try{await c.query('BEGIN');const result=await task(c);await c.query('COMMIT');return result}
 catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
 finally{c.release()}
}
export async function registrationSave(pool,actor,input){
 check(actor.access_status==='PENDING','REGISTRATION_ALREADY_REVIEWED',409);
 const data=checked(()=>validateCustomerProfile(input));
 check(!data.email||data.email===actor.email.toLowerCase(),'VERIFIED_EMAIL_MISMATCH',403);
 return tx(pool,async c=>{
  const r=await c.query(
   'INSERT INTO satori_v2_registrations(account_id,full_name,phone,address,company_name,tax_code,note,requested_type) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(account_id) DO UPDATE SET '+
   'full_name=EXCLUDED.full_name,phone=EXCLUDED.phone,address=EXCLUDED.address,'+
   'company_name=EXCLUDED.company_name,tax_code=EXCLUDED.tax_code,'+
   'note=EXCLUDED.note,requested_type=EXCLUDED.requested_type,'+
   'revision=satori_v2_registrations.revision+1,updated_at=now() '+
   'RETURNING revision',
   [actor.id,data.fullName,data.phone,data.address,data.companyName,data.taxCode,data.note,data.requestedType]);
  await c.query('UPDATE satori_v2_accounts SET display_name=$2,updated_at=now() WHERE id=$1',
   [actor.id,data.fullName]);
  await audit(c,actor.id,'CUSTOMER_REGISTRATION_SUBMITTED',actor.id,
   {registrationRevision:r.rows[0].revision});
  return {ok:true,accessStatus:'PENDING',revision:r.rows[0].revision,
   message:'Đã nhận hồ sơ. Admin cần duyệt trước khi đặt hàng.'};
 });
}
export async function registrationRead(pool,actor){
 const r=await pool.query(
  'SELECT account_id AS "accountId",full_name AS "fullName",phone,address,'+
  'company_name AS "companyName",tax_code AS "taxCode",note,'+
  'requested_type AS "requestedType",revision,submitted_at AS "submittedAt",reviewed_at AS "reviewedAt" '+
  'FROM satori_v2_registrations WHERE account_id=$1',[actor.id]);
 return {ok:true,accessStatus:actor.access_status,registration:r.rows[0]||null};
}
export async function adminCustomerList(pool){
 const [registered,leads]=await Promise.all([
  pool.query('SELECT a.id,a.email,a.display_name AS name,a.access_status AS "accessStatus",'+
   'a.revision,a.created_at AS "createdAt",r.full_name AS "fullName",'+
   'r.phone,r.address,r.company_name AS "companyName",r.tax_code AS "taxCode",'+
   'r.note,r.requested_type AS "requestedType",r.revision AS "registrationRevision",'+
   'r.submitted_at AS "submittedAt",r.reviewed_at IS NOT NULL AS "approvedForPricing",'+
   '(SELECT p.discount_bps FROM satori_v2_profiles prof '+
   'JOIN satori_v2_policies p ON p.profile_id=prof.id '+
   'WHERE prof.account_id=a.id AND p.enabled=true AND p.address_id IS NULL '+
   'AND p.product_code IS NULL ORDER BY prof.created_at ASC,p.version DESC LIMIT 1) AS "discountBps",'+
   '(SELECT p.collaborator_bps FROM satori_v2_profiles prof '+
   'JOIN satori_v2_policies p ON p.profile_id=prof.id '+
   'WHERE prof.account_id=a.id AND p.enabled=true AND p.address_id IS NULL '+
   'AND p.product_code IS NULL ORDER BY prof.created_at ASC,p.version DESC LIMIT 1) AS "collaboratorBps" '+
   'FROM satori_v2_accounts a LEFT JOIN satori_v2_registrations r ON r.account_id=a.id '+
   'ORDER BY a.created_at DESC LIMIT 250'),
  pool.query('SELECT id,full_name AS "fullName",email,phone,address,'+
   'company_name AS "companyName",tax_code AS "taxCode",note,'+
   'requested_type AS "requestedType",discount_bps AS "discountBps",'+
   'collaborator_bps AS "collaboratorBps",'+
   'linked_account_id AS "linkedAccountId",active,revision,created_at AS "createdAt",'+
   "EXISTS(SELECT 1 FROM satori_v2_audit e WHERE e.resource_id=l.id::text "+
   "AND e.event_type='LEGACY_CRM_STAGED') AS \"legacyStaged\" "+
   'FROM satori_v2_customer_leads l ORDER BY created_at DESC LIMIT 250')
 ]);
 // Explicit projections are intentional: there is NO password column.
 return {ok:true,registered:registered.rows,leads:leads.rows};
}
export async function adminCreateLead(pool,ownerId,input){
 check(input.confirmed===true,'OWNER_CONFIRMATION_REQUIRED',403);
 const data=checked(()=>validateCustomerProfile(input,{admin:true,phoneOptional:true}));
 return tx(pool,async c=>{
  const r=await c.query(
   'INSERT INTO satori_v2_customer_leads '+
   '(full_name,email,phone,address,company_name,tax_code,note,requested_type,discount_bps,collaborator_bps) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,revision',
   [data.fullName,data.email,data.phone,data.address,data.companyName,
    data.taxCode,data.note,data.requestedType,data.discountBps,data.collaboratorBps]);
  await audit(c,ownerId,'CUSTOMER_LEAD_CREATED',r.rows[0].id);
  return {ok:true,lead:{...r.rows[0],active:true}};
 });
}
export async function adminPatchLead(pool,ownerId,input){
 check(input.confirmed===true,'OWNER_CONFIRMATION_REQUIRED',403);
 check(isUuid(input.leadId)&&isRev(input.expectedRevision),'LEAD_REVISION_REQUIRED');
 check(typeof input.active==='boolean','LEAD_STATUS_INVALID');
 const data=input.active?checked(()=>validateCustomerProfile(input,{admin:true,phoneOptional:true})):null;
 return tx(pool,async c=>{
  const old=await c.query('SELECT id,linked_account_id FROM satori_v2_customer_leads WHERE id=$1 FOR UPDATE',
   [input.leadId]);
  check(old.rows.length===1,'LEAD_NOT_FOUND',404);
  // A linked lead is only a CRM reference. Change its live pricing via the
  // verified registered account policy, not by silently editing this lead.
  check(!old.rows[0].linked_account_id||input.active===false,
   'LINKED_LEAD_EDIT_REQUIRES_ACCOUNT_POLICY',409);
  // Archiving a linked contact DOES NOT revoke login. Admin must suspend the
  // linked Google account separately if access should also be stopped.
  const r=await c.query(
   'UPDATE satori_v2_customer_leads SET active=$3,'+
   'full_name=COALESCE($4,full_name),email=COALESCE($5,email),phone=COALESCE($6,phone),'+
   'address=COALESCE($7,address),company_name=COALESCE($8,company_name),'+
   'tax_code=COALESCE($9,tax_code),note=COALESCE($10,note),'+
   'requested_type=COALESCE($11,requested_type),discount_bps=COALESCE($12,discount_bps),'+
   'collaborator_bps=CASE WHEN $3 THEN $13 ELSE collaborator_bps END,'+
   'revision=revision+1,updated_at=now() '+
   'WHERE id=$1 AND revision=$2 RETURNING id,revision,active',
   [input.leadId,input.expectedRevision,input.active,
    data?.fullName??null,data?.email??null,data?.phone??null,
    data?.address??null,data?.companyName??null,data?.taxCode??null,
    data?.note??null,data?.requestedType??null,data?.discountBps??null,
    input.active?data?.collaboratorBps??null:null]);
  check(r.rows.length===1,'LEAD_REVISION_CONFLICT',409);
  await audit(c,ownerId,input.active?'CUSTOMER_LEAD_UPDATED':'CUSTOMER_LEAD_ARCHIVED',input.leadId);
  return {ok:true,lead:r.rows[0]};
 });
}
async function applyGeneralDiscount(c,profileId,ownerSub,discountBps,collaboratorBps=null){
 const versions=await c.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM satori_v2_policies '+
  'WHERE profile_id=$1 AND address_id IS NULL AND product_code IS NULL',[profileId]);
 await c.query('UPDATE satori_v2_policies SET enabled=false,revision=revision+1 '+
  'WHERE profile_id=$1 AND address_id IS NULL AND product_code IS NULL AND enabled=true',[profileId]);
 return c.query(
  'INSERT INTO satori_v2_policies '+
  '(profile_id,address_id,product_code,discount_bps,collaborator_bps,invoice_mode,version,approved_by) '+
  "VALUES($1,NULL,NULL,$2,$3,'single',$4,$5) RETURNING id,version",
  [profileId,discountBps,collaboratorBps,versions.rows[0].version,ownerSub]);
}
export async function adminEditRegisteredCustomer(pool,owner,input){
 check(input.confirmed===true,'OWNER_CONFIRMATION_REQUIRED',403);
 check(isUuid(input.accountId)&&isRev(input.expectedRevision),'CUSTOMER_EDIT_REVISION_REQUIRED');
 check(input.accountId!==owner.id,'OWNER_CANNOT_BE_MODIFIED',403);
 const profile=checked(()=>validateCustomerProfile(input));
 return tx(pool,async c=>{
  const account=await c.query('SELECT id,email,access_status FROM satori_v2_accounts '+
   'WHERE id=$1 FOR UPDATE',[input.accountId]);
  check(account.rows.length===1,'CUSTOMER_NOT_FOUND',404);
  check(account.rows[0].access_status!=='REMOVED','CUSTOMER_REMOVED',409);
  check(!profile.email||profile.email===account.rows[0].email.toLowerCase(),
   'VERIFIED_EMAIL_IMMUTABLE',403);
  const existing=await c.query('SELECT requested_type,revision FROM satori_v2_registrations '+
   'WHERE account_id=$1 FOR UPDATE',[input.accountId]);
  check(existing.rows.length===1,'CUSTOMER_REGISTRATION_INCOMPLETE',409);
  check(existing.rows[0].revision===input.expectedRevision,
   'CUSTOMER_DETAILS_REVISION_CONFLICT',409);
  // The original approved role remains immutable through the CRM edit form.
  // Changing agency/CTV privileges requires a separate Admin policy operation.
  if(account.rows[0].access_status==='ACTIVE')
   check(profile.requestedType===existing.rows[0].requested_type,'ROLE_CHANGE_REQUIRES_ADMIN_POLICY',409);
  const updated=await c.query(
   'UPDATE satori_v2_registrations SET full_name=$2,phone=$3,address=$4,'+
   'company_name=$5,tax_code=$6,note=$7,requested_type=$8,'+
   'revision=revision+1,updated_at=now() '+
   'WHERE account_id=$1 AND revision=$9 RETURNING revision',
   [input.accountId,profile.fullName,profile.phone,profile.address,
    profile.companyName,profile.taxCode,profile.note,profile.requestedType,
    input.expectedRevision]);
  check(updated.rows.length===1,'CUSTOMER_DETAILS_REVISION_CONFLICT',409);
  await c.query('UPDATE satori_v2_accounts SET display_name=$2,revision=revision+1,'+
   'updated_at=now() WHERE id=$1',[input.accountId,profile.fullName]);
  // Keep the primary live ordering profile aligned with the owner-edited contact.
  // Older invoices and non-primary profiles retain their original snapshots.
  await c.query('UPDATE satori_v2_profiles SET display_name=$2,phone=$3,'+
   'revision=revision+1 WHERE id=(SELECT id FROM satori_v2_profiles '+
   'WHERE account_id=$1 ORDER BY created_at LIMIT 1)',
   [input.accountId,profile.fullName,profile.phone]);
  // Do not rewrite stored shipping addresses or historical quote snapshots.
  // Existing address edits remain explicit and revision-controlled.
  await audit(c,owner.id,'CUSTOMER_REGISTRATION_EDITED',input.accountId,
   {registrationRevision:updated.rows[0].revision});
  return {ok:true,revision:updated.rows[0].revision};
 });
}
/**
 * A single owner action changes BOTH the verified account's primary role and
 * its approved live price. Older orders, quotes and ledger entries are intact.
 * Existing address/product overrides retain their customer discount, and
 * receive a NEW policy version with the new role's commission reference.
 */
export async function adminAssignCustomerRole(pool,owner,input){
 check(isUuid(input?.accountId),'CUSTOMER_ID_INVALID');
 check(input.accountId!==owner.id,'OWNER_CANNOT_BE_MODIFIED',403);
 const price=checked(()=>validateOwnerRolePricing(input));
 return tx(pool,async c=>{
  const accounts=await c.query('SELECT id,access_status,revision FROM satori_v2_accounts '+
   'WHERE id=$1 FOR UPDATE',[input.accountId]);
  check(accounts.rowCount===1,'CUSTOMER_NOT_FOUND',404);
  const account=accounts.rows[0];
  check(account.access_status==='ACTIVE','CUSTOMER_MUST_BE_ACTIVE_FOR_ROLE_CHANGE',409);
  check(account.revision===price.expectedRevision,'CUSTOMER_REVISION_CONFLICT',409);
  const registrations=await c.query('SELECT revision,requested_type FROM satori_v2_registrations '+
   'WHERE account_id=$1 FOR UPDATE',[input.accountId]);
  check(registrations.rowCount===1,'CUSTOMER_REGISTRATION_INCOMPLETE',409);
  const profiles=await c.query('SELECT id,type FROM satori_v2_profiles WHERE account_id=$1 '+
   'ORDER BY created_at LIMIT 1 FOR UPDATE',[input.accountId]);
  check(profiles.rowCount===1,'CUSTOMER_PROFILE_REQUIRED',409);
  const profile=profiles.rows[0];
  // Lock the same profile first as adminPolicy and CTV pricing writers.
  const scoped=await c.query('SELECT id,address_id,product_code,discount_bps,version,approved_by '+
   'FROM satori_v2_policies WHERE profile_id=$1 AND enabled=true '+
   'AND (address_id IS NOT NULL OR product_code IS NOT NULL) '+
   'ORDER BY id FOR UPDATE',[profile.id]);
  if(price.requestedType==='collaborator')
   check(scoped.rows.every(p=>p.discount_bps<=price.collaboratorBps),
    'CTV_CLIENT_DISCOUNT_EXCEEDS_NEW_RATE',409);
  for(const policy of scoped.rows){
   // Preserve the exact address/SKU scope and customer-facing discount.
   const values=[profile.id,policy.address_id,policy.product_code];
   const version=await c.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM satori_v2_policies '+
    'WHERE profile_id=$1 AND address_id IS NOT DISTINCT FROM $2 '+
    'AND product_code IS NOT DISTINCT FROM $3',values);
   await c.query('UPDATE satori_v2_policies SET enabled=false,revision=revision+1 '+
    'WHERE profile_id=$1 AND address_id IS NOT DISTINCT FROM $2 '+
    'AND product_code IS NOT DISTINCT FROM $3 AND enabled=true',values);
   await c.query('INSERT INTO satori_v2_policies '+
    '(profile_id,address_id,product_code,discount_bps,collaborator_bps,invoice_mode,version,approved_by) '+
    "VALUES($1,$2,$3,$4,$5,'single',$6,$7)",
    [profile.id,policy.address_id,policy.product_code,policy.discount_bps,
     price.collaboratorBps,version.rows[0].version,policy.approved_by||owner.google_sub]);
  }
  // A new default policy always wins over old active defaults.
  await applyGeneralDiscount(c,profile.id,owner.google_sub,price.discountBps,price.collaboratorBps);
  await c.query('UPDATE satori_v2_profiles SET type=$2,revision=revision+1 '+
   'WHERE id=$1',[profile.id,price.requestedType]);
  await c.query('UPDATE satori_v2_registrations SET requested_type=$2,revision=revision+1,'+
   'updated_at=now() WHERE account_id=$1',[input.accountId,price.requestedType]);
  const updated=await c.query('UPDATE satori_v2_accounts SET revision=revision+1,'+
   'updated_at=now() WHERE id=$1 RETURNING revision',[input.accountId]);
  await audit(c,owner.id,'CUSTOMER_ROLE_PRICE_CHANGED',input.accountId,{
   oldRole:profile.type,newRole:price.requestedType,
   customerDiscountBps:price.discountBps,collaboratorBps:price.collaboratorBps,
   scopedPoliciesPreserved:scoped.rows.length,oneInvoice:true});
  return {ok:true,accountId:input.accountId,requestedType:price.requestedType,
   discountBps:price.discountBps,collaboratorBps:price.collaboratorBps,
   revision:updated.rows[0].revision};
 });
}
export async function adminChangeCustomerStatus(pool,owner,input){
 check(isUuid(input.accountId),'CUSTOMER_ID_INVALID');
 const change=checked(()=>validateCustomerStatus(input));
 check(input.accountId!==owner.id,'OWNER_CANNOT_BE_MODIFIED',403);
 return tx(pool,async c=>{
  const account=await c.query('SELECT id,google_sub,access_status,revision FROM satori_v2_accounts '+
   'WHERE id=$1 FOR UPDATE',[input.accountId]);
  check(account.rows.length===1,'CUSTOMER_NOT_FOUND',404);
  check(account.rows[0].revision===change.expectedRevision,'CUSTOMER_REVISION_CONFLICT',409);
  check(account.rows[0].access_status!== 'REMOVED' || change.status!=='ACTIVE',
   'REMOVED_REQUIRES_NEW_APPROVAL',409);
  let profileId=null;
  if(change.status==='ACTIVE'){
   check(change.discountBps!==undefined,'DISCOUNT_INPUT_REQUIRED_AFTER_APPROVAL',409);
   const reg=await c.query('SELECT full_name,phone,address,requested_type,reviewed_at FROM satori_v2_registrations '+
    'WHERE account_id=$1',[input.accountId]);
   check(reg.rows.length===1,'CUSTOMER_REGISTRATION_INCOMPLETE',409);
   check(reg.rows[0].reviewed_at!==null,'CUSTOMER_APPROVAL_REQUIRED_BEFORE_PRICING',409);
   const data=reg.rows[0];
   const isCtv=data.requested_type==='collaborator';
   const ctvRate=input.collaboratorBps;
   check(!isCtv||Number.isSafeInteger(ctvRate)&&ctvRate>=change.discountBps&&ctvRate<=10000,
    'CTV_DISCOUNT_REQUIRED_AND_NOT_BELOW_CUSTOMER',409);
   check(isCtv||ctvRate==null,'CTV_ROLE_REQUIRED',409);
   const existing=await c.query('SELECT id,type FROM satori_v2_profiles WHERE account_id=$1 '+
    'ORDER BY created_at LIMIT 1 FOR UPDATE',[input.accountId]);
   if(existing.rows.length){
    profileId=existing.rows[0].id;
    // Previously approved roles remain as configured by Admin.
    if(account.rows[0].access_status==='PENDING')
     await c.query('UPDATE satori_v2_profiles SET type=$2,display_name=$3,phone=$4,revision=revision+1 '+
      'WHERE id=$1',[profileId,data.requested_type,data.full_name,data.phone]);
   }else{
    const created=await c.query('INSERT INTO satori_v2_profiles(account_id,type,display_name,phone) '+
     'VALUES($1,$2,$3,$4) RETURNING id',
     [input.accountId,data.requested_type,data.full_name,data.phone]);
    profileId=created.rows[0].id;
   }
   const hasAddress=await c.query('SELECT 1 FROM satori_v2_addresses WHERE profile_id=$1 LIMIT 1',[profileId]);
   if(!hasAddress.rows.length)
    await c.query('INSERT INTO satori_v2_addresses(profile_id,label,recipient_name,recipient_phone,address) '+
     "VALUES($1,'Địa chỉ đăng ký',$2,$3,$4)",[profileId,data.full_name,data.phone,data.address]);
   if(change.discountBps!==undefined)
    await applyGeneralDiscount(c,profileId,owner.google_sub,change.discountBps,
     isCtv?ctvRate:null);
   await c.query('UPDATE satori_v2_registrations SET reviewed_at=now(),reviewed_by=$2 '+
    'WHERE account_id=$1',[input.accountId,owner.id]);
  }else{
   await c.query('DELETE FROM satori_v2_sessions WHERE account_id=$1',[input.accountId]);
   if(change.status==='REMOVED')
    await c.query('UPDATE satori_v2_policies SET enabled=false,revision=revision+1 WHERE '+
     'profile_id IN (SELECT id FROM satori_v2_profiles WHERE account_id=$1) AND enabled=true',
     [input.accountId]);
  }
  const updated=await c.query('UPDATE satori_v2_accounts SET access_status=$2,'+
   'revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id,revision,access_status AS "accessStatus"',
   [input.accountId,change.status]);
  await audit(c,owner.id,'CUSTOMER_ACCESS_'+change.status,input.accountId,
   {approvedDiscountBps:change.status==='ACTIVE'?change.discountBps??null:null,
    collaboratorBps:change.status==='ACTIVE'?input.collaboratorBps??null:null,
    oneInvoice:true});
  return {ok:true,customer:updated.rows[0],profileId};
 });
}
export async function adminLinkLead(pool,owner,input){
 check(input.confirmed===true,'OWNER_CONFIRMATION_REQUIRED',403);
 check(isUuid(input.leadId)&&isUuid(input.accountId)&&isRev(input.expectedRevision),
  'CUSTOMER_LINK_INVALID');
 return tx(pool,async c=>{
  const lead=await c.query('SELECT * FROM satori_v2_customer_leads WHERE id=$1 FOR UPDATE',[input.leadId]);
  check(lead.rows.length===1&&lead.rows[0].active,'LEAD_NOT_AVAILABLE',404);
  const l=lead.rows[0];
  check(l.revision===input.expectedRevision,'LEAD_REVISION_CONFLICT',409);
  check(!l.linked_account_id,'LEAD_ALREADY_LINKED',409);
  const account=await c.query('SELECT id,email,access_status FROM satori_v2_accounts WHERE id=$1 FOR UPDATE',
   [input.accountId]);
  check(account.rows.length===1&&account.rows[0].access_status!=='REMOVED','ACCOUNT_NOT_AVAILABLE',404);
  const registered=await c.query('SELECT account_id,phone FROM satori_v2_registrations WHERE account_id=$1',
   [input.accountId]);
  check(registered.rows.length===1,'CUSTOMER_NOT_REGISTERED',409);
  // Matching email is verified by Google, never by a self-entered email field.
  if(l.email)check(l.email.toLowerCase()===account.rows[0].email.toLowerCase(),
   'VERIFIED_EMAIL_MISMATCH',409);
  else check(input.manualIdentityVerified===true&&l.phone===registered.rows[0].phone,
   'MANUAL_IDENTITY_PROOF_REQUIRED',403);
  const link=await c.query('UPDATE satori_v2_customer_leads SET linked_account_id=$2,'+
   'revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$3 RETURNING id,revision',
   [input.leadId,input.accountId,input.expectedRevision]);
  check(link.rows.length===1,'LEAD_REVISION_CONFLICT',409);
  const profile=await c.query('SELECT id FROM satori_v2_profiles WHERE account_id=$1 ORDER BY created_at LIMIT 1',
   [input.accountId]);
  // Old-customer discounts are imported as V2-only policy once Owner approved the identity.
  // CTV activation must set the verified profile role and both rates atomically.
  check(l.requested_type!=='collaborator','CTV_USE_LEGACY_ACTIVATION',409);
  if(profile.rows.length&&l.discount_bps>=0)
   await applyGeneralDiscount(c,profile.rows[0].id,owner.google_sub,l.discount_bps,
    l.requested_type==='collaborator'?l.collaborator_bps:null);
  await audit(c,owner.id,'CUSTOMER_LEAD_MANUALLY_LINKED',input.leadId,
   {linkedAccountId:input.accountId,discountBps:l.discount_bps});
  return {ok:true,lead:link.rows[0],linkedAccountId:input.accountId};
 });
}

/** Review identity/profile first; do NOT grant ordering or imply a 0% policy. */
export async function adminApproveRegistration(pool,owner,input){
 check(input?.confirmed===true,'OWNER_CONFIRMATION_REQUIRED',403);
 check(isUuid(input.accountId)&&isRev(input.expectedRevision),'CUSTOMER_REVISION_REQUIRED');
 check(input.accountId!==owner.id,'OWNER_CANNOT_BE_MODIFIED',403);
 return tx(pool,async c=>{
  const a=await c.query('SELECT id,access_status,revision FROM satori_v2_accounts '+
   'WHERE id=$1 FOR UPDATE',[input.accountId]);
  check(a.rowCount===1,'CUSTOMER_NOT_FOUND',404);
  check(a.rows[0].access_status==='PENDING','CUSTOMER_NOT_PENDING',409);
  check(a.rows[0].revision===input.expectedRevision,'CUSTOMER_REVISION_CONFLICT',409);
  const r=await c.query('UPDATE satori_v2_registrations SET reviewed_at=now(),'+
   'reviewed_by=$2,revision=revision+1,updated_at=now() '+
   'WHERE account_id=$1 RETURNING account_id',[input.accountId,owner.id]);
  check(r.rowCount===1,'CUSTOMER_REGISTRATION_INCOMPLETE',409);
  const updated=await c.query('UPDATE satori_v2_accounts SET revision=revision+1,'+
   'updated_at=now() WHERE id=$1 RETURNING revision',[input.accountId]);
  await audit(c,owner.id,'CUSTOMER_IDENTITY_APPROVED',input.accountId,
   {orderingEnabled:false,discountConfigured:false});
  return {ok:true,accessStatus:'PENDING',approvedForPricing:true,
   revision:updated.rows[0].revision};
 });
}


/* Signed, owner-gated legacy customer search. Never rewrite source invoices. */
const sourceText=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
/**
 * Ledger phones sometimes include customer notes, punctuation or Vietnamese
 * display names in parentheses. Keep original source untouched for display.
 * Extract a VALID phone candidate; never treat the whole field as a number
 * or silently invent one. Owner must check contact before activation.
 */
export function legacyPhoneCandidate(value){
 const text=sourceText(value,120).normalize('NFKC');
 const parts=text.match(/\+?\d[\d().\s-]{7,28}\d/g)||[];
 for(const part of parts){
  const digits=part.replace(/[ ().-]/g,'');
  if(/^\+?[0-9]{9,15}$/.test(digits))return digits;
 }
 return '';
}


/**
 * Owner-only, READ-ONLY preview of original invoice recipients for ONE month.
 * The canonical transport forbids multi-month bulk reads. Historical invoices
 * do not establish a customer's login, role, agency or CTV commission rate.
 */
export async function legacyMonthlyCustomerPreview(month){
 check(typeof month==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(month),'LEGACY_MONTH_INVALID');
 const [year,number]=month.split('-').map(Number);
 const last=new Date(Date.UTC(year,number,0)).getUTCDate();
 const from=month+'-01',to=month+'-'+String(last).padStart(2,'0');
 const signed=await readMinhSatori('orders.list',{from,to,limit:100});
 const revision=Number(signed?.revision??signed?.data?.revision);
 check(Number.isSafeInteger(revision)&&revision>=1,'LEGACY_SOURCE_UNVERIFIED',503);
 const raw=Array.isArray(signed?.data?.orders)?signed.data.orders:[];
 const byIdentity=new Map();
 for(const order of raw.slice(0,100)){
  if(!Number.isSafeInteger(Number(order.invoiceNo))||Number(order.invoiceNo)<1)continue;
  const name=sourceText(order.name,120),phone=legacyPhoneCandidate(order.phone);
  const address=sourceText(order.location,400);
  if(!name)continue;
  // Missing telephone is not enough evidence to merge distinct addresses.
  const key=phone?'phone:'+phone:'name:'+name.toLocaleLowerCase('vi-VN')+
   '|address:'+address.toLocaleLowerCase('vi-VN');
  let row=byIdentity.get(key);
  if(!row){
   row={id:key,name,phone,addresses:[],invoiceCount:0,lastOrderDate:null,
    invoiceNos:[]};
   byIdentity.set(key,row);
  }
  row.invoiceCount+=1;
  row.invoiceNos.push(Number(order.invoiceNo));
  if(address&&!row.addresses.includes(address))row.addresses.push(address);
  const date=sourceText(order.date,30);
  if(date&&(!row.lastOrderDate||date>row.lastOrderDate))
   row.lastOrderDate=date;
 }
 const total=Number(signed?.data?.totalMatches)||raw.length;
 return {ok:true,source:'canonical-signed-ledger',month,revision,
  customers:[...byIdentity.values()].sort((a,b)=>b.invoiceCount-a.invoiceCount),
  truncated:total>raw.length||raw.length>=100,scanned:raw.length};
}

export async function legacyCustomerSearch(query){
 const q=sourceText(query,90);
 check(q.length>=2&&!/[*%_]/.test(q),'LEGACY_SEARCH_REQUIRED');
 const signed=await readMinhSatori('orders.list',{query:q,limit:100});
 const raw=Array.isArray(signed?.data?.orders)?signed.data.orders:[];
 const revision=Number(signed?.revision??signed?.data?.revision);
 check(Number.isSafeInteger(revision)&&revision>=1,'LEGACY_SOURCE_UNVERIFIED',503);
 const orders=raw.slice(0,100).filter(o=>Number.isSafeInteger(Number(o.invoiceNo))&&Number(o.invoiceNo)>0)
 .map(o=>({
  id:String(o.id||'').slice(0,80),invoiceNo:Number(o.invoiceNo),
  name:sourceText(o.name,120),phone:sourceText(o.phone,80),
  phoneCandidate:legacyPhoneCandidate(o.phone),
  address:sourceText(o.location,400),date:sourceText(o.date,30),
  createdAt:typeof o.createdAt==='string'?sourceText(o.createdAt,48):null,
  timestamp:Number.isFinite(Number(o.timestamp))&&Number(o.timestamp)>946684800?
   Number(o.timestamp):null,
  status:sourceText(o.status,50),total:Number(o.total)||0,
  vatAmount:Number(o.vatAmount)||0,shippingAmount:Number(o.shippingAmount)||0,
  items:(Array.isArray(o.items)?o.items:[]).slice(0,40).map(i=>{
   const listPrice=Number(i.listPrice)||0,unitPrice=Number(i.unitPrice)||0;
   return {code:sourceText(i.code,24),product:sourceText(i.product,150),
    qty:Number(i.qty)||0,unit:sourceText(i.unit,32),unitPrice,listPrice,
    estimatedDiscountPercent:listPrice>0?
     Math.round((1-unitPrice/listPrice)*10000)/100:null};
  })
 }));
 const byAddress=new Map();
 for(const row of orders){
  const key=normalizedDeliveryAddress(row.address);
  if(!key)continue;
  if(!byAddress.has(key))byAddress.set(key,[]);
  byAddress.get(key).push(row);
 }
 const addressGroups=groupHistoricalAddresses(orders).map(latest=>{
  const members=byAddress.get(latest.normalizedAddress)||[];
  return {key:latest.normalizedAddress,address:latest.address,
   phone:latest.phoneCandidate||'',name:latest.name,
   date:latest.date,createdAt:latest.createdAt,timestamp:latest.timestamp,
   invoiceCount:members.length,refs:members.map(x=>({invoiceNo:x.invoiceNo,sourceId:x.id}))};
 });
 return {ok:true,source:'canonical-signed-ledger',revision,orders,addressGroups,
  totalMatches:Number(signed?.data?.totalMatches)||orders.length,
  truncated:Number(signed?.data?.totalMatches)>orders.length};
}
function checkedLegacyDetails(input){
 check(input?.confirmed===true&&input?.identityConfirmed===true,
  'LEGACY_OWNER_CONFIRMATION_REQUIRED',403);
 let data,addresses;
 try{
  data=validateCustomerProfile(input,{admin:true});
  addresses=(Array.isArray(input.addresses)?input.addresses:[]).map(a=>validateAddress(a));
 }catch(e){throw new CrmError(e.code||'LEGACY_CONTACT_INVALID');}
 check(Object.prototype.hasOwnProperty.call(input,'discountBps')&&
  Number.isSafeInteger(input.discountBps)&&input.discountBps>=0&&input.discountBps<=10000,
  'LEGACY_DISCOUNT_EXPLICIT_REQUIRED');
 check(addresses.length>=1&&addresses.length<=30,'LEGACY_ADDRESSES_REQUIRED');
 const unique=new Set();
 for(const a of addresses){
  const k=(a.recipientPhone+'|'+a.address).normalize('NFKC').toLowerCase();
  check(!unique.has(k),'LEGACY_DUPLICATE_ADDRESS',409);unique.add(k);
 }
 return {data,addresses};
}
async function findVerifiedGmail(c,email){
 if(!email)return null;
 const found=await c.query('SELECT id,email,access_status,revision FROM satori_v2_accounts '+
  'WHERE lower(email)=lower($1) ORDER BY created_at DESC FOR UPDATE',[email]);
 check(found.rows.length<=1,'LEGACY_GMAIL_AMBIGUOUS',409);
 return found.rows[0]||null;
}
async function activateLegacyAccount(c,owner,account,data,addresses,invoiceNos,sourceRevision,expectedRevision){
 check(account&&account.id!==owner.id&&account.access_status!=='REMOVED'&&
  account.access_status!=='SUSPENDED','LEGACY_ACCOUNT_UNAVAILABLE',409);
 check(account.email.toLowerCase()===data.email.toLowerCase(),
  'LEGACY_VERIFIED_GMAIL_MISMATCH',403);
 check(account.revision===expectedRevision,'LEGACY_ACCOUNT_REVISION_CONFLICT',409);
 const p=await c.query('SELECT id FROM satori_v2_profiles WHERE account_id=$1 '+
  'ORDER BY created_at LIMIT 1 FOR UPDATE',[account.id]);
 let profileId;
 if(p.rows.length){
  profileId=p.rows[0].id;
  await c.query('UPDATE satori_v2_profiles SET type=$2,display_name=$3,phone=$4,'+
   'revision=revision+1 WHERE id=$1',
   [profileId,data.requestedType,data.fullName,data.phone]);
 }else{
  const created=await c.query('INSERT INTO satori_v2_profiles '+
   '(account_id,type,display_name,phone) VALUES($1,$2,$3,$4) RETURNING id',
   [account.id,data.requestedType,data.fullName,data.phone]);
  profileId=created.rows[0].id;
 }
 // Registration schema requires a shipping phone, but Gmail linking does not.
 // Keep registration absent until a usable shipping phone is supplied.
 if(data.phone)await c.query('INSERT INTO satori_v2_registrations '+
  '(account_id,full_name,phone,address,company_name,tax_code,note,requested_type,reviewed_at,reviewed_by) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) ON CONFLICT(account_id) DO UPDATE SET '+
  'full_name=EXCLUDED.full_name,phone=EXCLUDED.phone,address=EXCLUDED.address,'+
  'company_name=EXCLUDED.company_name,tax_code=EXCLUDED.tax_code,note=EXCLUDED.note,'+
  'requested_type=EXCLUDED.requested_type,reviewed_at=now(),reviewed_by=EXCLUDED.reviewed_by,'+
  'revision=satori_v2_registrations.revision+1,updated_at=now()',
  [account.id,data.fullName,data.phone,data.address,data.companyName,data.taxCode,
   data.note,data.requestedType,owner.id]);
 const existing=await c.query('SELECT recipient_phone,address FROM satori_v2_addresses WHERE profile_id=$1',
  [profileId]);
 const known=new Set(existing.rows.map(x=>(x.recipient_phone+'|'+x.address).normalize('NFKC').toLowerCase()));
 let addressesAdded=0;
 for(const a of addresses){
  const key=(a.recipientPhone+'|'+a.address).normalize('NFKC').toLowerCase();
  if(known.has(key))continue;
  await c.query('INSERT INTO satori_v2_addresses '+
   '(profile_id,label,recipient_name,recipient_phone,address) VALUES($1,$2,$3,$4,$5)',
   [profileId,a.label,a.recipientName,a.recipientPhone,a.address]);
  known.add(key);addressesAdded++;
 }
 if(data.requestedType==='collaborator')
  check(Number.isSafeInteger(data.collaboratorBps)&&data.collaboratorBps>=data.discountBps,
   'CTV_RATE_REQUIRED_BEFORE_ACTIVATION',409);
 await applyGeneralDiscount(c,profileId,owner.google_sub,data.discountBps,
  data.requestedType==='collaborator'?data.collaboratorBps:null);
 const updated=await c.query('UPDATE satori_v2_accounts SET display_name=$2,'+
  "access_status='ACTIVE',revision=revision+1,updated_at=now() "+
  'WHERE id=$1 RETURNING revision',[account.id,data.fullName]);
 await audit(c,owner.id,'LEGACY_CRM_ACTIVATED',account.id,
  {invoiceNos,sourceRevision,profileId,discountBps:data.discountBps,
   collaboratorBps:data.collaboratorBps,addressesAdded});
 return {ok:true,state:'ACTIVE',accountId:account.id,profileId,addressesAdded,
  revision:updated.rows[0].revision};
}
export async function legacyCustomerImport(pool,owner,input){
 const {data,addresses}=checkedLegacyDetails(input);
 check(typeof input.query==='string'&&Array.isArray(input.invoiceNos)&&
  input.invoiceNos.length>=1&&input.invoiceNos.length<=30&&
  input.invoiceNos.every(v=>Number.isSafeInteger(v)&&v>0)&&
  new Set(input.invoiceNos).size===input.invoiceNos.length,'LEGACY_INVOICES_INVALID');
 const signed=await legacyCustomerSearch(input.query);
 check(signed.revision===input.sourceRevision,'LEGACY_SOURCE_REVISION_CHANGED',409);
 const found=new Map(signed.orders.map(o=>[o.invoiceNo,o]));
 check(input.invoiceNos.every(n=>found.get(n)?.id),'LEGACY_INVOICE_ID_UNVERIFIED',409);
 return tx(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock($1,$2)',[20261029,7]);
  const invoiceNos=input.invoiceNos.map(String);
  const prior=await c.query('SELECT id FROM satori_v2_audit '+
   "WHERE event_type IN ('LEGACY_CRM_STAGED','LEGACY_CRM_ACTIVATED') "+
   "AND details->'invoiceNos' ?| $1::text[] LIMIT 1",[invoiceNos]);
  check(prior.rowCount===0,'LEGACY_INVOICE_ALREADY_IMPORTED',409);
  const account=await findVerifiedGmail(c,data.email);
  if(account){
   check(input.expectedAccountRevision===account.revision,'LEGACY_ACCOUNT_REVISION_CONFLICT',409);
   return activateLegacyAccount(c,owner,account,data,addresses,invoiceNos,
    signed.revision,input.expectedAccountRevision);
  }
  const lead=await c.query('INSERT INTO satori_v2_customer_leads '+
   '(full_name,email,phone,address,company_name,tax_code,note,requested_type,discount_bps,collaborator_bps) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,revision',
   [data.fullName,data.email,data.phone,data.address,data.companyName,data.taxCode,
    data.note,data.requestedType,data.discountBps,data.collaboratorBps]);
  // Private V2 audit holds all staged delivery points until customer verifies Gmail.
  await audit(c,owner.id,'LEGACY_CRM_STAGED',lead.rows[0].id,
   {invoiceNos,sourceRevision:signed.revision,addresses,discountBps:data.discountBps,
    collaboratorBps:data.collaboratorBps});
  return {ok:true,state:'WAITING_FOR_GMAIL',leadId:lead.rows[0].id,
   addressesStaged:addresses.length};
 });
}

/**
 * A verified Google login may claim exactly one PRE-APPROVED, still-unlinked
 * old CRM lead with the same email. It never infers identity from name/phone,
 * claims historical invoices, or grants a rate from customer registration.
 *
 * Caller must already have verified the Google ID token and must pass its sub
 * and email. Execute inside the login's existing SQL transaction. Ambiguity
 * and incomplete owner-approved pricing deliberately keep the account PENDING.
 */
export async function autoActivateVerifiedLegacyGmail(c,{accountId,googleSub,email,ownerGoogleSub,dryRun=false}){
 if(!isUuid(accountId)||typeof googleSub!=='string'||googleSub.length<5||
    typeof email!=='string'||!email.trim()||!ownerGoogleSub||googleSub===ownerGoogleSub)
  return {state:'PENDING',reason:'IDENTITY_NOT_ELIGIBLE'};
 const account=await c.query('SELECT id,email,access_status FROM satori_v2_accounts '+
  "WHERE id=$1 AND google_sub=$2 AND lower(email)=lower($3) AND access_status='PENDING' FOR UPDATE",
  [accountId,googleSub,email.trim()]);
 if(account.rowCount!==1)return {state:'PENDING',reason:'ACCOUNT_NOT_PENDING'};
 const duplicateAccount=await c.query('SELECT id FROM satori_v2_accounts '+
  'WHERE lower(email)=lower($1) AND id<>$2 LIMIT 1',[email.trim(),accountId]);
 if(duplicateAccount.rowCount)return {state:'PENDING',reason:'EMAIL_USED_BY_OTHER_ACCOUNT'};
 const leads=await c.query('SELECT * FROM satori_v2_customer_leads '+
  'WHERE active=true AND lower(email)=lower($1) ORDER BY id FOR UPDATE',[email.trim()]);
 // Multiple accounts/contacts for the same Gmail must be resolved by owner.
 if(leads.rowCount!==1)return {state:'PENDING',reason:'NO_UNIQUE_LEGACY_LEAD'};
 const lead=leads.rows[0];
 // An earlier owner action may already have linked this SAME Google account
 // without granting ACTIVE access. Preserve that link, never relink another.
 if(lead.linked_account_id&&lead.linked_account_id!==accountId)
  return {state:'PENDING',reason:'LEAD_LINKED_TO_ANOTHER_ACCOUNT'};
 const source=await c.query('SELECT event_type,details FROM satori_v2_audit '+
  "WHERE resource_id=$1 AND event_type IN ('CUSTOMER_LEAD_CREATED','LEGACY_CRM_STAGED') "+
  'ORDER BY id DESC LIMIT 1',[lead.id]);
 if(source.rowCount!==1)return {state:'PENDING',reason:'NO_OWNER_APPROVAL'};
 const owner=await c.query('SELECT id FROM satori_v2_accounts WHERE google_sub=$1 LIMIT 1',
  [ownerGoogleSub]);
 if(owner.rowCount!==1)return {state:'PENDING',reason:'OWNER_NOT_INITIALIZED'};
 let data,addresses;
 try{
  data=validateCustomerProfile({
   fullName:lead.full_name,phone:lead.phone,address:lead.address,
   email:lead.email,companyName:lead.company_name,taxCode:lead.tax_code,
   note:lead.note,requestedType:lead.requested_type,
   discountBps:lead.discount_bps,collaboratorBps:lead.collaborator_bps
  },{admin:true,phoneOptional:true});
  if(!data.email||data.email!==email.trim().toLowerCase()||
     data.requestedType==='collaborator'&&!Number.isSafeInteger(data.collaboratorBps))
   return {state:'PENDING',reason:'LEGACY_POLICY_INVALID'};
  const primary=data.phone?validateAddress({label:'Khách cũ',recipientName:data.fullName,
   recipientPhone:data.phone,address:data.address}):null;
  if(source.rows[0].event_type==='LEGACY_CRM_STAGED'){
   const staged=source.rows[0].details;
   if(!Array.isArray(staged?.addresses))return {state:'PENDING',reason:'STAGED_ADDRESSES_INVALID'};
   addresses=staged.addresses.flatMap(x=>{
    try{return [validateAddress(x)]}catch{return []}
   });
   if(primary)addresses=[primary,...addresses];
  }else addresses=primary?[primary]:[];
 }catch{
  return {state:'PENDING',reason:'LEGACY_CONTACT_INVALID'};
 }
 const profiles=await c.query('SELECT id FROM satori_v2_profiles WHERE account_id=$1 '+
  'ORDER BY created_at LIMIT 2 FOR UPDATE',[accountId]);
 if(profiles.rowCount>1)return {state:'PENDING',reason:'AMBIGUOUS_PROFILES'};
 const profileId=profiles.rows[0]?.id||null;
 if(profileId){
  // Manually linked PENDING accounts can already have the old customer CK.
  // Only reconcile an owner-signed DEFAULT policy matching the approved lead.
  // Mismatched rates or customized address/SKU rules require manual review.
  const existing=await c.query('SELECT address_id,product_code,discount_bps,'+
   'collaborator_bps,approved_by FROM satori_v2_policies '+
   'WHERE profile_id=$1 AND enabled=true FOR UPDATE',[profileId]);
  if(existing.rows.some(p=>p.address_id||p.product_code||
   p.approved_by!==ownerGoogleSub||p.discount_bps!==data.discountBps||
   p.collaborator_bps!=null&&p.collaborator_bps!==data.collaboratorBps))
   return {state:'PENDING',reason:'EXISTING_POLICY_REQUIRES_OWNER'};
 }
 if(dryRun)return {state:'READY',role:data.requestedType};
 let targetProfile=profileId;
 if(targetProfile){
  await c.query('UPDATE satori_v2_profiles SET type=$2,display_name=$3,phone=$4,'+
   'revision=revision+1 WHERE id=$1',[targetProfile,data.requestedType,data.fullName,data.phone]);
 }else{
  const created=await c.query('INSERT INTO satori_v2_profiles '+
   '(account_id,type,display_name,phone) VALUES($1,$2,$3,$4) RETURNING id',
   [accountId,data.requestedType,data.fullName,data.phone]);
  targetProfile=created.rows[0].id;
 }
 const stored=await c.query('SELECT recipient_phone,address FROM satori_v2_addresses '+
  'WHERE profile_id=$1 FOR UPDATE',[targetProfile]);
 const addressKey=a=>(String(a.recipientPhone||a.recipient_phone||'')+'|'+String(a.address||''))
  .normalize('NFKC').trim().toLowerCase();
 const seen=new Set(stored.rows.map(addressKey));
 let addressesAdded=0;
 for(const addr of addresses){
  if(seen.has(addressKey(addr)))continue;
  await c.query('INSERT INTO satori_v2_addresses '+
   '(profile_id,label,recipient_name,recipient_phone,address) VALUES($1,$2,$3,$4,$5)',
   [targetProfile,addr.label,addr.recipientName,addr.recipientPhone,addr.address]);
  seen.add(addressKey(addr));addressesAdded++;
 }
 if(data.phone)await c.query('INSERT INTO satori_v2_registrations '+
  '(account_id,full_name,phone,address,company_name,tax_code,note,requested_type,reviewed_at,reviewed_by) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) ON CONFLICT(account_id) DO UPDATE SET '+
  'full_name=EXCLUDED.full_name,phone=EXCLUDED.phone,address=EXCLUDED.address,'+
  'company_name=EXCLUDED.company_name,tax_code=EXCLUDED.tax_code,note=EXCLUDED.note,'+
  'requested_type=EXCLUDED.requested_type,reviewed_at=now(),reviewed_by=EXCLUDED.reviewed_by,'+
  'revision=satori_v2_registrations.revision+1,updated_at=now()',
  [accountId,data.fullName,data.phone,data.address,data.companyName,data.taxCode,data.note,
   data.requestedType,owner.rows[0].id]);
 await applyGeneralDiscount(c,targetProfile,ownerGoogleSub,data.discountBps,
  data.requestedType==='collaborator'?data.collaboratorBps:null);
 if(!lead.linked_account_id){
  const linked=await c.query('UPDATE satori_v2_customer_leads SET linked_account_id=$2,'+
   'revision=revision+1,updated_at=now() WHERE id=$1 AND linked_account_id IS NULL RETURNING id',
   [lead.id,accountId]);
  check(linked.rowCount===1,'LEGACY_LEAD_RACE',409);
 }
 await c.query('UPDATE satori_v2_accounts SET display_name=$2,'+
  "access_status='ACTIVE',revision=revision+1,updated_at=now() WHERE id=$1",
  [accountId,data.fullName]);
 await c.query('INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) '+
  "VALUES($1,'system','LEGACY_VERIFIED_GMAIL_AUTO_ACTIVATED',$2,$3)",
  [accountId,lead.id,JSON.stringify({profileId:targetProfile,role:data.requestedType,
   discountBps:data.discountBps,collaboratorBps:data.collaboratorBps,
   addressesAdded,oneInvoice:true})]);
 return {state:'ACTIVE',profileId:targetProfile,leadId:lead.id,addressesAdded};
}


/** An existing session was originally established through verified Google OAuth.
 * The customer can retry safe legacy reconciliation without re-authentication.
 * Never derives identity from a user-supplied email, name, or phone.
 */
export async function reconcileVerifiedLegacySession(pool,actor,ownerGoogleSub,{dryRun=false}={}){
 if(!actor||actor.access_status!=='PENDING')
  return {state:'PENDING',reason:'ACCOUNT_NOT_PENDING'};
 return tx(pool,c=>autoActivateVerifiedLegacyGmail(c,{
  accountId:actor.id,googleSub:actor.google_sub,email:actor.email,
  ownerGoogleSub,dryRun
 }));
}

/** Admin explicitly reconciles previously verified PENDING accounts.
 * One small transaction per account, failure isolated and no cross-account writes.
 */
export async function adminReconcileVerifiedLegacyPending(pool,owner,ownerGoogleSub){
 check(owner?.google_sub===ownerGoogleSub,'ADMIN_REQUIRED',403);
 const r=await pool.query('SELECT id,google_sub,email,access_status FROM satori_v2_accounts '+
  "WHERE access_status='PENDING' ORDER BY created_at LIMIT 40");
 let activated=0,unchanged=0;
 const reasons={};
 for(const actor of r.rows){
  const out=await reconcileVerifiedLegacySession(pool,actor,ownerGoogleSub);
  if(out.state==='ACTIVE')activated++;
  else {unchanged++;reasons[out.reason||'NOT_ELIGIBLE']=(reasons[out.reason||'NOT_ELIGIBLE']||0)+1;}
 }
 return {ok:true,checked:r.rowCount,activated,unchanged,reasons,truncated:r.rowCount===40};
}

/**
 * ONE owner operation for linking a preconfigured CRM lead to an already
 * Google-verified V2 account. No prior staged-invoice audit is needed.
 * Does not claim any historical invoice and never trusts a name match.
 */
export async function ownerActivateSavedGmail(pool,owner,input){
 check(input?.confirmed===true&&input?.identityConfirmed===true,'OWNER_CONFIRMATION_REQUIRED',403);
 check(isUuid(input?.leadId)&&isUuid(input?.accountId),'CRM_LINK_IDS_REQUIRED');
 check(isRev(input?.expectedLeadRevision)&&isRev(input?.expectedAccountRevision),
  'CRM_LINK_REVISION_REQUIRED');
 check(owner?.id!==input.accountId,'OWNER_CANNOT_BE_MODIFIED',403);
 return tx(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock($1,$2)',[20261029,19]);
  const leadResult=await c.query('SELECT * FROM satori_v2_customer_leads WHERE id=$1 FOR UPDATE',
   [input.leadId]);
  check(leadResult.rowCount===1&&leadResult.rows[0].active,'LEGACY_LEAD_NOT_FOUND',404);
  const lead=leadResult.rows[0];
  check(lead.revision===input.expectedLeadRevision,'LEAD_REVISION_CONFLICT',409);
  check(!lead.linked_account_id||lead.linked_account_id===input.accountId,
   'LEAD_LINKED_TO_ANOTHER_ACCOUNT',409);
  check(lead.email,'LEGACY_EMAIL_REQUIRED',409);
  const accountResult=await c.query('SELECT id,email,google_sub,access_status,revision '+
   'FROM satori_v2_accounts WHERE id=$1 FOR UPDATE',[input.accountId]);
  check(accountResult.rowCount===1,'CUSTOMER_NOT_FOUND',404);
  const account=accountResult.rows[0];
  check(account.access_status==='PENDING','CUSTOMER_NOT_PENDING',409);
  check(account.revision===input.expectedAccountRevision,'CUSTOMER_REVISION_CONFLICT',409);
  check(account.google_sub&&account.email.toLowerCase()===lead.email.toLowerCase(),
   'LEGACY_VERIFIED_GMAIL_MISMATCH',403);
  const duplicates=await c.query('SELECT id FROM satori_v2_customer_leads '+
   'WHERE active=true AND lower(email)=lower($1) AND id<>$2 LIMIT 1',[lead.email,lead.id]);
  check(!duplicates.rowCount,'LEGACY_GMAIL_AMBIGUOUS',409);
  const otherAccounts=await c.query('SELECT id FROM satori_v2_accounts '+
   'WHERE lower(email)=lower($1) AND id<>$2 LIMIT 1',[lead.email,account.id]);
  check(!otherAccounts.rowCount,'LEGACY_GMAIL_AMBIGUOUS',409);
  // Never authorize a lead that was not actually created through the owner CRM.
  const approved=await c.query('SELECT 1 FROM satori_v2_audit '+
   "WHERE resource_id=$1 AND event_type IN ('CUSTOMER_LEAD_CREATED','LEGACY_CRM_STAGED') "+
   'LIMIT 1',[lead.id]);
  check(approved.rowCount===1,'NO_OWNER_APPROVAL',409);
  const data=checked(()=>validateCustomerProfile({
   fullName:lead.full_name,email:lead.email,phone:lead.phone,address:lead.address,
   companyName:lead.company_name,taxCode:lead.tax_code,note:lead.note,
   requestedType:lead.requested_type,discountBps:lead.discount_bps,
   collaboratorBps:lead.collaborator_bps
  },{admin:true,phoneOptional:true}));
  const primary=data.phone?checked(()=>validateAddress({
   label:'Địa chỉ chính',recipientName:data.fullName,recipientPhone:data.phone,address:data.address
  })):null;
  const existingProfiles=await c.query('SELECT id FROM satori_v2_profiles '+
   'WHERE account_id=$1 ORDER BY created_at LIMIT 2 FOR UPDATE',[account.id]);
  check(existingProfiles.rowCount<=1,'AMBIGUOUS_PROFILES',409);
  if(existingProfiles.rowCount){
   const rules=await c.query('SELECT address_id,product_code,discount_bps,collaborator_bps,approved_by '+
    'FROM satori_v2_policies WHERE profile_id=$1 AND enabled=true FOR UPDATE',
    [existingProfiles.rows[0].id]);
   check(rules.rows.every(r=>r.address_id==null&&r.product_code==null&&
    r.approved_by===owner.google_sub&&r.discount_bps===data.discountBps&&
    (r.collaborator_bps==null||r.collaborator_bps===data.collaboratorBps)),
    'EXISTING_POLICY_REQUIRES_OWNER',409);
  }
  const result=await activateLegacyAccount(c,owner,account,data,primary?[primary]:[],[],null,account.revision);
  const linked=await c.query('UPDATE satori_v2_customer_leads SET linked_account_id=$2,'+
   'revision=revision+1,updated_at=now() WHERE id=$1 '+
   'AND (linked_account_id IS NULL OR linked_account_id=$2) RETURNING id',
   [lead.id,account.id]);
  check(linked.rowCount===1,'LEAD_LINK_CONFLICT',409);
  await audit(c,owner.id,'OWNER_SAVED_GMAIL_LINKED',lead.id,{
   accountId:account.id,profileId:result.profileId,role:data.requestedType,
   discountBps:data.discountBps,collaboratorBps:data.collaboratorBps,
   invoiceHistoryUnchanged:true
  });
  return {...result,leadId:lead.id,source:'owner-saved-crm'};
 });
}

export async function legacyCustomerActivateLead(pool,owner,input){
 check(input?.confirmed===true&&input?.identityConfirmed===true,
  'LEGACY_OWNER_CONFIRMATION_REQUIRED',403);
 check(isUuid(input.leadId)&&isRev(input.expectedRevision),'LEGACY_LEAD_INVALID');
 return tx(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock($1,$2)',[20261029,7]);
  const found=await c.query('SELECT * FROM satori_v2_customer_leads WHERE id=$1 FOR UPDATE',
   [input.leadId]);
  check(found.rowCount===1&&found.rows[0].active,'LEGACY_LEAD_NOT_FOUND',404);
  const lead=found.rows[0];
  check(lead.revision===input.expectedRevision&&!lead.linked_account_id,
   'LEGACY_LEAD_REVISION_CONFLICT',409);
  check(lead.email,'LEGACY_EMAIL_REQUIRED',409);
  const staged=await c.query('SELECT details FROM satori_v2_audit WHERE '+
   "event_type='LEGACY_CRM_STAGED' AND resource_id=$1 ORDER BY id DESC LIMIT 1",[lead.id]);
  check(staged.rowCount===1,'LEGACY_STAGING_NOT_FOUND',409);
  const account=await findVerifiedGmail(c,lead.email);
  check(account,'LEGACY_GMAIL_NOT_REGISTERED',409);
  check(account.revision===input.expectedAccountRevision,'LEGACY_ACCOUNT_REVISION_CONFLICT',409);
  const details=staged.rows[0].details;
  const data={fullName:lead.full_name,email:lead.email,phone:lead.phone,
   address:lead.address,companyName:lead.company_name,taxCode:lead.tax_code,
   note:lead.note,requestedType:lead.requested_type,discountBps:lead.discount_bps,
   collaboratorBps:lead.collaborator_bps};
  check(Array.isArray(details.addresses),'LEGACY_STAGED_ADDRESSES_MISSING',409);
  const addresses=details.addresses.map(a=>validateAddress(a));
  // If owner corrected the staged contact, the primary destination follows those edits.
  if(addresses.length)addresses[0]=validateAddress({...addresses[0],
   recipientName:lead.full_name,recipientPhone:lead.phone,address:lead.address});
  const result=await activateLegacyAccount(c,owner,account,data,addresses,
   details.invoiceNos,details.sourceRevision,input.expectedAccountRevision);
  await c.query('UPDATE satori_v2_customer_leads SET linked_account_id=$2,'+
   'revision=revision+1,updated_at=now() WHERE id=$1',[lead.id,account.id]);
  await audit(c,owner.id,'LEGACY_CRM_STAGED_LINKED',lead.id,{accountId:account.id});
  return {...result,leadId:lead.id};
 });
}


/**
 * Explicit OWNER binding of legacy invoice IDs to a Google-verified V2 account.
 * Never match a customer's ownership by name alone. Immutable audit entries
 * are V2 references; canonical invoice contents and payment status stay in V1.
 */

/** One ACTIVE shipping point per normalized address on this exact V2 profile.
 * Reuse a stable row ID when possible. Invoice history and V2 quotes stay intact.
 * Latest signed source invoice determines the displayed phone/name/address.
 */
async function syncBoundLegacyAddresses(c,profileId,addresses){
 const previous=await c.query('SELECT id,label,recipient_name,recipient_phone,address,active,created_at '+
  'FROM satori_v2_addresses WHERE profile_id=$1 FOR UPDATE',[profileId]);
 const byLocation=new Map();
 for(const row of previous.rows){
  const key=normalizedDeliveryAddress(row.address);
  if(!key)continue;
  if(!byLocation.has(key))byLocation.set(key,[]);
  byLocation.get(key).push(row);
 }
 let created=0,updated=0,duplicatesDeactivated=0;
 for(const a of addresses){
  const key=normalizedDeliveryAddress(a.address);
  if(!key)continue;
  const matching=byLocation.get(key)||[];
  matching.sort((x,y)=>Number(y.active)-Number(x.active)||
   Date.parse(y.created_at)-Date.parse(x.created_at));
  if(matching.length){
   const canonical=matching[0];
   await c.query('UPDATE satori_v2_addresses SET recipient_name=$2,recipient_phone=$3,'+
    'address=$4,active=true,revision=revision+1,updated_at=now() WHERE id=$1',
    [canonical.id,a.recipientName,a.recipientPhone,a.address]);
   updated++;
   for(const duplicate of matching.slice(1)){
    if(!duplicate.active)continue;
    await c.query('UPDATE satori_v2_addresses SET active=false,revision=revision+1,'+
     'updated_at=now() WHERE id=$1',[duplicate.id]);
    duplicatesDeactivated++;
   }
  }else{
   const createdRow=await c.query('INSERT INTO satori_v2_addresses '+
    '(profile_id,label,recipient_name,recipient_phone,address) '+
    'VALUES($1,$2,$3,$4,$5) RETURNING id,created_at',
    [profileId,a.label,a.recipientName,a.recipientPhone,a.address]);
   byLocation.set(key,[{id:createdRow.rows[0].id,created_at:createdRow.rows[0].created_at,active:true}]);
   created++;
  }
 }
 return {created,updated,duplicatesDeactivated};
}

export async function ownerBindLegacyInvoices(pool,owner,input){
 check(input?.confirmed===true&&input?.identityConfirmed===true,'LEGACY_BIND_CONFIRMATION_REQUIRED',403);
 check(isUuid(input.accountId)&&isRev(input.expectedAccountRevision),'LEGACY_BIND_ACCOUNT_INVALID');
 check(input.accountId!==owner.id,'OWNER_CANNOT_BIND_SELF',403);
 check(typeof input.query==='string'&&input.query.trim().length>=2,'LEGACY_SEARCH_REQUIRED');
 const refs=input.refs;
 check(Array.isArray(refs)&&refs.length>=1&&refs.length<=30,'LEGACY_BIND_REFS_REQUIRED');
 const keys=new Set();
 for(const r of refs){
  check(Number.isSafeInteger(r?.invoiceNo)&&r.invoiceNo>0&&
   typeof r?.sourceId==='string'&&r.sourceId.length>0&&r.sourceId.length<=80,'LEGACY_BIND_REF_INVALID');
  const key=r.invoiceNo+'|'+r.sourceId;
  check(!keys.has(key),'LEGACY_BIND_DUPLICATE',409);
  keys.add(key);
 }
 const signed=await legacyCustomerSearch(input.query);
 check(signed.revision===input.sourceRevision,'LEGACY_SOURCE_REVISION_CHANGED',409);
 check(!signed.truncated,'LEGACY_BIND_RESULT_TRUNCATED',409);
 const found=new Map(signed.orders.map(x=>[x.invoiceNo+'|'+x.id,x]));
 const rows=refs.map(x=>found.get(x.invoiceNo+'|'+x.sourceId));
 check(rows.every(Boolean),'LEGACY_BIND_SOURCE_REF_NOT_FOUND',409);
 // Never determine record identity or deduplicate destinations by customer name.
 // Only owner-confirmed source invoice IDs can establish the account binding.
 const role=input.requestedType;
 check(['retail','agency','collaborator'].includes(role),'CUSTOMER_ROLE_INVALID');
 check(Number.isSafeInteger(input.discountBps)&&input.discountBps>=0&&input.discountBps<=10000,
  'CUSTOMER_DISCOUNT_INVALID');
 check(role!=='collaborator'||Number.isSafeInteger(input.collaboratorBps)&&
  input.collaboratorBps>=input.discountBps&&input.collaboratorBps<=10000,
  'CTV_RATE_MUST_BE_AT_LEAST_CUSTOMER_RATE');
 check(role==='collaborator'||input.collaboratorBps==null,'CTV_ROLE_REQUIRED');
 const grouped=groupHistoricalAddresses(rows);
 check(grouped.length>0,'LEGACY_BIND_NO_VALID_ADDRESS',409);
 const recent=grouped[0]; // Most recently created among all distinct source locations.
 // Name is a display field supplied by Admin; it never decides account/invoice ownership.
 const displayName=String(input.profileName||'').trim()||recent.name;
 const phone=legacyPhoneCandidate(input.contactPhone)||recent.phoneCandidate||
  grouped.map(r=>r.phoneCandidate).find(Boolean)||'';
 // Phone is not an account ownership factor; missing phone never blocks linking.
 const data=checked(()=>validateCustomerProfile({
  fullName:displayName,email:input.email,phone,address:recent.address,
  requestedType:role,discountBps:input.discountBps,
  collaboratorBps:role==='collaborator'?input.collaboratorBps:null
 },{admin:true,phoneOptional:true}));
 const addresses=[];
 for(const row of grouped){
  let address;
  try{address=validateAddress({
   label:'Địa chỉ lịch sử',recipientName:row.name||data.fullName,
   recipientPhone:row.phoneCandidate||phone,address:row.address
  })}catch{continue}
  addresses.push(address);
 }
 // Addresses without valid shipping phone stay visible in signed invoice history.
 // Add a contact number only when placing a new delivery order.
 return tx(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock($1,$2)',[20261029,19]);
  const account=await c.query('SELECT id,email,access_status,revision FROM satori_v2_accounts '+
   'WHERE id=$1 FOR UPDATE',[input.accountId]);
  check(account.rowCount===1,'CUSTOMER_NOT_FOUND',404);
  const target=account.rows[0];
  check(['PENDING','ACTIVE'].includes(target.access_status),'LEGACY_ACCOUNT_UNAVAILABLE',409);
  check(target.revision===input.expectedAccountRevision,'CUSTOMER_REVISION_CONFLICT',409);
  check(target.email.toLowerCase()===data.email,'LEGACY_VERIFIED_GMAIL_MISMATCH',403);
  if(input.leadId){
   check(isUuid(input.leadId)&&isRev(input.expectedLeadRevision),
    'CRM_LINK_REVISION_REQUIRED');
   const leadResult=await c.query('SELECT * FROM satori_v2_customer_leads '+
    'WHERE id=$1 FOR UPDATE',[input.leadId]);
   check(leadResult.rowCount===1&&leadResult.rows[0].active,'LEGACY_LEAD_NOT_FOUND',404);
   const lead=leadResult.rows[0];
   check(lead.revision===input.expectedLeadRevision,'LEAD_REVISION_CONFLICT',409);
   check(!lead.linked_account_id||lead.linked_account_id===target.id,
    'LEAD_LINKED_TO_ANOTHER_ACCOUNT',409);
   check(lead.email?.toLowerCase()===target.email.toLowerCase()&&
    lead.requested_type===role&&lead.discount_bps===data.discountBps&&
    (role!=='collaborator'||lead.collaborator_bps===data.collaboratorBps),
    'CRM_APPROVED_PROFILE_MISMATCH',409);
   check(lead.full_name===data.fullName,'CRM_APPROVED_NAME_MISMATCH',409);
  }
  const dup=await c.query('SELECT id FROM satori_v2_accounts WHERE lower(email)=lower($1) AND id<>$2 LIMIT 1',
   [data.email,target.id]);
  check(dup.rowCount===0,'LEGACY_GMAIL_AMBIGUOUS',409);
  const leads=await c.query('SELECT id,linked_account_id FROM satori_v2_customer_leads '+
   'WHERE active=true AND lower(email)=lower($1) ORDER BY id FOR UPDATE',[data.email]);
  check(leads.rows.every(x=>!x.linked_account_id||x.linked_account_id===target.id),
   'LEGACY_GMAIL_LEAD_LINK_CONFLICT',409);
  check(leads.rowCount<=1,'LEGACY_GMAIL_AMBIGUOUS',409);
  let newlyBound=0;
  for(const ref of refs){
   const old=await c.query('SELECT account_id FROM satori_v2_audit WHERE '+
    "event_type='LEGACY_INVOICE_ACCOUNT_BOUND' AND details->>'sourceId'=$1 "+
    "AND details->>'invoiceNo'=$2 LIMIT 1",[ref.sourceId,String(ref.invoiceNo)]);
   check(old.rowCount===0||old.rows[0].account_id===target.id,'LEGACY_INVOICE_ALREADY_OWNED',409);
  }
  let profileId=null;
  if(target.access_status==='PENDING'){
   const current=await c.query('SELECT id FROM satori_v2_profiles '+
    'WHERE account_id=$1 ORDER BY created_at LIMIT 2 FOR UPDATE',[target.id]);
   check(current.rowCount<=1,'AMBIGUOUS_PROFILES',409);
   if(current.rowCount){
    const policies=await c.query('SELECT discount_bps,collaborator_bps,address_id,product_code '+
     'FROM satori_v2_policies WHERE profile_id=$1 AND enabled=true FOR UPDATE',
     [current.rows[0].id]);
    check(policies.rows.every(p=>p.address_id==null&&p.product_code==null&&
     p.discount_bps===data.discountBps&&
     (p.collaborator_bps==null||p.collaborator_bps===data.collaboratorBps)),
     'EXISTING_POLICY_REQUIRES_OWNER',409);
   }
   const result=await activateLegacyAccount(c,owner,target,data,addresses,
    refs.map(x=>x.invoiceNo),signed.revision,target.revision);
   profileId=result.profileId;
  }else{
   const active=await c.query('SELECT p.id,p.type FROM satori_v2_profiles p '+
    'WHERE p.account_id=$1 ORDER BY created_at LIMIT 2 FOR UPDATE',[target.id]);
   check(active.rowCount===1&&active.rows[0].type===role,'LEGACY_ACTIVE_ROLE_CONFLICT',409);
   profileId=active.rows[0].id;
   const p=await c.query('SELECT discount_bps,collaborator_bps FROM satori_v2_policies '+
    'WHERE profile_id=$1 AND enabled=true AND address_id IS NULL AND product_code IS NULL '+
    'ORDER BY version DESC LIMIT 1',[profileId]);
   check(p.rowCount===1&&p.rows[0].discount_bps===data.discountBps&&
    (role!=='collaborator'||p.rows[0].collaborator_bps===data.collaboratorBps),
    'LEGACY_ACTIVE_POLICY_CONFLICT',409);
   // The shared address sync below also handles existing ACTIVE accounts.
  }
  const addressSync=await syncBoundLegacyAddresses(c,profileId,addresses);
  if(leads.rowCount===1&&!leads.rows[0].linked_account_id)
   await c.query('UPDATE satori_v2_customer_leads SET linked_account_id=$2,revision=revision+1 '+
    'WHERE id=$1',[leads.rows[0].id,target.id]);
  for(const ref of refs){
   const already=await c.query('SELECT 1 FROM satori_v2_audit WHERE '+
    "event_type='LEGACY_INVOICE_ACCOUNT_BOUND' AND account_id=$1 "+
    "AND details->>'sourceId'=$2 AND details->>'invoiceNo'=$3 LIMIT 1",
    [target.id,ref.sourceId,String(ref.invoiceNo)]);
   if(already.rowCount)continue;
   const invoice=found.get(ref.invoiceNo+'|'+ref.sourceId);
   await c.query('INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) '+
    "VALUES($1,'owner','LEGACY_INVOICE_ACCOUNT_BOUND',$2,$3)",
    [target.id,ref.sourceId,JSON.stringify({invoiceNo:ref.invoiceNo,sourceId:ref.sourceId,
     query:input.query,sourceName:invoice.name,sourceRevision:signed.revision,
     profileId,readOnly:true})]);
   newlyBound++;
  }
  return {ok:true,accountId:target.id,accessStatus:target.access_status==='PENDING'?'ACTIVE':'ACTIVE',
   profileId,linkedInvoices:newlyBound,totalSelected:refs.length,sourceRevision:signed.revision,
   uniqueAddresses:addresses.length,addressSync};
 });
}

/** Read-only legacy history for the authenticated account. The bindings, not
 * mutable names or phone numbers, authorize an old invoice to appear.
 * Live signed ledger remains the only source of totals/payment states.
 */
export async function linkedLegacyInvoiceHistory(pool,actor){
 const binds=await pool.query('SELECT details FROM satori_v2_audit '+
  "WHERE account_id=$1 AND event_type='LEGACY_INVOICE_ACCOUNT_BOUND' "+
  'ORDER BY id DESC LIMIT 300',[actor.id]);
 if(!binds.rowCount)return {ok:true,orders:[],linkedCount:0,unavailableCount:0};
 const refs=new Map();
 for(const row of binds.rows){
  const d=row.details||{},key=d.invoiceNo+'|'+d.sourceId;
  if(Number.isSafeInteger(d.invoiceNo)&&typeof d.sourceId==='string'&&d.sourceId)
   refs.set(key,d);
 }
 const groups=new Map();
 for(const d of refs.values()){
  const name=d.query;
  if(typeof name==='string'&&name.length>=2)groups.set(name,null);
 }
 const resolved=new Map();
 for(const name of [...groups.keys()].slice(0,8)){
  try{
   const result=await legacyCustomerSearch(name);
   for(const order of result.orders){
    const key=order.invoiceNo+'|'+order.id;
    if(refs.has(key))resolved.set(key,{
     source:'legacy',invoiceNo:order.invoiceNo,sourceId:order.id,
     date:order.date,name:order.name,address:order.address,status:order.status,
     totalVnd:order.total,items:order.items,readOnly:true
    });
   }
  }catch{ /* never substitute unverified totals or broaden visibility */ }
 }
 const orders=[...resolved.values()].sort((a,b)=>b.invoiceNo-a.invoiceNo);
 const addresses=groupHistoricalAddresses(orders);
 return {ok:true,orders,addresses,uniqueAddressCount:addresses.length,
  linkedCount:refs.size,unavailableCount:refs.size-resolved.size};
}

/**
 * Owner-only, read-only registration notification feed. No extra schema,
 * no invoices, and no notification tokens stored in customer data.
 * Existing reviewed/activated accounts are excluded.
 */
export async function adminRegistrationNotifications(pool){
 const [counts,latest]=await Promise.all([
  pool.query('SELECT COUNT(*)::int AS count FROM satori_v2_accounts a '+
   'JOIN satori_v2_registrations r ON r.account_id=a.id '+
   "WHERE a.access_status='PENDING' AND r.reviewed_at IS NULL"),
  pool.query('SELECT a.id,a.email,r.full_name AS "fullName",r.phone,'+
   'r.requested_type AS "requestedType",r.submitted_at AS "submittedAt",'+
   'r.revision FROM satori_v2_accounts a '+
   'JOIN satori_v2_registrations r ON r.account_id=a.id '+
   "WHERE a.access_status='PENDING' AND r.reviewed_at IS NULL "+
   'ORDER BY r.submitted_at DESC,a.created_at DESC LIMIT 100')
 ]);
 return {ok:true,pendingCount:counts.rows[0]?.count||0,
  newest:latest.rows,checkedAt:new Date().toISOString()};
}

/** Owner-only CTV profit ledger. Source = ONE canonical COMMITTED order request
 * and its immutable priced quote snapshot, never a second CTV invoice.
 * A missing/old CTV rate is reported as unpriced instead of invented margin.
 */
export async function adminCtvProfitSummary(pool,profileId){
 check(isUuid(profileId),'CTV_PROFILE_REQUIRED');
 const profile=await pool.query(
  'SELECT id,display_name AS name,type FROM satori_v2_profiles WHERE id=$1',[profileId]);
 check(profile.rowCount===1&&profile.rows[0].type==='collaborator','CTV_PROFILE_REQUIRED',404);
 const result=await pool.query(
  'SELECT r.ledger_invoice_no AS "invoiceNo",r.created_at AS "createdAt",'+
  'q.payload FROM satori_v2_order_requests r '+
  'JOIN satori_v2_quotes q ON q.id=r.quote_id '+
  "WHERE q.profile_id=$1 AND r.state='COMMITTED' "+
  'ORDER BY r.created_at DESC LIMIT 200',[profileId]);
 let salesVnd=0,marginVnd=0,internalCostVnd=0,unpricedCount=0;
 const entries=result.rows.map(row=>{
  const q=row.payload||{},total=Number(q.totalVnd);
  const margin=Number(q.collaboratorMarginVnd);
  const internal=Number(q.internalReference?.goodsVnd);
  const validMargin=Number.isSafeInteger(margin)&&margin>=0&&
   Number.isSafeInteger(internal)&&internal>=0&&
   Number.isSafeInteger(total)&&total>=margin;
  const validTotal=Number.isSafeInteger(total)&&total>=0;
  if(validTotal)salesVnd+=total;
  if(validMargin){marginVnd+=margin;internalCostVnd+=internal}
  else unpricedCount++;
  return {invoiceNo:row.invoiceNo,createdAt:row.createdAt,
   customer:q.delivery?.recipientName||'Khách của CTV',
   address:q.delivery?.address||'',
   saleVnd:validTotal?total:null,marginVnd:validMargin?margin:null,
   ...(validMargin?{internalCostVnd:internal}:{})};
 });
 return {ok:true,profileId,invoiceMode:'single',count:entries.length,
  salesVnd,marginVnd,internalCostVnd,unpricedCount,entries};
}
