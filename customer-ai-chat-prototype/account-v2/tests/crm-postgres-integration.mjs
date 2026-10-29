/* Dedicated PostgreSQL 16 CI account lifecycle. Synthetic users only. */
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import pg from 'pg';
import {ctvClientWrite,ctvClientList} from '../router.mjs';
import {registrationSave,adminCreateLead,adminPatchLead,adminChangeCustomerStatus,adminAssignCustomerRole,
 adminLinkLead,adminCustomerList,registrationRead,adminEditRegisteredCustomer,
 adminApproveRegistration,legacyCustomerSearch,legacyCustomerImport,
 legacyCustomerActivateLead} from '../customer-backend.mjs';

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
 await assert.rejects(()=>adminChangeCustomerStatus(pool,owner,{accountId:customer.id,
  expectedRevision:1,status:'ACTIVE',confirmed:true,discountBps:2500}),
  /CUSTOMER_APPROVAL_REQUIRED_BEFORE_PRICING/);
 const approved=await adminApproveRegistration(pool,owner,{accountId:customer.id,
  expectedRevision:1,confirmed:true});
 assert.equal(approved.revision,2);
 assert.equal(approved.accessStatus,'PENDING','Review must not grant ordering before price');
 await assert.rejects(()=>adminChangeCustomerStatus(pool,owner,{accountId:customer.id,
  expectedRevision:2,status:'ACTIVE',confirmed:true}),/DISCOUNT_INPUT_REQUIRED_AFTER_APPROVAL/);
 const activated=await adminChangeCustomerStatus(pool,owner,{accountId:customer.id,
  expectedRevision:2,status:'ACTIVE',confirmed:true,discountBps:2500});
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
  accountId:customer.id,expectedRevision:2,confirmed:true,
  ...form,fullName:'Fake Agency Updated',address:'Edited Registration Address'});
 assert.equal(edited.revision,3);
 await assert.rejects(()=>adminEditRegisteredCustomer(pool,owner,{
  accountId:customer.id,expectedRevision:1,confirmed:true,...form}),
  /CUSTOMER_DETAILS_REVISION_CONFLICT/);
 await assert.rejects(()=>adminEditRegisteredCustomer(pool,owner,{
  accountId:customer.id,expectedRevision:3,confirmed:true,
  ...form,email:'different@example.invalid'}),/VERIFIED_EMAIL_IMMUTABLE/);
 const list=await adminCustomerList(pool);
 const readback=list.registered.find(x=>x.id===customer.id);
 assert.equal(readback.address,'Edited Registration Address');
 assert.equal(readback.fullName,'Fake Agency Updated');
 assert.equal(readback.companyName,form.companyName);
 assert.equal(readback.taxCode,form.taxCode);
 assert.equal(readback.discountBps,2500,
  'Admin list must read approved policy rather than reset discount display to zero');
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
  expectedRevision:4,status:'SUSPENDED',confirmed:true});
 assert.equal(blocked.customer.accessStatus,'SUSPENDED');
 const sessions=await one('SELECT count(*)::int AS count FROM satori_v2_sessions WHERE account_id=$1',
  [customer.id]);assert.equal(sessions.count,0,'Suspension kills all sessions');
 const removed=await adminChangeCustomerStatus(pool,owner,{accountId:customer.id,
  expectedRevision:5,status:'REMOVED',confirmed:true});
 assert.equal(removed.customer.accessStatus,'REMOVED');
 const allPolicies=await one('SELECT count(*)::int AS count FROM satori_v2_policies '+
  'WHERE profile_id=$1 AND enabled=true',[activated.profileId]);
 assert.equal(allPolicies.count,0,'Soft-removed client has no active discounted policy');
 const afterRemoval=await adminCustomerList(pool);
 assert.equal(afterRemoval.registered.find(x=>x.id===customer.id)?.discountBps,null,
  'Removed customer must not display an obsolete approved discount');
 const extra=await adminCreateLead(pool,owner.id,{...form,email:'',confirmed:true,discountBps:4500});
 const archived=await adminPatchLead(pool,owner.id,{
  leadId:extra.lead.id,expectedRevision:extra.lead.revision,active:false,confirmed:true});
 assert.equal(archived.lead.active,false);
 await assert.rejects(()=>adminPatchLead(pool,owner.id,{
  leadId:extra.lead.id,expectedRevision:extra.lead.revision,active:false,confirmed:true}),
  /LEAD_REVISION_CONFLICT/);
 // Synthetic signed legacy ledger: the fetch stub never contacts Apps Script.
 const prevFetch=globalThis.fetch;
 const prevVars=Object.fromEntries(['SATORI_READ_ENDPOINT','SATORI_READ_KEY_ID','SATORI_READ_HMAC_SECRET']
  .map(k=>[k,process.env[k]]));
 const fakeEndpoint='https://script.google.com/macros/s/fake-legacy-crm-ci-only/exec';
 const fakeKey='ci_read_key',fakeSecret='z'.repeat(40);
 let invoices=[
  {id:900001,invoiceNo:900001,date:'01/10/2026',name:'Old Test Buyer',
   phone:'0911000000',location:'10 Synthetic A',status:'Chưa thanh toán',total:160000,
   items:[{code:'TP-00001',product:'Satori 350ml',unit:'Thùng',qty:2,
    unitPrice:80000,listPrice:100000}]},
  {id:900002,invoiceNo:900002,date:'02/10/2026',name:'Old Test Buyer',
   phone:'0911000000',location:'20 Synthetic B',status:'Đã thanh toán',total:80000,
   items:[{code:'TP-00001',product:'Satori 350ml',unit:'Thùng',qty:1,
    unitPrice:80000,listPrice:100000}]}
 ];
 try{
  Object.assign(process.env,{SATORI_READ_ENDPOINT:fakeEndpoint,
   SATORI_READ_KEY_ID:fakeKey,SATORI_READ_HMAC_SECRET:fakeSecret});
  globalThis.fetch=async(url,options)=>{
   assert.equal(url,fakeEndpoint);
   const b=JSON.parse(options.body);
   assert.equal(b.action,'orders.list');
   const msg=[b.keyId,b.timestamp,b.nonce,b.action,JSON.stringify(b.payload)].join('\n');
   assert.equal(b.signature,createHmac('sha256',fakeSecret).update(msg).digest('hex'));
   return new Response(JSON.stringify({ok:true,action:b.action,revision:42,
    data:{revision:42,totalMatches:invoices.length,orders:invoices}}),{status:200});
  };
  const matches=await legacyCustomerSearch('Old Test');
  assert.equal(matches.orders.length,2);
  assert.equal(matches.orders[0].items[0].estimatedDiscountPercent,20);
  const oldAccount=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
   "VALUES($1,'legacy-buyer@example.invalid','PENDING') RETURNING id,revision",
   ['ci-legacy-'+randomUUID()]);
  const shipping=[
   {label:'Nhà',recipientName:'Old Test Buyer',recipientPhone:'0911000000',address:'10 Synthetic A'},
   {label:'Văn phòng',recipientName:'Old Test Buyer',recipientPhone:'0911000000',address:'20 Synthetic B'}
  ];
  const input={query:'Old Test',sourceRevision:42,invoiceNos:[900001,900002],
   fullName:'Old Test Buyer',phone:'0911000000',email:'legacy-buyer@example.invalid',
   address:'10 Synthetic A',requestedType:'agency',discountBps:2000,addresses:shipping,
   expectedAccountRevision:oldAccount.revision,confirmed:true,identityConfirmed:true};
  const bound=await legacyCustomerImport(pool,owner,input);
  assert.equal(bound.state,'ACTIVE');assert.equal(bound.addressesAdded,2);
  const oldProfile=await one('SELECT type FROM satori_v2_profiles WHERE id=$1',[bound.profileId]);
  assert.equal(oldProfile.type,'agency');
  const policy=await one('SELECT discount_bps FROM satori_v2_policies WHERE profile_id=$1 AND enabled=true',
   [bound.profileId]);assert.equal(policy.discount_bps,2000);
  await assert.rejects(()=>legacyCustomerImport(pool,owner,input),/LEGACY_INVOICE_ALREADY_IMPORTED/);
  invoices=invoices.map(x=>({...x,id:x.id+2,invoiceNo:x.invoiceNo+2}));
  const pending=await legacyCustomerImport(pool,owner,{
   ...input,invoiceNos:[900003,900004],email:'waiting-legacy@example.invalid',
   expectedAccountRevision:null});
  assert.equal(pending.state,'WAITING_FOR_GMAIL');assert.equal(pending.addressesStaged,2);
  const newGoogle=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
   "VALUES($1,'waiting-legacy@example.invalid','PENDING') RETURNING id,revision",
   ['ci-waiting-'+randomUUID()]);
  const lead=await one('SELECT revision FROM satori_v2_customer_leads WHERE id=$1',[pending.leadId]);
  const linked=await legacyCustomerActivateLead(pool,owner,{leadId:pending.leadId,
   expectedRevision:lead.revision,expectedAccountRevision:newGoogle.revision,
   confirmed:true,identityConfirmed:true});
  assert.equal(linked.state,'ACTIVE');assert.equal(linked.addressesAdded,2);
  const linkedAccount=await one('SELECT access_status FROM satori_v2_accounts WHERE id=$1',[newGoogle.id]);
  assert.equal(linkedAccount.access_status,'ACTIVE');
 }finally{
  globalThis.fetch=prevFetch;
  for(const [k,v] of Object.entries(prevVars))if(v===undefined)delete process.env[k];
  else process.env[k]=v;
 }


 // Synthetic CTV: one owner-approved global cap, customer-specific policies
 // on two distinct saved delivery addresses and account-scoped CAS updates.
 const ctvSub='ci-ctv-'+randomUUID();
 const ctv=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) VALUES($1,$2,'PENDING') RETURNING id,revision,email",[ctvSub,'ctv-ci@example.invalid']);
 const ctvForm={fullName:'CTV Synthetic',phone:'0900000123',address:'123 Synthetic CTV Street',
  email:'ctv-ci@example.invalid',requestedType:'collaborator'};
 await registrationSave(pool,{...ctv,access_status:'PENDING'},ctvForm);
 await adminApproveRegistration(pool,owner,{accountId:ctv.id,expectedRevision:1,confirmed:true});
 const activeCtv=await adminChangeCustomerStatus(pool,owner,{accountId:ctv.id,
  expectedRevision:2,status:'ACTIVE',discountBps:2000,collaboratorBps:3500,confirmed:true});
 const ctvActor={id:ctv.id,google_sub:ctvSub,access_status:'ACTIVE'};
 const clientOne=await ctvClientWrite(pool,ctvActor,{profileId:activeCtv.profileId,
  label:'Khách Lan Anh',recipientName:'Lan Anh',recipientPhone:'0903000000',
  address:'10 Synthetic Client Street',discountBps:1800,confirmed:true},true);
 const first=await ctvClientList(pool,ctvActor,activeCtv.profileId);
 const saved=first.clients.find(x=>x.id===clientOne.addressId);
 assert.equal(saved.discountBps,1800);assert.equal(first.collaboratorBps,3500);
 assert.equal(saved.policyVersion,1);assert.equal(saved.ownerLocked,false);
 await assert.rejects(()=>ctvClientWrite(pool,ctvActor,{
  profileId:activeCtv.profileId,addressId:clientOne.addressId,
  expectedPolicyVersion:1,discountBps:3501,confirmed:true},false),/CTV_CUSTOMER_RATE_OUT_OF_RANGE/);
 const changed=await ctvClientWrite(pool,ctvActor,{
  profileId:activeCtv.profileId,addressId:clientOne.addressId,
  expectedPolicyVersion:1,discountBps:2100,confirmed:true},false);
 assert.equal(changed.policyVersion,2);
 await assert.rejects(()=>ctvClientWrite(pool,ctvActor,{
  profileId:activeCtv.profileId,addressId:clientOne.addressId,
  expectedPolicyVersion:1,discountBps:2100,confirmed:true},false),/CTV_CLIENT_REVISION_CONFLICT/);
 await assert.rejects(()=>ctvClientList(pool,{id:owner.id,google_sub:owner.google_sub},activeCtv.profileId),/PROFILE_FORBIDDEN/);
 const actual=await one("SELECT discount_bps,collaborator_bps,invoice_mode FROM satori_v2_policies WHERE profile_id=$1 AND address_id=$2 AND enabled=true",[activeCtv.profileId,clientOne.addressId]);
 assert.equal(actual.discount_bps,2100);assert.equal(actual.collaborator_bps,3500);assert.equal(actual.invoice_mode,'single');

 // One atomic role/pricing update on the already verified account:
 // - cap reduction must not silently exceed existing client discounts
 // - existing customer discount and shipping address must be preserved
 // - each CTV / agency conversion must update both registration and profile.
 await assert.rejects(()=>adminAssignCustomerRole(pool,owner,{
  accountId:ctv.id,expectedRevision:activeCtv.customer.revision,
  requestedType:'collaborator',discountBps:1500,collaboratorBps:2000,confirmed:true
 }),/CTV_CLIENT_DISCOUNT_EXCEEDS_NEW_RATE/);
 const agencyRole=await adminAssignCustomerRole(pool,owner,{
  accountId:ctv.id,expectedRevision:activeCtv.customer.revision,
  requestedType:'agency',discountBps:2500,confirmed:true
 });
 assert.equal(agencyRole.requestedType,'agency');
 assert.equal(agencyRole.revision,activeCtv.customer.revision+1);
 const agencyProfile=await one('SELECT type FROM satori_v2_profiles WHERE id=$1',[activeCtv.profileId]);
 assert.equal(agencyProfile.type,'agency');
 const agencyAddressPolicy=await one(
  'SELECT discount_bps,collaborator_bps,invoice_mode,version FROM satori_v2_policies '+
  'WHERE profile_id=$1 AND address_id=$2 AND enabled=true',
  [activeCtv.profileId,clientOne.addressId]);
 assert.equal(agencyAddressPolicy.discount_bps,2100);
 assert.equal(agencyAddressPolicy.collaborator_bps,null);
 assert.equal(agencyAddressPolicy.invoice_mode,'single');
 assert.equal(agencyAddressPolicy.version,3);
 await assert.rejects(()=>ctvClientList(pool,ctvActor,activeCtv.profileId),/CTV_PROFILE_FORBIDDEN/);
 await assert.rejects(()=>adminAssignCustomerRole(pool,owner,{
  accountId:ctv.id,expectedRevision:activeCtv.customer.revision,
  requestedType:'collaborator',discountBps:2000,collaboratorBps:3500,confirmed:true
 }),/CUSTOMER_REVISION_CONFLICT/);
 const restoredCtv=await adminAssignCustomerRole(pool,owner,{
  accountId:ctv.id,expectedRevision:agencyRole.revision,
  requestedType:'collaborator',discountBps:2000,collaboratorBps:4000,confirmed:true
 });
 assert.equal(restoredCtv.revision,agencyRole.revision+1);
 const restoredProfile=await one('SELECT type FROM satori_v2_profiles WHERE id=$1',[activeCtv.profileId]);
 assert.equal(restoredProfile.type,'collaborator');
 const restoredPolicy=await one(
  'SELECT discount_bps,collaborator_bps,invoice_mode,version FROM satori_v2_policies '+
  'WHERE profile_id=$1 AND address_id=$2 AND enabled=true',
  [activeCtv.profileId,clientOne.addressId]);
 assert.equal(restoredPolicy.discount_bps,2100);
 assert.equal(restoredPolicy.collaborator_bps,4000);
 assert.equal(restoredPolicy.invoice_mode,'single');
 assert.equal(restoredPolicy.version,4);
 const listedAfterRole=await adminCustomerList(pool);
 const ctvAfterRole=listedAfterRole.registered.find(x=>x.id===ctv.id);
 assert.equal(ctvAfterRole.requestedType,'collaborator');
 assert.equal(ctvAfterRole.discountBps,2000);
 assert.equal(ctvAfterRole.collaboratorBps,4000);

 // Staged old CTV must keep both owner-set discounts independently.
 const leadCtv=await adminCreateLead(pool,owner.id,{fullName:'CTV Legacy Synthetic',
  phone:'0900000222',address:'22 Synthetic Legacy Street',
  requestedType:'collaborator',discountBps:2000,collaboratorBps:3500,confirmed:true});
 const pendingCtv=await one('SELECT discount_bps,collaborator_bps FROM satori_v2_customer_leads WHERE id=$1',[leadCtv.lead.id]);
 assert.equal(pendingCtv.discount_bps,2000);assert.equal(pendingCtv.collaborator_bps,3500);

 console.log('PASS separate PostgreSQL customer signup/full fields, manual legacy link, Admin approval/discount, CAS suspension and removal, session invalidation, soft archive, no passwords');
}finally{await pool.end()}
