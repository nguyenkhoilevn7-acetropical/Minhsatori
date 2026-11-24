import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogueSnapshot,logCatalogueSnapshot} from '../catalogue-readiness-log.mjs';

test('read-only startup diagnostic reveals only aggregate flags and public SKU presence',async()=>{
 const inputs=[];
 const snapshot=await catalogueSnapshot(async sql=>{
  inputs.push(sql);
  return {rows:[{active_count:3,satori_500:0,juice_oi:1}]};
 });
 assert.deepEqual(snapshot,{activeCount:3,satori500Active:false,oiHongActive:true});
 assert.equal(Object.isFrozen(snapshot),true);
 assert.equal(inputs.length,1);
 assert.match(inputs[0],/SELECT COUNT/);
 assert.match(inputs[0],/WHERE active=true/);
 assert.doesNotMatch(inputs[0],/INSERT|UPDATE|DELETE|DROP/);
 assert.equal(JSON.stringify(snapshot).includes('secret'),false);
});
test('startup probe disabled without explicit pilot/DB configuration',async()=>{
 const messages=[];
 await logCatalogueSnapshot({},(...parts)=>messages.push(parts));
 assert.equal(messages.length,0);
});
