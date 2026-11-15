/**
 * Minh Satori — one-time scope grant for the Grok ledger tools (PR follow-up to #428).
 * OWNER-ONLY. Paste into the SAME Apps Script project as BotApi.gs, fill the two
 * key IDs below (key IDs are NOT secrets), then run from the editor in this order:
 *   1) satoriGrokScopesCheck()     read-only: prints key IDs, scopes, role, secret LENGTH only
 *   2) satoriGrokScopesApply()     backs up SATORI_BOT_CLIENTS_JSON, then changes ONLY scopes/role
 *   3) satoriGrokScopesCheck()     confirm
 * Rollback: satoriGrokScopesRollback() restores the exact backup.
 * After production validation: satoriGrokScopesClearBackup() removes the backup property.
 *
 * Never logs or returns a secret. Never creates a key. Never changes a secret or `enabled`.
 * Refuses to give orders:update (or any write scope) to the READ key.
 */
// = Render env SATORI_V2_CANONICAL_WRITE_KEY_ID (V2 WRITER key). Fill before running.
var SATORI_GROK_WRITER_KEY_ID='';
// = Render env SATORI_READ_KEY_ID (V2 READ key). Fill before running.
var SATORI_GROK_READER_KEY_ID='';

var SATORI_GROK_SCOPES_={
 property:'SATORI_BOT_CLIENTS_JSON',
 backup:'SATORI_BOT_CLIENTS_JSON_BACKUP_GROK_20261115',
 writerAdd:['orders:cancel','orders:delete'],
 readerAdd:['debt:read'],
 readerRole:'owner',
 readerForbidden:['orders:update','orders:write','orders:delete','orders:cancel','payments:write','customers:write','orders:ai:write','pricing:approve']
};
function satoriGrokScopesLoad_(props){
 var raw=props.getProperty(SATORI_GROK_SCOPES_.property);
 if(!raw)throw Error('MISSING_SATORI_BOT_CLIENTS_JSON_DO_NOT_CREATE');
 var clients=JSON.parse(raw);
 if(!clients||typeof clients!=='object'||Array.isArray(clients))throw Error('INVALID_SATORI_BOT_CLIENTS_JSON');
 return {raw:raw,clients:clients};
}
function satoriGrokScopesIds_(clients){
 var w=String(SATORI_GROK_WRITER_KEY_ID||''),r=String(SATORI_GROK_READER_KEY_ID||'');
 if(!/^[A-Za-z0-9_-]{3,64}$/.test(w)||!/^[A-Za-z0-9_-]{3,64}$/.test(r))throw Error('FILL_WRITER_AND_READER_KEY_IDS_FIRST');
 if(w===r)throw Error('WRITER_AND_READER_MUST_BE_DIFFERENT_KEYS');
 [w,r].forEach(function(id){
  var c=Object.prototype.hasOwnProperty.call(clients,id)?clients[id]:null;
  if(!c||typeof c.secret!=='string'||c.secret.length<32||!Array.isArray(c.scopes))throw Error('KEY_NOT_FOUND_OR_INVALID:'+id);
 });
 return {writer:w,reader:r};
}
function satoriGrokScopesDescribe_(clients){
 return Object.keys(clients).sort().map(function(id){
  var c=clients[id]||{};
  return id+' enabled='+(c.enabled!==false)+' role='+(c.role||'-')+' secretLength='+(typeof c.secret==='string'?c.secret.length:0)+
   ' scopes='+(Array.isArray(c.scopes)?c.scopes.join(','):'-');
 });
}
function satoriGrokScopesCheck(){
 var loaded=satoriGrokScopesLoad_(PropertiesService.getScriptProperties());
 satoriGrokScopesDescribe_(loaded.clients).forEach(function(line){console.log(line)});
 return 'CHECK_DONE_NO_SECRETS_PRINTED';
}
function satoriGrokScopesApply(){
 var lock=LockService.getScriptLock();lock.waitLock(30000);
 try{
  var props=PropertiesService.getScriptProperties(),cfg=SATORI_GROK_SCOPES_;
  var loaded=satoriGrokScopesLoad_(props),clients=loaded.clients,ids=satoriGrokScopesIds_(clients);
  if(props.getProperty(cfg.backup))throw Error('BACKUP_ALREADY_EXISTS_RUN_ROLLBACK_OR_CLEAR_FIRST');
  var reader=clients[ids.reader],writer=clients[ids.writer];
  var bad=reader.scopes.filter(function(s){return cfg.readerForbidden.indexOf(s)>=0});
  if(bad.length)throw Error('READER_KEY_ALREADY_HAS_WRITE_SCOPE_STOP:'+bad.join(','));
  var before={};Object.keys(clients).forEach(function(id){before[id]=clients[id].secret});
  cfg.writerAdd.forEach(function(s){if(writer.scopes.indexOf(s)<0)writer.scopes.push(s)});
  cfg.readerAdd.forEach(function(s){if(reader.scopes.indexOf(s)<0)reader.scopes.push(s)});
  reader.role=cfg.readerRole;
  var encoded=JSON.stringify(clients);
  if(encoded.length>8500)throw Error('SCRIPT_PROPERTY_TOO_LARGE');
  props.setProperty(cfg.backup,loaded.raw);
  if(props.getProperty(cfg.backup)!==loaded.raw)throw Error('BACKUP_READBACK_FAILED_NOTHING_CHANGED');
  props.setProperty(cfg.property,encoded);
  var after=JSON.parse(props.getProperty(cfg.property));
  Object.keys(before).forEach(function(id){if(!after[id]||after[id].secret!==before[id])throw Error('SECRET_CHANGED_RUN_ROLLBACK:'+id)});
  if(Object.keys(after).length!==Object.keys(before).length)throw Error('KEY_COUNT_CHANGED_RUN_ROLLBACK');
  if(after[ids.reader].role!=='owner'||after[ids.reader].scopes.some(function(s){return cfg.readerForbidden.indexOf(s)>=0}))
   throw Error('READER_CHECK_FAILED_RUN_ROLLBACK');
  satoriGrokScopesDescribe_(after).forEach(function(line){console.log(line)});
  return 'APPLY_DONE_BACKUP_IN_'+cfg.backup;
 }finally{lock.releaseLock()}
}
function satoriGrokScopesRollback(){
 var lock=LockService.getScriptLock();lock.waitLock(30000);
 try{
  var props=PropertiesService.getScriptProperties(),cfg=SATORI_GROK_SCOPES_,backup=props.getProperty(cfg.backup);
  if(!backup)throw Error('NO_BACKUP_NOTHING_TO_ROLLBACK');
  JSON.parse(backup);
  props.setProperty(cfg.property,backup);
  if(props.getProperty(cfg.property)!==backup)throw Error('ROLLBACK_READBACK_FAILED');
  return 'ROLLBACK_DONE_BACKUP_KEPT';
 }finally{lock.releaseLock()}
}
function satoriGrokScopesClearBackup(){
 var props=PropertiesService.getScriptProperties();
 if(!props.getProperty(SATORI_GROK_SCOPES_.backup))return 'NO_BACKUP';
 props.deleteProperty(SATORI_GROK_SCOPES_.backup);
 return 'BACKUP_CLEARED';
}
