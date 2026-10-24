import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionPrivateLinks} from '../production-private-links.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseMultiOrder} from '../multi-order.mjs';

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
  assert.equal(action,'orders.create');
  if(!payload.requestId)throw Object.assign(Error('INVALID_REQUEST'),{code:'INVALID_REQUEST'});
  writes++;lastRequest=payload;
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

test('agency: one authenticated link serves 17 unique approved destinations with independent prices and exactly one invoice',async()=>{
 const env={GEMINI_PRODUCTION_LINKS_ENABLED:'1',GEMINI_OWNER_ONLY_REAL_PILOT:'1',
  SATORI_BOT_SECRET:'test-only-key-not-production-32-bytes-minimum'};
 const records=Array.from({length:17},(_,i)=>({id:1000+i,invoiceNo:2000+i,name:'Khách '+(i+1),phone:'0900000000',
  location:'Đường số '+(i+1)+', TP. Hồ Chí Minh',discountPercent:[20,25,30][i%3]}));
 let writes=0,lastPayload,revision=80;
 const products=new Map([['TP-00001',{code:'TP-00001',name:'Satori nước 500ml',unit:'Thùng',listPrice:100000}]]);
 const source=async no=>{
  const c=records.find(d=>d.invoiceNo===no);
  if(!c)throw Error('UNKNOWN_SOURCE');
  return {revision,customer:{id:c.id,name:c.name,phone:c.phone,location:c.location},products};
 };
 const bot=async(action,payload)=>{
  assert.equal(action,'orders.create');
  if(!payload.requestId)throw Object.assign(Error('INVALID_REQUEST'),{code:'INVALID_REQUEST'});
  writes++;lastPayload=payload;
  return {revision:revision+1,data:{order:{invoiceNo:9001,name:payload.order.name,
   phone:payload.order.phone,location:payload.order.location,total:payload.order.total}}};
 };
 const app=createProductionPrivateLinks({env,source,bot,now:()=>Date.UTC(2026,9,23,12),origin:'https://example.test'});
 const issued=await app.issue({confirmation:'OWNER_APPROVES_REAL_CUSTOMER_LINK',agentName:'Đại lý thử',
  destinations:records.map(r=>({customerRef:{id:r.id,invoiceNo:r.invoiceNo},discountPercent:r.discountPercent})),
  shippingPercent:0,vatPercent:0,daysValid:7});
 assert.equal(issued.agencyLink,true);
 assert.equal(issued.deliveryLocations,17);
 assert.equal(issued.link.split('/real/#').length,2);
 assert.ok(!issued.link.includes('Hồ Chí Minh'));
 const token=issued.link.split('/real/#')[1];
 await assert.rejects(()=>app.catalogue({token,accessCode:'bad'}),{code:'ACCESS_CODE_REQUIRED'});
 const directory=await app.catalogue({token,accessCode:issued.accessCode});
 assert.equal(directory.requiresDestination,true);
 assert.equal(directory.destinations.length,17);
 assert.equal(directory.products.length,0);
 for(const [index,price] of [[0,80000],[1,75000],[2,70000]]){
  const ref={id:records[index].id,invoiceNo:records[index].invoiceNo};
  const view=await app.catalogue({token,accessCode:issued.accessCode,destination:ref});
  assert.equal(view.products[0].unitPrice,price);
  const quote=await app.quote({token,accessCode:issued.accessCode,destination:ref,items:[{code:'TP-00001',qty:2}],deliveryNote:'Giao sớm'});
  assert.equal(quote.total,price*2);
  assert.equal(writes,0);
  if(index===2){
   const created=await app.confirm({token,accessCode:issued.accessCode,quoteToken:quote.quoteToken,
    confirmation:'CUSTOMER_CONFIRMS_REAL_ORDER'});
   assert.equal(created.saved,true);
   assert.equal(writes,1);
   assert.equal(lastPayload.customerRef.invoiceNo,2002);
   assert.equal(lastPayload.order.total,140000);
  }
 }
 await assert.rejects(()=>app.quote({token,accessCode:issued.accessCode,
  destination:{id:999,invoiceNo:2999},items:[{code:'TP-00001',qty:1}]}),
  {code:'REAL_DESTINATION_NOT_APPROVED'});
 assert.equal(writes,1);
});
test('agency: duplicate references and missing writer rights must never issue a link',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.app.issue({confirmation:'OWNER_APPROVES_REAL_CUSTOMER_LINK',
  agentName:'Đại lý A',destinations:[{customerRef:ref,discountPercent:20},{customerRef:ref,discountPercent:25}],
  shippingPercent:0,vatPercent:0,daysValid:7}),{code:'REAL_LINK_APPROVAL_REQUIRED'});
 f.env.GEMINI_PRODUCTION_LINKS_ENABLED='0';
 await assert.rejects(()=>f.app.issue({confirmation:'OWNER_APPROVES_REAL_CUSTOMER_LINK',
  agentName:'Đại lý A',destinations:[{customerRef:ref,discountPercent:20}],
  shippingPercent:0,vatPercent:0,daysValid:7}),{code:'REAL_LINKS_NOT_ENABLED'});
});

test('owner-only production gateway permits authenticated real chat while denying untrusted edits',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const guard=server.slice(server.indexOf('// Owner real pilot is a sealed'),server.indexOf('// Private customer invitations can be issued'));
 assert.match(guard,/realPrivateLinks\.readiness\(\)\.configured===true/);
 assert.match(guard,/\(\?:catalogue\|quote\|confirm\|interpret\)/,
  'allowlist must contain interpret; previously blocked every live chat request with 403');
 assert.match(server,/if\(p==='\/api\/real\/interpret'\)/);
 assert.match(server,/const profile=await realPrivateLinks\.catalogue\(input\)/,
  'chat must verify sealed token, access code and destination BEFORE parsing');
 assert.match(server,/identityChange\(message,profile\.customer\)/,
  'chat cannot silently modify address or phone');
 assert.match(server,/match=parseColloquialBasket\(productMessage,\{\}\)/,
  'fallback supports Vietnamese shorthand as in demo');
 const html=readFileSync(new URL('../real-checkout.html',import.meta.url),'utf8');
 assert.match(html,/id="chatMessages"/);
 assert.match(html,/id="cartState"/);
 assert.match(html,/id="manualCatalog"/);
 assert.match(html,/id="message"/);
 assert.match(html,/function bubble\(role,text\)/);
 assert.match(html,/const counts=new Map\(fields\.map/,
  'full parsed request is added atomically, not partially');
 for(const [,source] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
  new vm.Script(source,{filename:'real-checkout.html.js'});
});

test('Vietnamese two-product shorthand is one locally validated real cart request',()=>{
 const match=parseMultiOrder('10 suối 500, 2 ổi');
 assert.ok(match?.items?.length===2,'must understand shorthand without network AI');
 assert.deepEqual(match.items.map(x=>x.qty),[10,2]);
 assert.equal(new Set(match.items.map(x=>x.sku)).size,2);
});

test('CTV reuses agency one-link engine: one customer invoice, private 20/35 commission and owner-only preview',async()=>{
 const env={GEMINI_PRODUCTION_LINKS_ENABLED:'1',GEMINI_OWNER_ONLY_REAL_PILOT:'1',
  SATORI_BOT_SECRET:'test-private-commission-key-12345678901234567890'};
 const destinations=[
  {id:7401,invoiceNo:741,name:'Khách giao A',phone:'0912233445',location:'Tòa nhà A, Q.1'},
  {id:7402,invoiceNo:742,name:'Khách giao B',phone:'0912233446',location:'Tòa nhà B, Q.3'}
 ];
 let writes=0,lastPayload,revision=135;
 const products=new Map([
  ['TP-00001',{code:'TP-00001',name:'Satori 500ml',unit:'Thùng',listPrice:100000}],
  ['TP-00002',{code:'TP-00002',name:'Satori 350ml',unit:'Thùng',listPrice:78400}]
 ]);
 const source=async(invoiceNo)=>{
  const d=destinations.find(x=>x.invoiceNo===invoiceNo);
  assert.ok(d,'source reference must be real and exact');
  return {revision,customer:{...d},products};
 };
 const bot=async(action,payload)=>{
  assert.equal(action,'orders.create','CTV path must NEVER invoke orders.create.pair');
  if(!payload.requestId)throw Object.assign(Error('INVALID_REQUEST'),{code:'INVALID_REQUEST'});
  writes++;lastPayload=payload;
  return {revision:revision+1,data:{order:{invoiceNo:9002,name:payload.order.name,
   location:payload.order.location,total:payload.order.total},duplicate:false}};
 };
 const app=createProductionPrivateLinks({env,source,bot,now:()=>Date.UTC(2026,9,24,4),origin:'https://example.test'});
 const base={confirmation:'OWNER_APPROVES_REAL_CUSTOMER_LINK',
  agentName:'Hà Minh Nguyệt',
  destinations:destinations.map(d=>({customerRef:{id:d.id,invoiceNo:d.invoiceNo},discountPercent:20})),
  shippingPercent:8,vatPercent:8,daysValid:7};
 const commissionPolicy={mode:'single-invoice-commission',collaboratorId:'ctv-nguyet-01',
  collaboratorName:'Hà Minh Nguyệt',customerDiscountPercent:20,collaboratorDiscountPercent:35};
 await assert.rejects(()=>app.issue({...base,commissionPolicy,
  destinations:[{customerRef:{id:7401,invoiceNo:741},discountPercent:25}]}),
 {code:'REAL_LINK_APPROVAL_REQUIRED'});
 const issued=await app.issue({...base,commissionPolicy});
 assert.equal(issued.agencyLink,true);
 assert.equal(issued.commissionSummary.oneCustomerInvoice,true);
 assert.equal(issued.commissionSummary.differencePercent,15);
 const token=issued.link.split('/real/#')[1],accessCode=issued.accessCode;
 const destination={id:7401,invoiceNo:741};
 const catalogue=await app.catalogue({token,accessCode,destination});
 assert.equal(catalogue.discountPercent,20);
 assert.equal(catalogue.products.find(p=>p.code==='TP-00001').unitPrice,80000);
 assert.ok(!JSON.stringify(catalogue).includes('commission'),
  'buyer catalogue must not disclose CTV settlement');
 const items=[{code:'TP-00001',qty:2},{code:'TP-00002',qty:3}];
 const quote=await app.quote({token,accessCode,destination,items});
 assert.equal(quote.subtotal,348160);
 assert.equal(quote.total,403866);
 assert.ok(!JSON.stringify(quote).includes('commission'),
  'buyer quote must not disclose internal financial data');
 const owner=await app.ownerCommissionPreview({token,accessCode,destination,items});
 assert.equal(owner.invoiceCount,1);
 assert.equal(owner.commissionPercent,15);
 assert.equal(owner.commissionAmount,65280,'price-by-line: 2×15000 + 3×11760');
 assert.equal(owner.customerSubtotal,quote.subtotal);
 assert.equal(owner.customerTotal,quote.total);
 assert.equal(writes,0,'quote and owner finance preview cannot write any invoice');
 const result=await app.confirm({token,accessCode,quoteToken:quote.quoteToken,
  confirmation:'CUSTOMER_CONFIRMS_REAL_ORDER'});
 assert.equal(result.saved,true);
 assert.equal(writes,1,'EXACTLY ONE invoice must be created');
 assert.equal(lastPayload.order.total,quote.total);
 assert.ok(!lastPayload.order.pairRole&&!lastPayload.order.pairCommissionAmount,
  'do not add legacy two-invoice bookkeeping');
 assert.ok(!JSON.stringify(lastPayload.order).includes('collaborator'),
  'no confidential commission in customer-facing invoice payload');
 assert.ok(!JSON.stringify(result).includes('commission'),'public receipt hides internal settlement');
 await assert.rejects(()=>app.ownerCommissionPreview({token,accessCode:'wrong',destination,items}),
 {code:'ACCESS_CODE_REQUIRED'});
 const regular=await app.issue(base);
 assert.equal(regular.commissionSummary,undefined,'ordinary agencies unchanged');
 const plainToken=regular.link.split('/real/#')[1];
 await assert.rejects(()=>app.ownerCommissionPreview({token:plainToken,
  accessCode:regular.accessCode,destination,items}),{code:'REAL_NOT_A_COLLABORATOR_LINK'});
});

test('one-area admin UI keeps CTV legacy controls invisible and offers one-invoice commission',()=>{
 const admin=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
 assert.match(admin,/id="collaboratorPairAdmin" style="display:none!important"/);
 assert.match(admin,/id="agencyCommissionEnabled"/);
 assert.match(admin,/id="agencyCtvCustomerPercent"/);
 assert.match(admin,/id="agencyCtvCollaboratorPercent"/);
 assert.match(admin,/id="agencyCommissionCalculator"/);
 assert.match(admin,/agency-commission\/preview/);
 assert.match(admin,/commissionPolicy:\{mode:'single-invoice-commission'/);
 for(const [,source] of admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
  new vm.Script(source,{filename:'owner-admin.js'});
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/ownerPairAction\('collaborators\.pair\.list',\{\}\)/);
 assert.match(server,/p==='\/api\/admin\/agency-commission\/preview'/);
 assert.match(server,/customerLinks\.adminAuthorized\(req\)/);
});
