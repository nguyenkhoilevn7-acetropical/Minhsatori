// Staged, self-contained Node tests: no network or Google Drive access.
const vm=require('node:vm'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../api/BotApi.gs'),'utf8'),secret='LOCAL_UNIT_TEST_SECRET_012345678901234567890';
assert.equal(fs.readFileSync(path.join(__dirname,'../api/AccountingCore.gs'),'utf8').trimEnd(),fs.readFileSync(path.join(__dirname,'../accounting-core.js'),'utf8').trimEnd(),'API and website must use identical accounting rules');
let data={revision:1,updatedAt:'2026-10-18T00:00:00Z',values:{satori_orders_v15:'[]',satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]'}},backs=0,writes=0,sequence=0;
const cache=new Map(),props={STATE_FILE_ID:'test-file',SATORI_BOT_CLIENTS_JSON:JSON.stringify({'bot-01':{secret,enabled:true,scopes:['orders:read','orders:write','orders:delete','customers:read','debt:read','payments:write']}})};
const context={
 Date,JSON,Number,String,Object,Array,Math,Error,RegExp,
 readState_:()=>JSON.parse(JSON.stringify(data)),
 ContentService:{MimeType:{JSON:'json'},createTextOutput(t){return {text:t,setMimeType(){return this}}}},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{computeHmacSha256Signature:(m,k)=>[...crypto.createHmac('sha256',k).update(m).digest()],getUuid:()=>String(++sequence),formatDate:()=> '19/10/2026'},
 DriveApp:{getFileById:()=>({makeCopy:()=>{const original=JSON.stringify(data);return {getId:()=>String(++backs),getBlob:()=>({getDataAsString:()=>original})}},setContent(s){data=JSON.parse(s);writes++}})}
};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../accounting-core.js'),'utf8'),context);vm.runInContext(source,context);
function call(action,payload={},override={}){
 const body={keyId:'bot-01',timestamp:Date.now(),nonce:'test_nonce_'+String(++sequence).padStart(20,'0'),action,payload};
 body.signature=crypto.createHmac('sha256',secret).update([body.keyId,body.timestamp,body.nonce,body.action,JSON.stringify(body.payload)].join('\n')).digest('hex');
 Object.assign(body,override);return JSON.parse(context.doPost({postData:{contents:JSON.stringify(body)}}).text);
}
const initialStatus=call('system.status');console.log('HMAC smoke:',JSON.stringify(initialStatus));assert.equal(initialStatus.data.orders,0);
const input={expectedRevision:1,requestId:'create-00001',confirmedNewCustomer:true,order:{name:'Test Customer',location:'123 Đường thử nghiệm',phone:'0901234567',items:[{product:'Satori 500 ml',qty:2,unitPrice:10000}],total:20000}};
assert.equal(call('orders.create',input).data.order.invoiceNo,1);
assert.equal(backs,1);assert.equal(data.revision,2);
assert.equal(call('orders.create',input).data.duplicate,true);
assert.equal(backs,1);
assert.equal(call('orders.create',{...input,requestId:'create-00002'}).error.code,'REVISION_CONFLICT');
assert.equal(call('orders.create',{...input,requestId:'create-00003',expectedRevision:2,order:{...input.order,total:30000}}).error.code,'TOTAL_MISMATCH');
assert.equal(call('orders.list',{query:'Test Customer'}).data.totalMatches,1);
assert.equal(call('debt.summary').data.due,20000);
assert.equal(call('payments.markCustomerPaid',{expectedRevision:2,invoiceNo:1,confirmed:false}).error.code,'CONFIRMATION_REQUIRED');
assert.equal(call('payments.markCustomerPaid',{expectedRevision:2,invoiceNo:1,confirmed:true,amount:20000}).data.order.status,'Đã thanh toán');
assert.equal(call('debt.summary').data.due,0);assert.equal(backs,2);assert.equal(writes,2);

assert.equal(call('customers.search',{query:'Test Customer'}).data.profiles.total,1);
assert.equal(call('customers.search',{query:'Test Customer'}).data.profiles.profiles[0].location,'123 Đường thử nghiệm');
let originalOrder=JSON.parse(data.values.satori_orders_v15)[0];
const paidRemoval={expectedRevision:3,requestId:'delete-00001',confirmed:true,id:originalOrder.id,
 invoiceNo:1,expectedName:'Test Customer',expectedTotal:20000};
assert.equal(call('orders.delete',paidRemoval).error.code,'PAID_ORDER_PROTECTED');
assert.equal(backs,2);
const second={expectedRevision:3,requestId:'create-00004',customerRef:{id:originalOrder.id,invoiceNo:1},
 order:{name:originalOrder.name,phone:originalOrder.phone,location:originalOrder.location,
 items:[{product:'Satori 500 ml',qty:3,unitPrice:10000}],total:30000,deliveryDate:'2026-10-20'}};
const added=call('orders.create',second);
assert.equal(added.ok,true);assert.equal(added.data.order.invoiceNo,2);assert.equal(backs,3);
const remove={expectedRevision:4,requestId:'delete-00003',confirmed:true,
  id:added.data.order.id,invoiceNo:2,expectedName:'Test Customer',expectedTotal:30000};
assert.equal(call('orders.delete',{...remove,expectedTotal:29000}).error.code,'ORDER_CHANGED');
assert.equal(backs,3);
const gone=call('orders.delete',remove);
assert.equal(gone.ok,true);assert.equal(gone.data.deleted,true);
assert.equal(backs,4);assert.equal(data.revision,5);
assert.equal(JSON.parse(data.values.satori_trash_bin_v15).length,1);
assert.equal(JSON.parse(data.values.satori_deleted_invoice_nos)[0],2);
assert.equal(JSON.parse(data.values.satori_orders_v15).length,1);
assert.equal(call('orders.delete',remove).data.duplicate,true);
assert.equal(backs,4);
assert.equal(call('orders.create',second).error.code,'REUSED_REQUEST_ID');
assert.equal(call('orders.create',{expectedRevision:5,requestId:'create-00005',
 order:{name:'Unknown',location:'ABC',items:[{product:'Satori 500 ml',qty:1,unitPrice:10000}]}}).error.code,'PROFILE_CONFIRMATION_REQUIRED');
assert.equal(backs,4);

const third=call('orders.create',{expectedRevision:5,requestId:'create-00006',confirmedNewCustomer:true,
 order:{name:'Another Test',phone:'0901122334',location:'Địa chỉ giao thử',
 items:[{product:'Satori 500 ml',qty:1,unitPrice:12000}],total:12000}});
assert.equal(third.ok,true);
assert.equal(third.data.order.invoiceNo,3); // #2 stays reserved after deletion.
assert.equal(data.revision,6);assert.equal(backs,5);
assert.equal(call('orders.delete',{expectedRevision:6,requestId:'delete-00007',confirmed:true,
 invoiceNo:3,expectedName:'Another Test',expectedTotal:12000}).error.code,'INVALID_ORDER');
assert.equal(backs,5);

assert.equal(call('system.status',{}, {signature:'0'.repeat(64)}).error.code,'AUTH_FAILED');
const pairBase={name:'Khach CTV',location:'123 test',status:'Chưa thanh toán',date:'19/10/2026',items:[{product:'Nuoc',qty:2,unitPrice:10000}]};
data={revision:20,updatedAt:'2026-10-19T00:00:00Z',values:{satori_orders_v15:JSON.stringify([{...pairBase,id:101,invoiceNo:101,total:20000},{...pairBase,id:102,invoiceNo:102,total:15000}])}};
const debt=call('debt.summary',{query:'Khach CTV'});assert.equal(debt.ok,true);assert.equal(debt.data.due,20000);assert.equal(debt.data.orders,1);assert.equal(debt.data.excludedReferenceCount,1);
assert.equal(call('debt.summary',{query:'102'}).data.due,0,'reference bill must not become debt when high sale outside filter');
console.log('PASS — debt agrees with ledger: excludes low CTV reference using full-state pairing before filtering');
console.log('PASS — authenticated customer profiles, create, soft delete, paid protection, backups, idempotency, revision, debt');


// Mobile Android owner API: isolated mock Google tokeninfo and userinfo; NO real credentials.
props.SATORI_ANDROID_OWNER_EMAIL='owner@example.com';
props.SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON=JSON.stringify(['android-test-client-id']);
const issuer={email:'owner@example.com',aud:'android-test-client-id',scope:
 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.readonly'};
context.UrlFetchApp={fetch(url,options){
  let obj,status=200;
  if(url.startsWith('https://oauth2.googleapis.com/tokeninfo?access_token=')){
    const token=decodeURIComponent(url.split('access_token=')[1]||'');
    obj={aud:issuer.aud,expires_in:3600,scope:issuer.scope};
    if(token!=='valid-owner-token')status=401;
  }else if(url==='https://www.googleapis.com/oauth2/v3/userinfo'){
    const bearer=options&&options.headers&&options.headers.Authorization;
    if(bearer!=='Bearer valid-owner-token')status=401;
    obj={email:issuer.email,email_verified:true,sub:'google-owner-test'};
  }else throw Error('Unexpected URL in isolated test');
  return {getResponseCode:()=>status,getContentText:()=>JSON.stringify(obj)};
}};
vm.runInContext(fs.readFileSync(path.join(__dirname,'../api/MobileApi.gs'),'utf8'),context);
function mobile(action,payload={},overrides={}){
  const body={kind:'satori-android-v1',accessToken:'valid-owner-token',action,
     nonce:'mobiletestnonce'+String(++sequence).padStart(20,'0'),payload,...overrides};
  return JSON.parse(context.doPost({parameter:{route:'android'},
    postData:{contents:JSON.stringify(body)}}).text);
}
assert.equal(mobile('mobile.snapshot').data.revision,20);
const earlierWriteCount=writes;
assert.equal(mobile('orders.create',{expectedRevision:20,requestId:'phone-order-001',
  confirmedNewCustomer:true,order:{name:'Android Test Customer',location:'Cát Lái 101',phone:'0909988999',
  items:[{product:'Satori 350 ml',qty:2,unitPrice:65000}],
  shippingAmount:20000,total:150000,deliveryNote:'Shipper gửi hóa đơn có giá.'}},
  {accessToken:'bad-token'}).error.code,'AUTH_FAILED');
assert.equal(writes,earlierWriteCount);
issuer.aud='unknown-android-client';
assert.equal(mobile('mobile.snapshot').error.code,'FORBIDDEN');
issuer.aud='android-test-client-id';
issuer.email='attacker@example.com';
assert.equal(mobile('mobile.snapshot').error.code,'FORBIDDEN');
issuer.email='owner@example.com';
const createdMobile=mobile('orders.create',{expectedRevision:20,requestId:'phone-order-001',
  confirmedNewCustomer:true,order:{name:'Android Test Customer',location:'Cát Lái 101',phone:'0909988999',
  items:[{product:'Satori 350 ml',qty:2,unitPrice:65000}],
  shippingAmount:20000,total:150000,deliveryNote:'Shipper gửi hóa đơn có giá.'}});
assert.equal(createdMobile.ok,true);
assert.equal(createdMobile.backupCreated,true);
assert.equal(createdMobile.data.order.deliveryNote,'Shipper gửi hóa đơn có giá.');
assert.equal(mobile('orders.create',{expectedRevision:20,requestId:'phone-order-001',
  confirmedNewCustomer:true,order:{name:'Android Test Customer',location:'Cát Lái 101',phone:'0909988999',
  items:[{product:'Satori 350 ml',qty:2,unitPrice:65000}],
  shippingAmount:20000,total:150000}}).data.duplicate,true);
let mobileId=createdMobile.data.order.id,mobileNo=createdMobile.data.order.invoiceNo;
const edit=mobile('orders.update',{expectedRevision:21,requestId:'phone-update-001',
  id:mobileId,invoiceNo:mobileNo,expectedName:'Android Test Customer',
  expectedTotal:150000,confirmed:true,
  order:{name:'Android Test Customer',phone:'0909988999',location:'Cát Lái 101',
   items:[{product:'Satori 350 ml',qty:3,unitPrice:65000}],
   shippingAmount:20000,total:215000,deliveryNote:'Mang đủ hóa đơn có số tiền'}});
assert.equal(edit.ok,true);
assert.equal(edit.data.order.total,215000);
assert.equal(edit.data.order.deliveryNote,'Mang đủ hóa đơn có số tiền');
assert.equal(mobile('orders.update',{expectedRevision:20,requestId:'phone-update-002',
  id:mobileId,invoiceNo:mobileNo,expectedName:'Android Test Customer',
  expectedTotal:215000,confirmed:true,order:{name:'Android Test Customer',
  location:'Cát Lái 101',items:[{product:'Satori 350 ml',qty:3,unitPrice:65000}]}}).error.code,
  'REVISION_CONFLICT');
const deletedMobile=mobile('orders.delete',{expectedRevision:22,requestId:'phone-delete-001',
  id:mobileId,invoiceNo:mobileNo,expectedName:'Android Test Customer',
  expectedTotal:215000,confirmed:true});
assert.equal(deletedMobile.data.deleted,true);
assert.equal(mobile('mobile.trash').data.orders.some(x=>x.invoiceNo===mobileNo),true);
const restoredMobile=mobile('orders.restore',{expectedRevision:23,requestId:'phone-restore-001',
  id:mobileId,invoiceNo:mobileNo,expectedName:'Android Test Customer',
  expectedTotal:215000,confirmed:true});
assert.equal(restoredMobile.data.restored,true);
const markedMobile=mobile('payments.markCustomerPaid',{expectedRevision:24,
  invoiceNo:mobileNo,amount:215000,confirmed:true});
assert.equal(markedMobile.data.order.status,'Đã thanh toán');
assert.equal(mobile('orders.delete',{expectedRevision:25,requestId:'phone-delete-002',
  id:mobileId,invoiceNo:mobileNo,expectedName:'Android Test Customer',
  expectedTotal:215000,confirmed:true}).error.code,'PAID_ORDER_PROTECTED');
assert.equal(data.revision,25);
assert.equal(writes,earlierWriteCount+5);
console.log('PASS — Mobile Google client/email/expiry checks and read-only snapshot');
console.log('PASS — Mobile create/edit/delete/restore/payment with backup, revision, no duplicate');
