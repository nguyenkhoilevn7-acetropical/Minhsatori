import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateInvoiceFeePolicy,readInvoiceFeePolicy,saveInvoiceFeePolicy,calculateInvoiceFees} from '../invoice-fee-scopes.mjs';
const a='d0000000-1111-4111-8111-000000000001',b='d0000000-1111-4111-8111-000000000002',p='d0000000-1111-4111-8111-000000000003';
const defaultRule={scope:'none',addressIds:[]};
const req=(extra={})=>({
 profileId:p,confirmed:true,expectedRevision:0,
 vat:{...defaultRule,rateBps:0},shipping:{...defaultRule,amountVnd:0},...extra
});
test('all applies to existing/future clients, selected only explicit recipients',()=>{
 const vat={scope:'all',rateBps:1000,addressIds:[]};
 const shipping={scope:'selected',amountVnd:35000,addressIds:[a]};
 assert.deepEqual(calculateInvoiceFees({vat,shipping},a),{vatBps:1000,shippingVnd:35000});
 assert.deepEqual(calculateInvoiceFees({vat,shipping},b),{vatBps:1000,shippingVnd:0});
 assert.deepEqual(calculateInvoiceFees({vat:{scope:'none',rateBps:0,addressIds:[]},
  shipping:{scope:'none',amountVnd:0,addressIds:[]}},a),{vatBps:0,shippingVnd:0});
});
test('deny unapproved, orphan IDs, duplicate IDs, invalid scope and invalid amounts',()=>{
 const bad=[
  req({confirmed:false}),req({expectedRevision:-1}),
  req({vat:{scope:'selected',rateBps:1000,addressIds:[]}}),
  req({vat:{scope:'all',rateBps:1000,addressIds:[a]}}),
  req({vat:{scope:'selected',rateBps:1000,addressIds:[a,a]}}),
  req({vat:{scope:'all',rateBps:0,addressIds:[]}}),
  req({vat:{scope:'all',rateBps:10001,addressIds:[]}}),
  req({shipping:{scope:'all',amountVnd:1.5,addressIds:[]}}),
  req({shipping:{scope:'selected',amountVnd:20000,addressIds:['other']}})
 ];
 for(const input of bad)assert.throws(()=>validateInvoiceFeePolicy(input),/CHARGE_/);
});
test('saved scopes are revisioned and checked against current active profile addresses',async()=>{
 const journal=[];
 const fake={async connect(){return conn;},async query(){throw Error('unexpected pool direct query')}};
 const conn={
  async query(sql,args=[]){
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
   if(sql.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[]};
   if(sql.startsWith('SELECT id FROM satori_v2_profiles'))return {rows:[{id:p}]};
   if(sql.startsWith('SELECT id FROM satori_v2_addresses')){
    return {rows:args[1].filter(id=>id===a||id===b).map(id=>({id}))};
   }
   if(sql.startsWith('SELECT details FROM satori_v2_audit'))return {rows:journal.length?[{details:journal[journal.length-1]}]:[]};
   if(sql.startsWith('INSERT INTO satori_v2_audit')){
    journal.push(JSON.parse(args[4]));return {rows:[]};
   }
   throw Error('Unexpected SQL '+sql);
  },
  release(){}
 };
 const v=await readInvoiceFeePolicy(conn,p);
 assert.equal(v.revision,0);
 const payload=req({vat:{scope:'all',rateBps:1000,addressIds:[]},
  shipping:{scope:'selected',amountVnd:35000,addressIds:[b]}});
 const saved=await saveInvoiceFeePolicy(fake,{id:a},payload);
 assert.equal(saved.revision,1);
 assert.deepEqual(calculateInvoiceFees(await readInvoiceFeePolicy(conn,p),b),{vatBps:1000,shippingVnd:35000});
 await assert.rejects(()=>saveInvoiceFeePolicy(fake,{id:a},payload),{code:'CHARGE_POLICY_REVISION_CONFLICT'});
 await assert.rejects(()=>saveInvoiceFeePolicy(fake,{id:a},
  req({expectedRevision:1,shipping:{scope:'selected',amountVnd:50000,addressIds:[p]}})),
  {code:'CHARGE_ADDRESS_NOT_OWNED'});
 assert.equal(journal.length,1);
});
test('admin-only routes and server quote freshness use approved VAT and shipping, not browser inputs',()=>{
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const freshness=readFileSync(new URL('../quote-freshness.mjs',import.meta.url),'utf8');
 const owner=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../app.html',import.meta.url),'utf8');
 assert.match(router,/if\(pathname==='\/api\/v2\/admin\/invoice-charge-policy'&&req.method==='PUT'\)\{\s*owner\(actor\)/);
 assert.match(router,/readInvoiceFeePolicy\(pool,profile.id\)/);
 assert.match(router,/calculateInvoiceFees\(feePolicy,addressRow.rows\[0\].id\)/);
 assert.match(router,/readInvoiceFeePolicy\(client,q.profile_id\)/);
 assert.match(router,/calculateInvoiceFees\(feeConfig,q.address_id\)/);
 assert.match(freshness,/vatBps=0,shippingVnd=0/);
 assert.match(freshness,/catalogueRevision,vatBps,shippingVnd/);
 assert.match(owner,/function ownerInvoiceChargeEditor\(/);
 assert.match(owner,/\['none','Không áp dụng'\],\['all','Tất cả khách trong hồ sơ'\],\['selected','Chỉ khách được chỉ định'\]/);
 assert.match(owner,/expectedRevision:current.revision/);
 assert.match(owner,/ownerInvoiceChargeEditor\(profile.id,a.addresses,refresh\)/);
 assert.match(owner,/ownerInvoiceChargeEditor\(profileId,a.addresses,/);
 assert.doesNotThrow(()=>new vm.Script(owner.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||''));
 assert.doesNotThrow(()=>new vm.Script(app.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||''));
});
