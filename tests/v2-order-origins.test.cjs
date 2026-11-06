'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const SOURCE=fs.readFileSync('api/V2OrderOrigins.gs','utf8');
function load(extra={}){const ctx={OWNER_EMAIL:'owner@example.invalid',...extra};vm.createContext(ctx);vm.runInContext(SOURCE,ctx);return ctx}
const api=extra=>load(extra).SatoriV2OrderOrigins;
const row={ledgerInvoiceId:'1793954613000',invoiceNo:'900001',accountId:'fake-account',accountName:'FAKE CTV',
 accountRole:'collaborator',roleSource:'ORDER_SNAPSHOT',requestId:'fake-request-0001'};
const bill={id:1793954613000,invoiceNo:900001,apiRequestId:'fake-request-0001',name:'FAKE recipient',total:1000};
const doc=(entries=[row],generatedAt=new Date().toISOString())=>({schemaVersion:1,source:'satori-v2-postgresql-committed',generatedAt,entries});

test('exact ledger ID, number and request ID required; output is attribution only',()=>{
 const before=JSON.stringify(bill),out=api().select(doc(),[bill]);
 assert.equal(out.length,1);
 assert.deepEqual(Object.keys(out[0]).sort(),['accountId','accountName','accountRole','invoiceNo','ledgerInvoiceId','roleSource']);
 assert.equal(JSON.stringify(bill),before);
 for(const b of [{...bill,id:1793954613001},{...bill,invoiceNo:900002},{...bill,apiRequestId:'other-request-01'},{...bill,apiRequestId:undefined}])
  assert.equal(api().select(doc(),[b]).length,0);
});

test('all three roles and both role sources pass through unchanged',()=>{
 for(const accountRole of ['collaborator','agency','retail'])for(const roleSource of ['ORDER_SNAPSHOT','CURRENT_PROFILE']){
  const [out]=api().select(doc([{...row,accountRole,roleSource}]),[bill]);
  assert.equal(out.accountRole,accountRole);assert.equal(out.roleSource,roleSource);
 }
});

test('duplicates or conflicts on either side, untrusted source and bad rows are rejected',()=>{
 const dupId={...row,invoiceNo:'900002',requestId:'fake-request-0002'};
 const dupNo={...row,ledgerInvoiceId:'1793954613999',requestId:'fake-request-0003'};
 for(const d of [doc([row,row]),doc([row,dupId]),doc([row,dupNo]),{...doc(),source:'browser'},
  doc([{...row,accountRole:'unknown'}]),doc([{...row,roleSource:'GUESS'}]),doc([{...row,invoiceNo:'05978'}]),
  doc([{...row,accountName:' padded'}]),doc([{...row,requestId:''}])])
  assert.equal(api().select(d,[bill]).length,0);
 assert.equal(api().select(doc(),[bill,bill]).length,0);
 assert.equal(api().select(doc(),[bill,{...bill,id:1793954613777}]).length,0); // number reused in ledger
});

test('export age: immutable facts accepted up to 30 days, older or future rejected',()=>{
 const now=Date.parse('2026-11-06T12:00:00Z'),day=86400000;
 assert.equal(api().select(doc([row],new Date(now-2*day).toISOString()),[bill],now).length,1);
 assert.equal(api().select(doc([row],new Date(now-29*day).toISOString()),[bill],now).length,1);
 assert.equal(api().select(doc([row],new Date(now-31*day).toISOString()),[bill],now).length,0);
 assert.equal(api().select(doc([row],new Date(now+5*60000).toISOString()),[bill],now).length,0);
});

test('read never calls the network and fails closed on missing config or errors',()=>{
 const fetchSpy={fetch(){throw Error('read must not fetch')}};
 const props={getScriptProperties:()=>({getProperty:()=>null})};
 assert.equal(api({PropertiesService:props,UrlFetchApp:fetchSpy}).read({}).length,0);
 const failing={getScriptProperties:()=>({getProperty:()=>{throw Error('fake')}})};
 assert.equal(api({PropertiesService:failing,UrlFetchApp:fetchSpy}).read({}).length,0);
});

function fakeEnv({endpoint='https://minh-satori-v2-customer-admin.onrender.com/api/v2/origins/export',
 secret='s'.repeat(40),response,existingFile=null}={}){
 const stored={SATORI_V2_ORIGINS_ENDPOINT:endpoint,SATORI_V2_ORIGINS_SECRET:secret};
 if(existingFile)stored.SATORI_V2_ORDER_ORIGINS_FILE_ID=existingFile.id;
 const calls=[],files=[];
 const file=(id,content)=>({id,content,shared:'PRIVATE',getId(){return id},isTrashed:()=>false,
  getOwner:()=>({getEmail:()=>'owner@example.invalid'}),getSharingAccess(){return this.shared},getSize(){return this.content.length},
  setContent(c){this.content=c},setSharing(a){this.shared=a},getBlob(){return {getDataAsString:()=>this.content}}});
 const existing=existingFile?file(existingFile.id,existingFile.content):null;
 const ctx={
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>stored[k]??null,setProperty:(k,v)=>{stored[k]=v}})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  Utilities:{getUuid:()=>crypto.randomUUID(),Charset:{UTF_8:'utf8'},
   computeHmacSha256Signature:(m,k)=>[...crypto.createHmac('sha256',k).update(m).digest()].map(b=>b>127?b-256:b)},
  UrlFetchApp:{fetch(url,opt){calls.push({url,opt});return response}},
  DriveApp:{Access:{PRIVATE:'PRIVATE'},Permission:{NONE:'NONE'},
   getFileById:id=>{if(existing&&id===existing.id)return existing;const f=files.find(x=>x.id===id);if(f)return f;throw Error('missing')},
   createFile:(name,content)=>{const f=file('created-file-0001',content);files.push(f);return f}}};
 return {ctx,stored,calls,files,existing};
}
const ok=(body)=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(body)});

test('refresh signs exactly the V2 contract and stores a private cache file',()=>{
 const env=fakeEnv({response:ok({ok:true,...doc([{...row,phone:'000',extra:'x'}])})});
 const status=load(env.ctx).satoriV2OrderOriginsRefreshTick();
 assert.equal(status,'OK_1');
 const {url,opt}=env.calls[0],payload=JSON.parse(opt.payload);
 assert.equal(url,env.stored.SATORI_V2_ORIGINS_ENDPOINT);assert.equal(opt.method,'post');assert.equal(opt.followRedirects,false);
 const expected=crypto.createHmac('sha256','s'.repeat(40)).update('satori-v2-order-origins-v1\n'+payload.ts+'\n'+payload.nonce).digest('hex');
 assert.equal(opt.headers['x-satori-origins-signature'],expected);assert.match(payload.nonce,/^[a-f0-9]{32}$/);
 assert.equal(env.files.length,1);assert.equal(env.files[0].shared,'PRIVATE');
 assert.equal(env.stored.SATORI_V2_ORDER_ORIGINS_FILE_ID,'created-file-0001');
 const cached=JSON.parse(env.files[0].content);assert.equal(cached.entries[0].phone,undefined);
 assert.doesNotMatch(env.stored.SATORI_V2_ORDER_ORIGINS_STATUS,/s{32}/);
 // The cached file is what the owner Mobile API then reads.
 assert.equal(load(env.ctx).SatoriV2OrderOrigins.read({values:{satori_orders_v15:JSON.stringify([bill])}}).length,1);
});

test('refresh updates the existing cache in place instead of creating copies',()=>{
 const env=fakeEnv({response:ok({ok:true,...doc()}),existingFile:{id:'existing-file-01',content:'{}'}});
 assert.equal(load(env.ctx).satoriV2OrderOriginsRefreshTick(),'OK_1');
 assert.equal(env.files.length,0);assert.equal(JSON.parse(env.existing.content).entries.length,1);
});

test('refresh refuses bad config, HTTP errors and invalid exports without touching the cache',()=>{
 const cases=[[{endpoint:'http://minh-satori-v2-customer-admin.onrender.com/api/v2/origins/export'},'NOT_CONFIGURED'],
  [{endpoint:'https://evil.example.com/api/v2/origins/export'},'NOT_CONFIGURED'],[{secret:'short'},'NOT_CONFIGURED'],
  [{response:{getResponseCode:()=>403,getContentText:()=>''}},'HTTP_403'],
  [{response:ok({ok:true,...doc(),source:'browser'})},'INVALID_EXPORT'],[{response:ok({ok:false})},'INVALID_EXPORT'],
  [{response:{getResponseCode:()=>200,getContentText:()=>'not json'}},'ERROR']];
 for(const [opts,code] of cases){
  const env=fakeEnv({response:ok({ok:true,...doc()}),...opts});
  assert.equal(load(env.ctx).satoriV2OrderOriginsRefreshTick(),code);
  assert.equal(env.files.length,0);assert.equal(env.stored.SATORI_V2_ORDER_ORIGINS_FILE_ID,undefined);
  assert.equal(JSON.parse(env.stored.SATORI_V2_ORDER_ORIGINS_STATUS).status,code);
 }
});

test('registry hook is after owner checks; no ledger, payment or PDF writes in this file',()=>{
 const code=fs.readFileSync('api/AndroidOwnerMobileApi.gs','utf8');
 assert.ok(code.indexOf('SatoriV2OrderOrigins.read(s)')>code.indexOf('var actor=verify(req.accessToken)'));
 assert.ok(code.indexOf('SatoriV2OrderOrigins.read(s)')>code.indexOf("if(action==='mobile.revision')"));
 assert.doesNotMatch(SOURCE,/satori_orders_v15['"]?\s*\]?\s*=|writeState|saveState|setValue|Pdf|pdf/);
});
