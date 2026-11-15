// Offline fake-ledger tests: orders.cancel (BotApiOrderCancel.gs) and
// orders.auditHistory (BotApiOrderAuditHistory.gs) through the signed BotApi.gs.
// No network, no real secrets, no real data. Run: node tests/bot-api-cancel-audit.cjs
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const dir=__dirname+'/../api/';
const SOURCES={botApi:fs.readFileSync(dir+'BotApi.gs','utf8'),cancel:fs.readFileSync(dir+'BotApiOrderCancel.gs','utf8'),
 audit:fs.readFileSync(dir+'BotApiOrderAuditHistory.gs','utf8')};
const SECRET={writer:'fake-writer-secret-0123456789abcdefghij',reader:'fake-reader-secret-0123456789abcdefghij',
 legacy:'fake-legacy-secret-0123456789abcdefghij'};
const DEFAULT_CLIENTS={
 writer:{secret:SECRET.writer,scopes:['orders:read','orders:write','orders:cancel','orders:delete']},
 reader:{secret:SECRET.reader,scopes:['orders:read','debt:read'],role:'owner'},
 legacy:{secret:SECRET.legacy,scopes:['orders:read','orders:write','orders:delete']}};
function orders(){return [
 {id:2001,invoiceNo:501,name:'Khách Thử Hủy',phone:'0900000001',location:'Địa chỉ thử 1',total:150000,status:'Chưa thanh toán',
  date:'14/11/2026',timestamp:Date.parse('2026-11-14T02:00:00Z'),source:'bot_api',apiRequestId:'create-req-501',items:[{product:'Nước thử',qty:1}],
  paymentAudit:[{requestId:'pay-req-501a',id:2001,invoiceNo:501,action:'payments.markSatoriPaid',recordedAt:'2026-11-14T05:00:00Z',
   reason:'thử đối soát',previousStatus:'Chưa thanh toán',newStatus:'Đã TT Satori'},
   {requestId:'pay-req-501b',id:2001,invoiceNo:501,action:'payments.markSatoriUnpaid',recordedAt:'2026-11-14T06:00:00Z',
   reason:'nhập nhầm',previousStatus:'Đã TT Satori',newStatus:'Chưa thanh toán'}]},
 {id:2002,invoiceNo:502,name:'Khách Đã Trả',total:90000,status:'Đã thanh toán',customerPaidAt:'2026-11-13T00:00:00Z',date:'13/11/2026'},
 {id:2003,invoiceNo:503,name:'Khách Không Lịch Sử',total:10000,status:'Chưa thanh toán'}
];}
function harness({clients=DEFAULT_CLIENTS,withCancel=true,withAudit=true,extraValues={}}={}){
 let raw=JSON.stringify({revision:7,updatedAt:'2026-11-15T00:00:00Z',values:Object.assign({
  satori_orders_v15:JSON.stringify(orders()),
  satori_trash_bin_v15:JSON.stringify([{order:{id:3001,invoiceNo:601,name:'Khách Trong Thùng Rác',total:5000,status:'Chưa thanh toán'},
   deletedAt:Date.now()-86400000,expiresAt:Date.now()+29*86400000,apiDeleteRequestId:'delete-req-601'}]),
  satori_deleted_invoice_nos:'[601]'},extraValues)});
 const backups=[],cache=new Map();let writes=0;
 const props={STATE_FILE_ID:'fake-state-file',SATORI_BOT_CLIENTS_JSON:JSON.stringify(clients)};
 const file={getBlob:()=>({getDataAsString:()=>raw}),
  makeCopy:()=>{const copy=raw;backups.push(copy);return {getId:()=>'backup-'+backups.length,getBlob:()=>({getDataAsString:()=>copy})}},
  setContent:v=>{raw=v;writes++}};
 const context={console,readState_:()=>JSON.parse(raw),
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null})},
  DriveApp:{getFileById:id=>{assert.equal(id,'fake-state-file');return file}},
  Utilities:{Charset:{UTF_8:'utf8'},computeHmacSha256Signature:(m,k)=>[...crypto.createHmac('sha256',k).update(m,'utf8').digest()],
   formatDate:()=>'15/11/2026',getUuid:()=>crypto.randomUUID()},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>s})},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})}};
 vm.createContext(context);
 // Apps Script loads every .gs file into one global scope.
 if(withCancel)vm.runInContext(SOURCES.cancel,context);
 if(withAudit)vm.runInContext(SOURCES.audit,context);
 vm.runInContext(SOURCES.botApi,context);
 function send(keyId,action,payload={}){
  const body={keyId,timestamp:Date.now(),nonce:crypto.randomUUID(),action,payload};
  body.signature=crypto.createHmac('sha256',clients[keyId]?.secret||'x'.repeat(40))
   .update([body.keyId,body.timestamp,body.nonce,body.action,JSON.stringify(payload)].join('\n')).digest('hex');
  return JSON.parse(context.doPost({postData:{contents:JSON.stringify(body)}}));
 }
 return {send,get raw(){return raw},get state(){return JSON.parse(raw)},get backups(){return backups},get writes(){return writes},
  rows(){return JSON.parse(JSON.parse(raw).values.satori_orders_v15)}};
}
const cancelPayload={expectedRevision:7,requestId:'grok-cancel-req-501',invoiceNo:501,id:2001,
 expectedName:'Khách Thử Hủy',expectedTotal:150000,confirmed:true,reason:'Khách đổi ý không lấy hàng',actor:'owner-v2'};
let passed=0;
function test(name,fn){fn();console.log('PASS '+name);passed++;}
function unchanged(h,before){assert.equal(h.raw,before);assert.equal(h.writes,0);assert.equal(h.backups.length,0);}

/* ---------- orders.cancel ---------- */
test('writer key with orders:cancel: status Đã hủy, row kept, original total kept, audit appended, verified backup',()=>{
 const h=harness(),before=h.raw;
 const r=h.send('writer','orders.cancel',cancelPayload);
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(r.revision,8);assert.equal(r.backupCreated,true);
 assert.equal(h.backups[0],before);assert.equal(h.writes,1);
 assert.deepEqual({cancelled:r.data.cancelled,duplicate:r.data.duplicate,invoiceNo:r.data.invoiceNo,status:r.data.status},
  {cancelled:true,duplicate:false,invoiceNo:501,status:'Đã hủy'});
 const rows=h.rows(),row=rows.find(o=>o.invoiceNo===501);
 assert.equal(rows.length,3,'cancel never deletes a row');
 assert.equal(row.status,'Đã hủy');assert.equal(row.total,150000);assert.equal(row.statusBeforeCancel,'Chưa thanh toán');
 assert.equal(row.cancelledBy,'botapi:writer');assert.equal(row.apiCancelRequestId,'grok-cancel-req-501');
 const log=JSON.parse(h.state.values.satori_order_cancel_audit_v1);
 assert.equal(log.length,1);
 assert.deepEqual({requestId:log[0].requestId,invoiceNo:log[0].invoiceNo,actor:log[0].actor,source:log[0].source,
  originalTotal:log[0].originalTotal,effectiveTotal:log[0].effectiveTotal},
  {requestId:'grok-cancel-req-501',invoiceNo:501,actor:'botapi:writer',source:'owner-v2',originalTotal:150000,effectiveTotal:0});
 // Untouched rows stay byte-identical.
 const old=JSON.parse(JSON.parse(before).values.satori_orders_v15);
 assert.deepEqual(rows.filter(o=>o.invoiceNo!==501),old.filter(o=>o.invoiceNo!==501));
});
test('repeated confirm with the same requestId is idempotent: duplicate:true, no second write or backup',()=>{
 const h=harness();
 assert.equal(h.send('writer','orders.cancel',cancelPayload).ok,true);
 const r=h.send('writer','orders.cancel',cancelPayload);
 assert.equal(r.ok,true);assert.equal(r.data.duplicate,true);assert.equal(h.writes,1);assert.equal(h.backups.length,1);
});
for(const [name,client,payload,code] of [
 ['legacy writer key WITHOUT orders:cancel is refused','legacy',cancelPayload,'FORBIDDEN'],
 ['V2 read key (orders:read+debt:read+owner role) cannot cancel','reader',cancelPayload,'FORBIDDEN'],
 ['stale revision','writer',{...cancelPayload,expectedRevision:6},'REVISION_CONFLICT'],
 ['missing confirmation','writer',{...cancelPayload,confirmed:false},'CONFIRMATION_REQUIRED'],
 ['missing reason','writer',{...cancelPayload,reason:''},'REASON_REQUIRED'],
 ['customer-paid invoice protected','writer',{...cancelPayload,requestId:'grok-cancel-req-502',invoiceNo:502,id:2002,expectedName:'Khách Đã Trả',expectedTotal:90000},'PAID_ORDER_PROTECTED'],
 ['name or total changed','writer',{...cancelPayload,expectedTotal:1},'ORDER_CHANGED']
])test('cancel refused: '+name,()=>{
 const h=harness(),before=h.raw;
 const r=h.send(client,'orders.cancel',payload);
 assert.equal(r.ok,false);assert.equal(r.error.code,code);unchanged(h,before);
});
test('cancel without BotApiOrderCancel.gs in the project fails closed with CONFIG_MISSING, nothing written',()=>{
 const h=harness({withCancel:false}),before=h.raw;
 const r=h.send('writer','orders.cancel',cancelPayload);
 assert.equal(r.error.code,'CONFIG_MISSING');unchanged(h,before);
});

/* ---------- orders.auditHistory ---------- */
test('auditHistory (owner read key): created + payment history + cancel log, oldest -> newest, read-only',()=>{
 const h=harness();
 assert.equal(h.send('writer','orders.cancel',cancelPayload).ok,true);
 const before=h.raw,backups=h.backups.length,writes=h.writes;
 const r=h.send('reader','orders.auditHistory',{invoiceNo:501,id:'2001'});
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(h.raw,before);assert.equal(h.backups.length,backups);assert.equal(h.writes,writes);assert.equal(r.backupCreated,false);
 assert.equal(r.data.readOnly,true);assert.equal(r.data.status,'Đã hủy');assert.equal(r.data.location,'live');
 assert.deepEqual(r.data.entries.map(e=>e.kind),['created','payments.markSatoriPaid','payments.markSatoriUnpaid','cancelled']);
 assert.deepEqual(r.data.entries.map(e=>e.source),['invoice_row','invoice_row.paymentAudit','invoice_row.paymentAudit','satori_order_cancel_audit_v1']);
 const c=r.data.entries[3];
 assert.deepEqual({requestId:c.requestId,actor:c.actor,reason:c.reason,previousStatus:c.previousStatus,newStatus:c.newStatus},
  {requestId:'grok-cancel-req-501',actor:'botapi:writer',reason:'Khách đổi ý không lấy hàng',previousStatus:'Chưa thanh toán',newStatus:'Đã hủy'});
 assert.equal(r.data.entries[0].at,'2026-11-14T02:00:00.000Z');
 assert.deepEqual(r.data.sources,['invoice_row','satori_order_cancel_audit_v1','invoice_row.paymentAudit']);
});
test('auditHistory never fabricates: an invoice with no stored history returns an empty list',()=>{
 const h=harness();
 const r=h.send('reader','orders.auditHistory',{invoiceNo:503,id:'2003'});
 assert.equal(r.ok,true);assert.deepEqual(r.data.entries,[]);assert.equal(r.data.totalEntries,0);
});
test('auditHistory reads other existing satori_*audit* ledger logs by exact id + invoiceNo only',()=>{
 const h=harness({extraValues:{satori_order_edit_audit_v1:JSON.stringify([
  {id:2001,invoiceNo:501,action:'orders.update',at:'2026-11-14T03:00:00Z',reason:'sửa số lượng',requestId:'edit-req-1'},
  {id:9999,invoiceNo:501,action:'orders.update',at:'2026-11-14T03:00:00Z',reason:'khác ID: không được lấy'}])}});
 const r=h.send('reader','orders.auditHistory',{invoiceNo:501,id:'2001'});
 assert.equal(r.ok,true);
 const edits=r.data.entries.filter(e=>e.source==='satori_order_edit_audit_v1');
 assert.equal(edits.length,1);assert.equal(edits[0].kind,'orders.update');assert.equal(edits[0].reason,'sửa số lượng');
 assert.deepEqual(r.data.entries.map(e=>e.kind),['created','orders.update','payments.markSatoriPaid','payments.markSatoriUnpaid']);
});
test('auditHistory for an invoice in the 30-day trash shows the stored deletion',()=>{
 const h=harness();
 const r=h.send('reader','orders.auditHistory',{invoiceNo:601,id:'3001'});
 assert.equal(r.ok,true);assert.equal(r.data.location,'trash');
 assert.equal(r.data.entries.length,1);assert.equal(r.data.entries[0].kind,'deleted_to_trash');
 assert.equal(r.data.entries[0].requestId,'delete-req-601');
});
for(const [name,clients,keyId,payload,code] of [
 ['read key WITHOUT role owner is refused',{...DEFAULT_CLIENTS,reader:{...DEFAULT_CLIENTS.reader,role:undefined}},'reader',{invoiceNo:501,id:'2001'},'FORBIDDEN'],
 ['role "admin" is not owner',{...DEFAULT_CLIENTS,reader:{...DEFAULT_CLIENTS.reader,role:'admin'}},'reader',{invoiceNo:501,id:'2001'},'FORBIDDEN'],
 ['role owner but no orders:read scope',{...DEFAULT_CLIENTS,reader:{...DEFAULT_CLIENTS.reader,scopes:['debt:read']}},'reader',{invoiceNo:501,id:'2001'},'FORBIDDEN'],
 ['writer key has no owner role',DEFAULT_CLIENTS,'writer',{invoiceNo:501,id:'2001'},'FORBIDDEN'],
 ['extra payload field rejected',DEFAULT_CLIENTS,'reader',{invoiceNo:501,id:'2001',query:'x'},'INVALID_REQUEST'],
 ['numeric id rejected (contract sends String(id))',DEFAULT_CLIENTS,'reader',{invoiceNo:501,id:2001},'INVALID_ORDER'],
 ['unknown invoice',DEFAULT_CLIENTS,'reader',{invoiceNo:777,id:'1'},'ORDER_NOT_FOUND'],
 ['id must match invoice exactly',DEFAULT_CLIENTS,'reader',{invoiceNo:501,id:'2002'},'ORDER_NOT_FOUND']
])test('auditHistory refused: '+name,()=>{
 const h=harness({clients}),before=h.raw;
 const r=h.send(keyId,'orders.auditHistory',payload);
 assert.equal(r.ok,false);assert.equal(r.error.code,code);unchanged(h,before);
});
test('auditHistory without BotApiOrderAuditHistory.gs fails closed with CONFIG_MISSING',()=>{
 const h=harness({withAudit:false});
 assert.equal(h.send('reader','orders.auditHistory',{invoiceNo:501,id:'2001'}).error.code,'CONFIG_MISSING');
});

/* ---------- read key stays read-only ---------- */
test('V2 read key cannot delete, and orders.previewUpdate / orders.update are NOT exposed (no orders:update path)',()=>{
 const h=harness(),before=h.raw;
 assert.equal(h.send('reader','orders.delete',{...cancelPayload,requestId:'grok-trash-req-501'}).error.code,'FORBIDDEN');
 assert.equal(h.send('reader','orders.previewUpdate',{invoiceNo:501,confirmed:true}).error.code,'INVALID_ACTION');
 assert.equal(h.send('reader','orders.update',{invoiceNo:501}).error.code,'INVALID_ACTION');
 unchanged(h,before);
});
test('debt:read on the read key still serves debt.summary path (scope gate only; AccountingCore absent here)',()=>{
 const h=harness();
 assert.equal(h.send('reader','debt.summary',{}).error.code,'CONFIG_MISSING');
 assert.equal(h.send('legacy','debt.summary',{}).error.code,'FORBIDDEN');
});

/* ---------- GrokLedgerScopesSetup.gs (one-time scope grant helper) ---------- */
function scopesHarness(clients,{writer='writer',reader='reader'}={}){
 const props={SATORI_BOT_CLIENTS_JSON:JSON.stringify(clients)},logs=[];
 const ctx={console:{log:m=>logs.push(String(m))},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=v},deleteProperty:k=>{delete props[k]}})}};
 vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(dir+'GrokLedgerScopesSetup.gs','utf8'),ctx);
 vm.runInContext('SATORI_GROK_WRITER_KEY_ID='+JSON.stringify(writer)+';SATORI_GROK_READER_KEY_ID='+JSON.stringify(reader),ctx);
 return {ctx,props,logs,clients:()=>JSON.parse(props.SATORI_BOT_CLIENTS_JSON)};
}
const PRE={writer:{enabled:true,secret:SECRET.writer,scopes:['orders:read','orders:write']},
 reader:{enabled:true,secret:SECRET.reader,scopes:['orders:read','catalogue:read']},
 legacy:{enabled:true,secret:SECRET.legacy,scopes:['orders:read']}};
test('scope helper: adds orders:cancel+orders:delete to writer, debt:read+role owner to reader, secrets untouched, no secret logged',()=>{
 const h=scopesHarness(PRE),original=h.props.SATORI_BOT_CLIENTS_JSON;
 assert.equal(h.ctx.satoriGrokScopesApply(),'APPLY_DONE_BACKUP_IN_SATORI_BOT_CLIENTS_JSON_BACKUP_GROK_20261115');
 const c=h.clients();
 assert.deepEqual(c.writer.scopes,['orders:read','orders:write','orders:cancel','orders:delete']);
 assert.deepEqual(c.reader.scopes,['orders:read','catalogue:read','debt:read']);assert.equal(c.reader.role,'owner');
 assert.equal(c.writer.role,undefined);assert.ok(!c.reader.scopes.includes('orders:update'));
 assert.deepEqual(c.legacy,PRE.legacy);
 for(const id of Object.keys(PRE))assert.equal(c[id].secret,PRE[id].secret);
 assert.equal(h.props.SATORI_BOT_CLIENTS_JSON_BACKUP_GROK_20261115,original);
 assert.ok(h.logs.every(l=>!Object.values(SECRET).some(sec=>l.includes(sec))),'secret leaked to log');
 // Second apply refused (backup exists); rollback restores byte-identical original.
 assert.throws(()=>h.ctx.satoriGrokScopesApply(),/BACKUP_ALREADY_EXISTS/);
 assert.equal(h.ctx.satoriGrokScopesRollback(),'ROLLBACK_DONE_BACKUP_KEPT');
 assert.equal(h.props.SATORI_BOT_CLIENTS_JSON,original);
 assert.equal(h.ctx.satoriGrokScopesClearBackup(),'BACKUP_CLEARED');
 assert.equal(h.props.SATORI_BOT_CLIENTS_JSON_BACKUP_GROK_20261115,undefined);
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
test('scope helper check prints secret length only',()=>{
 const h=scopesHarness(PRE);h.ctx.satoriGrokScopesCheck();
 assert.ok(h.logs.some(l=>l.includes('reader')&&l.includes('secretLength=39')));
 assert.ok(h.logs.every(l=>!Object.values(SECRET).some(sec=>l.includes(sec))));
});
console.log(passed+' PASS, 0 FAIL');
