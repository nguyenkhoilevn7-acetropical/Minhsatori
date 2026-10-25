/**
 * Standalone V2 CRM data access. No old /real, /ctv, Apps Script,
 * customer invoice tables, cleartext passwords or client-side Admin authority.
 */
import {validateCustomerProfile,validateCustomerStatus} from './customer-management.mjs';
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
  return {ok:true,accessStatus:'PENDING',revision:r.rows[0].revision,
   message:'Đã nhận hồ sơ. Admin cần duyệt trước khi đặt hàng.'};
 });
}
export async function registrationRead(pool,actor){
 const r=await pool.query(
  'SELECT account_id AS "accountId",full_name AS "fullName",phone,address,'+
  'company_name AS "companyName",tax_code AS "taxCode",note,'+
  'requested_type AS "requestedType",revision,submitted_at AS "submittedAt" '+
  'FROM satori_v2_registrations WHERE account_id=$1',[actor.id]);
 return {ok:true,accessStatus:actor.access_status,registration:r.rows[0]||null};
}
export async function adminCustomerList(pool){
 const [registered,leads]=await Promise.all([
  pool.query('SELECT a.id,a.email,a.display_name AS name,a.access_status AS "accessStatus",'+
   'a.revision,a.created_at AS "createdAt",r.full_name AS "fullName",'+
   'r.phone,r.address,r.company_name AS "companyName",r.tax_code AS "taxCode",'+
   'r.note,r.requested_type AS "requestedType",r.revision AS "registrationRevision",'+
   'r.submitted_at AS "submittedAt",'+
   'COALESCE((SELECT p.discount_bps FROM satori_v2_profiles prof '+
   'JOIN satori_v2_policies p ON p.profile_id=prof.id '+
   'WHERE prof.account_id=a.id AND p.enabled=true AND p.address_id IS NULL '+
   'AND p.product_code IS NULL ORDER BY prof.created_at ASC,p.version DESC LIMIT 1),0) AS "discountBps" '+
   'FROM satori_v2_accounts a LEFT JOIN satori_v2_registrations r ON r.account_id=a.id '+
   'ORDER BY a.created_at DESC LIMIT 250'),
  pool.query('SELECT id,full_name AS "fullName",email,phone,address,'+
   'company_name AS "companyName",tax_code AS "taxCode",note,'+
   'requested_type AS "requestedType",discount_bps AS "discountBps",'+
   'linked_account_id AS "linkedAccountId",active,revision,created_at AS "createdAt" '+
   'FROM satori_v2_customer_leads ORDER BY created_at DESC LIMIT 250')
 ]);
 // Explicit projections are intentional: there is NO password column.
 return {ok:true,registered:registered.rows,leads:leads.rows};
}
export async function adminCreateLead(pool,ownerId,input){
 check(input.confirmed===true,'OWNER_CONFIRMATION_REQUIRED',403);
 const data=checked(()=>validateCustomerProfile(input,{admin:true}));
 return tx(pool,async c=>{
  const r=await c.query(
   'INSERT INTO satori_v2_customer_leads '+
   '(full_name,email,phone,address,company_name,tax_code,note,requested_type,discount_bps) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,revision',
   [data.fullName,data.email,data.phone,data.address,data.companyName,
    data.taxCode,data.note,data.requestedType,data.discountBps]);
  await audit(c,ownerId,'CUSTOMER_LEAD_CREATED',r.rows[0].id);
  return {ok:true,lead:{...r.rows[0],active:true}};
 });
}
export async function adminPatchLead(pool,ownerId,input){
 check(input.confirmed===true,'OWNER_CONFIRMATION_REQUIRED',403);
 check(isUuid(input.leadId)&&isRev(input.expectedRevision),'LEAD_REVISION_REQUIRED');
 check(typeof input.active==='boolean','LEAD_STATUS_INVALID');
 const data=input.active?checked(()=>validateCustomerProfile(input,{admin:true})):null;
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
   'revision=revision+1,updated_at=now() '+
   'WHERE id=$1 AND revision=$2 RETURNING id,revision,active',
   [input.leadId,input.expectedRevision,input.active,
    data?.fullName??null,data?.email??null,data?.phone??null,
    data?.address??null,data?.companyName??null,data?.taxCode??null,
    data?.note??null,data?.requestedType??null,data?.discountBps??null]);
  check(r.rows.length===1,'LEAD_REVISION_CONFLICT',409);
  await audit(c,ownerId,input.active?'CUSTOMER_LEAD_UPDATED':'CUSTOMER_LEAD_ARCHIVED',input.leadId);
  return {ok:true,lead:r.rows[0]};
 });
}
async function applyGeneralDiscount(c,profileId,ownerSub,discountBps){
 const versions=await c.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM satori_v2_policies '+
  'WHERE profile_id=$1 AND address_id IS NULL AND product_code IS NULL',[profileId]);
 await c.query('UPDATE satori_v2_policies SET enabled=false,revision=revision+1 '+
  'WHERE profile_id=$1 AND address_id IS NULL AND product_code IS NULL AND enabled=true',[profileId]);
 return c.query(
  'INSERT INTO satori_v2_policies '+
  '(profile_id,address_id,product_code,discount_bps,invoice_mode,version,approved_by) '+
  "VALUES($1,NULL,NULL,$2,'single',$3,$4) RETURNING id,version",
  [profileId,discountBps,versions.rows[0].version,ownerSub]);
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
  // Do not rewrite stored shipping addresses or historical quote snapshots.
  // Existing address edits remain explicit and revision-controlled.
  await audit(c,owner.id,'CUSTOMER_REGISTRATION_EDITED',input.accountId,
   {registrationRevision:updated.rows[0].revision});
  return {ok:true,revision:updated.rows[0].revision};
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
   const reg=await c.query('SELECT full_name,phone,address,requested_type FROM satori_v2_registrations '+
    'WHERE account_id=$1',[input.accountId]);
   check(reg.rows.length===1,'CUSTOMER_REGISTRATION_INCOMPLETE',409);
   const data=reg.rows[0];
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
    await applyGeneralDiscount(c,profileId,owner.google_sub,change.discountBps);
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
   {approvedDiscountBps:change.status==='ACTIVE'?change.discountBps??null:null});
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
  if(profile.rows.length&&l.discount_bps>=0)
   await applyGeneralDiscount(c,profile.rows[0].id,owner.google_sub,l.discount_bps);
  await audit(c,owner.id,'CUSTOMER_LEAD_MANUALLY_LINKED',input.leadId,
   {linkedAccountId:input.accountId,discountBps:l.discount_bps});
  return {ok:true,lead:link.rows[0],linkedAccountId:input.accountId};
 });
}
