// One-time scope helper (api/GrokLedgerScopesSetup.gs), then the REAL production BotApi
// (apps-script/production-snapshot-20261115) checked with the resulting keys.
// Fake secrets, fake Script Properties, no network. Run: node tests/grok-scopes-setup.cjs
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=__dirname+'/../';
const SECRET={writer:'fake-writer-secret-0123456789abcdefghij',reader:'fake-reader-secret-0123456789abcdefghij',
 chatgpt:'fake-chatgpt-secret-0123456789abcdefgh'};
const PRE={writer:{enabled:true,secret:SECRET.writer,scopes:['orders:read','orders:write']},
 reader:{enabled:true,secret:SECRET.reader,scopes:['orders:read','catalogue:read']},
 chatgpt:{enabled:true,secret:SECRET.chatgpt,scopes:['orders:read','orders:update','payments:write'],role:'admin'}};
let passed=0;const test=(n,f)=>{f();console.log('PASS '+n);passed++};
function helper(clients,{writer='writer',reader='reader'}={}){
 const props={SATORI_BOT_CLIENTS_JSON:JSON.stringify(clients)},logs=[];
 const ctx={console:{log:m=>logs.push(String(m))},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=v},deleteProperty:k=>{delete props[k]}})}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(root+'api/GrokLedgerScopesSetup.gs','utf8'),ctx);
 vm.runInContext('SATORI_GROK_WRITER_KEY_ID='+JSON.stringify(writer)+';SATORI_GROK_READER_KEY_ID='+JSON.stringify(reader),ctx);
 return {ctx,props,logs,clients:()=>JSON.parse(props.SATORI_BOT_CLIENTS_JSON)};
}
const BACKUP='SATORI_BOT_CLIENTS_JSON_BACKUP_GROK_20261116';
test('writer: +orders:delete +orders:update +payments:write, role owner; reader: +debt:read, role owner, never orders:update',()=>{
 const h=helper(PRE),original=h.props.SATORI_BOT_CLIENTS_JSON;
 assert.equal(h.ctx.satoriGrokScopesApply(),'APPLY_DONE_BACKUP_IN_'+BACKUP);
 const c=h.clients();
 assert.deepEqual(c.writer.scopes,['orders:read','orders:write','orders:delete','orders:update','payments:write']);assert.equal(c.writer.role,'owner');
 assert.deepEqual(c.reader.scopes,['orders:read','catalogue:read','debt:read']);assert.equal(c.reader.role,'owner');
 assert.deepEqual(c.chatgpt,PRE.chatgpt,'other keys untouched');
 for(const id of Object.keys(PRE))assert.equal(c[id].secret,PRE[id].secret);
 assert.ok(!c.writer.scopes.includes('orders:cancel')&&!c.reader.scopes.includes('orders:cancel'));
 assert.ok(h.logs.every(l=>!Object.values(SECRET).some(s=>l.includes(s))),'secret leaked to log');
 assert.throws(()=>h.ctx.satoriGrokScopesApply(),/BACKUP_ALREADY_EXISTS/);
 assert.equal(h.ctx.satoriGrokScopesRollback(),'ROLLBACK_DONE_BACKUP_KEPT');assert.equal(h.props.SATORI_BOT_CLIENTS_JSON,original);
 assert.equal(h.ctx.satoriGrokScopesClearBackup(),'BACKUP_CLEARED');
});
for(const [name,clients,ids,re] of [
 ['key IDs not filled',PRE,{writer:'',reader:''},/FILL_WRITER_AND_READER_KEY_IDS_FIRST/],
 ['same key for writer and reader',PRE,{writer:'writer',reader:'writer'},/WRITER_AND_READER_MUST_BE_DIFFERENT/],
 ['unknown key ID',PRE,{writer:'writer',reader:'nope'},/KEY_NOT_FOUND_OR_INVALID/],
 ['reader already holds orders:update',{...PRE,reader:{...PRE.reader,scopes:['orders:read','orders:update']}},{},/READER_KEY_ALREADY_HAS_WRITE_SCOPE_STOP/]
])test('refuses and changes nothing: '+name,()=>{
 const h=helper(clients,ids),before=h.props.SATORI_BOT_CLIENTS_JSON;
 assert.throws(()=>h.ctx.satoriGrokScopesApply(),re);
 assert.equal(h.props.SATORI_BOT_CLIENTS_JSON,before);assert.equal(h.props[BACKUP],undefined);
});
test('with the granted keys, production BotApi lets the WRITER preview/update and the READER only read',()=>{
 const h=helper(PRE);h.ctx.satoriGrokScopesApply();
 const PROD=root+'apps-script/production-snapshot-20261115/';
 let raw=JSON.stringify({revision:3,values:{satori_orders_v15:JSON.stringify([{id:'L1',invoiceNo:1,name:'Khách Giả',location:'01 Đường Giả',
  items:[{product:'Nước Giả',qty:1,unitPrice:1000}],total:1000,status:'Chưa thanh toán'}]),satori_trash_bin_v15:'[]'}});
 const cache=new Map(),out=s=>({setMimeType(){return s}});
 const ctx={console,readState_:()=>JSON.parse(raw),PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='STATE_FILE_ID'?'f':h.props[k]??null})},
  DriveApp:{getFileById:()=>({makeCopy:()=>({getId:()=>'b',getBlob:()=>({getDataAsString:()=>raw})}),setContent:v=>{raw=v}})},
  Utilities:{Charset:{UTF_8:'utf8'},DigestAlgorithm:{SHA_256:'sha256'},computeHmacSha256Signature:(m,k)=>[...crypto.createHmac('sha256',k).update(m,'utf8').digest()],
   computeDigest:(a,m)=>[...crypto.createHash('sha256').update(String(m),'utf8').digest()],formatDate:()=>'',getUuid:()=>crypto.randomUUID()},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:out},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(PROD+'BotApi.gs','utf8'),ctx);
 const send=(keyId,action,payload)=>{const b={keyId,timestamp:Date.now(),nonce:crypto.randomUUID(),action,payload};
  b.signature=crypto.createHmac('sha256',SECRET[keyId]).update([keyId,b.timestamp,b.nonce,action,JSON.stringify(payload)].join('\n')).digest('hex');
  return JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(b)}}))};
 const edit={expectedRevision:3,requestId:'grokpreview-abcdef123456',invoiceNo:1,id:'L1',expectedName:'Khách Giả',expectedTotal:1000,confirmed:true,reason:'Giả lập',
  order:{priceMode:'exclusive',vatRate:0,name:'Khách Giả',location:'01 Đường Giả',items:[{product:'Nước Giả',qty:2,unitPrice:1000}]}};
 assert.equal(send('writer','orders.previewUpdate',edit).data.order.total,2000);
 assert.equal(send('writer','orders.get',{invoiceNo:1,id:'L1'}).ok,true);
 assert.equal(send('reader','orders.previewUpdate',{...edit,requestId:'grokpreview-reader000001'}).error.code,'FORBIDDEN');
 assert.equal(send('reader','orders.update',{...edit,requestId:'grokupdate-reader0000001'}).error.code,'FORBIDDEN');
 assert.equal(send('reader','payments.markSatoriPaid',{}).error.code,'FORBIDDEN');
 assert.equal(send('reader','orders.auditHistory',{invoiceNo:1,id:'L1'}).ok,true);
 assert.equal(send('reader','orders.cancel',{}).error.code,'INVALID_ACTION','production has no orders.cancel');
 assert.equal(JSON.parse(raw).revision,3,'nothing written');
});
console.log(passed+' PASS, 0 FAIL');
