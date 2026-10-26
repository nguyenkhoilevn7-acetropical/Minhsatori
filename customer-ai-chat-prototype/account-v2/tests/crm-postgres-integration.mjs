/* Dedicated PostgreSQL 16 CI account lifecycle. Synthetic users only. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {registrationSave,adminCreateLead,adminPatchLead,adminChangeCustomerStatus,
 adminLinkLead,adminCustomerList,registrationRead,adminEditRegisteredCustomer} from '../customer-backend.mjs';

const url=process.env.SATORI_V2_CI_DATABASE_URL||'';
assert.ok(url.includes('127.0.0.1')&&url.endsWith('/satori_v2_ci'),
 'CRM test MUST use isolated localhost-only database');
const pool=new pg.Pool({connectionString:url,max:8});
const one=async(sql,params)=>{
 const r=await pool.query(sql,params);assert.equal(r.rowCount,1);return r.rows[0];
};
const form={
 fullName:'Fake Old Agency',phone:'0900000000',address:'123 Synthetic Rd',
 companyName:'Fake Co Ltd',taxCode:'0300000000',note:'FAKE ONLY',
 requestedType:'agency',email:'oldagency@example.invalid'
};
try{
 const owner=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,'owner@demo.invalid','ACTIVE') RETURNING id,google_sub",
  ['ci-owner-'+randomUUID()]);
 const customer=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,$2,'PENDING') RETURNING id,email,access_status",
  ['ci-customer-'+randomUUID(),form.email]);
 const data=await registrationSave(pool,{...customer,access_status:'PENDING'},form);
 assert.equal(data.accessStatus,'PENDING');
 const read=await registrationRead(pool,customer);
 assert.equal(read.registration.fullName,form.fullName);
 assert.equal(read.registration.phone,form.phone);
 const lead=await adminCreateLead(pool,owner.id,{...form,discountBps:2000,confirmed:true});
 assert.ok(lead.lead.id);
 const leadRow=await one('SELECT discount_bps,active FROM satori_v2_customer_leads WHERE id=$1',
  [lead.lead.id]);assert.equal(leadRow.discount_bps,2000);
 // Link only after selecting a Google-verified account; no name/phone auto claim.
 const link=await adminLinkLead(pool,owner,{leadId:lead.lead.id,accountId:customer.id,
  expectedRevision:lead.lead.revision,confirmed:true});
 assert.equal(link.linkedAccountId,customer.id);
 await assert.rejects(()=>adminPatchLead(pool,owner.id,{
  ...form,leadId:lead.lead.id,expectedRevision:link.lead.revision,
  active:true,confirmed:true,discountBps:3500}),
  /LINKED_LEAD_EDIT_REQUIRES_ACCOUNT_POLICY/,
  'Linked leads must use the account pricing policy, not hidden lead edits');
 await assert.rejects(()=>adminLinkLead(pool,owner,{leadId:lead.lead.id,
  accountId:customer.id,expectedRevision:lead.lead.revision,confirmed:true}),
  /LEAD_REVISION_CONFLICT|LEAD_ALREADY_LINKED/);
 const activated=await adminChangeCustomerStatus(pool,owner,{accountId:customer.id,
  expectedRevision:1,status:'ACTIVE',confirmed:true,discountBps:2500});
 assert.equal(activated.customer.accessStatus,'ACTIVE');
 assert.ok(activated.profileId);
 const addr=await one('SELECT count(*)::int AS count FROM satori_v2_addresses WHERE profile_id=$1',
  [activated.profileId]);assert.equal(addr.count,1);
 const profile=await one('SELECT type,display_name AS name FROM satori_v2_profiles WHERE id=$1',
  [activated.profileId]);assert.equal(profile.type,'agency');assert.equal(profile.name,form.fullName);
 const policy=await one('SELECT discount_bps AS discount,version FROM satori_v2_policies '+
  'WHERE profile_id=$1 AND enabled=true ORDER BY version DESC LIMIT 1',[activated.profileId]);
 assert.equal(policy.discount,2500);
 const edited=await adminEditRegisteredCustomer(pool,owner,{
  accountId:customer.id,expectedRevision:1,confirmed:true,
  ...form,fullName:'Fake Agency Updated',address:'Edited Registration Address'});
 assert.equal(edited.revision,2);
 await assert.rejects(()=>adminEditRegisteredCustomer(pool,owner,{
  accountId:customer.id,expectedRevision:1,confirmed:true,...form}),
  /CUSTOMER_DETAILS_REVISION_CONFLICT/);
 await assert.rejects(()=>adminEditRegisteredCustomer(pool,owner,{
  accountId:customer.id,expectedRevision:2,confirmed:true,
  ...form,email:'different@example.invalid'}),/VERIFIED_EMAIL_IMMUTABLE/);
 const list=await adminCustomerList(pool);
 const readback=list.registered.find(x=>x.id===customer.id);
 assert.equal(readback.address,'Edited Registration Address');
 assert.equal(readback.fullName,'Fake Agency Updated');
 assert.equal(readback.companyName,form.companyName);
 assert.equal(readback.taxCode,form.taxCode);
 assert.equal(readback.discountBps,2500,
  'Admin list must read approved policy rather than reset discount display to zero');
 assert.equal(readback.hasCtvProfile,false,'Agency is not eligible for CTV mode switch');
 assert.equal(readback.ctvEnabled,true,'Default mode value remains explicit');
 // Owner list must distinguish real collaborator eligibility from a registration label.
 const ctv=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,'ctv-contract@example.invalid','ACTIVE') RETURNING id,revision",
  ['ci-ctv-'+randomUUID()]);
 await one("INSERT INTO satori_v2_profiles(account_id,type,display_name) "+
  "VALUES($1,'collaborator','Fake CTV') RETURNING id",[ctv.id]);
 const ctvBefore=(await adminCustomerList(pool)).registered.find(x=>x.id===ctv.id);
 assert.equal(ctvBefore.hasCtvProfile,true,'Real collaborator profile gates owner toggle');
 assert.equal(ctvBefore.ctvEnabled,true);
 // Simulate a committed owner mode change; the API must reflect it on re-read.
 await pool.query('UPDATE satori_v2_accounts SET ctv_enabled=false,revision=revision+1 WHERE id=$1',[ctv.id]);
 const ctvAfter=(await adminCustomerList(pool)).registered.find(x=>x.id===ctv.id);
 assert.equal(ctvAfter.ctvEnabled,false);
 assert.equal(ctvAfter.hasCtvProfile,true);
 assert.equal(ctvAfter.revision,ctvBefore.revision+1);
 assert.ok(!('password' in readback));
 assert.ok(!('google_sub' in readback),'Do not return immutable Google subject');
 // CAS prevents stale review and owner lockout.
 await assert.rejects(()=>adminChangeCustomerStatus(pool,owner,{accountId:customer.id,
  expectedRevision:1,status:'SUSPENDED',confirmed:true}),/CUSTOMER_REVISION_CONFLICT/);
 await assert.rejects(()=>adminChangeCustomerStatus(pool,owner,{accountId:owner.id,
  expectedRevision:1,status:'REMOVED',confirmed:true}),/OWNER_CANNOT_BE_MODIFIED/);
 await pool.query('INSERT INTO satori_v2_sessions(token_hash,csrf_hash,account_id,expires_at) '+
  "VALUES($1,$2,$3,now()+interval '1 day')",['a'.repeat(64),'b'.repeat(64),customer.id]);
 const blocked=await adminChangeCustomerStatus(pool,owner,{accountId:customer.id,
  expectedRevision:3,status:'SUSPENDED',confirmed:true});
 assert.equal(blocked.customer.accessStatus,'SUSPENDED');
 const sessions=await one('SELECT count(*)::int AS count FROM satori_v2_sessions WHERE account_id=$1',
  [customer.id]);assert.equal(sessions.count,0,'Suspension kills all sessions');
 const removed=await adminChangeCustomerStatus(pool,owner,{accountId:customer.id,
  expectedRevision:4,status:'REMOVED',confirmed:true});
 assert.equal(removed.customer.accessStatus,'REMOVED');
 const allPolicies=await one('SELECT count(*)::int AS count FROM satori_v2_policies '+
  'WHERE profile_id=$1 AND enabled=true',[activated.profileId]);
 assert.equal(allPolicies.count,0,'Soft-removed client has no active discounted policy');
 const afterRemoval=await adminCustomerList(pool);
 assert.equal(afterRemoval.registered.find(x=>x.id===customer.id)?.discountBps,0,
  'Removed customer must not display an obsolete approved discount');
 const extra=await adminCreateLead(pool,owner.id,{...form,email:'',confirmed:true,discountBps:4500});
 const archived=await adminPatchLead(pool,owner.id,{
  leadId:extra.lead.id,expectedRevision:extra.lead.revision,active:false,confirmed:true});
 assert.equal(archived.lead.active,false);
 await assert.rejects(()=>adminPatchLead(pool,owner.id,{
  leadId:extra.lead.id,expectedRevision:extra.lead.revision,active:false,confirmed:true}),
  /LEAD_REVISION_CONFLICT/);
 console.log('PASS separate PostgreSQL customer signup/full fields, manual legacy link, Admin approval/discount, CAS suspension and removal, session invalidation, soft archive, no passwords');
}finally{await pool.end()}
