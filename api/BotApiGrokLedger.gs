/**
 * Minh Satori — Grok ledger add-on for the signed Bot API.
 * STAGING SOURCE ONLY: not deployed by this PR. Owner deploys after review.
 * Written against the REAL production code: apps-script/production-snapshot-20261115/BotApi.gs.
 *
 * SatoriBotApi is NOT edited. One line at the top of doPost(e) asks this file first:
 *   if(typeof SatoriGrokLedgerApi!=='undefined'){var grokLedger=SatoriGrokLedgerApi.tryHandle(e);if(grokLedger)return grokLedger;}
 * tryHandle(e) returns null (=> production handles the request exactly as today) unless:
 *
 * 1) orders.cancel  AND Script Property SATORI_GROK_LEDGER_ENABLED === '1'
 *    Production has no orders.cancel, so nothing existing is replaced.
 *    Scope orders:cancel. Same HMAC rule, same script lock, same replay cache
 *    ('satoriapi:'+keyId+':'+nonce), revision check, verified pre-write Drive backup,
 *    read-back check and response shape as production BotApi. actor = 'hmac:'+keyId
 *    (same format production uses for orders.update).
 *
 * 2) orders.auditHistory  AND Script Property SATORI_GROK_AUDIT_CANCEL_MERGE === '1'
 *    Production ALREADY has orders.auditHistory (role owner/admin, edit log
 *    satori_order_edit_audit_v1) and ChatGPT uses it. This add-on never replaces it:
 *    it calls SatoriBotApi.handle(e) itself (production auth, role, replay, lock),
 *    then only APPENDS the matching rows of satori_order_cancel_audit_v1, each marked
 *    kind:'cancel', auditSource:'satori_order_cancel_audit_v1' (original fields kept). Any doubt (error, revision moved, bad data) => production answer unchanged.
 *
 * orders.previewUpdate / orders.update are never touched.
 */
var SatoriGrokLedgerApi=(function(){
'use strict';
var ORDER_KEY='satori_orders_v15',CANCEL_KEY='satori_order_cancel_audit_v1';
var CANCEL_FLAG='SATORI_GROK_LEDGER_ENABLED',MERGE_FLAG='SATORI_GROK_AUDIT_CANCEL_MERGE';
function fail(code,message){var e=new Error(message);e.code=code;throw e;}
function need(x,code,message){if(!x)fail(code,message);}
function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function prop(k){return PropertiesService.getScriptProperties().getProperty(k);}
function signed(secret,data){return Utilities.computeHmacSha256Signature(data,secret,Utilities.Charset.UTF_8).map(function(b){return ('0'+(b&255).toString(16)).slice(-2)}).join('');}
function equalSig(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;var x=0;for(var i=0;i<64;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
function auth(o){
 need(/^[a-zA-Z0-9_-]{3,64}$/.test(o.keyId||'')&&/^[a-zA-Z0-9_-]{16,128}$/.test(o.nonce||''),'AUTH_FAILED','Không thể xác thực');
 need(Number.isSafeInteger(o.timestamp)&&Math.abs(Date.now()-o.timestamp)<300000,'EXPIRED','Yêu cầu hết hạn');
 var all=JSON.parse(prop('SATORI_BOT_CLIENTS_JSON')||'{}');
 var client=Object.prototype.hasOwnProperty.call(all,o.keyId)?all[o.keyId]:null;
 need(client&&client.enabled!==false&&typeof client.secret==='string'&&client.secret.length>=32,'AUTH_FAILED','Không thể xác thực');
 need(Array.isArray(client.scopes)&&client.scopes.indexOf('orders:cancel')>=0,'FORBIDDEN','Bot không có quyền');
 var p=o.payload==null?{}:o.payload;
 need(p&&typeof p==='object'&&!Array.isArray(p),'INVALID_REQUEST','Payload không hợp lệ');
 var msg=[o.keyId,o.timestamp,o.nonce,o.action,JSON.stringify(p)].join('\n');
 need(equalSig(signed(client.secret,msg),o.signature),'AUTH_FAILED','Không thể xác thực');
 return {action:o.action,payload:p,nonce:o.keyId+':'+o.nonce,actor:'hmac:'+o.keyId};
}
function state(){
 var x=readState_();need(Number.isInteger(x.revision)&&x.values&&typeof x.values[ORDER_KEY]==='string','INVALID_STATE','Dữ liệu Drive không hợp lệ');return x;
}
function rows(s){var x=JSON.parse(s.values[ORDER_KEY]);need(Array.isArray(x),'INVALID_STATE','Dữ liệu hóa đơn hỏng');return x;}
/** Same commit as production BotApi write(): verified pre-write backup, then read-back check. */
function commit(s,all,result){
 if(!result.modified)return {revision:s.revision,data:result.result};
 var fileId=prop('STATE_FILE_ID');
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
function cancel(o){
 try{
  var identity=auth(o),lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
   var cache=CacheService.getScriptCache(),key='satoriapi:'+identity.nonce;
   need(!cache.get(key),'REPLAYED','Lệnh đã sử dụng');
   need(typeof SatoriOrderCancel!=='undefined','CONFIG_MISSING','Thiếu BotApiOrderCancel.gs');
   var s=state(),all=rows(s);
   var result=commit(s,all,SatoriOrderCancel.cancel(s,all,identity.payload,identity.actor));
   cache.put(key,'1',600);
   return json({ok:true,action:identity.action,revision:result.revision,data:result.data,backupCreated:!!result.backupCreated});
  }finally{lock.releaseLock()}
 }catch(err){return json({ok:false,error:{code:err.code||'ERROR',message:err.code?err.message:'Không xử lý được; kiểm tra nhật ký hệ thống'}})}
}
function timeOf(x){
 var v=x&&(x.timestamp!=null?x.timestamp:x.at);
 var t=typeof v==='number'?v:Date.parse(String(v==null?'':v));
 return Number.isFinite(t)?t:null;
}
/** Production answers first; cancel rows are only appended to a successful answer. */
function mergeCancelHistory(e){
 var out=SatoriBotApi.handle(e);
 try{
  var r=JSON.parse(out.getContent());
  if(!r||r.ok!==true||!r.data||!Array.isArray(r.data.entries))return out;
  var s=readState_();
  if(!s||s.revision!==r.revision||!s.values)return out;
  var log=JSON.parse(s.values[CANCEL_KEY]||'[]');
  if(!Array.isArray(log))return out;
  var mine=log.filter(function(x){return x&&String(x.id)===String(r.data.id)&&Number(x.invoiceNo)===Number(r.data.invoiceNo)});
  if(!mine.length)return out;
  var merged=r.data.entries.concat(mine.map(function(x){return Object.assign({timestamp:x.at},x,{kind:'cancel',auditSource:CANCEL_KEY})}));
  var indexed=merged.map(function(x,i){return {x:x,i:i,t:timeOf(x)}});
  indexed.sort(function(a,b){
   if(a.t!=null&&b.t!=null&&a.t!==b.t)return a.t-b.t;
   if(a.t==null&&b.t!=null)return 1;if(b.t==null&&a.t!=null)return -1;return a.i-b.i;
  });
  r.data.entries=indexed.map(function(v){return v.x});
  r.data.cancelEntriesMerged=mine.length;
  return json(r);
 }catch(x){return out}
}
/** null => not ours or switched off: the caller continues with production doPost unchanged. */
function tryHandle(e){
 var o;
 try{
  if(!e||(e.parameter&&e.parameter.route))return null;
  var raw=e.postData&&e.postData.contents;
  if(typeof raw!=='string'||raw.length>100000)return null;
  o=JSON.parse(raw);
  if(!o||typeof o!=='object'||Array.isArray(o)||typeof o.action!=='string')return null;
  if(o.action==='orders.cancel'){if(prop(CANCEL_FLAG)!=='1')return null;}
  else if(o.action==='orders.auditHistory'){
   if(prop(MERGE_FLAG)!=='1'||typeof SatoriBotApi==='undefined')return null;
   return mergeCancelHistory(e);
  }
  else return null;
 }catch(x){return null}
 return cancel(o);
}
return {tryHandle:tryHandle};
})();
