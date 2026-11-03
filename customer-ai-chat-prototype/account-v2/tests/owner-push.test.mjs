import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {ownerPushConfig,validateDevice,eligibleOfficialInvoice,classifyFcmFailure,
 scanDays,createFcmSender,registerOwnerDevice,startOwnerPushRelay,verifyWakeRequest,
 probeInvoiceNumber,invoiceIsFresh} from '../owner-push.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:1024,
 privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const fakeAccount=(project='satori-fake-ci')=>JSON.stringify({type:'service_account',
 project_id:project,client_email:'push@'+project+'.iam.gserviceaccount.com',private_key:privateKey});
const enabled={SATORI_OWNER_PUSH_ENABLED:'1',SATORI_FCM_PROJECT_ID:'satori-fake-ci',
 SATORI_FCM_SERVICE_ACCOUNT_JSON:fakeAccount()};
const device={deviceId:'9c5d55a0-f96e-4ee1-8e2f-6e88cdac86aa',
 token:'fAkE_tOkEn:APA91b'+'x'.repeat(120),platform:'android'};

test('push stays disabled without explicit flag and a matching service account',()=>{
 assert.equal(ownerPushConfig({}).reason,'PUSH_DISABLED');
 assert.equal(ownerPushConfig({SATORI_OWNER_PUSH_ENABLED:'1'}).reason,'FCM_PROJECT_ID_MISSING');
 assert.equal(ownerPushConfig({...enabled,SATORI_FCM_SERVICE_ACCOUNT_JSON:''}).reason,
  'FCM_SERVICE_ACCOUNT_MISSING');
 assert.equal(ownerPushConfig({...enabled,SATORI_FCM_SERVICE_ACCOUNT_JSON:fakeAccount('other-project')}).reason,
  'FCM_PROJECT_MISMATCH');
 assert.equal(ownerPushConfig(enabled).enabled,true);
});

test('device registration input is strictly validated',()=>{
 assert.deepEqual(validateDevice(device),{deviceId:device.deviceId,token:device.token});
 for(const bad of [{...device,deviceId:'owner'},{...device,token:'short'},
  {...device,token:device.token+' x'},{...device,platform:'ios'},{...device,token:42},null])
  assert.throws(()=>validateDevice(bad),/PUSH_DEVICE_INVALID/);
});

test('registration is fail-closed before touching the database when push is off',async()=>{
 await assert.rejects(registerOwnerDevice({query(){throw Error('no db')},connect(){throw Error('no db')}},
  {id:'x'},'a'.repeat(64),device,{}),/PUSH_DISABLED/);
});

test('only official, non-test, non-cancelled canonical invoices are eligible',()=>{
 const base={id:'1700000000000',invoiceNo:5969,status:'Chưa thanh toán',excluded:false,timestamp:Date.now()};
 assert.equal(eligibleOfficialInvoice(base),true);
 for(const bad of [{...base,id:''},{...base,invoiceNo:0},{...base,status:'Đã hủy'},
  {...base,status:'Không Tính'},{...base,excluded:true},{...base,testOnly:true},
  {...base,isTest:true},{...base,missing:true},{...base,status:'DRAFT'},
  {...base,status:'Bị từ chối'},{...base,status:'TEST đơn'}])
  assert.equal(eligibleOfficialInvoice(bad),false,JSON.stringify(bad));
});

const fcmErr=(code)=>[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:code}];
test('FCM 404: only a verified UNREGISTERED token disables a device',()=>{
 assert.deepEqual(classifyFcmFailure(404,{error:{status:'NOT_FOUND',message:'Requested entity was not found.',details:fcmErr('UNREGISTERED')}}),
  {code:'FCM_TOKEN_UNREGISTERED',invalidToken:true});
 // Wrong Firebase project / endpoint: bare 404 without FcmError -> config, keep devices.
 for(const body of [{error:{status:'NOT_FOUND',message:'Requested entity was not found.'}},
  null,{},{error:{details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'UNREGISTERED'}]}}]){
  const r=classifyFcmFailure(404,body);
  assert.equal(r.invalidToken,false,JSON.stringify(body));
  assert.equal(r.code,'FCM_PROJECT_OR_ENDPOINT_NOT_FOUND');
  assert.equal(r.config,true);
 }
 // errorCode spoofed into a non-FCM detail type is ignored.
 assert.equal(classifyFcmFailure(404,{error:{details:[{'@type':'x.Other',errorCode:'UNREGISTERED'}]}}).invalidToken,false);
});
test('FCM 400/403/401/429/5xx classification',()=>{
 assert.equal(classifyFcmFailure(400,{error:{status:'INVALID_ARGUMENT',message:'The registration token is not a valid FCM registration token',details:fcmErr('INVALID_ARGUMENT')}}).invalidToken,true);
 assert.equal(classifyFcmFailure(400,{error:{status:'INVALID_ARGUMENT',message:'Invalid JSON payload received.'}}).invalidToken,false);
 const mismatch=classifyFcmFailure(403,{error:{status:'PERMISSION_DENIED',details:fcmErr('SENDER_ID_MISMATCH')}});
 assert.equal(mismatch.code,'FCM_SENDER_ID_MISMATCH');assert.equal(mismatch.invalidToken,false,'project mismatch is config, not token');
 assert.equal(classifyFcmFailure(401,{}).code,'FCM_AUTH_FAILED');
 assert.equal(classifyFcmFailure(403,{}).invalidToken,false);
 assert.equal(classifyFcmFailure(429,{}).code,'FCM_QUOTA_EXCEEDED');
 assert.equal(classifyFcmFailure(503,{}).code,'FCM_UNAVAILABLE');
});

test('scan covers today and yesterday in Vietnam time (midnight boundary)',()=>{
 assert.deepEqual(scanDays(new Date('2026-11-03T17:30:00Z')),['2026-11-04','2026-11-03']);
 assert.deepEqual(scanDays(new Date('2026-11-01T02:00:00Z')),['2026-11-01','2026-10-31']);
});

test('sender posts a data-only, high-priority HTTP v1 message without PII',async()=>{
 const calls=[];
 const send=createFcmSender(enabled,{accessToken:async()=>'fake-bearer',
  fetcher:async(url,init)=>{calls.push({url,init});return {ok:true,status:200}}});
 assert.equal(await send({token:device.token,data:{type:'verified_new_invoice',invoiceNo:'5969',eventId:'e1'}}),true);
 assert.equal(calls[0].url,'https://fcm.googleapis.com/v1/projects/satori-fake-ci/messages:send');
 assert.equal(calls[0].init.headers.authorization,'Bearer fake-bearer');
 const body=JSON.parse(calls[0].init.body);
 assert.equal(body.message.notification,undefined,'data-only so onMessageReceived always runs');
 assert.equal(body.message.android.priority,'HIGH');
 assert.equal(body.message.android.ttl,'21600s');
 assert.deepEqual(Object.keys(body.message.data).sort(),['eventId','invoiceNo','type']);
 const failing=createFcmSender(enabled,{accessToken:async()=>'t',
  fetcher:async()=>({ok:false,status:404,json:async()=>({error:{details:fcmErr('UNREGISTERED')}})})});
 await assert.rejects(failing({token:device.token,data:{type:'x'}}),
  e=>e.code==='FCM_TOKEN_UNREGISTERED'&&e.invalidToken===true);
});

test('relay never starts without configuration',()=>{
 const r=startOwnerPushRelay({env:{},pool:{},reader:()=>{}});
 assert.equal(r.enabled,false);
 assert.equal(r.reason,'PUSH_DISABLED');
});

const WAKE_SECRET='w'.repeat(20)+crypto.randomBytes(16).toString('hex');
const wakeEnv={SATORI_OWNER_PUSH_WAKE_SECRET:WAKE_SECRET};
const sign=(ts,nonce,changedAt,secret=WAKE_SECRET)=>crypto.createHmac('sha256',secret)
 .update(ts+'\n'+nonce+'\n'+changedAt).digest('hex');
test('wake: signed, fresh, single-use; forged/expired/replayed rejected',()=>{
 const now=Date.now(),nonce=crypto.randomBytes(16).toString('hex'),input={ts:now,nonce,changedAt:now-5000};
 assert.equal(verifyWakeRequest(sign(now,nonce,input.changedAt),input,{},now).code,'PUSH_WAKE_NOT_CONFIGURED');
 assert.equal(verifyWakeRequest(sign(now,nonce,input.changedAt,'x'.repeat(40)),input,wakeEnv,now).code,'PUSH_WAKE_FORBIDDEN');
 assert.equal(verifyWakeRequest('zz',input,wakeEnv,now).code,'PUSH_WAKE_INVALID');
 assert.equal(verifyWakeRequest(sign(now,nonce,input.changedAt),input,wakeEnv,now+301_000).code,'PUSH_WAKE_EXPIRED');
 assert.equal(verifyWakeRequest(sign(now,nonce,input.changedAt),{...input,changedAt:1},wakeEnv,now).code,'PUSH_WAKE_FORBIDDEN');
 assert.deepEqual(verifyWakeRequest(sign(now,nonce,input.changedAt),input,wakeEnv,now),{ok:true});
 assert.equal(verifyWakeRequest(sign(now,nonce,input.changedAt),input,wakeEnv,now).code,'PUSH_WAKE_REPLAYED');
});

test('Apps Script OwnerPushWake.gs signature is accepted by the V2 server; no change -> no call',()=>{
 const here=path.dirname(fileURLToPath(import.meta.url));
 const source=fs.readFileSync(path.join(here,'../../../api/OwnerPushWake.gs'),'utf8');
 const props={SATORI_OWNER_PUSH_WAKE_URL:'https://v2.example.invalid/api/v2/push/wake',
  SATORI_OWNER_PUSH_WAKE_SECRET:WAKE_SECRET,STATE_FILE_ID:'fake-file'};
 let updated=Date.now()-1000;const calls=[];
 const sandbox={
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=v}})},
  DriveApp:{getFileById:()=>({getLastUpdated:()=>new Date(updated)})},
  Utilities:{Charset:{UTF_8:'utf8'},getUuid:()=>crypto.randomUUID(),
   computeHmacSha256Signature:(value,key)=>[...crypto.createHmac('sha256',key).update(value,'utf8').digest()].map(b=>b>127?b-256:b)},
  UrlFetchApp:{fetch:(url,opt)=>{calls.push({url,opt});
   const body=JSON.parse(opt.payload);
   const ok=verifyWakeRequest(opt.headers['x-satori-wake-signature'],body,wakeEnv,Date.now()).ok;
   return {getResponseCode:()=>ok?202:403}}},
  ScriptApp:{}
 };
 vm.createContext(sandbox);vm.runInContext(source,sandbox);
 assert.equal(sandbox.ownerPushWakeTick(),'HTTP_202');
 assert.equal(calls.length,1);
 const sent=JSON.parse(calls[0].opt.payload);
 assert.deepEqual(Object.keys(sent).sort(),['changedAt','nonce','ts'],'no invoice/customer data');
 assert.equal(sandbox.ownerPushWakeTick(),'NO_CHANGE');assert.equal(calls.length,1);
 updated+=60_000;
 assert.equal(sandbox.ownerPushWakeTick(),'HTTP_202');assert.equal(calls.length,2);
 props.SATORI_OWNER_PUSH_WAKE_SECRET='short';
 assert.equal(sandbox.ownerPushWakeTick(),'WAKE_NOT_CONFIGURED');
});

test('exact readback narrows by day then status; never claims MISSING when unsure',async()=>{
 const rows=Array.from({length:150},(_,i)=>({id:'X'+i,invoiceNo:7100+i,status:i<120?'Chưa thanh toán':'Đã thanh toán',phone:'09'+'7001'+String(i).padStart(4,'0'),date:'2026-11-03'}));
 rows.push({id:'T',invoiceNo:7001,status:'Đã thanh toán',phone:'0',date:'2026-11-03'});
 const reader=async(_a,p)=>{
  const hit=rows.filter(o=>[o.phone,o.invoiceNo].some(v=>String(v).includes(p.query))&&
   (!p.status||o.status===p.status)&&(!p.from||o.date===p.from));
  return {revision:1,data:{totalMatches:hit.length,orders:hit.slice(0,100)}};
 };
 const r=await probeInvoiceNumber(reader,7001,{days:['2026-11-03']});
 assert.equal(r.state,'FOUND');assert.ok(r.rows.some(x=>x.id==='T'));
 const unsure=await probeInvoiceNumber(async()=>({revision:1,data:{totalMatches:500,orders:[]}}),7999,{days:['2026-11-03']});
 assert.equal(unsure.state,'UNRESOLVED');
 assert.equal((await probeInvoiceNumber(async()=>({revision:1,data:{totalMatches:0,orders:[]}}),7999,{days:['2026-11-03']})).state,'MISSING');
});

test('freshness is fail-closed for missing/invalid/future timestamps',()=>{
 const now=Date.parse('2026-11-03T08:00:00Z'); // 15:00 Vietnam time
 const base={id:'abc',invoiceNo:1,status:'Chưa thanh toán'};
 assert.equal(invoiceIsFresh({...base,timestamp:now-3_600_000},now),true);
 assert.equal(invoiceIsFresh({...base,timestamp:now-49*3_600_000},now),false,'older than 48h');
 // Missing / non-numeric / zero / negative / pre-2000 / far-future timestamp -> fall back to date.
 for(const timestamp of [undefined,null,'',0,-5,'abc',123456,NaN,now+86_400_000,1.5e12+0.5]){
  assert.equal(invoiceIsFresh({...base,timestamp,date:'03/11/2026'},now),true,'today by date: '+timestamp);
  assert.equal(invoiceIsFresh({...base,timestamp,date:'2026-11-02'},now),true,'yesterday by date');
  assert.equal(invoiceIsFresh({...base,timestamp,date:'15/10/2026'},now),false,'old date never alerts');
  assert.equal(invoiceIsFresh({...base,timestamp},now),false,'no usable age -> no alert');
  assert.equal(invoiceIsFresh({...base,timestamp,date:'31/02/2026'},now),false,'impossible date');
 }
 // Millisecond ledger id as last resort.
 assert.equal(invoiceIsFresh({...base,id:String(now-60_000)},now),true);
 assert.equal(invoiceIsFresh({...base,id:String(now-30*86_400_000)},now),false);
 assert.equal(invoiceIsFresh({...base,id:String(now+86_400_000)},now),false,'future id rejected');
 // Eligibility includes freshness.
 assert.equal(eligibleOfficialInvoice({...base,id:'L1',date:'01/01/2025'},now),false);
 assert.equal(eligibleOfficialInvoice({...base,id:'L1',date:'03/11/2026'},now),true);
});
