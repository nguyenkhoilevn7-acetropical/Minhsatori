import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {ownerPushConfig,validateDevice,eligibleOfficialInvoice,classifyFcmFailure,
 scanDays,createFcmSender,registerOwnerDevice,startOwnerPushRelay} from '../owner-push.mjs';

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
 const base={id:'1700000000000',invoiceNo:5969,status:'Chưa thanh toán',excluded:false};
 assert.equal(eligibleOfficialInvoice(base),true);
 for(const bad of [{...base,id:''},{...base,invoiceNo:0},{...base,status:'Đã hủy'},
  {...base,status:'Không Tính'},{...base,excluded:true},{...base,testOnly:true},
  {...base,isTest:true},{...base,missing:true},{...base,status:'DRAFT'},
  {...base,status:'Bị từ chối'},{...base,status:'TEST đơn'}])
  assert.equal(eligibleOfficialInvoice(bad),false,JSON.stringify(bad));
});

test('FCM HTTP v1 failures map to safe codes; only dead tokens disable a device',()=>{
 const unreg={error:{status:'NOT_FOUND',details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:'UNREGISTERED'}]}};
 assert.deepEqual(classifyFcmFailure(404,unreg),{code:'FCM_TOKEN_UNREGISTERED',invalidToken:true});
 assert.equal(classifyFcmFailure(400,{error:{message:'The registration token is not a valid FCM registration token'}}).invalidToken,true);
 assert.equal(classifyFcmFailure(400,{error:{message:'Invalid JSON payload'}}).invalidToken,false);
 assert.equal(classifyFcmFailure(401,{}).code,'FCM_AUTH_FAILED');
 assert.equal(classifyFcmFailure(429,{}).code,'FCM_QUOTA_EXCEEDED');
 assert.equal(classifyFcmFailure(503,{}).invalidToken,false);
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
  fetcher:async()=>({ok:false,status:404,json:async()=>({error:{details:[{errorCode:'UNREGISTERED'}]}})})});
 await assert.rejects(failing({token:device.token,data:{type:'x'}}),
  e=>e.code==='FCM_TOKEN_UNREGISTERED'&&e.invalidToken===true);
});

test('relay never starts without configuration',()=>{
 const r=startOwnerPushRelay({env:{},pool:{},reader:()=>{}});
 assert.equal(r.enabled,false);
 assert.equal(r.reason,'PUSH_DISABLED');
});
