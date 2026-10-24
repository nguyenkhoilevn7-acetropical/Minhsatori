import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createIssuedLinksRegistry} from '../issued-links-registry.mjs';

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
 assert.ok(!JSON.stringify(drive.rows).includes('pin'));
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
 const a=html.indexOf('/* Owner-only Drive directory.'),b=html.indexOf('function showAdminTab(name){',a);
 assert.ok(a>=0&&b>a);
 assert.doesNotMatch(html.slice(a,b),/localStorage|sessionStorage/);
 assert.match(html.slice(a,b),/navigator\.clipboard\.writeText\(r\.link\)/);
 const script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
 new vm.Script(script);
});
