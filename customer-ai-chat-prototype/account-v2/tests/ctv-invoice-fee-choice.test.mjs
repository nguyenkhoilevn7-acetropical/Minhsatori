import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateCtvInvoiceFeeChoice,saveCtvInvoiceFeeChoice,calculateInvoiceFees,
 readInvoiceFeePolicy,readEffectiveInvoiceFeePolicy,requireCtvChargeForAddress} from '../invoice-fee-scopes.mjs';

const profile='d0000000-1111-4111-8111-000000000011';
const address='d0000000-1111-4111-8111-000000000012';
const foreign='d0000000-1111-4111-8111-000000000013';
const account='d0000000-1111-4111-8111-000000000014';
const actor={id:account,google_sub:'ctv-test-identity'};
const vat=(extra={})=>({profileId:profile,confirmed:true,expectedRevision:0,
 choice:'vat',scope:'all',addressIds:[],vatBps:800,...extra});
const shipping=(extra={})=>({profileId:profile,confirmed:true,expectedRevision:0,
 choice:'shipping',scope:'all',addressIds:[],shippingBps:800,...extra});

test('CTV has exactly one choice: entered VAT 8% OR Shipping 8%, not both',()=>{
 const one=validateCtvInvoiceFeeChoice(vat());
 assert.deepEqual(calculateInvoiceFees(one,address),{vatBps:800,shippingVnd:0});
 const two=validateCtvInvoiceFeeChoice(shipping());
 assert.deepEqual(calculateInvoiceFees(two,address),{vatBps:0,shippingVnd:0,shippingBps:800});
 const bad=[vat({vatBps:799}),vat({vatBps:801}),vat({vatBps:null}),
  vat({shippingAmountVnd:1}),vat({shippingBps:800}),
  vat({shipping:{scope:'all',amountVnd:500,addressIds:[]}}),
  shipping({vatBps:800}),shipping({shippingBps:0}),shipping({shippingBps:799}),
  shipping({shippingBps:801}),shipping({shippingBps:null}),
  shipping({shippingAmountVnd:1000}),
  vat({choice:'none'}),vat({choice:'both'}),vat({confirmed:false}),
  vat({scope:'selected',addressIds:[]}),vat({scope:'all',addressIds:[address]}),
  vat({scope:'selected',addressIds:[address,address]})];
 for(const invalid of bad)assert.throws(()=>validateCtvInvoiceFeeChoice(invalid),
  /CTV_|CHARGE_/);
 const selected=validateCtvInvoiceFeeChoice(vat({scope:'selected',addressIds:[address]}));
 assert.deepEqual(calculateInvoiceFees(selected,address),{vatBps:800,shippingVnd:0});
 assert.deepEqual(calculateInvoiceFees(selected,foreign),{vatBps:0,shippingVnd:0});
});

test('CTV write is account/profile scoped, verified addresses, revisioned and audited',async()=>{
 const journal=[];
 const ownerPolicy={revision:1,vat:{scope:'all',rateBps:800,addressIds:[]},
  shipping:{scope:'none',amountVnd:0,addressIds:[]}};
 let allowProfile=true;
 const client={
  async query(sql,args=[]){
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
   if(sql.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[]};
   if(sql.includes('WHERE id=$1 AND account_id=$2 AND type=$3 FOR UPDATE')){
    assert.deepEqual(args,[profile,actor.id,'collaborator']);
    return {rows:allowProfile?[{id:profile}]:[]};
   }
   if(sql.startsWith('SELECT details FROM satori_v2_audit')){
    if(args[0]==='V2_INVOICE_CHARGE_POLICY_UPDATED')
     return {rows:[{details:ownerPolicy}]};
    assert.equal(args[0],'V2_CTV_INVOICE_CHARGE_OVERRIDES_UPDATED');
    return {rows:journal.length?[{details:journal.at(-1).details}]:[]};
   }
   if(sql.startsWith('SELECT id FROM satori_v2_addresses')){
    return {rows:args[1].filter(id=>id===address).map(id=>({id}))};
   }
   if(sql.startsWith('INSERT INTO satori_v2_audit')){
    journal.push({accountId:args[0],actor:args[1],details:JSON.parse(args[4])});
    return {rows:[]};
   }
   throw Error('unexpected query '+sql);
  },release(){}
 };
 const pool={async connect(){return client}};
 // Owner sets VAT 8% for every client. CTV overrides only this address.
 const first=await saveCtvInvoiceFeeChoice(pool,actor,
  shipping({scope:'selected',addressIds:[address]}));
 assert.equal(first.revision,1);
 assert.deepEqual(calculateInvoiceFees(await readInvoiceFeePolicy(client,profile),address),
  {vatBps:800,shippingVnd:0}); // Owner's default remains untouched.
 const effective=await readEffectiveInvoiceFeePolicy(client,'collaborator',profile);
 assert.deepEqual(calculateInvoiceFees(effective,address),
  {vatBps:0,shippingVnd:0,shippingBps:800});
 assert.deepEqual(calculateInvoiceFees(effective,foreign),
  {vatBps:800,shippingVnd:0}); // Other addresses inherit admin.
 assert.doesNotThrow(()=>requireCtvChargeForAddress('collaborator',effective,address));
 assert.doesNotThrow(()=>requireCtvChargeForAddress('collaborator',effective,foreign));
 await assert.rejects(()=>saveCtvInvoiceFeeChoice(pool,actor,shipping()),
  {message:'CHARGE_POLICY_REVISION_CONFLICT'});
 await assert.rejects(()=>saveCtvInvoiceFeeChoice(pool,actor,
  shipping({expectedRevision:1,scope:'selected',addressIds:[foreign]})),
  {message:'CHARGE_ADDRESS_NOT_OWNED'});
 const second=await saveCtvInvoiceFeeChoice(pool,actor,
  vat({expectedRevision:1,scope:'all'}));
 assert.equal(second.revision,2);
 const after=await readEffectiveInvoiceFeePolicy(client,'collaborator',profile);
 assert.deepEqual(calculateInvoiceFees(after,address),{vatBps:800,shippingVnd:0});
 assert.deepEqual(after.ctvOverrides.addresses,{});
 assert.equal(after.ctvOverrides.defaultChoice,'vat');
 assert.deepEqual(calculateInvoiceFees(await readInvoiceFeePolicy(client,profile),address),
  {vatBps:800,shippingVnd:0}); // Recheck admin ownership unchanged.
 assert.equal(journal.length,2);
 assert.ok(journal.every(x=>x.actor==='ctv'&&x.accountId===actor.id));
 allowProfile=false;
 await assert.rejects(()=>saveCtvInvoiceFeeChoice(pool,actor,
  vat({expectedRevision:2})),{message:'CTV_CHARGE_PROFILE_FORBIDDEN'});
 assert.equal(journal.length,2);
});


test('CTV cannot persist more than 250 address overrides into audit',async()=>{
 const id=n=>'d0000000-1111-4111-8111-'+String(1000+n).padStart(12,'0');
 const existing=Object.fromEntries(Array.from({length:250},(_,i)=>[id(i),'vat']));
 let committed=false,inserted=false,rolledBack=false;
 const client={
  async query(sql,args=[]){
   if(sql==='BEGIN')return {rows:[]};
   if(sql==='COMMIT'){committed=true;return {rows:[]}}
   if(sql==='ROLLBACK'){rolledBack=true;return {rows:[]}}
   if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
   if(sql.includes('WHERE id=$1 AND account_id=$2 AND type=$3 FOR UPDATE'))
    return {rows:[{id:profile}]};
   if(sql.startsWith('SELECT details FROM satori_v2_audit'))
    return {rows:[{details:{revision:1,defaultChoice:null,addresses:existing}}]};
   if(sql.startsWith('SELECT id FROM satori_v2_addresses'))
    return {rows:args[1].map(id=>({id}))};
   if(sql.startsWith('INSERT INTO satori_v2_audit')){
    inserted=true;return {rows:[]};
   }
   throw Error('unexpected query '+sql);
  },release(){}
 };
 await assert.rejects(
  ()=>saveCtvInvoiceFeeChoice({async connect(){return client}},actor,
   shipping({expectedRevision:1,scope:'selected',addressIds:[id(250)]})),
  {message:'CTV_CHARGE_ADDRESSES_LIMIT'});
 assert.equal(inserted,false);
 assert.equal(committed,false);
 assert.equal(rolledBack,true);
});

test('CTV routes use verified session, not owner admin API or caller-provided account ID',()=>{
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const app=readFileSync(new URL('../app.html',import.meta.url),'utf8');
 assert.match(router,/pathname==='\/api\/v2\/ctv\/invoice-charge-policy'&&req.method==='GET'/);
 assert.match(router,/const profile=await profileFor\(pool,actor,id\)/);
 assert.match(router,/profile.type==='collaborator'/);
 assert.match(router,/pathname==='\/api\/v2\/ctv\/invoice-charge-policy'&&req.method==='PUT'/);
 assert.match(router,/saveCtvInvoiceFeeChoice\(pool,actor,await json\(req\)\)/);
 assert.match(router,/readEffectiveInvoiceFeePolicy\(pool,profile.type,id\)/);
 assert.match(router,/readEffectiveInvoiceFeePolicy\(client,checkedProfile.rows\[0\].type,q.profile_id\)/);
 assert.match(app,/id="ctvChargePanel"/);
 assert.match(app,/name="ctvChargeChoice" value="vat"/);
 assert.match(app,/name="ctvChargeChoice" value="shipping"/);
 assert.match(app,/id="ctvVatPercent"/);
 assert.match(app,/id="ctvShippingPercent"/);
 assert.match(app,/typed===''\|\|Number\(typed\)!==8/);
 assert.match(app,/\/api\/v2\/ctv\/invoice-charge-policy/);
 assert.match(app,/expectedRevision:policy.ctvOverrides\?\.revision\?\?0/);
 assert.doesNotThrow(()=>new vm.Script(app.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||''));
});

test('CTV MUST configure exactly one applicable charge before quote and checkout',()=>{
 const off={vat:{scope:'none',rateBps:0,addressIds:[]},
  shipping:{scope:'none',amountVnd:0,addressIds:[]}};
 assert.throws(()=>requireCtvChargeForAddress('collaborator',off,address),
  {message:'CTV_VAT_OR_SHIPPING_REQUIRED'});
 assert.doesNotThrow(()=>requireCtvChargeForAddress('retail',off,address));
 assert.doesNotThrow(()=>requireCtvChargeForAddress('agency',off,address));
 const validVat=validateCtvInvoiceFeeChoice(vat());
 assert.doesNotThrow(()=>requireCtvChargeForAddress('collaborator',validVat,address));
 const validShipping=validateCtvInvoiceFeeChoice(shipping());
 assert.doesNotThrow(()=>requireCtvChargeForAddress('collaborator',validShipping,address));
 const selected=validateCtvInvoiceFeeChoice(vat({scope:'selected',addressIds:[address]}));
 assert.throws(()=>requireCtvChargeForAddress('collaborator',selected,foreign),
  {message:'CTV_VAT_OR_SHIPPING_REQUIRED'});
 const invalidVat={vat:{scope:'all',rateBps:700,addressIds:[]},shipping:off.shipping};
 assert.throws(()=>requireCtvChargeForAddress('collaborator',invalidVat,address),
  {message:'CTV_VAT_OR_SHIPPING_REQUIRED'});
 const inherited={vat:{scope:'all',rateBps:800,addressIds:[]},
  shipping:{scope:'none',amountVnd:0,addressIds:[]},
  ctvOverrides:{revision:1,defaultChoice:null,addresses:{[address]:'shipping'}}};
 assert.deepEqual(calculateInvoiceFees(inherited,address),
  {vatBps:0,shippingVnd:0,shippingBps:800});
 assert.deepEqual(calculateInvoiceFees(inherited,foreign),
  {vatBps:800,shippingVnd:0});
 const both={vat:validVat.vat,shipping:validShipping.shipping};
 assert.throws(()=>requireCtvChargeForAddress('collaborator',both,address),
  {message:'CTV_VAT_OR_SHIPPING_REQUIRED'});
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 assert.match(router,/requireCtvChargeForAddress\(profile.type,feePolicy,addressRow.rows\[0\].id\)/);
 assert.match(router,/requireCtvChargeForAddress\(profile.rows\[0\].type,feeConfig,q.address_id\)/);
});
