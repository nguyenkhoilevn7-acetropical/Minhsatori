import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {legacyMonthlyCustomerPreview} from '../customer-backend.mjs';

const source=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const script=source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const backend=readFileSync(new URL('../customer-backend.mjs',import.meta.url),'utf8');
const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');

test('old customer section is a single card-based surface matching approved two-tier CTV preview',()=>{
 assert.ok(source.includes('id="legacyConsole"'));
 assert.ok(source.includes('id="crmImportDelivery"'));
 assert.match(script,/make\('div',null,'crm-card-footer'\)/);
 assert.match(script,/function rolePricingEditor\(account,body,item,\{old=false\}=\{\}\)/);
 assert.match(script,/crmRoleChoices\(role\)/);
 assert.match(script,/Chiết khấu CTV \(%\)/);
 assert.match(script,/Chiết khấu mặc định cho khách của CTV/);
 assert.match(script,/renderOwnerCtvClientCards\(account,clients\)/);
 assert.match(script,/ownerCtvNewClient\(profile\.id,cap,main\?\.discountBps\?\?0/);
 assert.match(script,/ownerAddressEditor\(profile\.id,row,customerEpoch,refresh\)/);
 assert.match(script,/changeAccountLifecycle\(account,'SUSPENDED'\)/);
 assert.match(script,/changeAccountLifecycle\(account,'REMOVED'\)/);
 assert.doesNotThrow(()=>new vm.Script(script));
});

test('monthly signed ledger stays owner-only, while duplicate on-screen imports are gone',()=>{
 assert.ok(router.includes("pathname==='/api/v2/admin/legacy/month-customers'"));
 assert.ok(backend.includes("readMinhSatori('orders.list',{from,to,limit:100})"));
 for(const id of ['crmLedgerDiscovery','legacyLedgerDisclosure','legacySearchForm','crmLedgerPreview'])
  assert.doesNotMatch(source,new RegExp('id="'+id+'"'));
 assert.match(source,/id="crmImportDelivery"/);
 assert.match(script,/function renderHistoricAddressImporter\(/);
 assert.doesNotMatch(script,/function legacyBindingPanel\(/);
 assert.doesNotMatch(script,/function renderLegacyRecipientDirectory\(/);
 assert.doesNotMatch(script,/function submitLegacyImport\(/);
});

test('month preview groups only matching phone, does not merge same-name different-address customers',async()=>{
 const oldFetch=globalThis.fetch,keys=['SATORI_READ_ENDPOINT','SATORI_READ_KEY_ID','SATORI_READ_HMAC_SECRET'];
 const old=keys.map(k=>process.env[k]);
 process.env.SATORI_READ_ENDPOINT='https://script.google.com/macros/s/TEST-FAKE/exec';
 process.env.SATORI_READ_KEY_ID='fake_test';
 process.env.SATORI_READ_HMAC_SECRET='x'.repeat(32);
 const payload={action:'orders.list',ok:true,revision:172,data:{orders:[
  {invoiceNo:5953,name:'Hà Minh Nguyệt',phone:'0983000970',location:'LK 22-10',date:'2026-10-27'},
  {invoiceNo:5954,name:'Hà Minh Nguyệt',phone:'0983000970',location:'Quận 7',date:'2026-10-28'},
  {invoiceNo:5903,name:'Lan Anh',phone:'',location:'Địa chỉ A',date:'2026-10-12'},
  {invoiceNo:5904,name:'Lan Anh',phone:'',location:'Địa chỉ B',date:'2026-10-12'}
 ]}};
 try{
  globalThis.fetch=async(_url,opts)=>{
   const body=JSON.parse(opts.body);
   assert.equal(body.action,'orders.list');
   assert.deepEqual(body.payload,{from:'2026-10-01',to:'2026-10-31',limit:100});
   return {ok:true,text:async()=>JSON.stringify(payload)};
  };
  const result=await legacyMonthlyCustomerPreview('2026-10');
  assert.equal(result.customers.length,3);
  const ctv=result.customers.find(x=>x.name==='Hà Minh Nguyệt');
  assert.equal(ctv.invoiceCount,2);
  assert.deepEqual(ctv.addresses,['LK 22-10','Quận 7']);
  assert.equal('requestedType' in ctv,false);
  assert.equal('discountBps' in ctv,false);
  await assert.rejects(()=>legacyMonthlyCustomerPreview('2026-13'),/LEGACY_MONTH_INVALID/);
 }finally{
  globalThis.fetch=oldFetch;
  keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i]});
 }
});
