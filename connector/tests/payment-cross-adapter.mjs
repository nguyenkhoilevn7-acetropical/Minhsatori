// Synthetic cross-adapter acceptance A-G: actual connector, BotApi, owner API and accounting core.
// Google OAuth, Drive and network are mocked. Never a native/HTTP/device E2E claim.
// No HTTP, credentials, Apps Script deployment, or real invoice is accessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHmac,randomUUID} from 'node:crypto';
import {callTool,tools} from '../lib/satori.mjs';
const root=new URL('../../',import.meta.url);
function fixture(){
 const secret='SYNTHETIC_ONLY_KEY_012345678901234567890123456789';
 const env={SATORI_BOT_API_URL:'https://script.google.com/macros/s/FAKE_NON_NETWORK/exec',SATORI_BOT_KEY_ID:'fixture-client',SATORI_BOT_SECRET:secret,SATORI_ENABLE_WRITES:'true'};
 const name='Khách giả lập — Nguyễn';
 let data={revision:133,values:{satori_orders_v15:JSON.stringify([
  {id:'fixture-A',invoiceNo:70001,name,total:125000,status:'Chưa thanh toán'},
  {id:'fixture-B',invoiceNo:70001,name:'Khách giả lập B',total:250000,status:'Chưa thanh toán'}
 ]),satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]'}};
 let ownerEmail='owner@example.test', backupFail=false;
 const client='1234567890-fixture.apps.googleusercontent.com';
 // The canonical ID is only an in-memory map key: no live Drive API exists in this VM.
 const fileId='14XWSPrxLnKXATwmuHeXGZnCvjDbalghV';
 let writes=0;const backups=[],cache=new Map();
 let scopes=['orders:read','payments:write'];
 const ctx={Date,JSON,Number,String,Object,Array,Math,Error,RegExp,
 OWNER_EMAIL:'owner@example.test', Session:{getEffectiveUser:()=>({getEmail:()=> 'owner@example.test'})},
 UrlFetchApp:{fetch:url=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(url.startsWith('https://oauth2.googleapis.com/tokeninfo?')?{issued_to:client,scope:'https://www.googleapis.com/auth/userinfo.email',expires_in:3600}:{email:ownerEmail,email_verified:true,sub:'12345678901234567890'})})},
 readState_:()=>structuredClone(data),
 ContentService:{MimeType:{JSON:'json'},createTextOutput(text){return {text,setMimeType(){return this}}}},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='SATORI_ANDROID_OWNER_EMAIL'?'owner@example.test':k==='SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON'?JSON.stringify([client]):k==='STATE_FILE_ID'?fileId:k==='SATORI_BOT_CLIENTS_JSON'?JSON.stringify({'fixture-client':{enabled:true,secret,scopes}}):null})},
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{Charset:{UTF_8:'UTF_8'},computeHmacSha256Signature:(m,k,charset)=>{assert.equal(charset,'UTF_8');return [...createHmac('sha256',k).update(m,'utf8').digest()]},getUuid:randomUUID,formatDate:()=> '27/10/2026'},
 DriveApp:{getFileById:id=>{assert.equal(id,fileId);return {
 makeCopy(){if(backupFail)return null;const copy=JSON.stringify(data);backups.push(copy);return {getId:()=>`backup-${backups.length}`,getBlob:()=>({getDataAsString:()=>copy})}},
 setContent(raw){data=JSON.parse(raw);writes++}
 }}}
 };
 vm.createContext(ctx);vm.runInContext(readFileSync(new URL('accounting-core.js',root),'utf8'),ctx);vm.runInContext(readFileSync(new URL('api/BotApi.gs',root),'utf8'),ctx);
 vm.runInContext(readFileSync(new URL('api/AndroidOwnerMobileApi.gs',root),'utf8'),ctx);
 const mobile=(action,payload={})=>JSON.parse(ctx.doPost({parameter:{route:'android'},postData:{contents:JSON.stringify({kind:'satori-android-v1',action,payload,nonce:randomUUID(),accessToken:'FAKE_OWNER_TOKEN_NEVER_REAL_123456'})}}).text);
 const fetcher=async(url,options)=>{
  assert.equal(url,env.SATORI_BOT_API_URL);assert.ok(!options.body.includes(secret));
  assert.ok(/^[\x00-\x7f]*$/.test(options.body),'ASCII transport preserves UTF8 HMAC canonical message');
  return Response.json(JSON.parse(ctx.doPost({postData:{contents:options.body}}).text));
 };
 return {env,name,fetcher,mobile,owner:v=>{ownerEmail=v},failBackup:()=>{backupFail=true},core:ctx.SatoriAccountingCore,read:()=>structuredClone(data),writes:()=>writes,backups,
 scope:v=>{scopes=v},
 payload:(requestId)=>({expectedRevision:data.revision,requestId,id:'fixture-A',invoiceNo:70001,expectedName:name,expectedTotal:125000,confirmed:true,reason:'Giả lập đối soát — không phải thanh toán thật'}),
 call:(tool,p,transport=fetcher)=>callTool(tool,p,env,transport)};
}
function customerPayload(f){const {requestId,reason,...p}=f.payload('unused-customer-id');return {...p,amount:125000}}
function mobileRow(f){
 const snapshot=f.mobile('mobile.snapshot');assert.equal(snapshot.ok,true);
 return JSON.parse(snapshot.data.values.satori_orders_v15).find(x=>x.id==='fixture-A');
}
async function botRow(f){return (await f.call('satori_orders_list',{query:'70001'})).data.orders.find(x=>x.id==='fixture-A')}
test('A: connector customer payment reaches owner snapshot and website accounting core',async()=>{
 const f=fixture();await f.call('satori_mark_customer_paid',customerPayload(f));
 assert.equal((await botRow(f)).customerPaid,true);
 assert.equal(f.core.paid(mobileRow(f)),true);assert.equal(f.writes(),1);
});
test('B: connector Satori payment leaves customer unpaid in canonical and owner reads',async()=>{
 const f=fixture();await f.call('satori_mark_satori_paid',f.payload('acceptance-B-001'));
 const b=await botRow(f);assert.equal(b.satoriPaid,true);assert.equal(b.customerPaid,false);
 const m=mobileRow(f);assert.ok(m.satoriPaidAt);assert.equal(f.core.paid(m),false);
});
test('C: actual owner API bridge reverses Satori payment without changing customer payment',async()=>{
 const f=fixture();await f.call('satori_mark_customer_paid',customerPayload(f));
 await f.call('satori_mark_satori_paid',f.payload('acceptance-C-002'));
 const result=f.mobile('payments.markSatoriUnpaid',f.payload('acceptance-C-003'));assert.equal(result.ok,true);
 const b=await botRow(f);assert.equal(b.satoriPaid,false);assert.equal(b.customerPaid,true);
 const m=mobileRow(f);assert.ok(!m.satoriPaidAt);assert.equal(f.core.paid(m),true);
});
test('D: lost owner response and same requestId retry commit once',()=>{
 const f=fixture(),p=f.payload('acceptance-D-001');
 // Discard the successful response, as if the transport disconnected after commit.
 f.mobile('payments.markSatoriPaid',p);
 const retry=f.mobile('payments.markSatoriPaid',p);assert.equal(retry.ok,true);
 assert.equal(retry.data.alreadyApplied,true);assert.equal(f.writes(),1);assert.equal(f.backups.length,1);
 assert.equal(mobileRow(f).paymentAudit[0].requestId,p.requestId);
});
test('E: duplicate invoice numbers cannot redirect an exact-ID owner write',()=>{
 const f=fixture(),before=f.read();
 const result=f.mobile('payments.markSatoriPaid',{...f.payload('acceptance-E-001'),id:'fixture-B'});
 assert.equal(result.ok,false);assert.equal(result.error.code,'ORDER_CHANGED');
 assert.deepEqual(f.read(),before);assert.equal(f.writes(),0);
});
test('F: failed prewrite backup rejects both owner and signed connector writes',async()=>{
 const f=fixture(),before=f.read();f.failBackup();
 assert.equal(f.mobile('payments.markSatoriPaid',f.payload('acceptance-F-001')).error.code,'BACKUP_FAILED');
 await assert.rejects(()=>f.call('satori_mark_satori_paid',f.payload('acceptance-F-002')),/BACKUP_FAILED/);
 assert.equal(f.writes(),0);assert.deepEqual(f.read(),before);
});
test('G: mocked verified non-owner OAuth identity cannot reach actual BotApi write bridge',()=>{
 const f=fixture(),before=f.read();f.owner('intruder@example.test');
 const result=f.mobile('payments.markSatoriPaid',f.payload('acceptance-G-001'));
 assert.equal(result.ok,false);assert.equal(result.error.code,'FORBIDDEN');
 assert.equal(f.writes(),0);assert.equal(f.backups.length,0);assert.deepEqual(f.read(),before);
});
