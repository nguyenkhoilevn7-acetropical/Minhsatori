/**
 * Minh Satori — Grok ledger add-on for the signed Bot API.
 * STAGING SOURCE ONLY: not deployed by this PR. Owner deploys after review.
 *
 * WHY AN ADD-ON: the production BotApi.gs differs from GitHub (main and the V2
 * feature branch disagree, and production may run actions not in GitHub).
 * Editing inside SatoriBotApi would risk breaking live actions. This file does
 * NOT touch SatoriBotApi. One line at the top of doPost(e) asks it first:
 *   if(typeof SatoriGrokLedgerApi!=='undefined'){var grokLedger=SatoriGrokLedgerApi.tryHandle(e);if(grokLedger)return grokLedger;}
 *
 * tryHandle(e) returns null (=> the existing BotApi handles the request exactly
 * as today) unless ALL of these hold:
 *   - no ?route=... parameter (Android owner route untouched)
 *   - body is JSON with action 'orders.cancel' or 'orders.auditHistory'
 *   - Script Property SATORI_GROK_LEDGER_ENABLED === '1' (kill switch, no redeploy)
 *
 * Same guarantees as BotApi.gs: HMAC-SHA256 over keyId\ntimestamp\nnonce\naction\npayload,
 * 5-minute timestamp window, keys from SATORI_BOT_CLIENTS_JSON, the SAME script lock,
 * the SAME replay cache namespace ('satoriapi:'+keyId+':'+nonce), revision check,
 * verified pre-write Drive backup, read-back verification, same response shape.
 *
 *   orders.cancel       scope orders:cancel           -> SatoriOrderCancel.cancel (BotApiOrderCancel.gs)
 *   orders.auditHistory scope orders:read + role owner -> SatoriOrderAuditHistory.read (read-only)
 * orders.previewUpdate / orders.update are deliberately NOT handled here.
 */
var SatoriGrokLedgerApi=(function(){
'use strict';
var ORDER_KEY='satori_orders_v15',FLAG='SATORI_GROK_LEDGER_ENABLED';
var ACTIONS={
 'orders.cancel':{scope:'orders:cancel',write:true,owner:false},
 'orders.auditHistory':{scope:'orders:read',write:false,owner:true}
};
function fail(code,message){var e=new Error(message);e.code=code;throw e;}
function need(x,code,message){if(!x)fail(code,message);}
function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function signed(secret,data){return Utilities.computeHmacSha256Signature(data,secret,Utilities.Charset.UTF_8).map(function(b){return ('0'+(b&255).toString(16)).slice(-2)}).join('');}
function equalSig(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;var x=0;for(var i=0;i<64;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
function auth(o){
 need(/^[a-zA-Z0-9_-]{3,64}$/.test(o.keyId||'')&&/^[a-zA-Z0-9_-]{16,128}$/.test(o.nonce||''),'AUTH_FAILED','Không thể xác thực');
 need(Number.isSafeInteger(o.timestamp)&&Math.abs(Date.now()-o.timestamp)<300000,'EXPIRED','Yêu cầu hết hạn');
 var rule=ACTIONS[o.action];
 var all=JSON.parse(PropertiesService.getScriptProperties().getProperty('SATORI_BOT_CLIENTS_JSON')||'{}');
 var client=Object.prototype.hasOwnProperty.call(all,o.keyId)?all[o.keyId]:null;
 need(client&&client.enabled!==false&&typeof client.secret==='string'&&client.secret.length>=32,'AUTH_FAILED','Không thể xác thực');
 var p=o.payload==null?{}:o.payload;
 need(p&&typeof p==='object'&&!Array.isArray(p),'INVALID_REQUEST','Payload không hợp lệ');
 var msg=[o.keyId,o.timestamp,o.nonce,o.action,JSON.stringify(p)].join('\n');
 need(equalSig(signed(client.secret,msg),o.signature),'AUTH_FAILED','Không thể xác thực');
 need(Array.isArray(client.scopes)&&client.scopes.indexOf(rule.scope)>=0,'FORBIDDEN','Bot không có quyền');
 need(!rule.owner||client.role==='owner','FORBIDDEN','Bot không có quyền');
 return {action:o.action,payload:p,keyId:o.keyId,nonce:o.keyId+':'+o.nonce,rule:rule};
}
function state(){
 var x=readState_();need(Number.isInteger(x.revision)&&x.values&&typeof x.values[ORDER_KEY]==='string','INVALID_STATE','Dữ liệu Drive không hợp lệ');return x;
}
function rows(s){var x=JSON.parse(s.values[ORDER_KEY]);need(Array.isArray(x),'INVALID_STATE','Dữ liệu hóa đơn hỏng');return x;}
/** Commit exactly like BotApi.gs write(): verified pre-write backup, then read-back check. */
function commit(s,all,result){
 if(!result.modified)return {revision:s.revision,data:result.result};
 var fileId=PropertiesService.getScriptProperties().getProperty('STATE_FILE_ID');
 need(!!fileId,'CONFIG_MISSING','Thiếu STATE_FILE_ID');
 var file=DriveApp.getFileById(fileId);
 var backup=file.makeCopy('MinhSatori_API_PreWrite_'+new Date().toISOString().replace(/[:.]/g,'-'));
 need(backup&&backup.getId(),'BACKUP_FAILED','Không tạo được bản sao trước ghi');
 var backedUp=JSON.parse(backup.getBlob().getDataAsString());
 need(JSON.stringify(backedUp)===JSON.stringify(s),'BACKUP_FAILED','Bản sao trước ghi không khớp dữ liệu hiện tại');
 var next={revision:s.revision+1,values:Object.assign({},s.values),updatedAt:new Date().toISOString()};
 next.values[ORDER_KEY]=JSON.stringify(all);
 if(result.extras)Object.keys(result.extras).forEach(function(k){next.values[k]=result.extras[k]});
 file.setContent(JSON.stringify(next));
 var check=state();need(check.revision===next.revision&&check.values[ORDER_KEY]===next.values[ORDER_KEY]&&
  (!result.extras||Object.keys(result.extras).every(function(k){return check.values[k]===result.extras[k]})),
  'COMMIT_UNVERIFIED','Chưa xác minh được ghi dữ liệu');
 return {revision:next.revision,data:result.result,backupCreated:true};
}
function run(o){
 try{
  var identity=auth(o),lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
   var cache=CacheService.getScriptCache(),key='satoriapi:'+identity.nonce;
   need(!cache.get(key),'REPLAYED','Lệnh đã sử dụng');
   var s=state(),all=rows(s),result;
   if(identity.action==='orders.cancel'){
    need(typeof SatoriOrderCancel!=='undefined','CONFIG_MISSING','Thiếu BotApiOrderCancel.gs');
    result=commit(s,all,SatoriOrderCancel.cancel(s,all,identity.payload,'botapi:'+identity.keyId));
   }else{
    need(typeof SatoriOrderAuditHistory!=='undefined','CONFIG_MISSING','Thiếu BotApiOrderAuditHistory.gs');
    result={revision:s.revision,data:SatoriOrderAuditHistory.read(s,all,identity.payload)};
   }
   cache.put(key,'1',600);
   return json({ok:true,action:identity.action,revision:result.revision,data:result.data,backupCreated:!!result.backupCreated});
  }finally{lock.releaseLock()}
 }catch(err){return json({ok:false,error:{code:err.code||'ERROR',message:err.code?err.message:'Không xử lý được; kiểm tra nhật ký hệ thống'}})}
}
/** null => not ours (or switched off): the caller continues with SatoriBotApi.handle(e). */
function tryHandle(e){
 var o;
 try{
  if(!e||(e.parameter&&e.parameter.route))return null;
  var raw=e.postData&&e.postData.contents;
  if(typeof raw!=='string'||raw.length>100000)return null;
  o=JSON.parse(raw);
  if(!o||typeof o!=='object'||Array.isArray(o)||typeof o.action!=='string'||
   !Object.prototype.hasOwnProperty.call(ACTIONS,o.action))return null;
  if(PropertiesService.getScriptProperties().getProperty(FLAG)!=='1')return null;
 }catch(x){return null}
 return run(o);
}
return {tryHandle:tryHandle,ACTIONS:Object.keys(ACTIONS)};
})();
