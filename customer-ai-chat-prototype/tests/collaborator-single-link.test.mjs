import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCollaboratorSingleLink,customerInvoiceForShare} from '../collaborator-single-link.mjs';

const env={GEMINI_COLLABORATOR_SINGLE_LINKS_ENABLED:'1',
 SATORI_CTV_PAIR_ORDER_ENABLED:'1',GEMINI_CTV_LINK_SECRET:'private-ctv-invitation-key-longer-than-32',
 SATORI_CTV_PAIR_WRITE_KEY_ID:'ctv-pair-writer',
 SATORI_CTV_PAIR_WRITE_SECRET:'private-pair-signer-key-longer-than-32'};
const canonical=[
 {id:1001,invoiceNo:6201,name:'Khách A',phone:'0900000001',location:'Địa chỉ A, TP.HCM'},
 {id:1002,invoiceNo:6202,name:'Khách B',phone:'0900000002',location:'Địa chỉ B, TP.HCM'}
];
const catalog=new Map([['TP-00001',{code:'TP-00001',name:'Satori 500ml',
 unit:'Thùng',listPrice:100000}]]);
const stamp=Date.UTC(2026,9,23,7);
function setup(){
 let active=true,revision=113,writes=0,otherCTV=false,lastPayload=null;
 const policy={collaboratorId:'ctv_1001',enabled:true,reviewedByOwner:true,
  linkEpoch:'uuid-20261023',policyVersion:'policy-v1',
  customerDiscountPercent:20,collaboratorDiscountPercent:35,
  shippingPercent:0,vatPercent:0,authorizedDestinations:canonical};
 const list=async()=>({revision,
  collaborators:[{id:'ctv_1001',name:'CTV Tổng',active},{id:'ctv_2001',name:'CTV Khác',active:true}],
  policies:[policy]});
 const source=async invoiceNo=>{
  const customer=canonical.find(x=>x.invoiceNo===invoiceNo);
  if(!customer)throw Error('NO_SOURCE');
  return {revision,customer,products:catalog};
 };
 const pair=async payload=>{
  writes++;lastPayload=payload;
  const place=canonical.find(x=>x.invoiceNo===payload.customerRef.invoiceNo);
  const group='pair_aabbccddeeff001122334455';
  const amount=payload.order.items.reduce((n,i)=>n+catalog.get(i.code).listPrice*i.qty,0);
  const high=Math.round(amount*.8),low=Math.round(amount*.65);
  return {customerInvoice:{invoiceNo:7001,pairRole:'customer',collaboratorId:'ctv_1001',
    pairGroupId:group,name:place.name,phone:place.phone,location:place.location,
    date:'23/10/2026',total:high,items:[{code:'TP-00001',product:'Satori 500ml',
      unit:'Thùng',qty:2,unitPrice:80000,subtotal:160000}],
    pairDiscountPercent:20,pairInvoiceNo:7002,pairCommissionAmount:high-low},
   collaboratorInvoice:{invoiceNo:7002,pairRole:'collaborator',collaboratorId:'ctv_1001',
    pairGroupId:group,name:'CTV Tổng',location:place.location,total:low,pairDiscountPercent:35}};
 };
 const invoiceLookup=async()=>[];
 const portal=createCollaboratorSingleLink({env,policyList:list,invoiceSource:source,
  createPair:pair,invoiceLookup,now:()=>stamp,origin:'https://example.test'});
 return {portal,policy,env,get writes(){return writes},get payload(){return lastPayload},
  changeRevision:n=>revision=n,deactivate:()=>{active=false},other:()=>{otherCTV=true}};
}

test('one stable private link for the CTV, not one link per delivery address',async()=>{
 const x=setup(),a=await x.portal.issue({collaboratorId:'ctv_1001'}),
  b=await x.portal.issue({collaboratorId:'ctv_1001'});
 assert.equal(a.url,b.url);
 assert.equal(a.accessCode,b.accessCode);
 assert.equal(a.deliveryLocations,2);
 assert.ok(!a.url.includes('Địa chỉ'));
 assert.ok(!a.url.includes('100000'));
 assert.equal(a.customerDiscountPercent,20);
 assert.equal(a.collaboratorDiscountPercent,35);
 const token=a.url.split('/#')[1];
 const data=await x.portal.catalogue({token,accessCode:a.accessCode});
 assert.equal(data.destinations.length,2);
 await assert.rejects(()=>x.portal.catalogue({token,accessCode:'00'.repeat(16)}),
  {code:'CTV_ACCESS_DENIED'});
});
test('two independent paired invoices, same CTV, correct 20/35 commission without VAT',async()=>{
 const x=setup(),a=await x.portal.issue({collaboratorId:'ctv_1001'}),
 token=a.url.split('/#')[1],accessCode=a.accessCode;
 const q=await x.portal.quote({token,accessCode,
  destination:{id:1002,invoiceNo:6202},
  items:[{code:'TP-00001',qty:2}],deliveryNote:'Giao trước 2 giờ'});
 assert.equal(q.customerGoods,160000);
 assert.equal(q.partnerGoods,130000);
 assert.equal(q.commission,30000);
 assert.equal(x.writes,0);
 await assert.rejects(()=>x.portal.confirm({token,accessCode,quoteToken:q.quoteToken,
  confirmation:'WRONG'}),{code:'CTV_CONFIRMATION_REQUIRED'});
 const done=await x.portal.confirm({token,accessCode,quoteToken:q.quoteToken,
  confirmation:'CTV_CONFIRMS_BOTH_REAL_INVOICES'});
 assert.equal(x.writes,1);
 assert.equal(x.payload.collaboratorId,'ctv_1001');
 assert.deepEqual(x.payload.customerRef,{id:1002,invoiceNo:6202});
 assert.equal(done.customerInvoice.total,160000);
 assert.equal(done.collaboratorInvoice.total,130000);
 assert.equal(done.commission,30000);
 assert.equal(done.customerInvoice.pairDiscountPercent,undefined);
 assert.equal(done.customerInvoice.pairInvoiceNo,undefined);
 assert.equal(done.customerInvoice.pairCommissionAmount,undefined);
 assert.equal(done.collaboratorInvoice.role,'collaborator');
});
test('owner-approved destination only; CTV cannot supply a new customer/address',async()=>{
 const x=setup(),a=await x.portal.issue({collaboratorId:'ctv_1001'}),token=a.url.split('/#')[1];
 await assert.rejects(()=>x.portal.quote({token,accessCode:a.accessCode,
  destination:{id:5000,invoiceNo:9999},items:[{code:'TP-00001',qty:2}]}),
  {code:'CTV_LOCATION_NOT_APPROVED'});
 assert.equal(x.writes,0);
});
test('revoking CTV access denies already-issued token',async()=>{
 const x=setup(),a=await x.portal.issue({collaboratorId:'ctv_1001'}),token=a.url.split('/#')[1];
 x.deactivate();
 await assert.rejects(()=>x.portal.catalogue({token,accessCode:a.accessCode}),
  {code:'CTV_NOT_ACTIVE'});
});
test('price or source revision changes prohibit a real write',async()=>{
 const x=setup(),a=await x.portal.issue({collaboratorId:'ctv_1001'}),token=a.url.split('/#')[1];
 const q=await x.portal.quote({token,accessCode:a.accessCode,
  destination:{id:1001,invoiceNo:6201},items:[{code:'TP-00001',qty:1}]});
 x.changeRevision(114);
 await assert.rejects(()=>x.portal.confirm({token,accessCode:a.accessCode,quoteToken:q.quoteToken,
  confirmation:'CTV_CONFIRMS_BOTH_REAL_INVOICES'}),{code:'CTV_QUOTE_STALE'});
 assert.equal(x.writes,0);
});
test('customer share projection redacts collaborator settlement fields',()=>{
 const raw={invoiceNo:7001,pairRole:'customer',total:80000,name:'Người mua',phone:'0900000001',
 location:'Địa chỉ mua',pairInvoiceNo:7002,pairCommissionAmount:15000,
 collaboratorId:'ctv_sensitive',pairCollaboratorName:'CTV',pairDiscountPercent:20,
 items:[{product:'Nước',code:'TP-00001',unit:'Thùng',qty:1,unitPrice:80000,subtotal:80000,
  privateCtvCost:65000}]};
 const publicView=customerInvoiceForShare(raw);
 const serialized=JSON.stringify(publicView);
 for(const secret of ['ctv_sensitive','CTV','15000','65000','7002','privateCtvCost'])
  assert.ok(!serialized.includes(secret),'private field leaked: '+secret);
 assert.equal(publicView.total,80000);
 assert.throws(()=>customerInvoiceForShare({...raw,pairRole:'collaborator'}),
  {code:'CUSTOMER_INVOICE_REQUIRED'});
});
test('disabled writer configuration prevents all CTV invites',()=>{
 const x=setup(),env2={...env,GEMINI_COLLABORATOR_SINGLE_LINKS_ENABLED:'0'};
 const p=createCollaboratorSingleLink({env:env2,
  policyList:async()=>({revision:1,collaborators:[],policies:[]}),
  invoiceSource:async()=>({}),createPair:async()=>({}),invoiceLookup:async()=>[]});
 assert.equal(p.readiness().enabled,false);
});

test('CTV link requires explicit destination selection and allows searching all approved places',()=>{
 const html=readFileSync(new URL('../ctv-order.html',import.meta.url),'utf8');
 assert.match(html,/id="deliverySearch" type="search"/);
 assert.match(html,/destinations=result\.destinations/);
 assert.match(html,/picker\.replaceChildren\(new Option\('— Chọn điểm giao trước khi đặt —',''\)\)/);
 assert.match(html,/picker\.value=\[\.\.\.picker\.options\]/);
 assert.match(html,/if\(!\$\('delivery'\)\.value\)throw Error\('Vui lòng chọn đúng điểm giao/);
 assert.match(html,/fold\(\[d\.name,d\.location,d\.phone\]\.join\(' '\)\)/);
});
