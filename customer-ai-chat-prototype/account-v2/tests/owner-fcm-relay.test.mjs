import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleOfficialInvoice,ownerEvent,startOwnerFcmRelay} from '../owner-fcm-relay.mjs';
import {validateDevice,ownerFcmConfigured} from '../owner-fcm-devices.mjs';

const id='1700000000000';
const base={id,invoiceNo:5936,status:'Chưa thanh toán',excluded:false};
test('only official confirmed canonical invoice can create event',()=>{
 assert.equal(eligibleOfficialInvoice(base),true);
 for(const change of [
  {...base,id:''},{...base,invoiceNo:0},{...base,status:'Đã hủy'},
  {...base,status:'Không Tính'},{...base,excluded:true},
  {...base,testOnly:true},{...base,isTest:true},{...base,missing:true},
  {...base,status:'DRAFT'}
 ])assert.equal(eligibleOfficialInvoice(change),false);
});
test('event identities cannot masquerade as edit or payment',()=>{
 assert.deepEqual(ownerEvent('official_invoice_created','5936|'+id,5936),{
  kind:'official_invoice_created',sourceKey:'5936|'+id,invoiceNo:5936});
 assert.deepEqual(ownerEvent('owner_registration_pending','some-uuid'),{
  kind:'owner_registration_pending',sourceKey:'some-uuid',invoiceNo:null});
 for(const kind of ['invoice_edited','payment_changed','cancelled','quote_created'])
  assert.throws(()=>ownerEvent(kind,'5936|'+id,5936),/OWNER_EVENT_INVALID/);
 assert.throws(()=>ownerEvent('official_invoice_created','5936|'+id,0));
});
test('device identifier and FCM token require strict validation',()=>{
 const good={deviceId:'9c5d55a0-f96e-4ee1-8e2f-6e88cdac86aa',
  token:'Abc:def-Ghi_jKlMnoPqrstUvwxYz123456789012345678'};
 assert.deepEqual(validateDevice(good),good);
 for(const bad of [{...good,deviceId:'owner'},{...good,token:'unsafe token'},
  {...good,token:'abc'},{...good,token:42}])
  assert.throws(()=>validateDevice(bad),/INVALID_PUSH_DEVICE/);
});
test('without explicit flag and protected credentials no push worker starts',async()=>{
 assert.equal(ownerFcmConfigured({}),false);
 assert.deepEqual(await startOwnerFcmRelay({}),{enabled:false});
});
