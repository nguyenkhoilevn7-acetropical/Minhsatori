import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../staging/guard.mjs').catch(()=>({}));
test('staging refuses live transport credentials and non-local databases',()=>{
 assert.equal(typeof mod.assertSyntheticEnvironment,'function');
 const valid={SATORI_SYNTHETIC_STAGING:'1',SATORI_V2_CI_DATABASE_URL:'postgresql://fake@127.0.0.1:5432/satori_v2_ci'};
 assert.doesNotThrow(()=>mod.assertSyntheticEnvironment(valid));
 for(const key of ['SATORI_READ_ENDPOINT','SATORI_READ_HMAC_SECRET','SATORI_V2_CANONICAL_WRITE_ENDPOINT','SATORI_V2_CANONICAL_WRITE_SECRET','SATORI_GROK_MCP_TOKEN'])
  assert.throws(()=>mod.assertSyntheticEnvironment({...valid,[key]:'unexpected'}),/SYNTHETIC_ONLY/);
 assert.throws(()=>mod.assertSyntheticEnvironment({...valid,SATORI_V2_CI_DATABASE_URL:'postgresql://fake@remote/satori_v2_ci'}),/LOCAL_DATABASE_ONLY/);
 assert.throws(()=>mod.assertSyntheticEnvironment({...valid,SATORI_SYNTHETIC_STAGING:'0'}),/SYNTHETIC_ONLY/);
});
test('concurrent signed fixture reads restore fetch and environment exactly',async()=>{
 const {production}=await import('../staging/synthetic-ledger.mjs');
 const p=production(),original=globalThis.fetch;
 const keys=['SATORI_READ_ENDPOINT','SATORI_READ_KEY_ID','SATORI_READ_HMAC_SECRET'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  const replies=await Promise.all([p.reader('orders.list',{query:'501'}),p.reader('orders.list',{query:'503'})]);
  assert.equal(replies.length,2);
  assert.equal(globalThis.fetch,original);
  for(const k of keys)assert.equal(process.env[k],before[k]);
 }finally{globalThis.fetch=original;for(const k of keys)if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k]}
});
