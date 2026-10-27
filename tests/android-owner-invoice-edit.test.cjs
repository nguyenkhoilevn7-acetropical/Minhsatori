// Complete synthetic Google Owner -> Android Mobile API -> Bot API -> Drive write.
// No Google calls, no production invoice, no real secrets or paid services.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const path=require('node:path');
const raw=fs.readFileSync(path.join(__dirname,'../api/BotApi.gs'),'utf8');
const mobile=fs.readFileSync(path.join(__dirname,'../api/AndroidOwnerMobileApi.gs'),'utf8');
const owner='owner@example.test',clientId='1234567890-ownerandroid.apps.googleusercontent.com';
const fileId='14XWSPrxLnKXATwmuHeXGZnCvjDbalghV'; // exact fixture gate expected by API
const props={STATE_FILE_ID:fileId,SATORI_ANDROID_OWNER_EMAIL:owner,
 SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON:JSON.stringify([clientId])};
const start=[
 {id:6001,invoiceNo:9001,name:'Synthetic Customer A',phone:'0901234567',
  location:'123 Synthetic Street',date:'27/10/2026',timestamp:1000,
  status:'Chưa thanh toán',total:20000,shippingAmount:0,vatAmount:0,
  items:[{product:'Satori mock',qty:2,unitPrice:10000,listPrice:10000}]},
 {id:6002,invoiceNo:9001,name:'Synthetic Customer B',phone:'0909999999',
  location:'987 Other Street',date:'27/10/2026',timestamp:1100,
  status:'Chưa thanh toán',total:45000,
  items:[{product:'Satori mock',qty:3,unitPrice:15000,listPrice:15000}]},
 {id:6003,invoiceNo:9002,name:'Synthetic Paid',phone:'0908888888',
  location:'Fake Street',date:'27/10/2026',status:'Đã thanh toán',total:10000,
  items:[{product:'Satori mock',qty:1,unitPrice:10000,listPrice:10000}]},
 {id:6004,invoiceNo:9003,name:'Synthetic CTV',phone:'0907777777',
  location:'Fake Street',date:'27/10/2026',status:'Chưa thanh toán',total:10000,
  pairRole:'customer',pairGroupId:'fakepair001',
  items:[{product:'Satori mock',qty:1,unitPrice:10000,listPrice:10000}]}
];
let data={revision:200,updatedAt:'2026-10-27T00:00:00Z',values:{
 satori_orders_v15:JSON.stringify(start),satori_trash_bin_v15:'[]',
 satori_deleted_invoice_nos:'[]'}},writes=0,backups=0,uid=0;
let currentEmail=owner,currentClient=clientId;
const cache=new Map();
const context={
 Date,JSON,Number,String,Array,Object,Error,Math,Set,Map,RegExp,console,
 OWNER_EMAIL:owner,
 readState_:()=>JSON.parse(JSON.stringify(data)),
 Session:{getEffectiveUser:()=>({getEmail:()=>owner})},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},
 ContentService:{MimeType:{JSON:'json'},createTextOutput(text){return {body:text,setMimeType(){return this}}}},
 Utilities:{Charset:{UTF_8:'UTF_8'},DigestAlgorithm:{SHA_256:'SHA_256'},
  computeDigest:(algo,value,encoding)=>{
   assert.equal(algo,'SHA_256');assert.equal(encoding,'UTF_8');
   return [...crypto.createHash('sha256').update(value,'utf8').digest()];
  },
  getUuid:()=>String(++uid),formatDate:()=> '27/10/2026'},
 DriveApp:{getFileById:(id)=>{
  assert.equal(id,fileId);
  return {makeCopy:()=>{const backup=JSON.stringify(data);backups++;
     return {getId:()=> 'fake-backup-'+backups,
      getBlob:()=>({getDataAsString:()=>backup})};
   },setContent:x=>{data=JSON.parse(x);writes++;}};
 }},
 UrlFetchApp:{fetch:(url,param)=>{
  if(url.startsWith('https://oauth2.googleapis.com/tokeninfo?'))
   return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({
    issued_to:currentClient,scope:'https://www.googleapis.com/auth/userinfo.email',
    expires_in:3600})};
  assert.equal(url,'https://www.googleapis.com/oauth2/v3/userinfo');
  assert.ok(param.headers.Authorization.includes('Bearer FAKE_TEST_'));
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({
   email:currentEmail,email_verified:true,sub:'12345678901234567890'})};
 }}
};
vm.createContext(context);
vm.runInContext(raw,context,{filename:'BotApi.gs'});
vm.runInContext(mobile,context,{filename:'AndroidOwnerMobileApi.gs'});
let nonce=0;
function req(action,payload,token='FAKE_TEST_ACCESS_TOKEN_EXPLICIT'){
 return JSON.parse(context.AndroidOwnerMobileApi.handle({
  postData:{contents:JSON.stringify({kind:'satori-android-v1',action,
   accessToken:token,payload,nonce:'owner_edit_nonce_'+String(++nonce).padStart(12,'0')})}
 }).body);
}
const order=(name='Synthetic Customer A',total=30000)=>({
 name,phone:'0901 234 567',location:'12 Edited Sandbox Avenue',
 items:[{product:'Satori water mock',qty:3,unitPrice:10000,listPrice:12000}],
 shippingAmount:0,vatAmount:0,total,deliveryNote:'FAKE owner edit',
 deliveryDate:''});
const payload=(requestId='synthetic-update-001',id=6001)=>({
 expectedRevision:200,requestId,confirmed:true,
 id,invoiceNo:9001,expectedName:'Synthetic Customer A',expectedTotal:20000,
 order:order()
});
const count=()=>[writes,backups,data.revision];
let snap=req('mobile.snapshot',{});
assert.equal(snap.ok,true);
assert.ok(snap.data.allowedActions.includes('orders.update'));
assert.ok(snap.data.allowedActions.includes('orders.create'));
assert.ok(!('satori_order_edit_audit_v1' in snap.data.values),
 'private edit audit must never be in Android snapshot');
currentEmail='intruder@example.test';
assert.equal(req('orders.update',payload()).error.code,'FORBIDDEN');
currentEmail=owner;currentClient='9999999999-invalid.apps.googleusercontent.com';
assert.equal(req('orders.update',payload()).error.code,'FORBIDDEN');
currentClient=clientId;
props.STATE_FILE_ID='fake-noncanonical-ledger';
assert.equal(req('orders.update',payload()).error.code,'WRONG_LEDGER_SOURCE');
props.STATE_FILE_ID=fileId;
assert.deepEqual(count(),[0,0,200]);

assert.equal(req('orders.update',{...payload(),confirmed:false}).error.code,'CONFIRMATION_REQUIRED');
assert.equal(req('orders.update',{...payload(),id:6002}).error.code,'ORDER_CHANGED');
assert.equal(req('orders.update',{...payload(),expectedRevision:199}).error.code,'REVISION_CONFLICT');
assert.equal(req('orders.update',{...payload(),order:order('Synthetic Customer A',31000)}).error.code,'TOTAL_MISMATCH');
assert.equal(req('orders.update',{...payload(),order:{...order(),items:[]}}).error.code,'INVALID_ORDER');
assert.equal(req('orders.update',{
 ...payload('synthetic-paid-edit-001',6003),invoiceNo:9002,
 expectedName:'Synthetic Paid',expectedTotal:10000
}).error.code,'PAID_ORDER_PROTECTED');
assert.equal(req('orders.update',{
 ...payload('synthetic-ctv-edit-001',6004),invoiceNo:9003,
 expectedName:'Synthetic CTV',expectedTotal:10000
}).error.code,'PAIRED_ORDER_LOCKED');
assert.deepEqual(count(),[0,0,200],'rejected requests must never touch Drive');

const good=payload();
const saved=req('orders.update',good);
assert.equal(saved.ok,true,JSON.stringify(saved.error));
assert.equal(saved.backupCreated,true);
assert.equal(saved.revision,201);
assert.deepEqual(count(),[1,1,201]);
const rows=JSON.parse(data.values.satori_orders_v15);
assert.equal(rows[0].name,'Synthetic Customer A');
assert.equal(rows[0].location,'12 Edited Sandbox Avenue');
assert.equal(rows[0].phone,'0901 234 567');
assert.equal(rows[0].total,30000);
assert.equal(rows[0].invoiceNo,9001);
assert.equal(rows[0].id,6001);
assert.equal(rows[0].status,'Chưa thanh toán');
assert.equal(rows[0].date,'27/10/2026');
assert.equal(rows[0].apiUpdateRequestId,'synthetic-update-001');
assert.equal(rows[1].total,45000,'duplicate invoice number unrelated customer unchanged');
assert.equal(rows[2].status,'Đã thanh toán','paid customer unchanged');
const audit=JSON.parse(data.values.satori_order_edit_audit_v1);
assert.equal(audit.length,1);
assert.equal(audit[0].beforeTotal,20000);assert.equal(audit[0].afterTotal,30000);
assert.equal(audit[0].actor,'verified_owner_android');
assert.ok(!JSON.stringify(audit).includes('0901 234 567'),
 'minimal audit excludes phone');
const again=req('orders.update',good);
assert.equal(again.ok,true);assert.equal(again.data.duplicate,true);
assert.deepEqual(count(),[1,1,201],'exact replay creates no second backup/write');
assert.equal(req('orders.update',{...good,order:{...good.order,phone:'0900000000'}}).error.code,'REUSED_REQUEST_ID');
assert.equal(req('orders.update',{...good,requestId:'synthetic-update-002'}).error.code,'REVISION_CONFLICT');
assert.deepEqual(count(),[1,1,201]);
const snapshot=req('mobile.snapshot',{});
const after=JSON.parse(snapshot.data.values.satori_orders_v15);
assert.equal(after[0].apiUpdateRequestId,good.requestId,
 'Android pending outbox can safely reconcile by request ID');
assert.equal(snapshot.data.revision,201);
assert.ok(!('satori_order_edit_audit_v1' in snapshot.data.values));

assert.equal(req('orders.rename',good).error.code,'INVALID_ACTION');
assert.deepEqual(count(),[1,1,201]);
console.log('PASS synthetic owner invoice update: OAuth/identity/revision/paid/CTV/write audit/backup/readback/idempotency');

const payment=(action,requestId,rev,reason)=>{
 const p={id:6001,invoiceNo:9001,expectedName:'Synthetic Customer A',
  expectedTotal:30000,expectedRevision:rev,confirmed:true,requestId};
 if(action==='payments.markCustomerPaid')p.amount=30000;
 else p.reason=reason||'Fake verified owner payment adjustment';
 return req(action,p);
};
let paid=payment('payments.markCustomerPaid','fake-customer-paid-001',201);
assert.equal(paid.ok,true,JSON.stringify(paid.error));
assert.equal(paid.revision,202);
let mixed=JSON.parse(data.values.satori_orders_v15);
assert.ok(mixed[0].customerPaidAt);
assert.equal(mixed[0].satoriPaidAt,undefined);
let reconciled=payment('payments.markSatoriPaid','fake-satori-paid-001',202);
assert.equal(reconciled.ok,true,JSON.stringify(reconciled.error));
assert.equal(reconciled.revision,203);
mixed=JSON.parse(data.values.satori_orders_v15);
assert.ok(mixed[0].customerPaidAt&&mixed[0].satoriPaidAt,
 'customer and Satori independently marked paid');
assert.equal(mixed[0].status,'Đã TT Satori');
assert.equal(payment('payments.markSatoriPaid','fake-satori-paid-001',202).data.alreadyApplied,true,
 'exact historic payment request is idempotent');
assert.equal(data.revision,203);
let revertCustomer=payment('payments.markCustomerUnpaid','fake-customer-unpaid-001',203);
assert.equal(revertCustomer.ok,true,JSON.stringify(revertCustomer.error));
assert.equal(revertCustomer.revision,204);
mixed=JSON.parse(data.values.satori_orders_v15);
assert.equal(mixed[0].customerPaidAt,null);
assert.ok(mixed[0].satoriPaidAt,'customer unpaid must not change Satori settlement');
let revertSatori=payment('payments.markSatoriUnpaid','fake-satori-unpaid-001',204);
assert.equal(revertSatori.ok,true,JSON.stringify(revertSatori.error));
assert.equal(revertSatori.revision,205);
mixed=JSON.parse(data.values.satori_orders_v15);
assert.equal(mixed[0].satoriPaidAt,null);
assert.equal(mixed[0].status,'Chưa thanh toán');
assert.equal(mixed[1].total,45000,'duplicate invoice number remains untouched');
assert.equal(JSON.parse(data.values.satori_orders_v15)[2].status,'Đã thanh toán');
assert.equal(mixed[0].paymentAudit.length,3,
 'three corrective payment entries must be recorded');
const paymentsSnapshot=req('mobile.snapshot',{});
const paymentRead=JSON.parse(paymentsSnapshot.data.values.satori_orders_v15);
assert.equal(paymentRead[0].status,'Chưa thanh toán',
 'final readback agrees with canonical ledger after independent toggles');
console.log('PASS synthetic four payment toggles: independent customer/Satori states, audit, replays, readback');

// Infrastructure failure/recovery coverage; all storage and OAuth remain fake.
function resetEditFixture() {
 data={revision:200,updatedAt:'2026-10-27T00:00:00Z',values:{
  satori_orders_v15:JSON.stringify(start),satori_trash_bin_v15:'[]',
  satori_deleted_invoice_nos:'[]'}};
 writes=0;backups=0;cache.clear();
}
resetEditFixture();
const originalGetFile=context.DriveApp.getFileById;
const beforeFailedBackup=JSON.stringify(data);
context.DriveApp.getFileById=id=>({ ...originalGetFile(id),makeCopy:()=>null });
const failedBackup=req('orders.update',payload('backup-failure-001'));
assert.equal(failedBackup.ok,false);
assert.equal(failedBackup.error.code,'BACKUP_FAILED');
assert.equal(JSON.stringify(data),beforeFailedBackup);
assert.deepEqual(count(),[0,0,200]);
context.DriveApp.getFileById=originalGetFile;
console.log('PASS edit recovery: failed backup leaves ledger byte-identical');

resetEditFixture();
const lostPayload=payload('lost-response-001');
// Server commits, but the client discards the response as on transport loss.
req('orders.update',lostPayload);
assert.deepEqual(count(),[1,1,201]);
const retryAfterLoss=req('orders.update',lostPayload);
assert.equal(retryAfterLoss.ok,true);
assert.equal(retryAfterLoss.data.duplicate,true);
assert.deepEqual(count(),[1,1,201]);
const recoverySnapshot=req('mobile.snapshot',{});
const recoveryRows=JSON.parse(recoverySnapshot.data.values.satori_orders_v15);
assert.equal(recoveryRows.find(x=>x.id===6001).apiUpdateRequestId,lostPayload.requestId);
assert.equal(JSON.parse(data.values.satori_order_edit_audit_v1).length,1);
console.log('PASS edit recovery: lost response retry produces one write and one audit');

const secondEdit={...payload('later-edit-002'),expectedRevision:201,
 expectedTotal:30000,order:{...order(),location:'99 Later Synthetic Avenue'}};
assert.equal(req('orders.update',secondEdit).ok,true);
const beforeOldRetry=JSON.stringify(data);
const oldRetry=req('orders.update',lostPayload);
assert.equal(oldRetry.ok,false);
assert.equal(oldRetry.error.code,'REQUEST_SUPERSEDED');
assert.equal(JSON.stringify(data),beforeOldRetry);
assert.deepEqual(count(),[2,2,202]);
assert.equal(JSON.parse(data.values.satori_order_edit_audit_v1).length,2);
console.log('PASS edit recovery: superseded request cannot overwrite a later edit');
