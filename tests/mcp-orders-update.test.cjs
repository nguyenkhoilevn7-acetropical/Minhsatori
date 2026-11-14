// Synthetic ledger only. No network, real customer records or production writes.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function harness(){
 const original={id:901,invoiceNo:9001,name:'Synthetic Customer',phone:'0900000000',location:'123 Test Street',date:'13/11/2026',status:'Chưa thanh toán',customerPaidAt:null,satoriPaidAt:null,paymentAudit:[],total:108000,vatAmount:8000,shippingAmount:0,items:[{code:'TEST-01',product:'Synthetic Water',qty:1,unitPrice:100000,listPrice:100000}]};
 let state={revision:200,values:{satori_orders_v15:JSON.stringify([original,{...original,id:902,invoiceNo:9002,name:'Other Synthetic Customer'}]),satori_trash_bin_v15:'[]'}};
 let seq=0,writes=0,backups=0,role='owner',scopes=['orders:read','orders:update'],badBackup=false;
 const secret='FAKE_TEST_SECRET_01234567890123456789012345',cache=new Map();
 const ctx={console,Date,JSON,Math,Number,String,Object,Array,RegExp,Error,
 readState_:()=>structuredClone(state),
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='STATE_FILE_ID'?'fake-file':JSON.stringify({fixture:{secret,role,scopes}})})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this}})},
 Utilities:{Charset:{UTF_8:'UTF_8'},DigestAlgorithm:{SHA_256:'SHA_256'},getUuid:()=>`fixture-${++seq}`,formatDate:()=> '13/11/2026',
 computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],
 computeHmacSha256Signature:(s,k)=>[...crypto.createHmac('sha256',k).update(s).digest()]},
 DriveApp:{getFileById:()=>({makeCopy:()=>{backups++;return {getId:()=> 'backup-fixture',getBlob:()=>({getDataAsString:()=>badBackup?'{}':JSON.stringify(state)})}},setContent:s=>{writes++;state=JSON.parse(s)}})}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(process.env.SATORI_TEST_BOT_SOURCE||__dirname+'/../api/BotApi.gs','utf8'),ctx);
 function call(action,payload={}){const r={keyId:'fixture',timestamp:Date.now(),nonce:'synthetic_nonce_'+String(++seq).padStart(20,'0'),action,payload};r.signature=crypto.createHmac('sha256',secret).update([r.keyId,r.timestamp,r.nonce,action,JSON.stringify(payload)].join('\n')).digest('hex');return JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(r)}}).text);}
 function mobile(action,payload){try{return {ok:true,...ctx.SatoriBotApi.ownerMobileWrite(action,payload,'synthetic_mobile_nonce_'+String(++seq).padStart(20,'0'))}}catch(e){return {ok:false,error:{code:e.code}}}}
 return {call,mobile,rows:()=>JSON.parse(state.values.satori_orders_v15),counts:()=>[writes,backups,state.revision],state:()=>structuredClone(state),role:v=>role=v,scopes:v=>scopes=v,badBackup:()=>badBackup=true,seed:rows=>{state.values.satori_orders_v15=JSON.stringify(rows)}};
}
function input(extra={}){return {id:901,invoiceNo:9001,expectedRevision:200,expectedName:'Synthetic Customer',expectedTotal:108000,requestId:'synthetic-edit-0001',confirmed:true,reason:'Owner requested synthetic correction',order:{name:'Synthetic Customer',phone:'0900000000',location:'123 Test Street',items:[{code:'TEST-01',product:'Synthetic Water',qty:20,unitPrice:74000,listPrice:98000}],priceMode:'inclusive',vatRate:8,shippingAmount:0},...extra};}
test('ported live HMAC edit cannot add or increase retired 20L quantities', {skip:!process.env.SATORI_TEST_BOT_SOURCE},()=>{
 for(const product of ['Satori 20L','Satori 20-lít']){
  const h=harness(),p=input();p.order.items=[{product,qty:1,unitPrice:74000}];
  const result=h.call('orders.update',p);
  assert.equal(result.error?.code,'PRODUCT_DISCONTINUED',JSON.stringify(result));
  assert.deepEqual(h.counts(),[0,0,200]);
 }
 const h=harness(),rows=h.rows();rows[0].items=[{product:'Satori 20L',qty:1,unitPrice:100000}];h.seed(rows);
 const p=input();p.order.items=[{product:'Satori 20L',qty:2,unitPrice:100000}];
 assert.equal(h.call('orders.update',p).error?.code,'PRODUCT_DISCONTINUED');assert.deepEqual(h.counts(),[0,0,200]);
});
test('exact get and preview return canonical identity and correct inclusive VAT without a write',()=>{
 const h=harness();assert.equal(h.call('orders.get',{invoiceNo:9001}).data.order.id,901);
 const other=JSON.stringify(h.rows()[1]);const r=h.call('orders.previewUpdate',input());assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(r.data.order.total,1480000);assert.equal(r.data.order.vatAmount,109630);
 assert.equal(r.data.order.goodsTotal,1370370);assert.equal(r.data.order.vatMode,'invoice');
 assert.equal(r.data.order.items[0].unitPrice*20,1370370,'stored unit extension agrees with rounded invoice net');
 assert.equal(r.data.order.items[0].listPrice,98000,'catalogue cost/list basis remains pre-VAT and unchanged');
 assert.deepEqual(h.counts(),[0,0,200]);assert.equal(JSON.stringify(h.rows()[1]),other);
});
test('update backs up, preserves payment and identity, saves before/after, retries exactly once',()=>{
 const h=harness(),before=h.rows(),p=input(),r=h.call('orders.update',p);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.backupCreated,true);
 assert.deepEqual(h.counts(),[1,1,201]);assert.deepEqual(h.rows()[1],before[1]);
 for(const k of ['id','invoiceNo','date','status','customerPaidAt','satoriPaidAt','paymentAudit'])assert.deepEqual(h.rows()[0][k],before[0][k]);
 assert.equal(h.call('orders.update',p).data.duplicate,true);assert.deepEqual(h.counts(),[1,1,201]);
 assert.equal(h.call('orders.update',{...p,order:{...p.order,shippingAmount:1000}}).error.code,'REUSED_REQUEST_ID');
 const audit=h.call('orders.auditHistory',{invoiceNo:9001,id:901});assert.equal(audit.ok,true,JSON.stringify(audit));
 assert.equal(audit.data.entries.length,1);const a=audit.data.entries[0];assert.deepEqual(a.before,before[0]);assert.deepEqual(a.after,h.rows()[0]);assert.equal(a.actor,'hmac:fixture');assert.equal(a.reason,p.reason);
});
test('owner/admin role and dedicated edit scope required; payload role cannot grant permissions',()=>{
 for(const role of ['player','',null]){const h=harness();h.role(role);const r=h.call('orders.update',{...input(),role:'owner'});assert.equal(r.error.code,'FORBIDDEN');assert.deepEqual(h.counts(),[0,0,200]);}
 const h=harness();h.scopes(['orders:read','orders:write']);assert.equal(h.call('orders.update',input()).error.code,'FORBIDDEN');
 const a=harness();a.role('admin');assert.equal(a.call('orders.update',input()).ok,true);
});
test('conflicts, wrong identity, paid invoices and backup corruption fail before commit',()=>{
 for(const [patch,code] of [[{expectedRevision:199},'REVISION_CONFLICT'],[{id:999},'INVALID_ORDER'],[{expectedTotal:1},'ORDER_CHANGED'],[{confirmed:false},'CONFIRMATION_REQUIRED']]){const h=harness();assert.equal(h.call('orders.update',input(patch)).error.code,code);assert.deepEqual(h.counts(),[0,0,200]);}
 const h=harness(),rows=h.rows();rows[0].customerPaidAt='2026-11-13T00:00:00Z';h.seed(rows);assert.equal(h.call('orders.update',input()).error.code,'PAID_ORDER_PROTECTED');assert.deepEqual(h.counts(),[0,0,200]);
 const b=harness();b.badBackup();assert.equal(b.call('orders.update',input()).error.code,'BACKUP_FAILED');assert.equal(b.counts()[0],0);
});
test('exclusive and mixed line VAT compute once; 0% and invalid amounts/rates',()=>{
 const p=input();for(const rate of [0,8]){const h=harness();const r=h.call('orders.previewUpdate',{...p,order:{...p.order,priceMode:'exclusive',vatRate:rate,items:[{product:'Fake Water',qty:3,unitPrice:10001}]}});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.order.total,30003+Math.round(30003*rate/100));}
 const h=harness();const r=h.call('orders.previewUpdate',{...p,order:{...p.order,vatMode:'per_line',items:[{product:'Fake Water',qty:20,unitPrice:74000,vatRate:8},{product:'Deposit',qty:1,unitPrice:5000,vatExempt:true}]}});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.order.total,1485000);assert.equal(r.data.order.vatAmount,109630);assert.equal(r.data.order.items[1].vatRate,0);
 for(const order of [{...p.order,vatRate:5.5},{...p.order,vatRate:101},{...p.order,total:1},{...p.order,vatMode:'invoice',items:[{product:'Fake Water',qty:1,unitPrice:100,vatRate:5}]}])assert.equal(h.call('orders.previewUpdate',{...p,order}).ok,false);
});
test('guarded undo restores only the target with a new revision, history and idempotent retry',()=>{
 const h=harness(),before=h.rows();assert.equal(h.call('orders.update',input()).ok,true);
 const undo={...input(),expectedRevision:201,expectedTotal:1480000,requestId:'synthetic-undo-0001',undoRequestId:'synthetic-edit-0001'};delete undo.order;
 const r=h.call('orders.undoUpdate',undo);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.order.total,108000);assert.deepEqual(h.rows()[1],before[1]);assert.deepEqual(h.counts(),[2,2,202]);assert.equal(h.call('orders.undoUpdate',undo).data.duplicate,true);
 const entries=h.call('orders.auditHistory',{invoiceNo:9001,id:901}).data.entries;assert.equal(entries.length,2);assert.equal(entries[1].undoOf,'synthetic-edit-0001');
});
test('edit and undo requestIds cannot reuse creation or payment requestIds of another bill',()=>{
 const h=harness(),rows=h.rows();rows[1].paymentAudit=[{requestId:'synthetic-edit-0001'}];h.seed(rows);
 assert.equal(h.call('orders.update',input()).error.code,'REUSED_REQUEST_ID');assert.deepEqual(h.counts(),[0,0,200]);
 const u=harness(),other=u.rows();other[1].apiRequestId='synthetic-undo-0001';u.seed(other);assert.equal(u.call('orders.update',input()).ok,true);
 const undo={...input(),expectedRevision:201,expectedTotal:1480000,requestId:'synthetic-undo-0001',undoRequestId:'synthetic-edit-0001'};delete undo.order;
 assert.equal(u.call('orders.undoUpdate',undo).error.code,'REUSED_REQUEST_ID');assert.deepEqual(u.counts(),[1,1,201]);
});
test('omitted optional shipping and delivery note preserve the saved invoice fields',()=>{
 const h=harness(),rows=h.rows();rows[0].shippingAmount=5000;rows[0].deliveryNote='Synthetic morning delivery';rows[0].total=113000;h.seed(rows);
 const p=input({expectedTotal:113000});delete p.order.shippingAmount;
 const r=h.call('orders.previewUpdate',p);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.order.total,1485000);assert.equal(r.data.order.shippingAmount,5000);assert.equal(r.data.order.deliveryNote,rows[0].deliveryNote);
});
test('legacy integer-only mobile payload cannot overwrite fractional MCP prices',()=>{
 const h=harness(),p=input();assert.equal(h.call('orders.update',p).ok,true);
 const saved=h.rows()[0],before=h.state();
 const legacy={...p,expectedRevision:201,expectedTotal:1480000,requestId:'legacy-lossy-0001',order:{...p.order,total:1480000,vatAmount:109630,items:saved.items.map(i=>({...i,unitPrice:Math.trunc(i.unitPrice)}))}};
 delete legacy.order.priceMode;
 assert.equal(h.mobile('orders.update',legacy).error.code,'PRICE_MODE_REQUIRED');
 assert.deepEqual(h.state(),before);assert.deepEqual(h.counts(),[1,1,201]);
 assert.equal(h.call('orders.update',p).data.duplicate,true,'original retry still succeeds');
});
