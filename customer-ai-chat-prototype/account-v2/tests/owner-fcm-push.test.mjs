import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerPushReady,validateOwnerDevice,registerOwnerDevice,
 notifyConfirmedInvoice} from '../owner-fcm-push.mjs';

const disabled={SATORI_OWNER_PUSH_ENABLED:'0'};
test('FCM stays disabled unless trusted server credentials are configured',()=>{
 assert.equal(ownerPushReady(disabled),false);
 assert.equal(ownerPushReady({SATORI_OWNER_PUSH_ENABLED:'1'}),false);
});
test('strict token validation rejects empty/invalid or long identifiers',()=>{
 for(const input of [{token:'',platform:'android'},{token:'x'.repeat(4097),platform:'android'},
  {token:'x'.repeat(60),platform:'ios'},{token:'x'.repeat(60)+'\n',platform:'android'}]){
  assert.throws(()=>validateOwnerDevice(input));
 }
 const token='A'.repeat(152)+':APA91b';
 assert.equal(validateOwnerDevice({platform:'android',token}),token);
});
test('owner-only device registration is fail-closed without server credentials',async()=>{
 await assert.rejects(
  registerOwnerDevice({query(){throw new Error('DB must not be called')}},{id:'fake'},
   {token:'A'.repeat(152),platform:'android'},disabled),
  /FCM_NOT_CONFIGURED/);
});
test('disabled push never writes an outbox or performs network calls',async()=>{
 const result=await notifyConfirmedInvoice(
  {query(){throw Error('database access denied')}},5969,'fake',disabled,
  ()=>{throw Error('network denied')});
 assert.deepEqual(result,{sent:0,disabled:true});
});
