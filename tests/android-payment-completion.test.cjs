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

const find=id=>JSON.parse(data.values.satori_orders_v15).find(x=>x.id===id);
const pay=(action,id=6001,requestId='payment-'+String(++nonce))=>{
 const o=find(id);return {action,payload:{expectedRevision:data.revision,requestId,
  confirmed:true,id,invoiceNo:o.invoiceNo,expectedName:o.name,expectedTotal:o.total,
  amount:o.total,reason:'Synthetic reconciliation'}};
};
const send=x=>req(x.action,x.payload);
const before=()=>[writes,backups,data.revision];
let x=pay('payments.markCustomerPaid');
assert.equal(send(x).ok,true);assert.ok(find(6001).customerPaidAt);
assert.equal(find(6001).paymentAudit.length,1);
let checkpoint=before();assert.equal(send(x).ok,true);assert.deepEqual(before(),checkpoint);
let y=pay('payments.markSatoriPaid');assert.equal(send(y).ok,true);
assert.ok(find(6001).customerPaidAt);assert.ok(find(6001).satoriPaidAt);
assert.equal(send(pay('payments.markCustomerUnpaid')).ok,true);
assert.equal(find(6001).customerPaidAt,null);assert.ok(find(6001).satoriPaidAt);
assert.equal(send(pay('payments.markSatoriUnpaid')).ok,true);
assert.equal(find(6001).satoriPaidAt,null);assert.equal(find(6001).customerPaidAt,null);
assert.equal(find(6001).paymentAudit.length,4);
checkpoint=before();assert.equal(send(y).ok,true);assert.deepEqual(before(),checkpoint);
x=pay('payments.markCustomerPaid');x.payload.expectedRevision--;
assert.equal(send(x).error.code,'REVISION_CONFLICT');assert.deepEqual(before(),checkpoint);
x=pay('payments.markCustomerPaid');currentEmail='intruder@example.test';
assert.equal(send(x).error.code,'FORBIDDEN');currentEmail=owner;
currentClient='untrusted.apps.googleusercontent.com';assert.equal(send(x).error.code,'FORBIDDEN');currentClient=clientId;
assert.deepEqual(before(),checkpoint);
// Legacy paid state has no timestamp: paying Satori must preserve customer truth.
assert.equal(send(pay('payments.markSatoriPaid',6003)).ok,true);
assert.ok(find(6003).customerPaidAt);assert.ok(find(6003).satoriPaidAt);
assert.equal(send(pay('payments.markSatoriUnpaid',6003)).ok,true);
assert.ok(find(6003).customerPaidAt);
for(const status of ['Đã hủy','Không Tính']){
 const rows=JSON.parse(data.values.satori_orders_v15);
 const o=rows.find(x=>x.id===6002);o.status=status;
 o.customerPaidAt='2026-01-01T00:00:00Z';o.satoriPaidAt=o.customerPaidAt;
 data.values.satori_orders_v15=JSON.stringify(rows);
 checkpoint=before();
 for(const action of ['payments.markCustomerPaid','payments.markCustomerUnpaid',
   'payments.markSatoriPaid','payments.markSatoriUnpaid'])
  assert.equal(send(pay(action,6002)).ok,false);
 assert.deepEqual(before(),checkpoint);assert.ok(find(6002).customerPaidAt);
}
assert.equal(writes,backups);
console.log('PASS: owner mobile four transitions, independent facts, history, exact replay, lost-response replay, stale revision, excluded invoices, owner/client rejection, prewrite backups');
