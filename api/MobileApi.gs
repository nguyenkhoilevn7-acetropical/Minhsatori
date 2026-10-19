/**
 * Minh Satori Android owner API.
 * Put in the SAME Apps Script project/deployment as BotApi.gs + readState_().
 * Requires Google OAuth access token from Android Google Identity, never an
 * HMAC secret in the APK. Existing HMAC doPost route remains unchanged.
 *
 * Script Properties (set manually in server project; never commit secret values):
 *  SATORI_ANDROID_OWNER_EMAIL — the authorized business owner's email.
 *  SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON — JSON array of OAuth client IDs
 *  issued to authorized Android signing certificate/package (and optional
 *  trusted OAuth clients).
 * Needs UrlFetchApp scope and the script's existing Drive API permissions.
 *
 * IMPORTANT: deploying the GitHub files does NOT deploy Apps Script;
 * update a staging GAS deployment first, then deploy production separately.
 */
var SatoriMobileApi=(function(){
'use strict';
function fail(code,message){var ex=new Error(message);ex.code=code;throw ex;}
function need(value,code,message){if(!value)fail(code,message);}
function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function props(){return PropertiesService.getScriptProperties();}
function verifyOwner(accessToken){
 need(typeof accessToken==='string'&&accessToken.length>=20&&accessToken.length<=4096,
   'AUTH_FAILED','Thiếu phiên đăng nhập Google');
 var config=props();
 var owner=String(config.getProperty('SATORI_ANDROID_OWNER_EMAIL')||'').trim().toLowerCase();
 var clients;
 try{clients=JSON.parse(config.getProperty('SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON')||'[]')}
 catch(e){clients=[]}
 need(owner&&Array.isArray(clients)&&clients.length>0&&clients.length<=20,
   'MOBILE_NOT_CONFIGURED','Ứng dụng chưa được chủ sở hữu kích hoạt trên Apps Script');
 // Google tokeninfo checks token validity, expiry, issued app ID and scopes.
 var url='https://oauth2.googleapis.com/tokeninfo?access_token='+encodeURIComponent(accessToken);
 var verified=UrlFetchApp.fetch(url,{method:'get',muteHttpExceptions:true,followRedirects:false});
 need(verified.getResponseCode()===200,'AUTH_FAILED','Phiên Google không hợp lệ hoặc đã hết hạn');
 var info=JSON.parse(verified.getContentText());
 var audience=String(info.aud||info.issued_to||info.audience||'');
 need(clients.includes(audience),'FORBIDDEN','Ứng dụng Android chưa được cấp quyền');
 need(Number(info.expires_in)>0,'AUTH_FAILED','Phiên Google đã hết hạn');
 var scopes=String(info.scope||'').split(/\s+/);
 need(scopes.includes('https://www.googleapis.com/auth/userinfo.email')||
      scopes.includes('email'), 'FORBIDDEN','Phiên Google chưa cấp quyền kiểm tra email');
 // The authenticated profile is fetched server-to-server with the bearer token;
 // NEVER trust an email sent by the phone.
 var profileResponse=UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/userinfo',{
   method:'get',muteHttpExceptions:true,followRedirects:false,
   headers:{Authorization:'Bearer '+accessToken}
 });
 need(profileResponse.getResponseCode()===200,'AUTH_FAILED','Không xác minh được tài khoản Google');
 var profile=JSON.parse(profileResponse.getContentText());
 need(profile.email_verified===true&&String(profile.email||'').toLowerCase()===owner,
  'FORBIDDEN','Không phải tài khoản Google quản lý Minh Satori');
 return {email:owner,subject:String(profile.sub||'')};
}
function handle(e){
 try{
  var raw=e&&e.postData&&e.postData.contents;
  need(typeof raw==='string'&&raw.length>=2&&raw.length<=120000,
    'INVALID_REQUEST','Dữ liệu gửi lên không hợp lệ');
  var request=JSON.parse(raw);
  need(request&&request.kind==='satori-android-v1'&&typeof request.action==='string',
    'INVALID_REQUEST','Sai giao thức Android');
  verifyOwner(request.accessToken);
  var action=request.action;
  if(action==='mobile.snapshot'||action==='mobile.trash'){
    var lock=LockService.getScriptLock();lock.waitLock(30000);
    try{
      var state=readState_();
      need(state&&Number.isInteger(state.revision)&&state.values&&
       typeof state.values.satori_orders_v15==='string','INVALID_STATE',
       'Dữ liệu hóa đơn chưa sẵn sàng');
      if(action==='mobile.snapshot'){
        return json({ok:true,action:action,revision:state.revision,
         data:{revision:state.revision,updatedAt:state.updatedAt,
          values:{satori_orders_v15:state.values.satori_orders_v15,
           satori_catalogue_v15:state.values.satori_catalogue_v15||'[]'}}});
      }
      var bin=JSON.parse(state.values.satori_trash_bin_v15||'[]');
      return json({ok:true,action:action,revision:state.revision,data:{
       orders:bin.filter(function(t){return t&&t.order}).slice(0,100).map(function(t){
        return {id:t.order.id,invoiceNo:t.order.invoiceNo,name:t.order.name,
        total:t.order.total,deletedAt:t.deletedAt,expiresAt:t.expiresAt};
       })}});
    }finally{lock.releaseLock()}
  }
  need(['orders.create','orders.update','orders.delete','orders.restore',
        'payments.markCustomerPaid','system.status','orders.list',
        'customers.search','debt.summary'].includes(action),
       'INVALID_ACTION','Lệnh không hỗ trợ');
  var nonce=String(request.nonce||'');
  var outcome=SatoriBotApi.executeVerified(action,request.payload||{},nonce);
  return json(outcome);
 }catch(error){
   var recognized=typeof error.code==='string';
   return json({ok:false,error:{code:recognized?error.code:'ERROR',
    message:recognized?error.message:'Không thực hiện được tác vụ; vui lòng tải lại và thử lại'}});
 }
}
return {handle:handle,verifyOwner:verifyOwner};
})();