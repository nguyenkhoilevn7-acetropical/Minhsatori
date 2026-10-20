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
 Utilities:{Charset:{UTF_8:'UTF_8'},computeHmacSha256Signature:(m,k)=>[...crypto.createHmac('sha256',k).update(m).digest()],getUuid:()=>String(++sequence),formatDate:()=> '19/10/2026'},
 DriveApp:{getFileById:()=>({makeCopy:()=>{const original=JSON.stringify(data);return {getId:()=>String(++backs),getBlob:()=>({getDataAsString:()=>original})}},setContent(s){data=JSON.parse(s);writes++}})}
};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../accounting-core.js'),'utf8'),context);vm.runInContext(source.replaceAll("message:err.code?err.message:'Không xử lý được; kiểm tra nhật ký hệ thống'","message:String(err&&err.stack||err)"),context);
function call(action,payload={},override={}){
 const body={keyId:'bot-01',timestamp:Date.now(),nonce:'test_nonce_'+String(++sequence).padStart(20,'0'),action,payload};
 body.signature=crypto.createHmac('sha256',secret).update([body.keyId,body.timestamp,body.nonce,body.action,JSON.stringify(body.payload)].join('\n')).digest('hex');
 Object.assign(body,override);return JSON.parse(context.doPost({postData:{contents:JSON.stringify(body)}}).text);
}
const initialStatus=call('system.status');console.log('HMAC smoke:',JSON.stringify(initialStatus));assert.equal(initialStatus.data.orders,0);
 // Scope-isolated, versioned product catalogue: never trust website localStorage.
 assert.equal(call('catalogue.list').error.code,'FORBIDDEN','existing read/write bot may NOT read catalogue without explicit scope');
 const originalClients=props.SATORI_BOT_CLIENTS_JSON;
 const clients=JSON.parse(originalClients);
 clients['bot-01'].scopes.push('catalogue:read');
 props.SATORI_BOT_CLIENTS_JSON=JSON.stringify(clients);
 const beforeCatalogueReadWrites=writes;
 assert.equal(call('catalogue.list').error.code,'CATALOGUE_NOT_PERSISTED','missing shared ledger catalogue must fail closed');
 data.values.satori_catalogue_v15=JSON.stringify([
  {code:'TP-00003',name:'Satori 500ml',unit:'Thùng',brand:'SATORI',
    spec:'24 chai/thùng',listPrice:98000,unitPrice:73500,discountPercent:25}
 ]);
 const catalogueResponse=call('catalogue.list');
 assert.equal(catalogueResponse.ok,true);
 assert.equal(catalogueResponse.data.source,'drive-ledger:satori_catalogue_v15');
 assert.equal(catalogueResponse.data.revision,data.revision);
 assert.equal(catalogueResponse.data.products[0].listPrice,98000);
 assert.equal(catalogueResponse.data.products[0].code,'TP-00003');
 assert.equal(catalogueResponse.data.products[0].standardDiscountPercent,25);
 assert.equal(writes,beforeCatalogueReadWrites,'catalogue.list must never touch Drive');
 data.values.satori_catalogue_v15=JSON.stringify([
  {code:'TP-00003',name:'Satori 500ml',unit:'Thùng',listPrice:98000,unitPrice:73500},
  {code:'TP-00003',name:'Duplicate',unit:'Thùng',listPrice:98000,unitPrice:73500}
 ]);
 assert.equal(call('catalogue.list').error.code,'INVALID_CATALOGUE','duplicate SKU must not silently corrupt pricing');
 delete data.values.satori_catalogue_v15;
 props.SATORI_BOT_CLIENTS_JSON=originalClients;

const input={expectedRevision:1,requestId:'create-00001',confirmedNewCustomer:true,order:{name:'Test Customer',location:'123 Đường thử nghiệm',phone:'0901234567',items:[{product:'Satori 500 ml',qty:2,unitPrice:10000}],total:20000}};
assert.equal(call('orders.create',input).data.order.invoiceNo,1);
assert.equal(backs,1);assert.equal(data.revision,2);
assert.equal(call('orders.create',input).data.duplicate,true);
assert.equal(backs,1);
const tamperedRetry={...input,order:{...input.order,
 items:[{product:'Satori 500 ml',qty:3,unitPrice:10000}],total:30000}};
assert.equal(call('orders.create',tamperedRetry).error.code,'REQUEST_ID_CONFLICT',
 'same request ID with modified quantity and amount must be rejected');
assert.equal(call('orders.create',{...input,order:{...input.order,location:'Another delivery location'}}).error.code,
 'REQUEST_ID_CONFLICT','same request ID cannot be reused for another delivery address');
assert.equal(call('orders.create',{...input,order:{...input.order,phone:'0912345678'}}).error.code,
 'REQUEST_ID_CONFLICT','same request ID cannot be reused for another recipient phone');
assert.equal(call('orders.create',{...input,order:{...input.order,items:[{product:'Satori 500 ml',qty:2,unitPrice:11000}],total:22000}}).error.code,
 'REQUEST_ID_CONFLICT','same request ID cannot silently change a unit price');
assert.equal(call('orders.create',{...input,order:{...input.order,deliveryNote:'Different note'}}).error.code,
 'REQUEST_ID_CONFLICT','same request ID cannot silently change delivery notes');
assert.equal(backs,1,'reused mutated intent must never create a new Drive backup');
assert.equal(data.revision,2,'reused mutated intent must never change Drive revision');
assert.equal(call('orders.create',{...input,requestId:'create-00002'}).error.code,'REVISION_CONFLICT');
assert.equal(call('orders.create',{...input,requestId:'create-00003',expectedRevision:2,order:{...input.order,total:30000}}).error.code,'TOTAL_MISMATCH');
assert.equal(call('orders.list',{query:'Test Customer'}).data.totalMatches,1);
assert.equal(call('debt.summary').data.due,20000);
assert.equal(call('payments.markCustomerPaid',{expectedRevision:2,invoiceNo:1,confirmed:false}).error.code,'CONFIRMATION_REQUIRED');
assert.equal(call('payments.markCustomerPaid',{expectedRevision:2,invoiceNo:1,confirmed:true,amount:20000}).data.order.status,'Đã thanh toán');
// When a mobile reply is lost after a committed payment, a retry with the same
// stale revision must be read-only, but still reject missing confirmation or
// a different amount. This must not create another backup or write.
assert.equal(call('payments.markCustomerPaid',{expectedRevision:2,invoiceNo:1,confirmed:true,amount:20000}).data.alreadyPaid,true);
assert.equal(call('payments.markCustomerPaid',{expectedRevision:2,invoiceNo:1,confirmed:false,amount:20000}).error.code,'CONFIRMATION_REQUIRED');
assert.equal(call('payments.markCustomerPaid',{expectedRevision:2,invoiceNo:1,confirmed:true,amount:19000}).error.code,'TOTAL_MISMATCH');
assert.equal(data.revision,3);
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
    if(token!=='valid-owner-oauth-access-token')status=401;
  }else if(url==='https://www.googleapis.com/oauth2/v3/userinfo'){
    const bearer=options&&options.headers&&options.headers.Authorization;
    if(bearer!=='Bearer valid-owner-oauth-access-token')status=401;
    obj={email:issuer.email,email_verified:true,
      sub:issuer.subject===undefined?'google-sub:'+issuer.email:issuer.subject};
  }else throw Error('Unexpected URL in isolated test');
  return {getResponseCode:()=>status,getContentText:()=>JSON.stringify(obj)};
}};
vm.runInContext(fs.readFileSync(path.join(__dirname,'../api/MobileApi.gs'),'utf8').replace("message:recognized?error.message:'Không thực hiện được tác vụ; vui lòng tải lại và thử lại'","message:String(error&&error.stack||error)"),context);
function mobile(action,payload={},overrides={}){
  const body={kind:'satori-android-v1',accessToken:'valid-owner-oauth-access-token',action,
     nonce:'mobiletestnonce'+String(++sequence).padStart(20,'0'),payload,...overrides};
  return JSON.parse(context.doPost({parameter:{route:'android'},
    postData:{contents:JSON.stringify(body)}}).text);
}
const firstMobile=mobile('mobile.snapshot');console.log('MOBILE smoke:',JSON.stringify(firstMobile));assert.equal(firstMobile.data.revision,20);
assert.equal(firstMobile.data.actorId,'google-sub:owner@example.com');
assert.equal(mobile('mobile.snapshot',{}, {actorId:'spoofed-client-identity'}).data.actorId,
  'google-sub:owner@example.com','outbox identity must come from verified Google userinfo, never the phone');
issuer.subject='';
assert.equal(mobile('mobile.snapshot').error.code,'AUTH_FAILED');
delete issuer.subject;
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
// A staff account granted only read scope cannot change or inspect deleted invoices.
props.SATORI_ANDROID_STAFF_PERMISSIONS_JSON=JSON.stringify({
 'staff@example.com':['orders:read']
});
issuer.email='staff@example.com';
assert.equal(mobile('mobile.snapshot').ok,true);
assert.equal(mobile('mobile.snapshot').data.allowedActions.includes('orders.create'),false);
assert.equal(mobile('mobile.trash').error.code,'FORBIDDEN');
// A staff role that can delete but cannot create/edit must not be able to
// restore a deleted invoice. Restoring revives a financial record (write).
props.SATORI_ANDROID_STAFF_PERMISSIONS_JSON=JSON.stringify({
 'staff@example.com':['orders:read','orders:delete']
});
assert.equal(mobile('mobile.snapshot').data.allowedActions.includes('orders.restore'),false);
assert.equal(mobile('orders.restore',{}).error.code,'FORBIDDEN');
props.SATORI_ANDROID_STAFF_PERMISSIONS_JSON=JSON.stringify({
 'staff@example.com':['orders:read','orders:write']
});
assert.equal(mobile('mobile.snapshot').data.allowedActions.includes('orders.restore'),true);
assert.equal(mobile('mobile.snapshot').data.allowedActions.includes('orders.delete'),false);
assert.equal(mobile('mobile.trash').error.code,'FORBIDDEN');
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
  shippingAmount:20000,total:150000,deliveryNote:'Shipper gửi hóa đơn có giá.'}}).data.duplicate,true);
assert.equal(mobile('orders.create',{expectedRevision:20,requestId:'phone-order-001',
  confirmedNewCustomer:true,order:{name:'Android Test Customer',location:'Cát Lái 101',phone:'0909988999',
  items:[{product:'Satori 350 ml',qty:2,unitPrice:65000}],
  shippingAmount:20000,total:150000}}).error.code,'REQUEST_ID_CONFLICT',
  'retry with missing delivery note must be rejected rather than duplicating an order');
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
assert.equal(mobile('mobile.trash').data.orders.find(x=>x.invoiceNo===mobileNo).deleteRequestId,
  'phone-delete-001','restart recovery must prove the same delete request, not just a missing invoice');
const currentMobileBin=data.values.satori_trash_bin_v15;
const oldMobileBin=JSON.parse(currentMobileBin);
oldMobileBin.push({order:{id:'expired-mobile-test',invoiceNo:99901},deletedAt:Date.now()-31*86400000});
oldMobileBin.push({order:{id:'future-mobile-test',invoiceNo:99902},deletedAt:Date.now()+86400000});
oldMobileBin.push({order:{id:'invalid-mobile-test',invoiceNo:99903},deletedAt:'invalid'});
data.values.satori_trash_bin_v15=JSON.stringify(oldMobileBin);
const beforeMobileTrashRead=JSON.stringify(data);
assert.equal(mobile('mobile.trash').data.orders.some(x=>x.invoiceNo>=99901),false,
  'native trash must apply the same 30-day restore window as Bot API');
assert.equal(JSON.stringify(data),beforeMobileTrashRead,'trash reads must not purge or rewrite records');
data.values.satori_trash_bin_v15=currentMobileBin;
const restoredMobile=mobile('orders.restore',{expectedRevision:23,requestId:'phone-restore-001',
  id:mobileId,invoiceNo:mobileNo,expectedName:'Android Test Customer',
  expectedTotal:215000,confirmed:true});
assert.equal(restoredMobile.data.restored,true);
// A durable mobile payment is invalid without BOTH invoice identity and total.
assert.equal(mobile('payments.markCustomerPaid',{expectedRevision:24,
  invoiceNo:mobileNo,amount:215000,confirmed:true,
  requestId:'missing-id-payment-001'}).error.code,'ORDER_CHANGED');
assert.equal(mobile('payments.markCustomerPaid',{expectedRevision:24,
  id:mobileId,invoiceNo:mobileNo,confirmed:true,
  requestId:'missing-amount-payment-001'}).error.code,'INVALID_AMOUNT');
// A stale or forged invoice ID must never mark a different order paid,
// even when invoice number, amount and other fields happen to match.
assert.equal(mobile('payments.markCustomerPaid',{expectedRevision:24,
  id:'not-the-current-invoice',invoiceNo:mobileNo,amount:215000,
  confirmed:true,requestId:'wrong-id-payment-001'}).error.code,'ORDER_CHANGED');
assert.equal(writes,earlierWriteCount+4);
const markedMobile=mobile('payments.markCustomerPaid',{expectedRevision:24,
  id:mobileId,invoiceNo:mobileNo,amount:215000,confirmed:true,requestId:'phone-payment-001'});
assert.equal(markedMobile.data.order.status,'Đã thanh toán');
assert.equal(markedMobile.data.order.apiPaymentRequestId,'phone-payment-001');
// A second device seeing a paid bill cannot change attribution to its own ID.
const otherDevice=mobile('payments.markCustomerPaid',{expectedRevision:24,
  id:mobileId,invoiceNo:mobileNo,amount:215000,confirmed:true,requestId:'other-device-payment-002'});
assert.equal(mobile('payments.markCustomerPaid',{expectedRevision:24,
  id:'stale-id',invoiceNo:mobileNo,amount:215000,
  confirmed:true,requestId:'bad-paid-retry-003'}).error.code,'ORDER_CHANGED');
assert.equal(otherDevice.data.alreadyPaid,true);
assert.equal(otherDevice.data.order.apiPaymentRequestId,'phone-payment-001');
assert.equal(JSON.parse(data.values.satori_orders_v15).find(o=>o.invoiceNo===mobileNo).apiPaymentRequestId,'phone-payment-001');
assert.equal(mobile('orders.delete',{expectedRevision:25,requestId:'phone-delete-002',
  id:mobileId,invoiceNo:mobileNo,expectedName:'Android Test Customer',
  expectedTotal:215000,confirmed:true}).error.code,'PAID_ORDER_PROTECTED');
assert.equal(data.revision,25);
assert.equal(writes,earlierWriteCount+5);
console.log('PASS — Mobile Google client/email/expiry checks and read-only snapshot');
console.log('PASS — Mobile create/edit/delete/restore/payment with backup, revision, no duplicate');

// "Đã TT Satori" is a vendor-side settlement, not proof that the customer paid.
// Accept a customer payment while preserving that vendor status and record it once.
const priorBackups=backs,priorWrites=writes;
data={revision:70,updatedAt:'2026-10-19T00:00:00Z',values:{
  satori_orders_v15:JSON.stringify([{id:700,invoiceNo:700,
    name:'Settlement Example',location:'123 Sample Road',status:'Đã TT Satori',
    date:'19/10/2026',total:25000,items:[{product:'Satori 350 ml',qty:1,unitPrice:25000}]}]),
  satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]'}};
const payment=mobile('payments.markCustomerPaid',{
  expectedRevision:70,id:700,invoiceNo:700,amount:25000,confirmed:true,
  requestId:'vendor-paid-customer-001'});
assert.equal(payment.ok,true);
assert.equal(payment.data.order.status,'Đã TT Satori');
assert.ok(JSON.parse(data.values.satori_orders_v15)[0].customerPaidAt);
assert.equal(JSON.parse(data.values.satori_orders_v15)[0].apiPaymentRequestId,'vendor-paid-customer-001');
assert.equal(call('debt.summary').data.due,0);
assert.equal(mobile('payments.markCustomerPaid',{
  expectedRevision:70,id:700,invoiceNo:700,amount:25000,confirmed:true
}).data.alreadyPaid,true);
assert.equal(data.revision,71);
assert.equal(backs,priorBackups+1);
assert.equal(writes,priorWrites+1);
console.log('PASS — Satori-side paid is separate from customer-paid, payment retry is read-only');
