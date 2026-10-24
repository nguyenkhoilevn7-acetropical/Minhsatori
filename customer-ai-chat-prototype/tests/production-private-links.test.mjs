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

test('rollback: working agency links are isolated from the new CTV Drive table',()=>{
 const html=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
 const code=readFileSync(new URL('../production-private-links.mjs',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(html,/id="agencyRealIssue"/);
 assert.match(html,/data-admin-tab="ctv-ledger"/);
 assert.match(html,/id="independentCtvLedger"/);
 assert.match(html,/id="ctvReadLive"/,'owner CTV tab must work without opening a blocked external Sheet');
 assert.match(html,/id="collaboratorPairAdmin" style="display:none!important"/);
 assert.doesNotMatch(code,/commissionPolicy|ownerCommissionPreview/);
 assert.doesNotMatch(html,/id="agencyCommissionEnabled"|agency-commission\/preview/);
 assert.match(server,/const result=await realPrivateLinks\.issue\(input\)/);
 for(const [,source] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
  new vm.Script(source,{filename:'restored-owner-admin.html.js'});
});

test('production checkout matches chat-first demo: inline invoice, cart and actions; original write policy remains',()=>{
 const html=readFileSync(new URL('../real-checkout.html',import.meta.url),'utf8');
 assert.match(html,/id="showAllProducts"/);
 assert.match(html,/id="showCart"/);
 assert.match(html,/id="showInvoice"/);
 assert.match(html,/id="review"/);
 assert.match(html,/id="reviewPanel"/);
 assert.match(html,/function showInvoiceDetails\(q,confirmed\)/);
 assert.match(html,/function invoiceRow\(label,value,extraClass/);
 assert.match(html,/lastConfirmed=\{quote:lastQuote,result:d\}/);
 assert.doesNotMatch(html,/\$\('shop'\)\.hidden=true/,'quoting must not hide the chat');
 assert.match(html,/request\('\/api\/real\/confirm'/,'still requires explicitly confirmed real checkout');
 assert.match(html,/confirmation:'CUSTOMER_CONFIRMS_REAL_ORDER'/);
 assert.match(html,/không phải file PDF chính thức/i,'customer receipt never falsely claims official PDF');
 const i=html.indexOf('id="chat-shell"'),summary=html.indexOf('id="reviewPanel"');
 assert.ok(summary>0 && summary<html.indexOf('class="chat-composer"'),
  'invoice actions are inline ABOVE the composer, not on a separate screen');
 for(const [,src] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
  new vm.Script(src,{filename:'live-ai-checkout.js'});
});

test('Production reuses literal original Gemini DOM/CSS rather than rebuilding demo-like chat',async()=>{
 const {renderOriginalGeminiProduction}=await import('../production-gemini-shell.mjs');
 const demo=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const adapter=readFileSync(new URL('../real-gemini-adapter.js',import.meta.url),'utf8');
 const page=renderOriginalGeminiProduction(demo,adapter);
 const originalHtml=demo.slice(0,demo.indexOf('<script>'));
 for(const id of ['catalogLaunch','locationsToggle','suggestionsToggle','historyButton',
  'catalogBackdrop','catalogItems','cartFooter','quickCart','sendForm','messageInput',
  'messages','historyBackdrop','invoice','printPaper']){
  assert.match(originalHtml,new RegExp('id="'+id+'"'));
  assert.match(page,new RegExp('id="'+id+'"'),'live shell must use authentic existing HTML');
 }
 assert.match(page,/id="realCode"/);
 assert.match(page,/id="productionGeminiApp" hidden/);
 assert.match(page,/id="realOpen"/);
 assert.doesNotMatch(page,/id="panel"/,'demo account selector must not appear');
 assert.doesNotMatch(page,/KH-DEMO-A/,'no fake customer profile');
 assert.match(page,/production-gemini/);
 assert.match(page,/live-real-confirm/);
 assert.doesNotMatch(page,/MSATORI_SANDBOX_DEMO_ONLY/);
 assert.match(adapter,/\/api\/real\/catalogue/);
 assert.match(adapter,/\/api\/real\/interpret/);
 assert.match(adapter,/\/api\/real\/quote/);
 assert.match(adapter,/\/api\/real\/confirm/);
 assert.doesNotMatch(adapter,/\/api\/draft|\/api\/chat|\/api\/catalogue/,'real adapter never uses demo APIs');
 assert.match(adapter,/CUSTOMER_CONFIRMS_REAL_ORDER/);
 assert.match(adapter,/KHÔNG xác nhận lại/);
 for(const [,script] of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
  new vm.Script(script,{filename:'production-original-gemini.js'});
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/renderOriginalGeminiProduction\(/);
 assert.doesNotMatch(server,/const html=fs\.readFileSync\(path\.join\(HERE,'real-checkout\.html'\)/);
});

test('real links render EXACT Gemini original HTML/CSS with a Production adapter',async()=>{
 const {renderOriginalGeminiProduction}=await import('../production-gemini-shell.mjs');
 const original=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const adapter=readFileSync(new URL('../real-gemini-adapter.js',import.meta.url),'utf8');
 const view=renderOriginalGeminiProduction(original,adapter);
 const old=original.slice(0,original.indexOf('<script>'));
 for(const id of ['catalogLaunch','locationsToggle','suggestionsToggle','historyButton',
  'messages','sendForm','messageInput','catalogBackdrop','catalogItems','cartFooter',
  'quickCart','invoice','printPaper','historyBackdrop']){
  assert.match(old,new RegExp('id="'+id+'"'));
  assert.match(view,new RegExp('id="'+id+'"'),'the old component MUST be reused');
 }
 assert.match(view,/id="realOpen"/);
 assert.match(view,/id="realCode"/);
 assert.match(view,/id="productionGeminiApp" hidden/);
 assert.match(view,/class="server-mode production-gemini"/);
 assert.doesNotMatch(view,/KH-DEMO-A|id="panel"/,'sandbox customer panel excluded');
 assert.match(adapter,/\/api\/real\/catalogue/);
 assert.match(adapter,/\/api\/real\/interpret/);
 assert.match(adapter,/\/api\/real\/quote/);
 assert.match(adapter,/\/api\/real\/confirm/);
 assert.doesNotMatch(adapter,/\/api\/draft|\/api\/chat|\/api\/catalogue/,'no sandbox routes');
 assert.match(adapter,/CUSTOMER_CONFIRMS_REAL_ORDER/);
 assert.match(adapter,/KHÔNG xác nhận lại/,'ambiguous write must not be resubmitted');
 for(const [,js] of view.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
  new vm.Script(js,{filename:'real-original-gemini.js'});
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/renderOriginalGeminiProduction\(/);
 assert.doesNotMatch(server,/const html=fs\.readFileSync\(path\.join\(HERE,'real-checkout\.html'\)/);
});

test('standalone CTV finance is an owner-only live read, independent of agency link /real',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const route=server.slice(server.indexOf("p==='/api/admin/ctv-live-catalogue'"),
  server.indexOf('// Owner-only production READ access.',server.indexOf("p==='/api/admin/ctv-live-catalogue'")));
 assert.match(route,/customerLinks\.adminAuthorized\(req\)/);
 assert.match(route,/readMinhSatori\('catalogue\.list'\)/);
 assert.match(route,/receiverWritesEnabled:false/);
 assert.doesNotMatch(route,/orders\.create|orders\.create\.pair|ctv\.recipients\.upsert/);
 const html=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
 for(const id of ['ctvReadLive','ctvLedgerName','ctvReceiverName','ctvReceiverPhone',
  'ctvReceiverAddress','ctvCustomerPct','ctvPartnerPct','ctvLiveProduct',
  'ctvLiveQty','ctvCalculateLive','ctvAddReceiverDraft'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/CHƯA ghi Google Drive/);
 for(const [,js] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
  new vm.Script(js,{filename:'real-owner-ctv.js'});
});
