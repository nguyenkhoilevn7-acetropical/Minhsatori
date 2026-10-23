import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionPrivateLinks} from '../production-private-links.mjs';

const ref={id:62000,invoiceNo:62};
const customer={id:62000,name:'Hà Minh Nguyệt',phone:'0919989887',
 location:'KUAI JIE ZHAO HOTPOT - 40 Võ Văn Tần, Xuân Hòa, Hồ Chí Minh 700000'};
function fixture(){
 const env={GEMINI_PRODUCTION_LINKS_ENABLED:'1',GEMINI_OWNER_ONLY_REAL_PILOT:'1',
  SATORI_BOT_SECRET:'test-key-only-at-least-32-characters-and-private'};
 let revision=113,writes=0, lastRequest=null, allow=true;
 const products=new Map([['TP-00001',{code:'TP-00001',name:'Nước Satori 500ml',
  unit:'Thùng',listPrice:100000}]]);
 const source=async invoiceNo=>{
  if(!allow)throw Error('SOURCE_UNAVAILABLE');
  assert.equal(invoiceNo,62);
  return {revision,customer:{...customer},products};
 };
 const bot=async(action,payload)=>{
  assert.equal(action,'orders.create');writes++;lastRequest=payload;
  return {revision:revision+1,data:{order:{invoiceNo:6000+revision,name:customer.name,
   location:customer.location,total:payload.order.total},duplicate:false}};
 };
 const app=createProductionPrivateLinks({env,source,bot,
  now:()=>Date.UTC(2026,9,23,12),origin:'https://example.test'});
 const issue=()=>app.issue({confirmation:'OWNER_APPROVES_REAL_CUSTOMER_LINK',
  customerRef:{...ref},name:customer.name,phone:customer.phone,location:customer.location,
  discountPercent:20,shippingPercent:0,vatPercent:0,daysValid:7});
 return {app,issue,env,updateRevision:n=>revision=n,get writes(){return writes},
  get request(){return lastRequest},blockSource:()=>{allow=false}};
}
test('owner may create a private link for one exact historical location, not a TEST link',async()=>{
 const f=fixture(),p=await f.issue();
 assert.equal(p.production,true);
 assert.match(p.link,/^https:\/\/example.test\/real\/#?[a-zA-Z0-9_.-]+$/);
 assert.ok(!p.link.includes('Nguyệt'));
 assert.ok(!p.link.includes('40 Võ'));
 assert.equal(p.accessCode.length,27);
 const token=p.link.split('/real/#')[1];
 await assert.rejects(()=>f.app.catalogue({token,accessCode:'wrong'}),{code:'ACCESS_CODE_REQUIRED'});
 const view=await f.app.catalogue({token,accessCode:p.accessCode});
 assert.equal(view.products[0].unitPrice,80000);
 const quote=await f.app.quote({token,accessCode:p.accessCode,
  items:[{code:'TP-00001',qty:2}],deliveryNote:'Giao sớm nếu có thể'});
 assert.equal(quote.total,160000);
 assert.equal(f.writes,0);
 const result=await f.app.confirm({token,accessCode:p.accessCode,
  quoteToken:quote.quoteToken,confirmation:'CUSTOMER_CONFIRMS_REAL_ORDER'});
 assert.equal(result.saved,true);
 assert.equal(f.writes,1);
 assert.equal(f.request.order.total,160000);
 assert.equal(f.request.customerRef.invoiceNo,62);
 assert.equal(f.request.requestId.length,39);
});
test('no link without explicit approval or valid phone and original address',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.app.issue({customerRef:ref}),{code:'REAL_LINK_APPROVAL_REQUIRED'});
 const bad={confirmation:'OWNER_APPROVES_REAL_CUSTOMER_LINK',customerRef:ref,
  name:customer.name,phone:customer.phone,location:'Another street',
  discountPercent:20,shippingPercent:0,vatPercent:0,daysValid:7};
 await assert.rejects(()=>f.app.issue(bad),{code:'REAL_CUSTOMER_REFERENCE_MISMATCH'});
});
test('link is disabled by default and quote cannot authorize itself',async()=>{
 const f=fixture(),p=await f.issue();
 const token=p.link.split('/real/#')[1];
 f.env.GEMINI_PRODUCTION_LINKS_ENABLED='0';
 await assert.rejects(()=>f.app.catalogue({token,accessCode:p.accessCode}),
  {code:'REAL_LINKS_NOT_ENABLED'});
 assert.equal(f.writes,0);
});
test('stale Drive revision prevents a real invoice write',async()=>{
 const f=fixture(),p=await f.issue(),token=p.link.split('/real/#')[1];
 const q=await f.app.quote({token,accessCode:p.accessCode,items:[{code:'TP-00001',qty:1}]});
 f.updateRevision(114);
 await assert.rejects(()=>f.app.confirm({token,accessCode:p.accessCode,
  quoteToken:q.quoteToken,confirmation:'CUSTOMER_CONFIRMS_REAL_ORDER'}),
 {code:'REAL_QUOTE_STALE'});
 assert.equal(f.writes,0);
});
test('tampered link is rejected and writes require explicit customer confirmation',async()=>{
 const f=fixture(),p=await f.issue(),token=p.link.split('/real/#')[1];
 const fake=token.slice(0,-2)+'XX';
 await assert.rejects(()=>f.app.catalogue({token:fake,accessCode:p.accessCode}),
 {code:'INVALID_REAL_LINK'});
 const q=await f.app.quote({token,accessCode:p.accessCode,items:[{code:'TP-00001',qty:1}]});
 await assert.rejects(()=>f.app.confirm({token,accessCode:p.accessCode,
   quoteToken:q.quoteToken,confirmation:'NOT_APPROVED'}),{code:'REAL_CONFIRMATION_REQUIRED'});
 assert.equal(f.writes,0);
});
