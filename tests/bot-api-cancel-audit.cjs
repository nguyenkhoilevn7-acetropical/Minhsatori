// Offline fake-ledger tests for the Grok ledger add-on, run against the REAL production
// Apps Script code (apps-script/production-snapshot-20261115/BotApi.gs + AccountingCore.gs),
// with the single doPost hook line inserted exactly as docs/APPS_SCRIPT_DEPLOY_GROK_LEDGER.md says.
// No network, no real secrets, no real data. Run: node tests/bot-api-cancel-audit.cjs
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=__dirname+'/../';
const PROD=root+'apps-script/production-snapshot-20261115/';
const HOOK="if(typeof SatoriGrokLedgerApi!=='undefined'){var grokLedger=SatoriGrokLedgerApi.tryHandle(e);if(grokLedger)return grokLedger;}";
const prodBotApi=fs.readFileSync(PROD+'BotApi.gs','utf8');
assert.equal(prodBotApi.split('function doPost(e) {').length,2,'production doPost signature changed: update the deploy guide');
const SOURCES={
 botApiOriginal:prodBotApi,
 botApiHooked:prodBotApi.replace('function doPost(e) {','function doPost(e) {\n  '+HOOK),
 accounting:fs.readFileSync(PROD+'AccountingCore.gs','utf8'),
 cancel:fs.readFileSync(root+'api/BotApiOrderCancel.gs','utf8'),
 ext:fs.readFileSync(root+'api/BotApiGrokLedger.gs','utf8'),
 scopes:fs.readFileSync(root+'api/GrokLedgerScopesSetup.gs','utf8')};
const SECRET={writer:'fake-writer-secret-0123456789abcdefghij',reader:'fake-reader-secret-0123456789abcdefghij',
 legacy:'fake-legacy-secret-0123456789abcdefghij',chatgpt:'fake-chatgpt-secret-0123456789abcdefgh'};
const DEFAULT_CLIENTS={
 writer:{secret:SECRET.writer,scopes:['orders:read','orders:write','orders:cancel','orders:delete']},
 reader:{secret:SECRET.reader,scopes:['orders:read','debt:read'],role:'owner'},
 legacy:{secret:SECRET.legacy,scopes:['orders:read','orders:write','orders:delete']},
 chatgpt:{secret:SECRET.chatgpt,scopes:['orders:read','orders:update'],role:'admin'}};
const FIXTURE_NOW=Date.now();
function orders(){return [
 {id:2001,invoiceNo:501,name:'Khách Thử Hủy',phone:'0900000001',location:'Địa chỉ thử 1',total:150000,status:'Chưa thanh toán',
  date:'14/11/2026',timestamp:Date.parse('2026-11-14T02:00:00Z'),source:'bot_api',apiRequestId:'create-req-501',
  items:[{product:'Nước thử',qty:1,unitPrice:150000}]},
 {id:2002,invoiceNo:502,name:'Khách Đã Trả',total:90000,status:'Đã thanh toán',customerPaidAt:'2026-11-13T00:00:00Z',date:'13/11/2026',items:[]},
 {id:2003,invoiceNo:503,name:'Khách Không Lịch Sử',total:10000,status:'Chưa thanh toán',date:'12/11/2026',items:[]}
];}
const EDIT_AUDIT=[{requestId:'edit-req-501',id:2001,invoiceNo:501,timestamp:'2026-11-14T03:00:00.000Z',actor:'hmac:chatgpt',
 reason:'sửa số lượng',beforeTotal:140000,afterTotal:150000}];
function harness({clients=DEFAULT_CLIENTS,withCancel=true,withExt=true,hooked=true,flags={SATORI_GROK_LEDGER_ENABLED:'1'},extraValues={}}={}){
 let raw=JSON.stringify({revision:7,updatedAt:'2026-11-15T00:00:00Z',values:Object.assign({
  satori_orders_v15:JSON.stringify(orders()),
  satori_order_edit_audit_v1:JSON.stringify(EDIT_AUDIT),
  satori_trash_bin_v15:JSON.stringify([{order:{id:3001,invoiceNo:601,name:'Khách Trong Thùng Rác',total:5000,status:'Chưa thanh toán',items:[]},
   deletedAt:FIXTURE_NOW-86400000,expiresAt:FIXTURE_NOW+29*86400000,apiDeleteRequestId:'delete-req-601'}]),
  satori_deleted_invoice_nos:'[601]'},extraValues)});
 const backups=[],cache=new Map();let writes=0;
 const props=Object.assign({STATE_FILE_ID:'fake-state-file',SATORI_BOT_CLIENTS_JSON:JSON.stringify(clients)},flags);
 const file={getBlob:()=>({getDataAsString:()=>raw}),
  makeCopy:()=>{const copy=raw;backups.push(copy);return {getId:()=>'backup-'+backups.length,getBlob:()=>({getDataAsString:()=>copy})}},
  setContent:v=>{raw=v;writes++}};
 const textOutput=s=>{const o={getContent:()=>s,setMimeType:()=>o,toString:()=>s};return o};
 const context={console,readState_:()=>JSON.parse(raw),
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null})},
  DriveApp:{getFileById:id=>{assert.equal(id,'fake-state-file');return file}},
  Utilities:{Charset:{UTF_8:'utf8'},DigestAlgorithm:{SHA_256:'sha256'},
   computeHmacSha256Signature:(m,k)=>[...crypto.createHmac('sha256',k).update(m,'utf8').digest()],
   computeDigest:(alg,m)=>[...crypto.createHash('sha256').update(String(m),'utf8').digest()],
   formatDate:()=>'15/11/2026',getUuid:()=>crypto.randomUUID()},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:textOutput},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},
  AndroidOwnerMobileApi:{handle:()=>textOutput(JSON.stringify({ok:true,android:true}))}};
 vm.createContext(context);
 // Apps Script loads every .gs file into one global scope.
 vm.runInContext(SOURCES.accounting,context);
 if(withCancel)vm.runInContext(SOURCES.cancel,context);
 if(withExt)vm.runInContext(SOURCES.ext,context);
 vm.runInContext(hooked?SOURCES.botApiHooked:SOURCES.botApiOriginal,context);
 function send(keyId,action,payload={},mutate){
  const body={keyId,timestamp:Date.now(),nonce:crypto.randomUUID(),action,payload};
  body.signature=crypto.createHmac('sha256',clients[keyId]?.secret||'x'.repeat(40))
   .update([body.keyId,body.timestamp,body.nonce,body.action,JSON.stringify(payload)].join('\n')).digest('hex');
  const e={postData:{contents:''}};if(mutate)mutate(body,e);e.postData.contents=JSON.stringify(body);
  return JSON.parse(String(context.doPost(e)));
 }
 return {send,props,get raw(){return raw},get state(){return JSON.parse(raw)},get backups(){return backups},get writes(){return writes},
  rows(){return JSON.parse(JSON.parse(raw).values.satori_orders_v15)}};
}
const cancelPayload={expectedRevision:7,requestId:'grok-cancel-req-501',invoiceNo:501,id:2001,
 expectedName:'Khách Thử Hủy',expectedTotal:150000,confirmed:true,reason:'Khách đổi ý không lấy hàng',actor:'owner-v2'};
let passed=0;
function test(name,fn){fn();console.log('PASS '+name);passed++;}
function unchanged(h,before){assert.equal(h.raw,before);assert.equal(h.writes,0);assert.equal(h.backups.length,0);}
function existingTraffic(h){
 const out=[];
 out.push(h.send('writer','system.status'));
 out.push(h.send('reader','orders.list',{query:'Khách',limit:10}));
 out.push(h.send('writer','trash.list',{query:'601'}));
 out.push(h.send('reader','debt.summary',{}));
 out.push(h.send('reader','orders.auditHistory',{invoiceNo:501,id:'2001'}));
 out.push(h.send('chatgpt','orders.get',{invoiceNo:501,id:'2001'}));
 out.push(h.send('legacy','orders.auditHistory',{invoiceNo:501,id:'2001'}));
 out.push(h.send('legacy','orders.delete',{expectedRevision:7,requestId:'legacy-delete-503',invoiceNo:503,id:2003,
  expectedName:'Khách Không Lịch Sử',expectedTotal:10000,confirmed:true}));
 out.push(h.send('reader','orders.delete',{}));
 out.push(h.send('reader','orders.previewUpdate',{invoiceNo:501,confirmed:true}));
 out.push(h.send('writer','nope.action',{}));
 out.push(h.send('writer','orders.cancel',cancelPayload));
 return out;
}
function normalize(out){return JSON.stringify(out).replace(/"(deletedAt|expiresAt|updatedAt)":\d+/g,'"$1":0');}

/* ---------- the add-on never changes existing production behaviour ---------- */
test('production traffic: identical responses + ledger, ORIGINAL production vs hooked with add-on installed but switches OFF',()=>{
 const a=harness({hooked:false,withExt:false,withCancel:false,flags:{}}),b=harness({flags:{}});
 const ra=existingTraffic(a),rb=existingTraffic(b);
 assert.equal(normalize(rb),normalize(ra));
 assert.deepEqual(b.rows(),a.rows());assert.equal(b.writes,a.writes);assert.equal(a.writes,1);
 // Production behaviour confirmed by the same run:
 assert.equal(ra[4].ok,true,'production auditHistory already works with role owner');
 assert.deepEqual(ra[4].data.entries,EDIT_AUDIT);
 assert.equal(ra[6].error.code,'FORBIDDEN','production auditHistory requires owner/admin role');
 assert.equal(ra[9].error.code,'FORBIDDEN','read key without orders:update cannot preview');
 assert.equal(ra[11].error.code,'INVALID_ACTION','production has no orders.cancel today');
});
test('with cancel switch ON, every existing action still answers exactly like production',()=>{
 const a=harness({hooked:false,withExt:false,withCancel:false,flags:{}}),b=harness();
 const ra=existingTraffic(a).slice(0,11),rb=existingTraffic(b).slice(0,11);
 assert.equal(normalize(rb),normalize(ra));
});
test('add-on not installed but hook line present: production unchanged (typeof guard)',()=>{
 const a=harness({hooked:false,withExt:false,flags:{}}),b=harness({withExt:false});
 assert.equal(normalize(existingTraffic(b)),normalize(existingTraffic(a)));
});
test('Android ?route=android still goes to AndroidOwnerMobileApi, never to the add-on',()=>{
 const h=harness(),before=h.raw;
 const r=h.send('writer','orders.cancel',cancelPayload,(b,e)=>{e.parameter={route:'android'}});
 assert.deepEqual(r,{ok:true,android:true});unchanged(h,before);
});

/* ---------- orders.cancel ---------- */
test('cancel ON + writer key with orders:cancel: status Đã hủy, row kept, original total kept, audit appended, verified backup',()=>{
 const h=harness(),before=h.raw;
 const r=h.send('writer','orders.cancel',cancelPayload);
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(r.revision,8);assert.equal(r.backupCreated,true);assert.equal(h.backups[0],before);assert.equal(h.writes,1);
 assert.deepEqual({cancelled:r.data.cancelled,duplicate:r.data.duplicate,invoiceNo:r.data.invoiceNo,status:r.data.status},
  {cancelled:true,duplicate:false,invoiceNo:501,status:'Đã hủy'});
 const rows=h.rows(),row=rows.find(o=>o.invoiceNo===501);
 assert.equal(rows.length,3,'cancel never deletes a row');
 assert.equal(row.status,'Đã hủy');assert.equal(row.total,150000);assert.equal(row.statusBeforeCancel,'Chưa thanh toán');
 assert.equal(row.cancelledBy,'hmac:writer');
 const log=JSON.parse(h.state.values.satori_order_cancel_audit_v1);
 assert.equal(log.length,1);assert.equal(log[0].actor,'hmac:writer');assert.equal(log[0].source,'owner-v2');assert.equal(log[0].effectiveTotal,0);
 const old=JSON.parse(JSON.parse(before).values.satori_orders_v15);
 assert.deepEqual(rows.filter(o=>o.invoiceNo!==501),old.filter(o=>o.invoiceNo!==501));
 assert.equal(h.state.values.satori_order_edit_audit_v1,JSON.stringify(EDIT_AUDIT),'edit log untouched');
});
test('cancelled invoice drops out of production debt.summary (0 đ) but stays in orders.list',()=>{
 const h=harness();
 const before=h.send('reader','debt.summary',{});
 assert.equal(h.send('writer','orders.cancel',cancelPayload).ok,true);
 const after=h.send('reader','debt.summary',{});
 assert.equal(before.data.due-after.data.due,150000);
 const list=h.send('reader','orders.list',{query:'Hủy'});
 assert.equal(list.data.orders.find(o=>o.invoiceNo===501).status,'Đã hủy');
});
test('repeated confirm with the same requestId is idempotent: duplicate:true, no second write',()=>{
 const h=harness();
 assert.equal(h.send('writer','orders.cancel',cancelPayload).ok,true);
 const r=h.send('writer','orders.cancel',cancelPayload);
 assert.equal(r.data.duplicate,true);assert.equal(h.writes,1);assert.equal(h.backups.length,1);
});
test('replay protection is shared with production (same nonce cannot be used twice)',()=>{
 const h=harness();let saved;
 assert.equal(h.send('writer','orders.cancel',cancelPayload,b=>{saved={...b}}).ok,true);
 assert.equal(h.send('writer','orders.cancel',cancelPayload,b=>{Object.assign(b,saved)}).error.code,'REPLAYED');
 assert.equal(h.writes,1);
});
for(const [name,client,payload,code,opts] of [
 ['legacy writer key WITHOUT orders:cancel','legacy',cancelPayload,'FORBIDDEN'],
 ['V2 read key (orders:read+debt:read+owner)','reader',cancelPayload,'FORBIDDEN'],
 ['ChatGPT admin key with orders:update','chatgpt',cancelPayload,'FORBIDDEN'],
 ['bad signature','writer',cancelPayload,'AUTH_FAILED',{badSig:true}],
 ['stale revision','writer',{...cancelPayload,expectedRevision:6},'REVISION_CONFLICT'],
 ['missing confirmation','writer',{...cancelPayload,confirmed:false},'CONFIRMATION_REQUIRED'],
 ['missing reason','writer',{...cancelPayload,reason:''},'REASON_REQUIRED'],
 ['customer-paid invoice','writer',{...cancelPayload,requestId:'grok-cancel-req-502',invoiceNo:502,id:2002,expectedName:'Khách Đã Trả',expectedTotal:90000},'PAID_ORDER_PROTECTED'],
 ['name or total changed','writer',{...cancelPayload,expectedTotal:1},'ORDER_CHANGED']
])test('cancel refused: '+name,()=>{
 const h=harness(),before=h.raw;
 const r=h.send(client,'orders.cancel',payload,opts?.badSig?b=>{b.signature='0'.repeat(64)}:undefined);
 assert.equal(r.ok,false);assert.equal(r.error.code,code);unchanged(h,before);
});
test('cancel ON but BotApiOrderCancel.gs missing: CONFIG_MISSING, nothing written',()=>{
 const h=harness({withCancel:false}),before=h.raw;
 assert.equal(h.send('writer','orders.cancel',cancelPayload).error.code,'CONFIG_MISSING');unchanged(h,before);
});
for(const v of [null,'0','true'])test('cancel switch '+JSON.stringify(v)+' => production answer INVALID_ACTION, nothing written',()=>{
 const h=harness({flags:v==null?{}:{SATORI_GROK_LEDGER_ENABLED:v}}),before=h.raw;
 assert.equal(h.send('writer','orders.cancel',cancelPayload).error.code,'INVALID_ACTION');unchanged(h,before);
});

/* ---------- orders.auditHistory: production answer + optional cancel rows ---------- */
test('merge OFF: auditHistory is exactly production (edit log only), even after a cancel',()=>{
 const h=harness();
 assert.equal(h.send('writer','orders.cancel',cancelPayload).ok,true);
 const r=h.send('reader','orders.auditHistory',{invoiceNo:501,id:'2001'});
 assert.equal(r.ok,true);assert.deepEqual(r.data.entries,EDIT_AUDIT);assert.equal(r.data.cancelEntriesMerged,undefined);
});
test('merge ON: production edit entries unchanged + cancel row appended in time order, read-only',()=>{
 const h=harness({flags:{SATORI_GROK_LEDGER_ENABLED:'1',SATORI_GROK_AUDIT_CANCEL_MERGE:'1'}});
 assert.equal(h.send('writer','orders.cancel',cancelPayload).ok,true);
 const before=h.raw,writes=h.writes,backups=h.backups.length;
 const r=h.send('reader','orders.auditHistory',{invoiceNo:501,id:'2001'});
 assert.equal(r.ok,true);assert.equal(h.raw,before);assert.equal(h.writes,writes);assert.equal(h.backups.length,backups);
 assert.equal(r.data.cancelEntriesMerged,1);assert.equal(r.data.entries.length,2);
 assert.deepEqual(r.data.entries[0],EDIT_AUDIT[0],'production entry byte-identical and first (older)');
 const c=r.data.entries[1];
 assert.deepEqual({kind:c.kind,auditSource:c.auditSource,source:c.source,requestId:c.requestId,actor:c.actor,reason:c.reason,previousStatus:c.previousStatus},
  {kind:'cancel',auditSource:'satori_order_cancel_audit_v1',source:'owner-v2',requestId:'grok-cancel-req-501',actor:'hmac:writer',reason:'Khách đổi ý không lấy hàng',previousStatus:'Chưa thanh toán'});
 assert.equal(c.timestamp,c.at);
});
test('merge ON never fabricates: invoice without cancel rows gets the production answer unchanged',()=>{
 const off=harness(),on=harness({flags:{SATORI_GROK_AUDIT_CANCEL_MERGE:'1'}});
 assert.deepEqual(on.send('reader','orders.auditHistory',{invoiceNo:503,id:'2003'}),off.send('reader','orders.auditHistory',{invoiceNo:503,id:'2003'}));
});
test('merge ON keeps production security: legacy key without role still FORBIDDEN, no cancel data leaked',()=>{
 const h=harness({flags:{SATORI_GROK_LEDGER_ENABLED:'1',SATORI_GROK_AUDIT_CANCEL_MERGE:'1'}});
 assert.equal(h.send('writer','orders.cancel',cancelPayload).ok,true);
 const r=h.send('legacy','orders.auditHistory',{invoiceNo:501,id:'2001'});
 assert.equal(r.ok,false);assert.equal(r.error.code,'FORBIDDEN');assert.ok(!JSON.stringify(r).includes('grok-cancel-req-501'));
});
test('merge ON with a broken cancel log returns the production answer unchanged',()=>{
 const off=harness(),on=harness({flags:{SATORI_GROK_AUDIT_CANCEL_MERGE:'1'},extraValues:{satori_order_cancel_audit_v1:'{broken'}});
 assert.deepEqual(on.send('reader','orders.auditHistory',{invoiceNo:501,id:'2001'}),off.send('reader','orders.auditHistory',{invoiceNo:501,id:'2001'}));
});

/* ---------- GrokLedgerScopesSetup.gs (one-time scope grant helper) ---------- */
function scopesHarness(clients,{writer='writer',reader='reader'}={}){
 const props={SATORI_BOT_CLIENTS_JSON:JSON.stringify(clients)},logs=[];
 const ctx={console:{log:m=>logs.push(String(m))},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=v},deleteProperty:k=>{delete props[k]}})}};
 vm.createContext(ctx);vm.runInContext(SOURCES.scopes,ctx);
 vm.runInContext('SATORI_GROK_WRITER_KEY_ID='+JSON.stringify(writer)+';SATORI_GROK_READER_KEY_ID='+JSON.stringify(reader),ctx);
 return {ctx,props,logs,clients:()=>JSON.parse(props.SATORI_BOT_CLIENTS_JSON)};
}
const PRE={writer:{enabled:true,secret:SECRET.writer,scopes:['orders:read','orders:write']},
 reader:{enabled:true,secret:SECRET.reader,scopes:['orders:read','catalogue:read']},
 legacy:{enabled:true,secret:SECRET.legacy,scopes:['orders:read']}};
test('scope helper: writer +orders:cancel +orders:delete, reader +debt:read +role owner, secrets untouched, none logged, exact rollback',()=>{
 const h=scopesHarness(PRE),original=h.props.SATORI_BOT_CLIENTS_JSON;
 assert.equal(h.ctx.satoriGrokScopesApply(),'APPLY_DONE_BACKUP_IN_SATORI_BOT_CLIENTS_JSON_BACKUP_GROK_20261115');
 const c=h.clients();
 assert.deepEqual(c.writer.scopes,['orders:read','orders:write','orders:cancel','orders:delete']);
 assert.deepEqual(c.reader.scopes,['orders:read','catalogue:read','debt:read']);assert.equal(c.reader.role,'owner');
 assert.equal(c.writer.role,undefined);assert.ok(!c.reader.scopes.includes('orders:update'));assert.deepEqual(c.legacy,PRE.legacy);
 for(const id of Object.keys(PRE))assert.equal(c[id].secret,PRE[id].secret);
 assert.ok(h.logs.every(l=>!Object.values(SECRET).some(sec=>l.includes(sec))),'secret leaked to log');
 assert.throws(()=>h.ctx.satoriGrokScopesApply(),/BACKUP_ALREADY_EXISTS/);
 assert.equal(h.ctx.satoriGrokScopesRollback(),'ROLLBACK_DONE_BACKUP_KEPT');assert.equal(h.props.SATORI_BOT_CLIENTS_JSON,original);
 assert.equal(h.ctx.satoriGrokScopesClearBackup(),'BACKUP_CLEARED');
});
for(const [name,clients,ids,re] of [
 ['key IDs not filled',PRE,{writer:'',reader:''},/FILL_WRITER_AND_READER_KEY_IDS_FIRST/],
 ['same key for writer and reader',PRE,{writer:'writer',reader:'writer'},/WRITER_AND_READER_MUST_BE_DIFFERENT/],
 ['unknown key ID',PRE,{writer:'writer',reader:'nope'},/KEY_NOT_FOUND_OR_INVALID/],
 ['reader already holds orders:update',{...PRE,reader:{...PRE.reader,scopes:['orders:read','orders:update']}},{},/READER_KEY_ALREADY_HAS_WRITE_SCOPE_STOP/]
])test('scope helper refuses and changes nothing: '+name,()=>{
 const h=scopesHarness(clients,ids),before=h.props.SATORI_BOT_CLIENTS_JSON;
 assert.throws(()=>h.ctx.satoriGrokScopesApply(),re);
 assert.equal(h.props.SATORI_BOT_CLIENTS_JSON,before);assert.equal(h.props.SATORI_BOT_CLIENTS_JSON_BACKUP_GROK_20261115,undefined);
});
console.log(passed+' PASS, 0 FAIL');
