import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCustomers} from '../reconciliation/customer-review.mjs';
const row = (id, more={}) => ({id,tenantId:'synthetic-a',revision:1,name:'Khách giả lập',phone:'0901234567',kind:'customer',discountBps:2000,addresses:['Địa chỉ giả lập A','Địa chỉ giả lập B'],...more});
const review=(source,target)=>reviewCustomers({tenantId:'synthetic-a',source,target});
test('shared phone with distinct Google identities stays manual and never links',()=>{
 const out=review([row('s',{googleVerified:true,googleSub:'sub-1'})],[row('t',{phone:'+84 901 234 567',googleVerified:true,googleSub:'sub-2'})]);
 assert.equal(out[0].decision,'MANUAL_REVIEW');assert.equal(out[0].writesAllowed,false);
 assert.ok(out[0].candidates[0].reasons.includes('GOOGLE_IDENTITY_CONFLICT'));
});
test('verified identity with changed phone still requires review',()=>{
 const out=review([row('s',{googleVerified:true,googleSub:'sub-1'})],[row('t',{phone:'0912345678',googleVerified:true,googleSub:'sub-1'})]);
 assert.equal(out[0].candidates[0].reasons[0],'VERIFIED_GOOGLE_SUB_EQUAL');assert.equal(out[0].writesAllowed,false);
});
test('unverified Google claim and same name do not establish identity',()=>{
 assert.deepEqual(review([row('s',{phone:'',googleSub:'sub-1'})],[row('t',{phone:'',googleSub:'sub-1',googleVerified:true})])[0].candidates,[]);
});
test('no cross-tenant candidates or source identifiers are returned',()=>{
 const out=review([row('s'),row('foreign-source',{tenantId:'synthetic-b'})],[row('foreign-target',{tenantId:'synthetic-b'})]);
 assert.equal(out.length,1);assert.deepEqual(out[0].candidates,[]);
 assert.ok(!JSON.stringify(out).includes('foreign'));
});
test('one shared number across multiple profiles preserves all ambiguous candidates',()=>{
 const out=review([row('s'),row('s2')],[row('t'),row('t2')]);
 assert.equal(out[0].sourceCollision,true);assert.equal(out[0].candidates.length,2);
});
test('multiple addresses are compared as sets and source input is unchanged',()=>{
 const s=[row('s')],t=[row('t',{addresses:['Địa chỉ giả lập B','Địa chỉ giả lập A']})];
 const before=JSON.stringify([s,t]);const out=review(s,t);
 assert.ok(!out[0].candidates[0].reasons.includes('ADDRESS_SET_DIFFERENT'));assert.equal(JSON.stringify([s,t]),before);
});
test('address removal, role and discount changes require admin review',()=>{
 const out=review([row('s')],[row('t',{addresses:['Địa chỉ giả lập A'],kind:'agency',discountBps:3500})]);
 for(const reason of ['ADDRESS_SET_DIFFERENT','ROLE_DIFFERENT','DISCOUNT_REQUIRES_ADMIN_REVIEW'])assert.ok(out[0].candidates[0].reasons.includes(reason));
 assert.equal(out[0].sourceRevision,1);assert.equal(out[0].candidates[0].targetRevision,1);
});
test('empty, malformed and name-only inputs never produce phone matches',()=>{
 for(const p of ['', '0901234567 ext 2','0000000000'])assert.deepEqual(review([row('s',{phone:p})],[row('t',{phone:p})])[0].candidates,[]);
});
test('missing tenant, invalid revisions, duplicate IDs and invalid policy are rejected',()=>{
 assert.throws(()=>reviewCustomers({source:[],target:[]}),/TENANT_REQUIRED/);
 for(const s of [[row('s',{revision:0})],[row('s'),row('s')],[row('s',{discountBps:10001})]])assert.throws(()=>review(s,[]),/INVALID_REVIEW_SNAPSHOT/);
});
test('report contains IDs and reasons only, no raw contact details or Google subject',()=>{
 const out=JSON.stringify(review([row('s',{googleVerified:true,googleSub:'private-sub'})],[row('t',{googleVerified:true,googleSub:'private-sub'})]));
 for(const privateValue of ['0901234567','private-sub','Địa chỉ','Khách'])assert.ok(!out.includes(privateValue));
});
