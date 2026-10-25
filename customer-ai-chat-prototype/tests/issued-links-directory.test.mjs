import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createIssuedLinksRegistry} from '../issued-links-registry.mjs';
import {createOwnerRealInvoice} from '../owner-live-invoice.mjs';
import {createProductionPrivateLinks} from '../production-private-links.mjs';

const base='https://minh-satori-customer-ai-gemini.onrender.com';
const r=(no)=>({customerRef:{id:String(no),invoiceNo:no},
 name:'Người nhận '+no,phone:'0900000000',location:no+' Đường Satori, TP HCM',discountPercent:20});
function driveFixture(){
 const drive={revision:161,rows:[],writes:0,backupCreated:0};
 const bot=async(action,p)=>{
  if(action==='system.status')return {revision:drive.revision,data:{orders:121}};
  if(action==='links.list'){
   const matches=p.id?drive.rows.filter(x=>x.id===p.id):drive.rows;
   return {revision:drive.revision,data:{total:matches.length,
    items:matches.slice(p.offset||0,(p.offset||0)+(p.limit||8)),
    hasMore:(p.offset||0)+(p.limit||8)<matches.length}};
  }
  if(action==='links.register'){
   if(p.expectedRevision!==drive.revision)throw Object.assign(new Error('REVISION_CONFLICT'),{code:'REVISION_CONFLICT'});
   const old=drive.rows.find(x=>x.id===p.record.id);
   if(old)return {revision:drive.revision,data:{id:old.id,saved:true,duplicate:true},
    backupCreated:false};
   drive.rows.unshift(p.record);drive.revision++;drive.writes++;
   drive.backupCreated++;
   return {revision:drive.revision,data:{id:p.record.id,saved:true,duplicate:false},
    backupCreated:true};
  }
  throw Error('Unexpected Bot action');
 };
 return {drive,bot};
}
test('agency with multiple recipients survives new client and never stores PIN',async()=>{
 const {drive,bot}=driveFixture(),registry=createIssuedLinksRegistry({bot});
 const link=base+'/real/#'+'a'.repeat(160);
 const saved=await registry.register({kind:'agency',name:'Đại lý A',link,
  recipients:[r(71),r(72)],issuedAt:'2026-10-24T14:00:00.000Z',
  expiresAt:'2026-11-23T14:00:00.000Z',shippingPercent:0,vatPercent:8});
 assert.equal(saved.saved,true);assert.equal(drive.writes,1);
 assert.equal(drive.backupCreated,1);
 const newDevice=createIssuedLinksRegistry({bot});
 const history=await newDevice.list({limit:8});
 assert.equal(history.total,1);
 assert.equal(history.items[0].recipients.length,2);
 assert.equal(history.items[0].link,link);
 assert.ok(!JSON.stringify(drive.rows).includes('accessCode'));
 assert.doesNotMatch(JSON.stringify(drive.rows),/"(?:pin|pinDigest|accessPin|accessCode)"\s*:/i);
 const duplicate=await newDevice.register({kind:'agency',name:'Đại lý A',link,
  recipients:[r(71),r(72)],issuedAt:'2026-10-24T14:00:00.000Z',
  expiresAt:'2026-11-23T14:00:00.000Z',shippingPercent:0,vatPercent:8});
 assert.equal(duplicate.duplicate,true);assert.equal(drive.writes,1);
});
test('CTV deterministic link remains one record and supports delivery places',async()=>{
 const {drive,bot}=driveFixture(),registry=createIssuedLinksRegistry({bot});
 const link=base+'/ctv/#'+'b'.repeat(90);
 await registry.register({kind:'collaborator',name:'CTV mẫu',collaboratorId:'ctv_test123',
  link,recipients:[r(301),r(302)],shippingPercent:8,vatPercent:0});
 assert.equal(drive.rows[0].collaboratorId,'ctv_test123');
 assert.equal(drive.rows[0].recipients.length,2);
 assert.equal(drive.rows[0].expiresAt,null);
});
test('refuse to call missing registry or create customer invoices',async()=>{
 const codes=[];
 const registry=createIssuedLinksRegistry({bot:async action=>{
  codes.push(action);throw Object.assign(new Error('NOT_READY'),{code:'OWNER_BOT_UPSTREAM_REJECTED'});
 }});
 await assert.rejects(registry.list(),{code:'OWNER_BOT_UPSTREAM_REJECTED'});
 await assert.rejects(registry.register({kind:'agency',name:'Đại lý hợp lệ',link:base+'/real/#'+'a'.repeat(90),
   recipients:[r(31)]}),{code:'OWNER_BOT_UPSTREAM_REJECTED'});
 assert.ok(codes.every(x=>['links.list','system.status'].includes(x)));
});
test('admin uses owner-only Drive registry; no browser persistence',()=>{
 const html=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 for(const id of ['issuedLinksPanel','issuedLinkList','issuedLinkRefresh',
  'issuedLinkSearch','issuedLinkType','issuedLinkMore'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(server,/customerLinks\.adminAuthorized\(req\)/);
 assert.match(server,/issuedLinks\.register\(/);
 assert.match(server,/issuedLinks\.list\(/);
 const a=html.indexOf('/* Owner-only Drive link history.'),b=html.indexOf('function showAdminTab(name){',a);
 assert.ok(a>=0&&b>a);
 assert.doesNotMatch(html.slice(a,b),/localStorage|sessionStorage/);
 assert.match(html.slice(a,b),/navigator\.clipboard\.writeText\(r\.link\)/);
 const script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
 new vm.Script(script);
});

test('admin link history searches by name before showing private links',()=>{
 const html=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
 const region=html.slice(html.indexOf('/* Owner-only Drive link history.'),html.indexOf('function showAdminTab(name){'));
 assert.match(region,/if\(query\.length<2\)/);
 assert.match(region,/details\.open=true/);
 assert.match(region,/issuedRequestSerial/);
 assert.match(region,/serial!==issuedRequestSerial/);
 assert.match(region,/setTimeout\(\(\)=>void loadIssuedRecords\(true\),400\)/);
 assert.match(region,/r\.recipients/);
 assert.doesNotMatch(region,/localStorage|sessionStorage/);
 // No second browser-side name filter: Bot API folds Treky and Traky equally.
 assert.doesNotMatch(region,/issuedRecords\.filter\(/);
 assert.match(html,/invitation\.registrySaved!==true/);
 assert.match(html,/d\.registrySaved!==true/);
 assert.match(html,/Chưa xác minh lưu link trên Google Drive/);
});

test('owner can re-import an authentic previously copied real link without writing invoices',async()=>{
 const {drive,bot:linkBot}=driveFixture();
 const env={GEMINI_PRODUCTION_LINKS_ENABLED:'1',GEMINI_OWNER_ONLY_REAL_PILOT:'1',
  SATORI_BOT_SECRET:'this-is-only-a-test-secret-with-at-least-32-chars'};
 let invoiceWrites=0;
 const origin='https://minh-satori-customer-ai-gemini.onrender.com';
 const app=createProductionPrivateLinks({env,now:()=>Date.UTC(2026,9,25),
  source:async(invoiceNo,id)=>({customer:{id,name:'ACE Clubhouse',phone:'0900000000',
   location:invoiceNo+' Đường ACE, Hồ Chí Minh'},products:new Map(),revision:161}),
  bot:async(action,payload)=>{if(action!=='orders.create'||Object.keys(payload).length)
   invoiceWrites++;throw Object.assign(Error('INVALID_REQUEST'),{code:'INVALID_REQUEST'});},
  origin});
 const issued=await app.issue({confirmation:'OWNER_APPROVES_REAL_CUSTOMER_LINK',
  agentName:'Công Ty CP ACE Clubhouse',destinations:[
   {customerRef:{id:'71',invoiceNo:71},discountPercent:20},
   {customerRef:{id:'72',invoiceNo:72},discountPercent:35}],
  shippingPercent:0,vatPercent:8,daysValid:7});
 assert.equal(invoiceWrites,0);
 const recovered=app.inspectIssuedForOwner({link:issued.link});
 assert.equal(recovered.kind,'agency');
 assert.equal(recovered.name,'Công Ty CP ACE Clubhouse');
 assert.equal(recovered.recipients.length,2);
 assert.equal(recovered.link,issued.link);
 assert.equal('accessCode' in recovered,false);
 const registry=createIssuedLinksRegistry({bot:linkBot});
 const saved=await registry.register(recovered);
 assert.equal(saved.saved,true);
 assert.equal(drive.writes,1);
 const afterRefresh=createIssuedLinksRegistry({bot:linkBot});
 const result=await afterRefresh.list({limit:8,query:'Công Ty CP ACE Clubhouse'});
 assert.equal(result.items[0].name,'Công Ty CP ACE Clubhouse');
 assert.equal(result.items[0].recipients.length,2);
 const repeated=await afterRefresh.register(recovered);
 assert.equal(repeated.duplicate,true);
 assert.equal(drive.writes,1);
 assert.equal(invoiceWrites,0);
 await assert.rejects(async()=>app.inspectIssuedForOwner({
  link:issued.link.slice(0,-6)+'zzzzzz'}),/INVALID_REAL_LINK/);
 await assert.rejects(async()=>app.inspectIssuedForOwner({link:'https://other.example/real/#'+
  issued.link.split('#')[1]}),/REAL_LINK_RECOVERY_INVALID/);
});

test('the recovery form is collapsed, owner-only and does not store links in a browser cache',()=>{
 const html=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 for(const id of ['issuedRestorePanel','issuedRestoreUrl','issuedRestoreButton','issuedRestoreStatus','agencyRealShowSaved'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(server,/\/api\/admin\/issued-links\/import/);
 assert.match(server,/realPrivateLinks\.inspectIssuedForOwner/);
 assert.match(server,/customerLinks\.adminAuthorized\(req\)/);
 assert.match(server,/issuedLinks\.register\(record\)/);
 assert.match(html,/issuedLinkSearch'\)\.value=result\.name/);
 assert.doesNotMatch(html.slice(html.indexOf("$('issuedRestoreButton').onclick"),html.indexOf("function showAdminTab(name){")),
  /localStorage|sessionStorage/);
});

test('batch verification of 17 physical destinations uses one catalogue and bounded invoice reads',async()=>{
 const env={GEMINI_OWNER_ONLY_REAL_PILOT:'1',
  SATORI_OWNER_CHECKOUT_ENDPOINT:'https://script.google.com/macros/s/FAKE_12345678901234567890123456789012/exec',
  SATORI_OWNER_CHECKOUT_KEY_ID:'owner_trial_writer',
  SATORI_OWNER_CHECKOUT_SECRET:'FAKE_HMAC_SIGNING_012345678901234567890123456789',
  CUSTOMER_LINKS_ADMIN_TOKEN:'FAKE_ADMIN_SECRET_01234567890123456789012',
  SATORI_READ_KEY_ID:'readonly_key'};
 let catalogues=0,reads=0,activeReads=0,maximumConcurrent=0,writes=0;
 const engine=createOwnerRealInvoice({env,fetcher:async(_endpoint,{body})=>{
  const req=JSON.parse(body);
  if(req.action==='catalogue.list'){
   catalogues++;
   return {ok:true,text:async()=>JSON.stringify({ok:true,action:req.action,revision:161,
    data:{source:'drive-ledger:satori_catalogue_v15',revision:161,products:[
     {code:'TP-00001',name:'Nước Satori 500ml',unit:'Thùng',listPrice:98000}
    ]}})};
  }
  if(req.action==='orders.list'){
   reads++;activeReads++;maximumConcurrent=Math.max(maximumConcurrent,activeReads);
   await new Promise(r=>setTimeout(r,2));
   activeReads--;
   const number=Number(req.payload.query);
   return {ok:true,text:async()=>JSON.stringify({ok:true,action:req.action,revision:161,
    data:{totalMatches:1,orders:[{id:String(number+1000),invoiceNo:number,
     name:'Đại lý thử',phone:'0900000000',location:number+' Đường Satori'}]}})};
  }
  writes++;throw Error('unexpected bot action '+req.action);
 }});
 const refs=Array.from({length:17},(_,i)=>({id:String(1000+i+1),invoiceNo:i+1}));
 const verified=await engine.sourceBatch(refs);
 assert.equal(verified.length,17);
 assert.equal(catalogues,1);
 assert.equal(reads,17);
 assert.ok(maximumConcurrent<=3,'must never flood Apps Script beyond three concurrent invoice reads');
 assert.equal(writes,0);
 assert.deepEqual(verified.map(v=>v.customer.id),refs.map(v=>v.id));
 const linkEngine=createProductionPrivateLinks({env:{
  GEMINI_PRODUCTION_LINKS_ENABLED:'1',GEMINI_OWNER_ONLY_REAL_PILOT:'1',
  SATORI_BOT_SECRET:'this-is-only-a-test-secret-with-at-least-32-chars'},
  now:()=>Date.UTC(2026,9,25),source:async()=>{throw Error('must use batch')},
  sourceBatch:engine.sourceBatch,
  bot:async(action,payload)=>{if(action==='orders.create'&&!Object.keys(payload).length)
   throw Object.assign(Error('INVALID_REQUEST'),{code:'INVALID_REQUEST'});
   throw Error('never create invoice')},
  origin:base});
 const issued=await linkEngine.issue({confirmation:'OWNER_APPROVES_REAL_CUSTOMER_LINK',
  agentName:'Đại lý thử',destinations:refs.map(customerRef=>({customerRef,discountPercent:20})),
  shippingPercent:0,vatPercent:8,daysValid:7});
 assert.equal(issued.deliveryLocations,17);
 assert.equal(issued.recipients.length,17);
 assert.ok(issued.link.startsWith(base+'/real/#'));
 assert.equal(writes,0);
});
test('regression: issue button catches failed Drive readiness and shows validation beside submit',()=>{
 const html=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const issue=html.slice(html.indexOf("$('agencyRealIssue').onclick"),html.indexOf("$('agencyRealCopy').onclick"));
 const tryIndex=issue.indexOf('try{'),readinessIndex=issue.indexOf("request('/api/admin/real-links/readiness')");
 const catchIndex=issue.indexOf('}catch(e)');
 assert.ok(tryIndex>=0&&readinessIndex>tryIndex&&catchIndex>readinessIndex,
  'all readiness requests must be inside try/catch; old version left one unhandled');
 assert.match(issue,/agencyRealIssueStatus/);
 assert.match(issue,/registryWriteReady/);
 assert.match(issue,/daysValid>30/);
 assert.match(server,/ownerInvoice\.sourceBatch/);
 assert.match(server,/links\.register',\{confirmed:false\}/);
 assert.match(server,/LINK_REGISTRY_INVALID/);
 assert.match(server,/registryIssueCode/);
});

test('owner-verified no-phone PWC: issue, quote and write a NEW order without changing bill #16 (mock)',async()=>{
 const env={GEMINI_PRODUCTION_LINKS_ENABLED:'1',GEMINI_OWNER_ONLY_REAL_PILOT:'1',
  SATORI_BOT_SECRET:'this-is-only-a-test-secret-with-at-least-32-chars'};
 const ref={id:16,invoiceNo:16};
 const origin={name:'PWC',location:'1137 Huỳnh Tấn Phát, q7'};
 let historicalPhone='',created=0,sourceReads=0;
 const source=async(invoiceNo,id,_catalogue,options={})=>{
  assert.equal(invoiceNo,16);assert.equal(String(id),'16');sourceReads++;
  if(!historicalPhone&&!options.allowMissingPhone)
   throw Object.assign(Error('NO_CONTACT'),{code:'OWNER_CUSTOMER_REFERENCE_AMBIGUOUS'});
  return {revision:162,customer:{id:16,phone:historicalPhone,...origin},
   products:new Map([['TP-00003',{code:'TP-00003',name:'Nước Satori 500ml',
    unit:'Thùng',listPrice:98000}]])};
 };
 const bot=async(action,payload)=>{
  assert.equal(action,'orders.create');
  if(!Object.keys(payload).length)
   throw Object.assign(Error('INVALID_REQUEST'),{code:'INVALID_REQUEST'});
  created++;
  assert.equal(payload.confirmedNewCustomer,true,'original bill #16 is not eligible for phone matching');
  assert.equal(Object.hasOwn(payload,'customerRef'),false,'do not pretend blank old contact matched new number');
  assert.equal(payload.expectedRevision,162);
  assert.equal(payload.order.name,'PWC');
  assert.equal(payload.order.phone,'0901111111');
  assert.equal(payload.order.location,origin.location);
  assert.equal(payload.order.total,78400);
  return {revision:163,data:{order:{invoiceNo:6040,name:'PWC',
   location:origin.location,total:78400}}};
 };
 const engine=createProductionPrivateLinks({env,source,
  sourceBatch:async refs=>Promise.all(refs.map(x=>
    source(x.invoiceNo,x.id,null,{allowMissingPhone:x.confirmedPhoneMissing===true}))),
  bot,origin:base,now:()=>Date.UTC(2026,9,25)});
 const input={confirmation:'OWNER_APPROVES_REAL_CUSTOMER_LINK',
  agentName:'PWC',destinations:[{customerRef:ref,discountPercent:20,
   verifiedPhone:'0901111111',confirmedPhoneMissing:true}],
  shippingPercent:0,vatPercent:0,daysValid:7};
 const issued=await engine.issue(input);
 assert.equal(issued.deliveryLocations,1);
 assert.equal(issued.recipients[0].phone,'0901111111');
 assert.equal(created,0,'issuing a link MUST NOT create or modify any invoice');
 const token=issued.link.split('#')[1],destination=ref;
 const catalogue=await engine.catalogue({token,accessCode:issued.accessCode,destination});
 assert.equal(catalogue.customer.phone,'0901111111');
 assert.equal(catalogue.products[0].unitPrice,78400);
 const quote=await engine.quote({token,accessCode:issued.accessCode,destination,
  items:[{code:'TP-00003',qty:1}]});
 assert.equal(created,0);
 const saved=await engine.confirm({token,accessCode:issued.accessCode,
  quoteToken:quote.quoteToken,confirmation:'CUSTOMER_CONFIRMS_REAL_ORDER'});
 assert.equal(saved.invoiceNo,6040);
 assert.equal(created,1);
 assert.ok(sourceReads>=3);
 await assert.rejects(()=>engine.issue({...input,destinations:[{
  customerRef:ref,discountPercent:20,verifiedPhone:'garbage',confirmedPhoneMissing:true
 }]}),{code:'OWNER_PHONE_VERIFICATION_REQUIRED'});
 historicalPhone='0912345678';
 await assert.rejects(()=>engine.issue(input),{code:'OWNER_PHONE_VERIFICATION_CONFLICT'});
 await assert.rejects(()=>engine.catalogue({token,accessCode:issued.accessCode,destination}),
  {code:'REAL_CUSTOMER_SOURCE_CHANGED'});
 assert.equal(created,1,'mismatched source must never write another order');
});
test('missing phone form requires owner verification before enabling exact invoice source',()=>{
 const html=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
 const area=html.slice(html.indexOf("let agencyReviewed=[];"),
  html.indexOf("$('agencyRealIssue').onclick"));
 const issue=html.slice(html.indexOf("$('agencyRealIssue').onclick"),
  html.indexOf("$('agencyRealCopy').onclick"));
 assert.match(area,/manualSources/);
 assert.match(area,/xác minh/);
 assert.match(area,/contactInput\.type='tel'/);
 assert.match(area,/ownerChecked\.checked/);
 assert.match(area,/tick\.disabled=!valid/);
 assert.match(issue,/confirmedPhoneMissing:true,verifiedPhone/);
 assert.match(issue,/manualCount/);
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/realPrivateLinks\.issue\(input\)/);
 const privateCode=readFileSync(new URL('../production-private-links.mjs',import.meta.url),'utf8');
 assert.match(privateCode,/confirmedNewCustomer:destination\.ownerVerifiedPhone===true/);
 assert.match(privateCode,/allowMissingPhone:d\.ownerVerifiedPhone===true/);
 new vm.Script(html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>')));
});

test('fractions survive issue/price/registry: 16.64% and 25.5%, no invoice writes',async()=>{
 const env={GEMINI_PRODUCTION_LINKS_ENABLED:'1',GEMINI_OWNER_ONLY_REAL_PILOT:'1',
  SATORI_BOT_SECRET:'this-is-only-a-test-secret-with-at-least-32-chars'};
 let writes=0;
 const customerRefs=[{id:'301',invoiceNo:301},{id:'302',invoiceNo:302}];
 const source=async(invoiceNo,id)=>{
  assert.equal(invoiceNo,Number(id));
  return {revision:161,customer:{id,name:'Recipient '+id,phone:'0900000000',
   location:invoiceNo+' Satori Avenue'},products:new Map([['TP-00001',
    {code:'TP-00001',name:'Nước Satori',unit:'Thùng',listPrice:98000}]])};
 };
 const engine=createProductionPrivateLinks({env,source,
  bot:async(action,payload)=>{writes++;assert.equal(action,'orders.create');
   assert.deepEqual(payload,{});
   throw Object.assign(Error('INVALID_REQUEST'),{code:'INVALID_REQUEST'});},
  origin:base,now:()=>Date.UTC(2026,9,25)});
 const values=[16.64,25.5];
 const issued=await engine.issue({confirmation:'OWNER_APPROVES_REAL_CUSTOMER_LINK',
  agentName:'CTV khách thử',destinations:customerRefs.map((customerRef,i)=>({
   customerRef,discountPercent:values[i]})),
  shippingPercent:0,vatPercent:8,daysValid:7});
 assert.deepEqual(issued.recipients.map(x=>x.discountPercent),values);
 const {drive,bot}=driveFixture(),registry=createIssuedLinksRegistry({bot});
 const saved=await registry.register({kind:'agency',name:issued.agentName,
  link:issued.link,recipients:issued.recipients,issuedAt:issued.issuedAt,
  expiresAt:issued.expiresAt,shippingPercent:issued.shippingPercent,
  vatPercent:issued.vatPercent});
 assert.equal(saved.saved,true);
 assert.deepEqual(drive.rows[0].recipients.map(x=>x.discountPercent),values);
 const fresh=await createIssuedLinksRegistry({bot}).list({limit:8});
 assert.deepEqual(fresh.items[0].recipients.map(x=>x.discountPercent),values);
 const token=issued.link.split('#')[1];
 const priced=await Promise.all(customerRefs.map(customerRef=>
  engine.catalogue({token,accessCode:issued.accessCode,destination:customerRef})));
 assert.equal(priced[0].products[0].unitPrice,81693);
 assert.equal(priced[1].products[0].unitPrice,73010);
 assert.equal(writes,1,'one non-mutating orders.create permission probe only');
 for(const invalid of [-0.1,100.00001,NaN,Infinity]){
  await assert.rejects(()=>engine.issue({confirmation:'OWNER_APPROVES_REAL_CUSTOMER_LINK',
   agentName:'Bad',destinations:[{customerRef:customerRefs[0],discountPercent:invalid}],
   shippingPercent:0,vatPercent:8,daysValid:7}),{code:'REAL_LINK_APPROVAL_REQUIRED'});
 }
});
test('localized decimal discount parser accepts Vietnamese commas and blocks invalid percentages',()=>{
 const html=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
 const start=html.indexOf('function parseLinkDiscount(');
 const end=html.indexOf('let agencyReviewed=[];',start);
 assert.ok(start>=0&&end>start);
 const ctxt=vm.createContext({});
 vm.runInContext(html.slice(start,end)+';globalThis.parse=parseLinkDiscount;',ctxt);
 for(const [input,expected] of [['16,64',16.64],['16.64',16.64],
  ['25,5',25.5],['70,125',70.125],['0',0],['100',100]])
  assert.equal(ctxt.parse(input),expected,'fraction '+input);
 for(const input of ['','-1','100,0001','16,abc','Infinity','NaN'])
  assert.ok(Number.isNaN(ctxt.parse(input)),'reject invalid '+input);
 assert.match(html,/discountPercent:parseLinkDiscount\(x\.rate\.value\)/);
 assert.match(html,/rate\.inputMode='decimal'/);
});
