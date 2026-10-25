import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createIssuedLinksRegistry} from '../issued-links-registry.mjs';
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
