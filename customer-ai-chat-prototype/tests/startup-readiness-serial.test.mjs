/* Isolated non-mutating startup scheduler tests. No keys, network or invoices. */
import assert from 'node:assert/strict';
import {runSerializedStartupReadiness} from '../startup-readiness-serial.mjs';

const order=[];
let active=0,maxActive=0,failures=0;
const step=(name,shouldFail=false)=>({
 name,enabled:true,
 run:async()=>{
  order.push('start:'+name);
  active++;maxActive=Math.max(maxActive,active);
  try{
   await new Promise(resolve=>setTimeout(resolve,5));
   if(shouldFail)throw Error('fake transport failure');
  }finally{
   active--;
   order.push('end:'+name);
  }
 },
 onError:()=>{failures++;order.push('failed:'+name)}
});
const result=await runSerializedStartupReadiness([
 step('readonly'),step('ctv-read',true),
 {name:'disabled-write',enabled:false,run:()=>{throw Error('forbidden')}},
 step('owner-readonly')
]);
assert.equal(maxActive,1,'no overlapping App Script HMAC requests');
assert.deepEqual(result,[
 {name:'readonly',completed:true},
 {name:'ctv-read',completed:false},
 {name:'owner-readonly',completed:true}
]);
assert.deepEqual(order,[
 'start:readonly','end:readonly',
 'start:ctv-read','end:ctv-read','failed:ctv-read',
 'start:owner-readonly','end:owner-readonly'
]);
assert.equal(failures,1,'one safe diagnostic for simulated failure');
await assert.rejects(()=>runSerializedStartupReadiness({}),TypeError);
console.log('PASS serial-only startup probes, fail-closed continuation, disabled steps, zero writes');
