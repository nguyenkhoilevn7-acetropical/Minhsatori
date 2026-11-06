import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateInvoiceFeePolicy,calculateInvoiceFees} from '../invoice-fee-scopes.mjs';

const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const js=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const saved=js.split('async function renderOwnerSavedDeliveryCards(account,wrap,{editable=true}={}){')[1]
 ?.split('async function renderOwnerCtvClientCards(account,wrap){')[0]||'';
const fee=js.split('function ownerInvoiceChargeEditor(profileId,addresses,refresh){')[1]
 ?.split('async function renderOwnerSavedDeliveryCards(account,wrap,{editable=true}={}){')[0]||'';
const p1='e0000000-0000-4000-8000-000000000001';
const p2='e0000000-0000-4000-8000-000000000002';
const a1='a0000000-0000-4000-8000-000000000001';
const a2='a0000000-0000-4000-8000-000000000002';

function setup() {
 const calls=[];
 const profiles=[
  {id:p1,name:'Traky',type:'retail'},
  {id:p2,name:'Khách khác',type:'agency'}
 ];
 const addresses={
  [p1]:[{id:a1,active:true,label:'Traky Sài Gòn',
    recipientName:'Traky',recipientPhone:'0000000000',address:'Fake address 1'}],
  [p2]:[{id:a2,active:true,label:'Chi nhánh B',
    recipientName:'B',recipientPhone:'0000000000',address:'Fake address 2'}]
 };
 function node(tag,value,cls=''){
  return {tag,value,cls,children:[],isConnected:true,open:false,
   classList:{add(){}},
   append(...children){this.children.push(...children)},
   prepend(...children){this.children.unshift(...children)},
   replaceChildren(...children){this.children=children}};
 }
 const ctx={
  api:async path=>{
   if(path.startsWith('/api/v2/admin/profiles?accountId='))return {profiles};
   if(path.startsWith('/api/v2/admin/addresses?profileId=')){
    const id=decodeURIComponent(path.split('profileId=')[1]);
    return {addresses:addresses[id]||[]};
   }
   throw Error('Unexpected request: '+path);
  },
  make:node,
  crmUniqueSavedAddressGroups:rows=>rows.map(row=>[row]),
  ownerInvoiceChargeEditor:(id,rows,refresh)=>{
   calls.push({id,rows:rows.map(row=>row.id),refresh});
   return node('details',null,'crm-charge-policy');
  },
  typeLabel:type=>type,
  ownerAddressEditor:()=>node('details','Edit address'),
  customerEpoch:1
 };
 const fn=vm.runInNewContext('async function renderOwnerSavedDeliveryCards(account,wrap,{editable=true}={}){'+
  saved+'; renderOwnerSavedDeliveryCards',ctx);
 return {fn,calls,node};
}

test('retail and historical saved delivery points receive an Owner VAT/Shipping editor',async()=>{
 assert.ok(saved,'saved-delivery renderer must exist');
 const {fn,calls,node}=setup();
 const wrap=node('section');
 await fn({id:'registered-account',accessStatus:'ACTIVE',requestedType:'retail'},wrap);
 assert.deepEqual(calls.map(x=>x.id),[p1,p2]);
 assert.deepEqual(calls[0].rows,[a1]);
 assert.deepEqual(calls[1].rows,[a2]);
 assert.equal(typeof calls[0].refresh,'function');
 assert.match(html,/crm-saved-address-charge/);
 assert.match(fee,/recipient\.label\?recipient\.label\+' · '/);
 assert.match(js,/feeEditor\.open=profiles\.profiles\.length===1/);
 assert.doesNotThrow(()=>new vm.Script(js));
});

test('read-only, pending, suspended accounts never receive fee-write controls',async()=>{
 const {fn,calls,node}=setup();
 await fn({id:'pending',accessStatus:'PENDING'},node('section'),{editable:false});
 await fn({id:'paused',accessStatus:'SUSPENDED'},node('section'));
 assert.equal(calls.length,0);
 assert.match(saved,/if\(editable&&account\.accessStatus==='ACTIVE'\)/);
});

test('recipient-specific VAT/shipping preserves server scope and old billing boundaries',()=>{
 const selected={
  profileId:p1,confirmed:true,expectedRevision:0,
  vat:{scope:'selected',rateBps:800,addressIds:[a1]},
  shipping:{scope:'none',amountVnd:0,addressIds:[]}
 };
 assert.deepEqual(validateInvoiceFeePolicy(selected).vat,selected.vat);
 assert.deepEqual(calculateInvoiceFees(selected,a1),{vatBps:800,shippingVnd:0});
 assert.deepEqual(calculateInvoiceFees(selected,a2),{vatBps:0,shippingVnd:0});
 const route=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 assert.match(route,/pathname==='\/api\/v2\/admin\/invoice-charge-policy'&&req\.method==='PUT'/);
 assert.match(route,/owner\(actor\)/);
 assert.match(js,/hóa đơn cũ không đổi/);
});

test('agency/CTV rendering retains single-profile editor; mismatched historical role recovers',()=>{
 const specialized=js.split('async function renderOwnerCtvClientCards(account,wrap){')[1]
  ?.split('function ')[0]||'';
 assert.match(specialized,/ownerInvoiceChargeEditor\(profile\.id,a\.addresses,refresh\)/);
 assert.match(specialized,/await renderOwnerSavedDeliveryCards\(account,wrap\)/);
 assert.match(specialized,/Lưu vai trò CTV \/ Đại lý trước khi cấp chiết khấu riêng/);
});
