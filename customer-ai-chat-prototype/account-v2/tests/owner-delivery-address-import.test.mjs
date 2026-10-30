import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ownerImportHistoricDeliveryPoints} from '../customer-backend.mjs';

const ownerId='22222222-2222-4222-8222-222222222222';
const accountId='33333333-3333-4333-8333-333333333333';
const profileId='44444444-4444-4444-8444-444444444444';
const oldEnv=['SATORI_READ_ENDPOINT','SATORI_READ_KEY_ID','SATORI_READ_HMAC_SECRET'];
const sourceOrders=[
 {id:'src-1',invoiceNo:5961,name:'Traky Sài Gòn',phone:'0901234567',
  location:'96 Lê Thị Hồng Gấm, Quận 1',date:'30/10/2026'},
 {id:'src-2',invoiceNo:5954,name:'Traky Sài Gòn',phone:'0909606933',
  location:'F23 đường 3A, Him Lam, Quận 7',date:'28/10/2026'},
 {id:'src-3',invoiceNo:5904,name:'Traky Cần Thơ',phone:'',
  location:'133D Trần Hưng Đạo, Cần Thơ',date:'12/10/2026'}
];
function mockLedger(){
 const prev=globalThis.fetch,env=oldEnv.map(k=>process.env[k]);
 process.env.SATORI_READ_ENDPOINT='https://script.google.com/macros/s/TEST/exec';
 process.env.SATORI_READ_KEY_ID='test_key';
 process.env.SATORI_READ_HMAC_SECRET='x'.repeat(32);
 globalThis.fetch=async(_url,options)=>{
  const body=JSON.parse(options.body);
  assert.equal(body.action,'orders.list');
  assert.equal(body.payload.query,'Traky');
  return {ok:true,text:async()=>JSON.stringify({
   ok:true,action:'orders.list',revision:187,data:{orders:sourceOrders,totalMatches:3}
  })};
 };
 return ()=>{globalThis.fetch=prev;
  oldEnv.forEach((k,i)=>{if(env[i]===undefined)delete process.env[k];else process.env[k]=env[i]})};
}
function stub({status='PENDING',revision=3,registration=true,profile=true,
 existing=[]}={}){
 const queries=[],addresses=[...existing],audit=[];
 const conn={async query(sql,params=[]){
  queries.push({sql,params});
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rowCount:0,rows:[]};
  if(sql.startsWith('SELECT id,email,google_sub,access_status,revision'))
   return {rowCount:1,rows:[{id:accountId,email:'traky@example.test',
    google_sub:'verified-google-sub',access_status:status,revision}]};
  if(sql.startsWith('SELECT full_name,phone,requested_type FROM satori_v2_registrations'))
   return {rowCount:registration?1:0,rows:registration?[{
    full_name:'Traky Admin',phone:'0900000000',requested_type:'collaborator'}]:[]};
  if(sql.startsWith('SELECT id FROM satori_v2_profiles WHERE account_id'))
   return {rowCount:profile?1:0,rows:profile?[{id:profileId}]:[]};
  if(sql.startsWith('INSERT INTO satori_v2_profiles'))return {rowCount:1,rows:[{id:profileId}]};
  if(sql.startsWith('SELECT id,address FROM satori_v2_addresses'))return {
   rowCount:addresses.length,rows:addresses.map((x,i)=>({id:'row-'+i,address:x}))};
  if(sql.startsWith('INSERT INTO satori_v2_addresses')){
   addresses.push(params[4]);return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('INSERT INTO satori_v2_audit')){
   audit.push({account:params[0],event:params[2],details:JSON.parse(params[4])});
   return {rowCount:1,rows:[]};
  }
  throw Error('UNEXPECTED_QUERY: '+sql);
 },release(){}};
 return {pool:{async connect(){return conn}},queries,addresses,audit};
}
const request={confirmed:true,identityConfirmed:true,accountId,expectedAccountRevision:3,
 query:'Traky',sourceRevision:187,selected:[
  {invoiceNo:5961,sourceId:'src-1'},
  {invoiceNo:5954,sourceId:'src-2'}
 ]};
test('verified PENDING Gmail can receive only selected signed delivery points, no invoices',async()=>{
 const restore=mockLedger();
 try{
  const db=stub();
  const out=await ownerImportHistoricDeliveryPoints(db.pool,{id:ownerId},request);
  assert.equal(out.created,2);
  assert.equal(out.skippedExisting,0);
  assert.equal(out.accessStatus,'PENDING');
  assert.equal(out.invoiceHistoryImported,false);
  assert.equal(db.addresses.length,2);
  assert.equal(db.audit[0].event,'DELIVERY_POINTS_IMPORTED_FROM_SIGNED_LEDGER');
  assert.equal(db.audit[0].details.invoiceHistoryImported,false);
  assert.equal(db.queries.some(x=>/INSERT INTO (?:satori_v2_order|satori_v2_customer_leads)|LEGACY_INVOICE_ACCOUNT_BOUND|access_status='ACTIVE'/i.test(x.sql)),false);
 }finally{restore()}
});
test('repeated import skips saved addresses and never duplicates old source invoice',async()=>{
 const restore=mockLedger();
 try{
  const db=stub({existing:['96 Lê Thị Hồng Gấm, Quận 1']});
  const out=await ownerImportHistoricDeliveryPoints(db.pool,{id:ownerId},request);
  assert.equal(out.created,1);
  assert.equal(out.skippedExisting,1);
  assert.equal(db.addresses.length,2);
 }finally{restore()}
});
test('empty old phone requires explicit manual verified recipient phone',async()=>{
 const restore=mockLedger();
 try{
  const db=stub();
  const input={...request,selected:[{invoiceNo:5904,sourceId:'src-3'}]};
  await assert.rejects(()=>ownerImportHistoricDeliveryPoints(db.pool,{id:ownerId},input),
   {code:'DELIVERY_IMPORT_PHONE_REQUIRED'});
  const out=await ownerImportHistoricDeliveryPoints(db.pool,{id:ownerId},{
   ...input,selected:[{...input.selected[0],phoneOverride:'0975681220'}]});
  assert.equal(out.created,1);
 }finally{restore()}
});
test('deny unverified and unregistered or stale-account targets, refuse unverified source refs',async()=>{
 const restore=mockLedger();
 try{
  for(const [options,error] of [
   [{registration:false},'DELIVERY_IMPORT_COMPLETE_REGISTRATION_FIRST'],
   [{revision:4},'CUSTOMER_REVISION_CONFLICT'],
   [{status:'SUSPENDED'},'DELIVERY_IMPORT_GOOGLE_ACCOUNT_NOT_VERIFIED']
  ]){
   const db=stub(options);
   await assert.rejects(()=>ownerImportHistoricDeliveryPoints(db.pool,{id:ownerId},request),
    {code:error});
   assert.ok(db.queries.some(x=>x.sql==='ROLLBACK'));
  }
  await assert.rejects(()=>ownerImportHistoricDeliveryPoints(stub().pool,{id:ownerId},{
   ...request,selected:[{invoiceNo:5961,sourceId:'fake'}]
  }),{code:'DELIVERY_IMPORT_SOURCE_NOT_FOUND'});
  await assert.rejects(()=>ownerImportHistoricDeliveryPoints(stub().pool,{id:ownerId},{
   ...request,identityConfirmed:false
  }),{code:'DELIVERY_IMPORT_OWNER_CONFIRMATION_REQUIRED'});
  await assert.rejects(()=>ownerImportHistoricDeliveryPoints(stub().pool,{id:accountId},request),
   {code:'OWNER_CANNOT_IMPORT_SELF'});
 }finally{restore()}
});
test('owner UI selects target Gmail and signed addresses, never transfers invoices',()=>{
 const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
 assert.match(html,/id="crmImportDelivery"/);
 assert.match(script,/function renderHistoricAddressImporter\(\)/);
 assert.match(script,/account\.email/);
 assert.match(script,/group\.ref\.sourceId/);
 assert.match(script,/sourceRevision:source\.revision/);
 assert.match(script,/identityConfirmed:true/);
 assert.match(router,/if\(pathname==='\/api\/v2\/admin\/legacy\/import-delivery-points'&&req.method==='POST'\)\{\s*owner\(actor\)/);
 const fn=script.split('function renderHistoricAddressImporter(){')[1]
  ?.split('async function searchSignedOldCustomers(){')[0]||'';
 assert.doesNotMatch(fn,/\/api\/v2\/admin\/legacy\/bind-history|\/api\/v2\/admin\/customers','PATCH'/);
 assert.doesNotThrow(()=>new vm.Script(script));
});
