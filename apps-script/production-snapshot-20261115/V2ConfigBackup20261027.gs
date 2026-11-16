function v2BackupConfig20261027() {
  requireOwner_();
  var folder = DriveApp.getFolderById('REDACTED_CONFIG_BACKUP_FOLDER_ID');
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE || folder.getEditors().length || folder.getViewers().length) throw Error('BACKUP_FOLDER_NOT_PRIVATE');
  var properties = PropertiesService.getScriptProperties().getProperties();
  JSON.parse(properties.SATORI_BOT_CLIENTS_JSON);
  var body = JSON.stringify({createdAt:new Date().toISOString(),scriptId:ScriptApp.getScriptId(),properties:properties});
  var file = folder.createFile('MinhSatori_CONFIG_PRE_V2_20261027_' + Date.now() + '.json', body, MimeType.PLAIN_TEXT);
  if (file.getSharingAccess() !== DriveApp.Access.PRIVATE || file.getEditors().length || file.getViewers().length) throw Error('BACKUP_FILE_NOT_PRIVATE');
  if (file.getBlob().getDataAsString() !== body) throw Error('BACKUP_READBACK_FAILED');
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, body, Utilities.Charset.UTF_8).map(function(b){return ('0'+(b&255).toString(16)).slice(-2)}).join('');
  console.log(JSON.stringify({ok:true,fileId:file.getId(),sha256:hash,propertyCount:Object.keys(properties).length,readbackVerified:true}));
}

function v2ProbeCatalogue20261027() {
 requireOwner_();
 var clients = JSON.parse(PropertiesService.getScriptProperties().getProperty('SATORI_BOT_CLIENTS_JSON'));
 var endpoint = 'https://script.google.com/macros/s/REDACTED_DEPLOYMENT_ID/exec';
 function request(id,mode) {
  var e={keyId:id,timestamp:Date.now()-(mode==='expired'?600000:0),nonce:Utilities.getUuid().replace(/-/g,''),action:'catalogue.list',payload:{}};
  var message=[e.keyId,e.timestamp,e.nonce,e.action,JSON.stringify(e.payload)].join('\n');
  e.signature=Utilities.computeHmacSha256Signature(message,clients[id].secret,Utilities.Charset.UTF_8).map(function(b){return ('0'+(b&255).toString(16)).slice(-2)}).join('');
  if(mode==='tampered')e.signature='0'.repeat(64);
  var response=UrlFetchApp.fetch(endpoint,{method:'post',contentType:'application/json',payload:JSON.stringify(e),muteHttpExceptions:true});
  var packet;try{packet=JSON.parse(response.getContentText())}catch(err){return {http:response.getResponseCode(),json:false}}
  if(mode!=='valid')return {ok:packet.ok===true,error:packet.error&&typeof packet.error==='object'?packet.error.code:packet.error};
  var data=packet.data||{};
  var products=Array.isArray(data.products)?data.products:[];
  var seen={};var duplicates=[];products.forEach(function(p){if(seen[p.code])duplicates.push(p.code);seen[p.code]=true});
  return {ok:packet.ok===true,action:packet.action,revision:packet.revision,source:data.source,dataRevision:data.revision,count:products.length,duplicates:duplicates,focus:products.filter(function(p){return p.code==='TP-00003'||p.code==='TP-00058'}).map(function(p){return {code:p.code,name:p.name,unit:p.unit,listPrice:p.listPrice}})};
 }
 console.log(JSON.stringify({valid:request('v2_catalogue_read_20261027','valid'),tampered:request('v2_catalogue_read_20261027','tampered'),expired:request('v2_catalogue_read_20261027','expired'),missingScope:request('minhsatori_bot_2026','missingScope')}));
}

function v2CreateCatalogueClient20261027() {
 requireOwner_();
 var lock=LockService.getScriptLock();lock.waitLock(30000);
 try {
  var p=PropertiesService.getScriptProperties(),raw=p.getProperty('SATORI_BOT_CLIENTS_JSON');
  var c=JSON.parse(raw),id='v2_catalogue_read_20261027';
  if(c[id])throw Error('CLIENT_ALREADY_EXISTS_NO_CHANGE');
  Object.keys(c).forEach(function(k){if(!c[k]||typeof c[k].secret!=='string'||!Array.isArray(c[k].scopes))throw Error('EXISTING_CLIENT_INVALID')});
  v2BackupConfig20261027();
  var seed=Utilities.getUuid()+Utilities.getUuid()+Utilities.getUuid();
  var secret=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,seed,Utilities.Charset.UTF_8).map(function(b){return ('0'+(b&255).toString(16)).slice(-2)}).join('');
  c[id]={enabled:true,secret:secret,scopes:['catalogue:read']};
  p.setProperty('SATORI_BOT_CLIENTS_JSON',JSON.stringify(c));
  var after=JSON.parse(p.getProperty('SATORI_BOT_CLIENTS_JSON')),before=JSON.parse(raw);
  if(Object.keys(before).some(function(k){return JSON.stringify(before[k])!==JSON.stringify(after[k])}))throw Error('EXISTING_CLIENT_CHANGED');
  if(JSON.stringify(after[id])!==JSON.stringify(c[id]))throw Error('CLIENT_READBACK_FAILED');
  console.log(JSON.stringify({ok:true,clientId:id,scope:'catalogue:read',existingClientsPreserved:true}));
 } finally {lock.releaseLock()}
}
