/**
 * PRODUCTION OWNER ONLY — Android Mobile API route for the existing
 * Minh Satori Drive Sync Apps Script project.
 *
 * Add as a NEW .gs file. Keep the existing doGet/readState_/STATE_FILE_ID.
 * Route doPost ?route=android to AndroidOwnerMobileApi.handle(e) by merging
 * only the guarded dispatcher in api/BotApi.gs. NEVER paste sandbox Code.gs
 * or create an additional competing doPost.
 *
 * Required private Script Properties (never in source, APK, logs, or chat):
 *  SATORI_ANDROID_OWNER_EMAIL — matches current deployed OWNER_EMAIL
 *  SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON — JSON array of Google OAuth IDs
 *     issued to the signed owner Android app (not untrusted customers).
 *
 * OAuth token is checked server-side with Google, including its issuing
 * client, verified email, owner identity and read scope. No HMAC secret
 * or Drive write token is embedded in the phone.
 */
var AndroidOwnerMobileApi=(function(){
'use strict';
function fail(code,message){var e=new Error(message);e.code=code;throw e}
function need(ok,code,message){if(!ok)fail(code,message)}
function json(o){return ContentService.createTextOutput(JSON.stringify(o))
  .setMimeType(ContentService.MimeType.JSON)}
var READ_ACTIONS=['mobile.snapshot','mobile.revision','mobile.trash'];
var WRITE_ACTIONS=['orders.delete','orders.restore',
 'payments.markCustomerPaid','payments.markCustomerUnpaid',
 'payments.markSatoriPaid','payments.markSatoriUnpaid'];
var ALLOWED=READ_ACTIONS.concat(WRITE_ACTIONS);
// Owner ledger identity must be backed by the server-side STATE_FILE_ID property.
// The Android app checks these fields before showing Production as synced.
var PRODUCTION_FILE_ID='14XWSPrxLnKXATwmuHeXGZnCvjDbalghV';
var LEDGER_KIND='minh-satori-owner-drive-v15';
function productionLedgerProof(state){
 var actual=String(PropertiesService.getScriptProperties().getProperty('STATE_FILE_ID')||'').trim();
 need(actual===PRODUCTION_FILE_ID,'WRONG_LEDGER_SOURCE',
   'This Apps Script deployment is not connected to Minh Satori Production');
 need(state&&Number.isSafeInteger(state.revision)&&state.revision>=133,
   'WRONG_LEDGER_SOURCE','This Mobile API is reading an outdated or test ledger');
 return {ledgerFileId:actual,ledgerKind:LEDGER_KIND};
}
function verify(token){
 need(typeof token==='string'&&token.length>=20&&token.length<=3500&&
   /^[A-Za-z0-9._~-]+$/.test(token),'AUTH_FAILED','Invalid owner OAuth token');
 var props=PropertiesService.getScriptProperties();
 var owner=String(props.getProperty('SATORI_ANDROID_OWNER_EMAIL')||'')
   .trim().toLowerCase();
 var effective=String(Session.getEffectiveUser().getEmail()||'')
   .trim().toLowerCase();
 need(owner&&owner===String(OWNER_EMAIL||'').toLowerCase()&&owner===effective,
   'OWNER_NOT_CONFIGURED','Only current Minh Satori owner may access production');
 var clients;
 try{clients=JSON.parse(props.getProperty('SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON')||'[]')}
 catch(_){fail('OAUTH_NOT_CONFIGURED','Invalid OAuth client allowlist')}
 need(Array.isArray(clients)&&clients.length>0&&clients.length<=20&&
   clients.every(function(x){return typeof x==='string'&&
     /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(x)}),
   'OAUTH_NOT_CONFIGURED','Owner Android OAuth clients not configured');
 // Google verifies expiry + issuing OAuth client; browser-supplied email is
 // never trusted. OAuth access tokens must not be saved or logged.
 var tokenInfo=UrlFetchApp.fetch(
   'https://oauth2.googleapis.com/tokeninfo?access_token='+encodeURIComponent(token),
   {method:'get',muteHttpExceptions:true,followRedirects:false});
 need(tokenInfo.getResponseCode()===200,'AUTH_FAILED','Google rejected the OAuth token');
 var info=JSON.parse(tokenInfo.getContentText());
 var issued=String(info.issued_to||info.azp||info.aud||'');
 need(clients.indexOf(issued)>=0,'FORBIDDEN','OAuth client not allowed');
 need(String(info.scope||'').split(/\s+/).indexOf(
   'https://www.googleapis.com/auth/userinfo.email')>=0,
   'FORBIDDEN','Missing owner email scope');
 need(Number(info.expires_in)>0,'AUTH_FAILED','Expired OAuth token');
 var me=UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/userinfo',{
   method:'get',muteHttpExceptions:true,followRedirects:false,
   headers:{Authorization:'Bearer '+token}});
 need(me.getResponseCode()===200,'AUTH_FAILED','Google owner verification failed');
 var who=JSON.parse(me.getContentText());
 need(who.email_verified===true&&
   String(who.email||'').trim().toLowerCase()===owner&&
   /^[0-9]{5,40}$/.test(String(who.sub||'')),
   'FORBIDDEN','Google account is not verified owner');
 return {actorId:String(who.sub)};
}
function trash(state){
 var bin=JSON.parse(state.values.satori_trash_bin_v15||'[]');
 need(Array.isArray(bin)&&bin.length<=50000,'INVALID_STATE','Invalid trash');
 var now=Date.now();
 var rows=bin.filter(function(t){return t&&t.order&&
   Number.isFinite(t.deletedAt)&&t.deletedAt<=now&&
   now-t.deletedAt<30*86400000&&(!t.expiresAt||t.expiresAt>now)});
 return {revision:state.revision,orders:rows.slice(0,100).map(function(t){
   return {id:String(t.order.id),invoiceNo:Number(t.order.invoiceNo),
     name:String(t.order.name||''),total:Number(t.order.total||0),
     deletedAt:t.deletedAt,expiresAt:t.expiresAt||t.deletedAt+30*86400000,
     deleteRequestId:String(t.apiDeleteRequestId||'')};
 })};
}
function handle(e){
 try{
  var raw=e&&e.postData&&e.postData.contents;
  need(typeof raw==='string'&&raw.length>=20&&raw.length<=120000,
    'INVALID_REQUEST','Invalid Android request size');
  var req=JSON.parse(raw);
  need(req&&req.kind==='satori-android-v1'&&
    ALLOWED.indexOf(req.action)>=0,'INVALID_ACTION','Unsupported owner command');
  need(req.payload&&typeof req.payload==='object'&&!Array.isArray(req.payload),
    'INVALID_REQUEST','Invalid action payload');
  need(/^[A-Za-z0-9_-]{16,128}$/.test(String(req.nonce||'')),
    'INVALID_REQUEST','Missing nonce');
  var actor=verify(req.accessToken),action=req.action,requestId=req.payload.requestId;
  if(WRITE_ACTIONS.indexOf(action)>=0){
    // Only execute owner financial writes against the verified canonical ledger.
    productionLedgerProof(readState_());
    need(typeof requestId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(requestId),
      'INVALID_REQUEST','Missing idempotency requestId');
    // Reuse the identical production BotApi guards: expectedRevision, exact
    // invoice ID/name/total, protected paid invoices, shared lock, readback,
    // prewrite backup and 30-day soft-delete bin. No direct JSON PATCH.
    need(typeof SatoriBotApi!=='undefined'&&
      typeof SatoriBotApi.ownerMobileWrite==='function',
      'API_NOT_READY','Bot API owner write bridge missing');
    var result=SatoriBotApi.ownerMobileWrite(action,req.payload,req.nonce);
    return json({ok:true,action:action,revision:result.revision,
      data:result.data,backupCreated:result.backupCreated});
  }
  var s=readState_();
  need(s&&Number.isSafeInteger(s.revision)&&s.values&&
    typeof s.values.satori_orders_v15==='string',
    'INVALID_STATE','Invalid owner Drive ledger');
  var proof=productionLedgerProof(s);
  if(action==='mobile.revision')return json({ok:true,action:action,
    data:{revision:s.revision,updatedAt:s.updatedAt,
      ledgerFileId:proof.ledgerFileId,ledgerKind:proof.ledgerKind},
    revision:s.revision});
  if(action==='mobile.trash')return json({ok:true,action:action,
    data:trash(s),revision:s.revision});
  // No privileged owner secrets, state-file IDs, payment keys, PDF bytes or
  // entire Script Properties may be returned to the Android device.
  var keys=['satori_orders_v15','satori_catalogue_v15',
    'satori_ai_customer_memory'];
  var values={};keys.forEach(function(k){if(typeof s.values[k]==='string')
    values[k]=s.values[k]});
  return json({ok:true,action:action,revision:s.revision,
    data:{revision:s.revision,updatedAt:s.updatedAt,values:values,
      ledgerFileId:proof.ledgerFileId,ledgerKind:proof.ledgerKind,
      allowedActions:READ_ACTIONS.concat(WRITE_ACTIONS),
      actorId:actor.actorId}});
 }catch(ex){
  var code=String(ex&&ex.code||'ERROR').slice(0,55);
  // Fail closed and do not echo token, request body or customer data.
  return json({ok:false,error:{code:code,message:
    ex&&ex.code?String(ex.message||'Request rejected').slice(0,160):
      'Owner Mobile API request failed'}});
 }
}
return {handle:handle};
})();
