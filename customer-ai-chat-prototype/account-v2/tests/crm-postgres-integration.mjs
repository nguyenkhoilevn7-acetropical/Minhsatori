/* Dedicated PostgreSQL 16 CI account lifecycle. Synthetic users only. */
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import pg from 'pg';
import {ctvClientWrite,ctvClientList} from '../router.mjs';
import {registrationSave,adminCreateLead,adminPatchLead,adminChangeCustomerStatus,adminAssignCustomerRole,
 adminLinkLead,adminCustomerList,registrationRead,adminEditRegisteredCustomer,
 adminApproveRegistration,legacyCustomerSearch,legacyCustomerImport,
 legacyCustomerActivateLead,autoActivateVerifiedLegacyGmail,reconcileVerifiedLegacySession,
 adminReconcileVerifiedLegacyPending,ownerActivateSavedGmail,
 ownerBindLegacyInvoices,linkedLegacyInvoiceHistory,legacyAddressDirectory} from '../customer-backend.mjs';

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
 // Manual owner link remains possible; automatic claims require a verified Google token.
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

 // Exact owner-saved CRM lead → verified Google account requires NO staged invoice.
 const linkedLead=await adminCreateLead(pool,owner.id,{
  fullName:'Unstaged CTV Fake',phone:'0900000631',
  address:'12 Saved Address Fake',email:'saved-ctv@example.invalid',
  requestedType:'collaborator',discountBps:2000,collaboratorBps:3500,confirmed:true
 });
 const savedSub='ci-saved-ctv-'+randomUUID();
 const savedAccount=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,'saved-ctv@example.invalid','PENDING') RETURNING id,revision",
  [savedSub]);
 const savedResult=await ownerActivateSavedGmail(pool,owner,{
  accountId:savedAccount.id,leadId:linkedLead.lead.id,
  expectedAccountRevision:savedAccount.revision,expectedLeadRevision:linkedLead.lead.revision,
  confirmed:true,identityConfirmed:true
 });
 assert.equal(savedResult.state,'ACTIVE');
 const savedRole=await one('SELECT type FROM satori_v2_profiles WHERE id=$1',[savedResult.profileId]);
 assert.equal(savedRole.type,'collaborator');
 const savedPolicy=await one('SELECT discount_bps,collaborator_bps FROM satori_v2_policies '+
  'WHERE profile_id=$1 AND enabled=true',[savedResult.profileId]);
 assert.equal(savedPolicy.discount_bps,2000);
 assert.equal(savedPolicy.collaborator_bps,3500);
 const linkedLeadRow=await one('SELECT linked_account_id FROM satori_v2_customer_leads WHERE id=$1',
  [linkedLead.lead.id]);assert.equal(linkedLeadRow.linked_account_id,savedAccount.id);
 await assert.rejects(()=>ownerActivateSavedGmail(pool,owner,{
  accountId:savedAccount.id,leadId:linkedLead.lead.id,
  expectedAccountRevision:savedAccount.revision,expectedLeadRevision:linkedLead.lead.revision,
  confirmed:true,identityConfirmed:true
 }),/LEAD_REVISION_CONFLICT|CUSTOMER_NOT_PENDING/);
 const wrongAccount=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,'different-fake@example.invalid','PENDING') RETURNING id,revision",
  ['ci-wrong-saved-'+randomUUID()]);
 await assert.rejects(()=>ownerActivateSavedGmail(pool,owner,{
  accountId:wrongAccount.id,leadId:linkedLead.lead.id,
  expectedAccountRevision:wrongAccount.revision,expectedLeadRevision:linkedLead.lead.revision+1,
  confirmed:true,identityConfirmed:true
 }),/LEAD_LINKED_TO_ANOTHER_ACCOUNT/);


 // V2 owner-saved Gmail can be activated even when the lead's phone is blank.
 // No invented placeholder phone or delivery points must be stored.
 const noPhoneEmail='no-phone-owner@example.invalid';
 const noPhoneLead=await adminCreateLead(pool,owner.id,{
  ...form,fullName:'No Phone Owner',email:noPhoneEmail,phone:'',
  discountBps:2000,confirmed:true
 });
 const noPhoneAccount=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,$2,'PENDING') RETURNING id,revision",['ci-no-phone-'+randomUUID(),noPhoneEmail]);
 const noPhoneActivation=await ownerActivateSavedGmail(pool,owner,{
  confirmed:true,identityConfirmed:true,
  accountId:noPhoneAccount.id,leadId:noPhoneLead.lead.id,
  expectedAccountRevision:noPhoneAccount.revision,expectedLeadRevision:noPhoneLead.lead.revision
 });
 assert.equal(noPhoneActivation.state,'ACTIVE');
 assert.equal(noPhoneActivation.addressesAdded,0);
 const noPhoneStatus=await one('SELECT access_status FROM satori_v2_accounts WHERE id=$1',[noPhoneAccount.id]);
 assert.equal(noPhoneStatus.access_status,'ACTIVE');
 const noPhoneProfile=await one('SELECT phone FROM satori_v2_profiles WHERE id=$1',[noPhoneActivation.profileId]);
 assert.equal(noPhoneProfile.phone,'');
 const noPhoneAddresses=await one('SELECT count(*)::integer AS n FROM satori_v2_addresses WHERE profile_id=$1',
  [noPhoneActivation.profileId]);assert.equal(noPhoneAddresses.n,0);

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
  const directory=await legacyAddressDirectory({months:12});
  assert.equal(directory.readMonths,12);
  assert.equal(directory.uniqueAddresses,2);
  assert.equal(directory.addresses.length,2);
  assert.ok(directory.addresses.every(x=>x.invoiceCount>=1));
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

  // Same LOCATION with 4 past deliveries (different recipient names/phones)
  // must create ONE V2 address from the latest invoice, while keeping all bills.
  const repeatAddress='42 Duong So 95, Cat Lai, Ho Chi Minh';
  invoices=[
   {id:990001,invoiceNo:990001,date:'01/10/2026',timestamp:1790812800,
    name:'Client A',phone:'0900000001',location:repeatAddress,total:10000},
   {id:990002,invoiceNo:990002,date:'02/10/2026',timestamp:1790899200,
    name:'Client B',phone:'0900000002',location:'42 Đường Số 95, Cát Lái, Hồ Chí Minh',total:20000},
   {id:990003,invoiceNo:990003,date:'03/10/2026',timestamp:1790985600,
    name:'Client C',phone:'0900000003',location:'42 đường số 95, Cát Lái, Hồ Chí Minh.',total:30000},
   {id:990004,invoiceNo:990004,date:'04/10/2026',timestamp:1791072000,
    name:'Newest Recipient',phone:'0900000004',location:'42 DUONG SO 95 CAT LAI HO CHI MINH',total:40000},
   {id:990005,invoiceNo:990005,date:'03/10/2026',timestamp:1790985600,
    name:'Other Location',phone:'0900000005',location:'99 Distinct Road, Thu Duc',total:50000}
  ];
  const boundAccount=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
   "VALUES($1,'historical-verified@example.invalid','PENDING') RETURNING id,revision,email",
   ['ci-history-'+randomUUID()]);
  const bind=await ownerBindLegacyInvoices(pool,owner,{
   confirmed:true,identityConfirmed:true,accountId:boundAccount.id,
   email:boundAccount.email,expectedAccountRevision:boundAccount.revision,
   query:'42 Duong So 95',sourceRevision:42,
   refs:invoices.map(x=>({invoiceNo:x.invoiceNo,sourceId:String(x.id)})),
   requestedType:'collaborator',profileName:'CTV Owner-Verified',
   contactPhone:'0900000123',discountBps:2000,collaboratorBps:3500
  });
  assert.equal(bind.accessStatus,'ACTIVE');
  assert.equal(bind.linkedInvoices,5);
  assert.equal(bind.uniqueAddresses,2);
  const activeAddressRows=await pool.query(
   'SELECT address,recipient_name,recipient_phone FROM satori_v2_addresses '+
   'WHERE profile_id=$1 AND active=true',[bind.profileId]);
  assert.equal(activeAddressRows.rowCount,2);
  const newest=activeAddressRows.rows.find(x=>x.address.toUpperCase().includes('42 DUONG SO 95'));
  assert.ok(newest);
  assert.equal(newest.recipient_phone,'0900000004');
  assert.equal(newest.recipient_name,'Newest Recipient');
  const hist=await linkedLegacyInvoiceHistory(pool,{id:boundAccount.id});
  assert.equal(hist.orders.length,5,'every original invoice remains independently visible');
  assert.equal(hist.addresses.length,2,'only one destination for four repeated deliveries');
  assert.equal(hist.addresses.find(x=>x.address.toUpperCase().includes('42 DUONG SO 95')).invoiceNo,990004);
  // A verified invoice ID can NEVER be owned by a second Google account.
  const intruder=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
   "VALUES($1,'intruder-history@example.invalid','PENDING') RETURNING id,revision,email",
   ['ci-other-history-'+randomUUID()]);
  await assert.rejects(()=>ownerBindLegacyInvoices(pool,owner,{
   confirmed:true,identityConfirmed:true,accountId:intruder.id,
   email:intruder.email,expectedAccountRevision:intruder.revision,
   query:'42 Duong So 95',sourceRevision:42,
   refs:[{invoiceNo:990004,sourceId:'990004'}],
   requestedType:'agency',profileName:'Different Verified User',
   discountBps:2000,contactPhone:'0900000004'
  }),/LEGACY_INVOICE_ALREADY_OWNED/);

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


 // Owner-set old-client Gmail auto-activates only when GOOGLE verified the sub.
 // All records here are synthetic; no Gmail, invoices or real customer identities.
 const loginClaim=async(account,sub,email)=>{
  const conn=await pool.connect();
  try{
   await conn.query('BEGIN');
   const result=await autoActivateVerifiedLegacyGmail(conn,{
    accountId:account.id,googleSub:sub,email,ownerGoogleSub:owner.google_sub});
   await conn.query('COMMIT');return result;
  }catch(e){await conn.query('ROLLBACK');throw e}finally{conn.release()}
 };
 const autoEmail='auto-ctv@example.invalid',autoSub='ci-auto-ctv-'+randomUUID();
 const autoLead=await adminCreateLead(pool,owner.id,{
  fullName:'CTV Approved Legacy',email:autoEmail,phone:'0900000444',
  address:'44 Synthetic Old Client',requestedType:'collaborator',
  discountBps:2000,collaboratorBps:3500,confirmed:true});
 const autoAccount=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,$2,'PENDING') RETURNING id,access_status",[autoSub,autoEmail.toUpperCase()]);
 await one("INSERT INTO satori_v2_profiles(account_id,type,display_name) "+
  "VALUES($1,'retail','Google Display Name') RETURNING id",[autoAccount.id]);
 const wrongSub=await loginClaim(autoAccount,'wrong-google-sub',autoEmail);
 assert.equal(wrongSub.state,'PENDING','cannot claim from a client-supplied Gmail');
 const autoResult=await loginClaim(autoAccount,autoSub,autoEmail);
 assert.equal(autoResult.state,'ACTIVE');
 const activatedUser=await one('SELECT access_status,display_name FROM satori_v2_accounts WHERE id=$1',
  [autoAccount.id]);
 assert.equal(activatedUser.access_status,'ACTIVE');
 assert.equal(activatedUser.display_name,'CTV Approved Legacy');
 const role=await one('SELECT type FROM satori_v2_profiles WHERE id=$1',[autoResult.profileId]);
 assert.equal(role.type,'collaborator');
 const rate=await one('SELECT discount_bps,collaborator_bps,invoice_mode FROM satori_v2_policies '+
  'WHERE profile_id=$1 AND enabled=true',[autoResult.profileId]);
 assert.equal(rate.discount_bps,2000);assert.equal(rate.collaborator_bps,3500);
 assert.equal(rate.invoice_mode,'single');
 const autoAddress=await one('SELECT count(*)::int AS count FROM satori_v2_addresses WHERE profile_id=$1',
  [autoResult.profileId]);assert.equal(autoAddress.count,1);
 const autoLink=await one('SELECT linked_account_id FROM satori_v2_customer_leads WHERE id=$1',
  [autoLead.lead.id]);assert.equal(autoLink.linked_account_id,autoAccount.id);
 const reviewed=await one('SELECT requested_type,reviewed_at IS NOT NULL AS approved FROM satori_v2_registrations WHERE account_id=$1',
  [autoAccount.id]);assert.equal(reviewed.approved,true);assert.equal(reviewed.requested_type,'collaborator');
 const replay=await loginClaim(autoAccount,autoSub,autoEmail);
 assert.equal(replay.state,'PENDING','already active user cannot reapply CK policy');
 const policyCount=await one('SELECT count(*)::int AS count FROM satori_v2_policies WHERE profile_id=$1',
  [autoResult.profileId]);assert.equal(policyCount.count,1);

 // Existing case from owner CRM: pending Google account already has CK from
 // manual lead link. Matching owner-approved CK must not block auto activation.
 const preEmail='already-linked@example.invalid',preSub='ci-prelinked-'+randomUUID();
 const preLead=await adminCreateLead(pool,owner.id,{...form,email:preEmail,
  discountBps:2000,confirmed:true});
 const preAccount=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,$2,'PENDING') RETURNING id,email,access_status",[preSub,preEmail]);
 await registrationSave(pool,preAccount,{...form,email:preEmail});
 const preLink=await adminLinkLead(pool,owner,{leadId:preLead.lead.id,
  accountId:preAccount.id,expectedRevision:preLead.lead.revision,confirmed:true});
 assert.equal(preLink.linkedAccountId,preAccount.id);
 const preActivated=await loginClaim(preAccount,preSub,preEmail);
 assert.equal(preActivated.state,'ACTIVE','owner-prelinked pending customer should self-activate');
 const prePolicy=await one('SELECT count(*)::int AS count FROM satori_v2_policies WHERE profile_id=$1 '+
  'AND enabled=true AND discount_bps=2000',[preActivated.profileId]);
 assert.equal(prePolicy.count,1,'do not leave duplicate active CK policies');
 const preType=await one('SELECT type FROM satori_v2_profiles WHERE id=$1',[preActivated.profileId]);
 assert.equal(preType.type,'agency');
 // A pre-existing owner-approved customer CK=20% may be upgraded to the
 // explicitly approved CTV 35% cap, without replacing the 20% customer rate.
 const preCtvEmail='ctv-existing-rate@example.invalid',preCtvSub='ci-prectv-'+randomUUID();
 await adminCreateLead(pool,owner.id,{fullName:'CTV Historical Approved',
  phone:'0900011111',address:'10 CTV Sample Lane',email:preCtvEmail,
  requestedType:'collaborator',discountBps:2000,collaboratorBps:3500,confirmed:true});
 const preCtvAccount=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,$2,'PENDING') RETURNING id",[preCtvSub,preCtvEmail]);
 const preCtvProfile=await one('INSERT INTO satori_v2_profiles(account_id,type,display_name) '+
  "VALUES($1,'retail','Waiting CTV') RETURNING id",[preCtvAccount.id]);
 await pool.query('INSERT INTO satori_v2_policies '+
  '(profile_id,discount_bps,collaborator_bps,invoice_mode,version,approved_by) '+
  "VALUES($1,2000,NULL,'single',1,$2)",[preCtvProfile.id,owner.google_sub]);
 const preCtvActivated=await loginClaim(preCtvAccount,preCtvSub,preCtvEmail);
 assert.equal(preCtvActivated.state,'ACTIVE');
 const preCtvPolicy=await one('SELECT discount_bps,collaborator_bps FROM satori_v2_policies '+
  'WHERE profile_id=$1 AND enabled=true',[preCtvProfile.id]);
 assert.equal(preCtvPolicy.discount_bps,2000);
 assert.equal(preCtvPolicy.collaborator_bps,3500);
 // Wrong CK must never be silently replaced using an old Gmail record.
 const conflictEmail='conflict-rate@example.invalid',conflictSub='ci-conflict-'+randomUUID();
 await adminCreateLead(pool,owner.id,{...form,email:conflictEmail,discountBps:2000,confirmed:true});
 const conflictAccount=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,$2,'PENDING') RETURNING id",[conflictSub,conflictEmail]);
 const conflictProfile=await one('INSERT INTO satori_v2_profiles(account_id,type,display_name) '+
  "VALUES($1,'retail','Conflict') RETURNING id",[conflictAccount.id]);
 await pool.query('INSERT INTO satori_v2_policies '+
  '(profile_id,discount_bps,invoice_mode,version,approved_by) '+
  "VALUES($1,4000,'single',1,$2)",[conflictProfile.id,owner.google_sub]);
 const conflict=await loginClaim(conflictAccount,conflictSub,conflictEmail);
 assert.equal(conflict.state,'PENDING');
 const conflictRate=await one('SELECT discount_bps FROM satori_v2_policies WHERE profile_id=$1 '+
  'AND enabled=true',[conflictProfile.id]);assert.equal(conflictRate.discount_bps,4000);


 // Previously signed-in pending session can reconcile without a new Google login.
 const previousEmail='previous-session@example.invalid';
 const previousSub='ci-prev-session-'+randomUUID();
 await adminCreateLead(pool,owner.id,{...form,email:previousEmail,
  discountBps:1800,confirmed:true});
 const previousAccount=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,$2,'PENDING') RETURNING id,email,access_status,google_sub",
  [previousSub,previousEmail]);
 const preview=await reconcileVerifiedLegacySession(pool,previousAccount,owner.google_sub,{dryRun:true});
 assert.equal(preview.state,'READY','dry-run diagnoses eligible pending session without mutations');
 const unchanged=await one('SELECT access_status FROM satori_v2_accounts WHERE id=$1',[previousAccount.id]);
 assert.equal(unchanged.access_status,'PENDING');
 const sessionResult=await reconcileVerifiedLegacySession(pool,previousAccount,owner.google_sub);
 assert.equal(sessionResult.state,'ACTIVE','old session should activate without Google callback');
 const previousCheck=await one('SELECT access_status FROM satori_v2_accounts WHERE id=$1',[previousAccount.id]);
 assert.equal(previousCheck.access_status,'ACTIVE');
 // Admin reconciles pending accounts that already authenticated with Google.
 const bulkEmail='bulk-reconcile@example.invalid';
 const bulkSub='ci-bulk-'+randomUUID();
 await adminCreateLead(pool,owner.id,{...form,email:bulkEmail,discountBps:1600,confirmed:true});
 const bulkAccount=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,$2,'PENDING') RETURNING id",[bulkSub,bulkEmail]);
 const batch=await adminReconcileVerifiedLegacyPending(pool,owner,owner.google_sub);
 assert.ok(batch.checked>=1&&batch.activated>=1);
 const batchAccount=await one('SELECT access_status FROM satori_v2_accounts WHERE id=$1',[bulkAccount.id]);
 assert.equal(batchAccount.access_status,'ACTIVE');
 const noMatching=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,$2,'PENDING') RETURNING id,google_sub,email,access_status",
  ['ci-no-match-'+randomUUID(),'unmatched-ci@example.invalid']);
 const missing=await reconcileVerifiedLegacySession(pool,noMatching,owner.google_sub,{dryRun:true});
 assert.equal(missing.state,'PENDING');
 assert.equal(missing.reason,'NO_UNIQUE_LEGACY_LEAD');

 // Multiple approved delivery points with one verified Gmail are one account.
 // Both OAuth reconciliation and manual linking use the same validation path.
 for(const mode of ['automatic','manual']){
  const email=mode+'-six-points@example.invalid',sub='ci-six-'+randomUUID();
  const saved=[];
  for(let i=0;i<6;i++){
   const r=await adminCreateLead(pool,owner.id,{
    ...form,email,fullName:'Synthetic CTV',phone:'090000010'+i,
    address:i<2?'42 Synthetic Road':'Point '+i+' Synthetic Road',
    requestedType:'collaborator',discountBps:2000,collaboratorBps:3500,confirmed:true
   });saved.push(r.lead);
   await pool.query("UPDATE satori_v2_customer_leads SET created_at=now()+($2 * interval '1 second') WHERE id=$1",
    [r.lead.id,i]);
  }
  const account=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
   "VALUES($1,$2,'PENDING') RETURNING id,revision,email",[sub,email]);
  const result=mode==='automatic'?await loginClaim(account,sub,email):
   await ownerActivateSavedGmail(pool,owner,{confirmed:true,identityConfirmed:true,
    leadId:saved[0].id,expectedLeadRevision:saved[0].revision,
    accountId:account.id,expectedAccountRevision:account.revision});
  assert.equal(result.state,'ACTIVE');
  const points=await pool.query('SELECT address,recipient_phone FROM satori_v2_addresses WHERE profile_id=$1 AND active=true',[result.profileId]);
  assert.equal(points.rowCount,5,'same normalized address is unique despite different phone');
  assert.equal(points.rows.find(x=>x.address==='42 Synthetic Road').recipient_phone,'0900000101');
  const links=await one('SELECT count(*)::int AS n FROM satori_v2_customer_leads WHERE linked_account_id=$1',[account.id]);
  assert.equal(links.n,6,'preserve and link every approved source lead');
  const rate=await one('SELECT discount_bps,collaborator_bps FROM satori_v2_policies WHERE profile_id=$1 AND enabled=true',[result.profileId]);
  assert.equal(rate.discount_bps,2000);assert.equal(rate.collaborator_bps,3500);
  const profiles=await one('SELECT count(*)::int AS n FROM satori_v2_profiles WHERE account_id=$1',[account.id]);
  assert.equal(profiles.n,1);
 }

 // Duplicate old records with the SAME Gmail: fail closed instead of assigning one partner.
 const duplicateEmail='ambiguous@example.invalid';
 await adminCreateLead(pool,owner.id,{...form,email:duplicateEmail,discountBps:2000,confirmed:true});
 await adminCreateLead(pool,owner.id,{...form,email:duplicateEmail,discountBps:3000,confirmed:true});
 const dupSub='ci-duplicate-'+randomUUID();
 const dupAccount=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,$2,'PENDING') RETURNING id",[dupSub,duplicateEmail]);
 assert.equal((await loginClaim(dupAccount,dupSub,duplicateEmail)).state,'PENDING');
 // Unapproved legacy lead (no Admin audit) cannot auto-grant a role/discount.
 const noAuditEmail='no-audit@example.invalid',noAuditSub='ci-no-audit-'+randomUUID();
 await one('INSERT INTO satori_v2_customer_leads '+
  '(full_name,email,phone,address,requested_type,discount_bps) '+
  "VALUES('Unapproved','no-audit@example.invalid','0900000999','99 Test St','agency',2000) RETURNING id");
 const noAuditAccount=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,$2,'PENDING') RETURNING id",[noAuditSub,noAuditEmail]);
 assert.equal((await loginClaim(noAuditAccount,noAuditSub,noAuditEmail)).state,'PENDING');
 // Exact verified Gmail may restore all staged old invoice-recipient addresses.
 const stagedEmail='auto-staged@example.invalid',stagedSub='ci-staged-'+randomUUID();
 const stagedLead=await adminCreateLead(pool,owner.id,{
  ...form,email:stagedEmail,discountBps:1500,confirmed:true});
 await pool.query('INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) '+
  "VALUES($1,'owner','LEGACY_CRM_STAGED',$2,$3)",
  [owner.id,stagedLead.lead.id,JSON.stringify({addresses:[
   {label:'Nhà',recipientName:form.fullName,recipientPhone:form.phone,address:form.address},
   {label:'Điểm giao 2',recipientName:form.fullName,recipientPhone:form.phone,address:'88 Second St'}
  ],invoiceNos:[999001],sourceRevision:1})]);
 const stagedAccount=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) "+
  "VALUES($1,$2,'PENDING') RETURNING id",[stagedSub,stagedEmail]);
 const stagedResult=await loginClaim(stagedAccount,stagedSub,stagedEmail);
 assert.equal(stagedResult.state,'ACTIVE');assert.equal(stagedResult.addressesAdded,2);
 const stagedAddresses=await one('SELECT count(*)::int AS count FROM satori_v2_addresses WHERE profile_id=$1',
  [stagedResult.profileId]);assert.equal(stagedAddresses.count,2);
 const audit=await one("SELECT actor FROM satori_v2_audit WHERE event_type='LEGACY_VERIFIED_GMAIL_AUTO_ACTIVATED' "+
  'AND resource_id=$1',[stagedLead.lead.id]);
 assert.equal(audit.actor,'system');

 // Staged old CTV must keep both owner-set discounts independently.
 const leadCtv=await adminCreateLead(pool,owner.id,{fullName:'CTV Legacy Synthetic',
  phone:'0900000222',address:'22 Synthetic Legacy Street',
  requestedType:'collaborator',discountBps:2000,collaboratorBps:3500,confirmed:true});
 const pendingCtv=await one('SELECT discount_bps,collaborator_bps FROM satori_v2_customer_leads WHERE id=$1',[leadCtv.lead.id]);
 assert.equal(pendingCtv.discount_bps,2000);assert.equal(pendingCtv.collaborator_bps,3500);

 console.log('PASS separate PostgreSQL customer signup/full fields, manual legacy link, Admin approval/discount, CAS suspension and removal, session invalidation, soft archive, no passwords');
}finally{await pool.end()}
