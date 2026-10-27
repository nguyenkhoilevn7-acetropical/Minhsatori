// Offline fake Google token verifier + Drive ledger; never accesses live invoice.
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const code=fs.readFileSync(__dirname+'/../api/AndroidOwnerMobileApi.gs','utf8');
new vm.Script(code,{filename:'AndroidOwnerMobileApi.gs'});
const clientId='1234567890-ownerandroid.apps.googleusercontent.com',owner='owner@example.test';
const config={'SATORI_ANDROID_OWNER_EMAIL':owner,
 'SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON':JSON.stringify([clientId]),
 'STATE_FILE_ID':'14XWSPrxLnKXATwmuHeXGZnCvjDbalghV'};
const ledger={revision:133,updatedAt:'2026-10-23T22:40:00+07:00',
 values:{satori_orders_v15:JSON.stringify([{id:11,invoiceNo:8001,name:'FAKE A'}]),
 satori_catalogue_v15:'[]',satori_ai_customer_memory:'[]',
 satori_trash_bin_v15:JSON.stringify([{deletedAt:Date.now()-300000,
  expiresAt:Date.now()+30*86400000,apiDeleteRequestId:'fakedelete-id-8001',
  order:{id:12,invoiceNo:8000,name:'FAKE DELETED',total:0}}])}};
let oauthEmail=owner,oauthClient=clientId,mobileWrites=[];
const ctx={JSON,Date,Number,String,Array,Error,console,OWNER_EMAIL:owner,
 Session:{getEffectiveUser:()=>({getEmail:()=>owner})},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>config[k]})},
 readState_:()=>ledger,
 ContentService:{MimeType:{JSON:'json'},createTextOutput:body=>({
   body,setMimeType(){return this}
 })},
 UrlFetchApp:{fetch:(url,params)=>{
   if(url.startsWith('https://oauth2.googleapis.com/tokeninfo?')){
     return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({
       issued_to:oauthClient,scope:'https://www.googleapis.com/auth/userinfo.email',
       expires_in:3500})};
   }
   assert.equal(url,'https://www.googleapis.com/oauth2/v3/userinfo');
   assert.equal(params.headers.Authorization,'Bearer FAKE_TEST_OWNER_TOKEN_EXPLICIT');
   return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({
     email:oauthEmail,email_verified:true,sub:'12345678901234567890'})};
 }},
 SatoriBotApi:{ownerMobileWrite:(action,p,nonce)=>{
   mobileWrites.push({action,p,nonce});return {revision:133,
     data:{deleted:action==='orders.delete',restored:action==='orders.restore'},
     backupCreated:true};
 }}
};
vm.createContext(ctx);vm.runInContext(code,ctx);
function request(action,payload={},token='FAKE_TEST_OWNER_TOKEN_EXPLICIT'){
 return JSON.parse(ctx.AndroidOwnerMobileApi.handle({
   postData:{contents:JSON.stringify({kind:'satori-android-v1',action,
     payload,accessToken:token,nonce:'requestnonce_123456789012345'})},
   parameter:{route:'android'}}).body);
}
let snap=request('mobile.snapshot');assert.equal(snap.ok,true);
assert.equal(snap.data.revision,133);
assert.equal(snap.data.actorId,'12345678901234567890');
assert.ok(snap.data.allowedActions.includes('orders.restore'));
assert.ok(snap.data.allowedActions.includes('orders.delete'));
assert.equal(snap.data.values.satori_orders_v15,ledger.values.satori_orders_v15);
assert.ok(!('satori_trash_bin_v15' in snap.data.values),'trash not exposed with general snapshot');
assert.ok(!JSON.stringify(snap).includes('FAKE_TEST_OWNER_TOKEN_EXPLICIT'),'token not echoed');
let rev=request('mobile.revision');assert.equal(rev.ok,true);
assert.equal(rev.data.revision,133);assert.ok(!('values' in rev.data));
assert.equal(snap.data.ledgerFileId,config.STATE_FILE_ID);
assert.equal(snap.data.ledgerKind,'minh-satori-owner-drive-v15');
assert.equal(rev.data.ledgerFileId,config.STATE_FILE_ID);
config.STATE_FILE_ID='sandbox-file';
assert.equal(request('mobile.snapshot').error.code,'WRONG_LEDGER_SOURCE');
assert.equal(request('mobile.revision').error.code,'WRONG_LEDGER_SOURCE');
config.STATE_FILE_ID='14XWSPrxLnKXATwmuHeXGZnCvjDbalghV';
ledger.revision=1;
assert.equal(request('mobile.snapshot').error.code,'WRONG_LEDGER_SOURCE');
ledger.revision=133;
let bin=request('mobile.trash');assert.equal(bin.ok,true);
assert.equal(bin.data.orders[0].invoiceNo,8000);
assert.equal(bin.data.orders[0].deleteRequestId,'fakedelete-id-8001');
const payload={id:12,invoiceNo:8000,expectedName:'FAKE DELETED',
 expectedTotal:0,expectedRevision:133,confirmed:true,requestId:'delete-req-0001'};
assert.equal(request('orders.delete',payload).ok,true);
assert.equal(mobileWrites.length,1);
assert.equal(mobileWrites[0].action,'orders.delete');
assert.equal(request('orders.restore',{...payload,requestId:'restore-req-0001'}).ok,true);
assert.equal(mobileWrites.length,2);
const paymentActions=[
 'payments.markCustomerPaid','payments.markCustomerUnpaid',
 'payments.markSatoriPaid','payments.markSatoriUnpaid'];
paymentActions.forEach(action=>assert.ok(snap.data.allowedActions.includes(action),
 'owner snapshot exposes '+action+' only through verified OAuth route'));
const pay={id:'fixture-id',invoiceNo:8001,expectedName:'FAKE A',
 expectedTotal:20000,expectedRevision:133,confirmed:true,amount:20000,
 reason:'Fake owner payment correction',requestId:'fake-payment-req-0001'};
for(const [index,action] of paymentActions.entries()){
 const result=request(action,{...pay,requestId:'fake-payment-req-00'+(10+index)});
 assert.equal(result.ok,true,action+' owner route accepted');
 assert.equal(mobileWrites.at(-1).action,action);
}
assert.equal(mobileWrites.length,6);
config.STATE_FILE_ID='sandbox-file';
assert.equal(request('payments.markSatoriPaid',pay).error.code,
 'WRONG_LEDGER_SOURCE','payment write denied on noncanonical ledger');
assert.equal(mobileWrites.length,6,'no write to wrong ledger');
config.STATE_FILE_ID='14XWSPrxLnKXATwmuHeXGZnCvjDbalghV';
assert.equal(request('payments.markSatoriPaid',{...pay,requestId:'x'}).error.code,
 'INVALID_REQUEST','short payment requestId denied');
assert.equal(mobileWrites.length,6);
oauthEmail='intruder@example.test';
assert.equal(request('mobile.snapshot').error.code,'FORBIDDEN');
oauthEmail=owner;oauthClient='9999999999-wrongclient.apps.googleusercontent.com';
assert.equal(request('orders.delete',payload).error.code,'FORBIDDEN');
assert.equal(mobileWrites.length,6,'no unauthorized writes');
oauthClient=clientId;
assert.equal(request('orders.update',payload).error.code,'INVALID_ACTION',
 'dangerous and unsupported orders.update denied');
assert.equal(request('orders.delete',payload,'short').error.code,'AUTH_FAILED');
console.log('PASS fake production Mobile API: OAuth, ledger proof, four owner payment routes, delete/restore, forbidden calls');
