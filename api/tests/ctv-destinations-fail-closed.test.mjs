// Offline-only regression for CTV owner-approved destinations.
// Executes only the two pure preflight functions from staging BotApi.gs.
// No credentials, Apps Script requests, Drive access or invoice mutations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const file=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../BotApi.gs');
const source=fs.readFileSync(file,'utf8');
function extract(name,next){
 const a=source.indexOf('function '+name+'(');
 const b=source.indexOf('function '+next+'(',a+1);
 assert.ok(a>=0&&b>a,'Cannot locate '+name+' preflight');
 return source.slice(a,b).trim();
}
function need(value,code){
 if(!value){const e=new Error(code);e.code=code;throw e}
}
const destination={id:'historical-ref',invoiceNo:5911};
const basePolicy={enabled:true,reviewedByOwner:true,policyVersion:'policy-v1',
 customerDiscountPercent:20,collaboratorDiscountPercent:35,
 shippingPercent:0,vatPercent:0,authorizedDestinations:[]};
const baseRequest={collaboratorId:'ctv_1234',requestId:'req_12345678',
 confirmed:true,enabled:true,customerDiscountPercent:20,
 collaboratorDiscountPercent:35,shippingPercent:0,vatPercent:0};

function configFn(existing=null){
 const ctx={need,collaborator:()=>({name:'CTV synthetic'}),
  validPairPolicy:()=>{},pairPolicyFor:()=>existing,
  validatedCtvDestinations:(_s,refs)=>refs,version:()=>{},
  pairPolicies:()=>existing?[existing]:[],
  Utilities:{getUuid:()=> 'synthetic-uuid'},PAIR_POLICY_KEY:'fake-policies'};
 return vm.runInNewContext('('+extract('configurePair','pairRequestIntent')+')',ctx);
}
function pairFn(policy){
 const ctx={need,pairRequestIntent:()=> 'synthetic-intent',
  version:()=>{},collaborator:()=>({name:'CTV synthetic'}),
  pairPolicyFor:()=>policy,validPairPolicy:()=>{},
  checkProfile:()=>{throw new Error('PAST_DESTINATION_GUARD')},
  Utilities:{getUuid:()=> 'synthetic-uuid'}};
 return vm.runInNewContext('('+extract('createPair','create')+')',ctx);
}
const fakeState={revision:1,values:{satori_trash_bin_v15:'[]'}};
const fakeOrder={name:'Customer synthetic',phone:'0000000000',
 location:'Synthetic address',items:[{code:'TP-00001',qty:1}]};

test('enabling pair policy without destinations is forbidden, including omission',()=>{
 for(const p of [baseRequest,{...baseRequest,authorizedDestinations:[]}]){
  assert.throws(()=>configFn()(fakeState,p),e=>e.code==='CTV_DESTINATIONS_REQUIRED');
 }
});
test('disabling policy with no destinations remains permitted',()=>{
 const result=configFn()(fakeState,{...baseRequest,enabled:false});
 assert.equal(result.modified,true);
 assert.equal(result.result.policy.enabled,false);
});
test('explicit owner-approved destinations can be configured',()=>{
 const result=configFn()(fakeState,{...baseRequest,authorizedDestinations:[destination]});
 assert.equal(result.modified,true);
 assert.equal(result.result.policy.authorizedDestinations.length,1);
});
test('pair write fails closed on legacy active policy missing destinations',()=>{
 for(const authorizedDestinations of [undefined,[],null]){
  const fn=pairFn({...basePolicy,authorizedDestinations});
  assert.throws(()=>fn(fakeState,[],{requestId:'req_12345678',
   collaboratorId:'ctv_1234',expectedPolicyVersion:'policy-v1',order:fakeOrder}),
   e=>e.code==='CTV_DESTINATIONS_REQUIRED');
 }
});
test('pair write rejects a destination not explicitly approved',()=>{
 const fn=pairFn({...basePolicy,authorizedDestinations:[destination]});
 assert.throws(()=>fn(fakeState,[],{requestId:'req_12345678',
  collaboratorId:'ctv_1234',expectedPolicyVersion:'policy-v1',order:fakeOrder,
  customerRef:{id:'different',invoiceNo:5912}}),
  e=>e.code==='CTV_DESTINATION_NOT_APPROVED');
});
test('matching destination proceeds to subsequent profile verification',()=>{
 const fn=pairFn({...basePolicy,authorizedDestinations:[destination]});
 assert.throws(()=>fn(fakeState,[],{requestId:'req_12345678',
  collaboratorId:'ctv_1234',expectedPolicyVersion:'policy-v1',order:fakeOrder,
  customerRef:destination}),/PAST_DESTINATION_GUARD/);
});
