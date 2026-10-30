import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {adminCompleteNewRegistration,adminApproveRegistration} from '../customer-backend.mjs';
const account='11111111-1111-4111-8111-111111111111',ownerId='22222222-2222-4222-8222-222222222222';
const base={
 confirmed:true,accountId:account,expectedRevision:3,fullName:'Treky Official',
 phone:'0900000000',address:'32 Đường mẫu, Hồ Chí Minh',requestedType:'agency'
};
function fakeDB({verified=true,hasRegistration=false,status='PENDING',revision=3}={}){
 const log=[];
 const conn={async query(sql,params=[]){
  log.push({sql,params});
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rowCount:0,rows:[]};
  if(sql.includes('SELECT id,email,google_sub,access_status,revision')){
   return {rowCount:1,rows:[{id:account,email:'treky@example.test',
    google_sub:verified?'google-sub-treky':null,access_status:status,revision}]};
  }
  if(sql.startsWith('SELECT account_id FROM satori_v2_registrations')){
   return {rowCount:hasRegistration?1:0,rows:hasRegistration?[{account_id:account}]:[]};
  }
  if(sql.startsWith('INSERT INTO satori_v2_registrations'))return {rowCount:1,rows:[{revision:1}]};
  if(sql.startsWith('UPDATE satori_v2_accounts SET display_name'))return {rowCount:1,rows:[{revision:4}]};
  if(sql.startsWith('INSERT INTO satori_v2_audit'))return {rowCount:1,rows:[]};
  throw Error('SQL_UNEXPECTED: '+sql);
 },release(){}};
 return {pool:{async connect(){return conn}},log};
}
test('owner can complete a completely NEW Google account without legacy CRM or invoices',async()=>{
 const {pool,log}=fakeDB();
 const result=await adminCompleteNewRegistration(pool,{id:ownerId},base);
 assert.equal(result.accessStatus,'PENDING');
 assert.equal(result.approvedForPricing,false);
 assert.equal(result.registrationRevision,1);
 assert.equal(result.revision,4);
 assert.equal(log.filter(x=>x.sql==='COMMIT').length,1);
 assert.equal(log.some(x=>x.sql.includes('readMinhSatori')||x.sql.includes('legacy')||
   x.sql.includes('satori_v2_orders')||x.sql.includes('satori_v2_invoices')),false);
 assert.match(log.find(x=>x.sql.includes('INSERT INTO satori_v2_registrations')).sql,/requested_type/);
 assert.ok(log.some(x=>x.params?.[2]==='CUSTOMER_NEW_REGISTRATION_COMPLETED'));
 assert.equal(log.some(x=>x.sql.includes("access_status='ACTIVE'")),false);
});
test('no auto approval, no overwrite of existing registration, no unauthenticated account',async()=>{
 for(const [options,expected] of [
  [{hasRegistration:true},'CUSTOMER_REGISTRATION_ALREADY_EXISTS'],
  [{verified:false},'GOOGLE_ACCOUNT_NOT_VERIFIED'],
  [{status:'ACTIVE'},'CUSTOMER_NOT_PENDING'],
  [{revision:4},'CUSTOMER_REVISION_CONFLICT']
 ]){
  const {pool,log}=fakeDB(options);
  await assert.rejects(()=>adminCompleteNewRegistration(pool,{id:ownerId},base),{code:expected});
  assert.equal(log.some(x=>x.sql==='COMMIT'),false);
  assert.equal(log.some(x=>x.sql==='ROLLBACK'),true);
 }
 const {pool}=fakeDB();
 await assert.rejects(()=>adminCompleteNewRegistration(pool,{id:ownerId},{...base,confirmed:false}),
  {code:'OWNER_CONFIRMATION_REQUIRED'});
 await assert.rejects(()=>adminCompleteNewRegistration(pool,{id:ownerId},{...base,address:''}),
  {code:'CUSTOMER_FIELD_INVALID'});
 await assert.rejects(()=>adminCompleteNewRegistration(pool,{id:ownerId},{...base,phone:''}),
  {code:'CUSTOMER_FIELD_INVALID'});
 await assert.rejects(()=>adminCompleteNewRegistration(pool,{id:ownerId},{...base,email:'fake@example.test'}),
  {code:'VERIFIED_EMAIL_MISMATCH'});
});
test('new onboarding route is owner-only; legacy search is optional',()=>{
 const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
 assert.match(router,/pathname==='\/api\/v2\/admin\/customers\/complete-new-registration'&&req.method==='POST'/);
 assert.match(router,/owner\(actor\);[\s\S]{0,80}adminCompleteNewRegistration/);
 assert.match(script,/if\(x.accessStatus==='PENDING'&&!x.registrationRevision\)/);
 assert.match(script,/Hoàn thiện đăng ký mới/);
 assert.match(script,/if\(x.accessStatus==='PENDING'&&x.registrationRevision\)/);
 assert.match(script,/Kiểm tra lịch sử khách cũ \(tùy chọn, không bắt buộc\)/);
 assert.match(script,/Duyệt khách mới/);
 assert.match(script,/KHÔNG ngăn duyệt khách mới/);
 assert.doesNotThrow(()=>new vm.Script(script));
});
