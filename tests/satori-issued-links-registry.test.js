const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../api/BotApi.gs'),'utf8');

function helpers(){
 const start=source.indexOf("var LINK_KEY='satori_issued_links_v1'");
 const end=source.indexOf('function read(s,action,p){',start);
 assert.ok(start>=0&&end>start,'Drive registry helper exists');
 const need=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code})};
 const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
 const version=(state,p)=>{if(state.revision!==p.expectedRevision)
  fail('REVISION_CONFLICT','Ledger changed')};
 return new Function('need','fail','version',
  source.slice(start,end)+'\nreturn {linkRegister,linkList,linkUpdate,linkSecretSet}')(
   need,fail,version);
}
const url='https://minh-satori-customer-ai-gemini.onrender.com/real/#'+'a'.repeat(160);
const record={id:'il_'+'1'.repeat(32),kind:'agency',name:'Agency demo',
 link:url,issuedAt:'2026-10-24T12:00:00Z',expiresAt:'2026-11-23T12:00:00Z',
 shippingPercent:0,vatPercent:8,recipients:[{
  customerRef:{id:'12345',invoiceNo:123},name:'Recipient',
  phone:'0900000000',location:'123 Test Street, HCMC',discountPercent:20
 }]};
test('owner writer only: read/write link actions do not reuse customer read scope',()=>{
 assert.match(source,/'links\.register':'orders:write'/);
 assert.match(source,/'links\.list':'orders:write'/);
 assert.match(source,/identity\.action==='links\.register'/);
 assert.doesNotMatch(source,/'links\.list':'orders:read'/);
});
test('register is a versioned, idempotent Drive ledger update with recipient metadata',()=>{
 const {linkRegister,linkList}=helpers(),current={
  revision:161,values:{satori_orders_v15:'[{"invoiceNo":123}]'}
 };
 const registered=linkRegister(current,{record,confirmed:true,expectedRevision:161});
 assert.equal(registered.modified,true);
 assert.equal(current.values.satori_orders_v15,'[{"invoiceNo":123}]');
 const next={revision:162,values:{...current.values,...registered.extras}};
 const all=linkList(next,{limit:8});
 assert.equal(all.total,1);assert.equal(all.items[0].link,url);
 assert.equal(all.items[0].recipients[0].phone,'0900000000');
 assert.doesNotMatch(JSON.stringify(next),/accessCode|pinDigest|accessPin/);
 const duplicate=linkRegister(next,{record:{...record,issuedAt:'2026-10-25T12:00:00Z'},
  confirmed:true,expectedRevision:162});
 assert.equal(duplicate.modified,false);
 assert.equal(duplicate.result.duplicate,true);
 assert.throws(()=>linkRegister(next,{record:{...record,id:'il_'+'2'.repeat(32)},
  confirmed:true,expectedRevision:161}),{code:'REVISION_CONFLICT'});
});
test('fake host, duplicate recipients and unauthorized size are rejected',()=>{
 const {linkRegister}=helpers(),state={revision:10,values:{}};
 assert.throws(()=>linkRegister(state,{record:{...record,
  link:url.replace('minh-satori-customer-ai-gemini.onrender.com','example.com')},
  confirmed:true,expectedRevision:10}),{code:'LINK_REGISTRY_INVALID'});
 assert.throws(()=>linkRegister(state,{record:{...record,
  recipients:[record.recipients[0],record.recipients[0]]},
  confirmed:true,expectedRevision:10}),{code:'LINK_REGISTRY_INVALID'});
 assert.throws(()=>linkRegister(state,{record,confirmed:false,expectedRevision:10}),
  {code:'LINK_REGISTRY_INVALID'});
});

test('same CTV URL refreshes its newly approved recipients without changing link identity',()=>{
 const {linkRegister,linkList}=helpers();
 const ctv={...record,id:'il_'+'3'.repeat(32),kind:'collaborator',
  name:'CTV Example',collaboratorId:'ctv_test123',
  link:'https://minh-satori-customer-ai-gemini.onrender.com/ctv/#'+'c'.repeat(90),
  expiresAt:null};
 const initial={revision:17,values:{satori_orders_v15:'[]'}};
 const first=linkRegister(initial,{record:ctv,confirmed:true,expectedRevision:17});
 const next={revision:18,values:{...initial.values,...first.extras}};
 const expanded={...ctv,recipients:[...ctv.recipients,{
  customerRef:{id:'777',invoiceNo:777},name:'New Approved Receiver',
  phone:'0900123777',location:'777 Đường Mới TP.HCM',discountPercent:20
 }]};
 const refresh=linkRegister(next,{record:expanded,confirmed:true,expectedRevision:18});
 assert.equal(refresh.modified,true);
 assert.equal(refresh.result.updated,true);
 const saved=linkList({revision:19,values:{...next.values,...refresh.extras}},{limit:10});
 assert.equal(saved.total,1);
 assert.equal(saved.items[0].recipients.length,2);
 assert.equal(saved.items[0].issuedAt,new Date(ctv.issuedAt).toISOString());
 assert.equal(saved.items[0].link,ctv.link);
});

test('owner can change contact and address under SAME link id without touching invoice or rate',()=>{
 const {linkRegister,linkUpdate,linkList}=helpers();
 const initial={revision:200,values:{satori_orders_v15:'[{"invoiceNo":123}]'}};
 const created=linkRegister(initial,{record,confirmed:true,expectedRevision:200});
 const saved={revision:201,values:{...initial.values,...created.extras}};
 const next=[{...record.recipients[0],name:'Correct customer',
  phone:'0901111222',location:'42 New verified address, HCMC'}];
 const edit=linkUpdate(saved,{id:record.id,name:'Agency new display',
  recipients:next,confirmed:true,expectedRevision:201});
 assert.equal(edit.modified,true);
 assert.equal(saved.values.satori_orders_v15,initial.values.satori_orders_v15);
 const after={revision:202,values:{...saved.values,...edit.extras}};
 const found=linkList(after,{id:record.id});
 assert.equal(found.total,1);
 const actual=found.items[0];
 assert.equal(actual.link,record.link);
 assert.equal(actual.issuedAt,new Date(record.issuedAt).toISOString());
 assert.equal(actual.recipients[0].customerRef.id,record.recipients[0].customerRef.id);
 assert.equal(actual.recipients[0].discountPercent,20);
 assert.equal(actual.recipients[0].name,'Correct customer');
 assert.equal(actual.recipients[0].phone,'0901111222');
 assert.equal(actual.recipients[0].location,'42 New verified address, HCMC');
 assert.equal(actual.editCount,1);
 assert.equal(linkUpdate(after,{id:record.id,name:actual.name,
  recipients:actual.recipients,confirmed:true,expectedRevision:202}).modified,false);
});
test('owner link amendments reject wrong ref, price, invalid contact, CTV, and stale revision',()=>{
 const {linkRegister,linkUpdate}=helpers(),base={revision:200,values:{}};
 const created=linkRegister(base,{record,confirmed:true,expectedRevision:200});
 const current={revision:201,values:{...base.values,...created.extras}};
 const request={id:record.id,name:record.name,recipients:[record.recipients[0]],
  confirmed:true,expectedRevision:201};
 assert.throws(()=>linkUpdate(current,{...request,confirmed:false}),
  {code:'LINK_UPDATE_INVALID'});
 assert.throws(()=>linkUpdate(current,{...request,recipients:[{
  ...record.recipients[0],phone:'123'}]}),{code:'LINK_UPDATE_INVALID'});
 assert.throws(()=>linkUpdate(current,{...request,recipients:[{
  ...record.recipients[0],customerRef:{id:'different',invoiceNo:123}}]}),
  {code:'LINK_UPDATE_PRICE_PROTECTED'});
 assert.throws(()=>linkUpdate(current,{...request,recipients:[{
  ...record.recipients[0],discountPercent:35}]}),{code:'LINK_UPDATE_PRICE_PROTECTED'});
 assert.throws(()=>linkUpdate(current,{...request,recipients:[{
  ...record.recipients[0],name:'Updated',phone:'0900000888'}],
  expectedRevision:200}),{code:'REVISION_CONFLICT'});
 const ctv={...record,id:'il_'+'3'.repeat(32),kind:'collaborator',
  name:'CTV Example',collaboratorId:'ctv_test123',
  link:'https://minh-satori-customer-ai-gemini.onrender.com/ctv/#'+'c'.repeat(90),
  expiresAt:null};
 const saved=linkRegister(current,{record:ctv,confirmed:true,expectedRevision:201});
 const withCtv={revision:202,values:{...current.values,...saved.extras}};
 assert.throws(()=>linkUpdate(withCtv,{...request,id:ctv.id,expectedRevision:202}),
  {code:'LINK_UPDATE_CTV_POLICY_REQUIRED'});
 assert.match(source,/'links\.update':'orders:write'/);
 assert.match(source,/identity\.action==='links\.update'/);
});


test('encrypted PIN vault is immutable after owner-only backfill (fake ledger)',()=>{
 const {linkRegister,linkSecretSet}=helpers();
 const base={revision:200,values:{satori_orders_v15:'[{"invoiceNo":123}]'}};
 const created=linkRegister(base,{record,confirmed:true,expectedRevision:200});
 const saved={revision:201,values:{...base.values,...created.extras}};
 const vault='A'.repeat(16)+'.'+'B'.repeat(24)+'.'+'C'.repeat(32);
 const changed='A'.repeat(16)+'.'+'B'.repeat(24)+'.'+'D'.repeat(32);
 const request={id:record.id,accessCodeVault:vault,confirmed:true,expectedRevision:201};
 assert.throws(()=>linkSecretSet(saved,{...request,expectedRevision:200}),
  {code:'REVISION_CONFLICT'});
 const first=linkSecretSet(saved,request);
 assert.equal(first.modified,true);
 assert.equal(saved.values.satori_orders_v15,base.values.satori_orders_v15);
 const after={revision:202,values:{...saved.values,...first.extras}};
 assert.equal(JSON.parse(after.values.satori_issued_links_v1)[0].accessCodeVault,vault);
 const repeated=linkSecretSet(after,{...request,expectedRevision:202});
 assert.equal(repeated.modified,false);
 assert.equal(repeated.result.duplicate,true);
 assert.throws(()=>linkSecretSet(after,{...request,accessCodeVault:changed,expectedRevision:202}),
  {code:'LINK_VAULT_IMMUTABLE'});
 assert.match(source,/'links\\.secret\\.set':'orders:write'/);
});
