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
  source.slice(start,end)+'\nreturn {linkRegister,linkList}')(
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
