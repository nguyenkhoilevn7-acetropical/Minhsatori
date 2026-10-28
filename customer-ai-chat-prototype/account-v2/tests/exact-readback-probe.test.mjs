import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {probeCanonicalReadback} from '../exact-readback-probe.mjs';

const requestId='00000000-0000-4000-8000-000000000001';
test('read-only signed probe sends one exact random requestId and returns PASS',async()=>{
 const actions=[],reports=[];
 const result=await probeCanonicalReadback({
  readOnlyReady:()=>true,
  randomId:()=>requestId,
  readMinhSatori:async (action,payload)=>{
   actions.push([action,payload]);
   return {revision:177,data:{found:false,state:'NOT_FOUND'}};
  },
  report:s=>reports.push(s)
 });
 assert.deepEqual(actions,[['orders.findByRequestId',{requestId}]]);
 assert.deepEqual(result,{status:'PASS',revision:177});
 assert.deepEqual(reports,[result]);
 assert.equal(JSON.stringify(result).includes(requestId),false);
});
test('configuration missing skips without ANY HTTP request',async()=>{
 let count=0;
 const result=await probeCanonicalReadback({
  readOnlyReady:()=>false,
  readMinhSatori:async()=>{count++;}
 });
 assert.equal(count,0);
 assert.deepEqual(result,{status:'SKIPPED_NOT_CONFIGURED'});
});
test('unexpected existing record, bad revision, malformed id and network error fail closed',async()=>{
 const base={readOnlyReady:()=>true,randomId:()=>requestId};
 for(const bad of [
  {revision:177,data:{found:true,state:'COMMITTED',order:{invoiceNo:5}}},
  {revision:177,data:{found:false,state:'DELETED'}},
  {revision:0,data:{found:false,state:'NOT_FOUND'}},
  {revision:177,data:{found:false,state:'NOT_FOUND',order:{id:1}}}
 ]){
  const r=await probeCanonicalReadback({...base,readMinhSatori:async()=>bad});
  assert.match(r.status,/^FAIL_/);
  assert.equal('revision' in r,false);
 }
 let count=0;
 const badId=await probeCanonicalReadback({...base,
  randomId:()=>'',readMinhSatori:async()=>{count++}});
 assert.equal(badId.status,'FAIL_RANDOM_ID');
 assert.equal(count,0);
 const fail=await probeCanonicalReadback({...base,
  readMinhSatori:async()=>{throw Error('sensitive connection details')}});
 assert.deepEqual(fail,{status:'FAIL_SIGNED_LOOKUP'});
 assert.doesNotMatch(JSON.stringify(fail),/sensitive|connection|details/);
});
test('fixed auth/action categories do not leak signed request data',async()=>{
 const cases=[
  ['READ_ONLY_SIGNED_INVALID_ACTION','FAIL_INVALID_ACTION'],
  ['READ_ONLY_SIGNED_FORBIDDEN','FAIL_FORBIDDEN'],
  ['READ_ONLY_SIGNED_AUTH_FAILED','FAIL_AUTH'],
  ['READ_ONLY_NON_JSON_RESPONSE','FAIL_NON_JSON'],
  ['READ_ONLY_UPSTREAM_HTTP_503','FAIL_HTTP'],
  ['READ_ONLY_UPSTREAM_ERROR','FAIL_UPSTREAM_ERROR']
 ];
 for(const [upstream,status] of cases){
  const r=await probeCanonicalReadback({readOnlyReady:()=>true,
   randomId:()=>requestId,
   readMinhSatori:async()=>{throw Error(upstream)}
  });
  assert.deepEqual(r,{status});
  assert.equal(JSON.stringify(r).includes(requestId),false);
 }
 const transport=fs.readFileSync(new URL('../../satori-readonly.mjs',import.meta.url),'utf8');
 assert.match(transport,/if\(action==='orders.findByRequestId'&&allowed\.has\(code\)\)/);
 assert.doesNotMatch(transport,/console\.log\(.*(?:secret|signature|requestId)/);
});
test('read-only action whitelist permits exact IDs but not wildcard/private search or writes',()=>{
 const transport=fs.readFileSync(new URL('../../satori-readonly.mjs',import.meta.url),'utf8');
 const server=fs.readFileSync(new URL('../standalone.mjs',import.meta.url),'utf8');
 assert.match(transport,/const permitted=new Set\(\[[^\]]*'orders.findByRequestId'\]/);
 assert.match(transport,/keys\.length!==1\|\|keys\[0\]!=='requestId'/);
 assert.match(transport,/throw Error\('EXACT_REQUEST_ID_REQUIRED'\)/);
 assert.match(transport,/action!=='orders.findByRequestId'\)/);
 assert.doesNotMatch(transport,/const permitted=new Set\(\[[^\]]*'orders.create'/);
 assert.match(server,/SATORI_V2_HMAC_EXACT_REQUESTID_PROBE/);
 assert.doesNotMatch(server,/console\.info\(.*requestId/);
 assert.match(server,/server\.listen/);
});
