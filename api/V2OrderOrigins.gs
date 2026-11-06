/** Owner-only, read-only attribution of the V2 account that placed an invoice.
 *
 * Flow: PostgreSQL V2 (committed checkouts) --signed HTTPS pull--> this file's
 * time trigger --private Drive cache--> AndroidOwnerMobileApi (owner OAuth) --> Android.
 *
 * Never writes invoices, the ledger, ledger revision, permissions, prices,
 * payments or PDFs. The only thing it writes is its own private cache file.
 *
 * Script Properties (set by the owner during deployment, never in source):
 *  SATORI_V2_ORIGINS_ENDPOINT  https://<v2-service>.onrender.com/api/v2/origins/export
 *  SATORI_V2_ORIGINS_SECRET    >=32 chars, same value as Render SATORI_V2_ORIGINS_SECRET,
 *                              different from the push-wake secret
 *  SATORI_V2_ORDER_ORIGINS_FILE_ID  created/updated automatically by refresh()
 * Trigger: time-driven every 5 minutes -> satoriV2OrderOriginsRefreshTick
 */
var SatoriV2OrderOrigins=(function(){
'use strict';
var MAX_AGE_MS=30*86400000;  // committed attribution is immutable; age only guards a dead feed
var ROLES=['retail','agency','collaborator'];
var ROLE_SOURCES=['ORDER_SNAPSHOT','CURRENT_PROFILE'];
var CONTEXT='satori-v2-order-origins-v1';
var FILE_NAME='MinhSatori V2 order origins (auto, private)';
function text(v,max){return typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max}
function validEntry(r){
 return !!r&&text(r.ledgerInvoiceId,100)&&text(r.invoiceNo,24)&&/^[1-9][0-9]{0,15}$/.test(r.invoiceNo)&&
  text(r.accountId,100)&&text(r.accountName,150)&&ROLES.indexOf(r.accountRole)>=0&&
  ROLE_SOURCES.indexOf(r.roleSource)>=0&&text(r.requestId,100);
}
function validDocument(document,now){
 if(!document||document.schemaVersion!==1||document.source!=='satori-v2-postgresql-committed'||
  !Array.isArray(document.entries)||document.entries.length>50000)return false;
 var generated=Date.parse(document.generatedAt);
 return Number.isFinite(generated)&&generated<=now+60000&&now-generated<=MAX_AGE_MS;
}
/** Join a verified export with the CURRENT ledger. Pure; used by tests. */
function select(document,orders,now){
 now=now==null?Date.now():now;
 if(!validDocument(document,now)||!Array.isArray(orders))return [];
 function tally(map,k){map[k]=(map[k]||0)+1}
 var exportId=Object.create(null),exportNo=Object.create(null);
 var ledgerId=Object.create(null),ledgerNo=Object.create(null),bills=Object.create(null);
 document.entries.forEach(function(r){if(r){tally(exportId,String(r.ledgerInvoiceId));tally(exportNo,String(r.invoiceNo))}});
 orders.forEach(function(o){if(o&&o.id!=null&&o.invoiceNo!=null){
  tally(ledgerId,String(o.id));tally(ledgerNo,String(o.invoiceNo));
  bills[JSON.stringify([String(o.id),String(o.invoiceNo)])]=o;
 }});
 var result=[];
 document.entries.forEach(function(r){
  if(!validEntry(r))return;
  // Any duplicate of either half, on either side, means "not verified".
  if(exportId[r.ledgerInvoiceId]!==1||exportNo[r.invoiceNo]!==1||
   ledgerId[r.ledgerInvoiceId]!==1||ledgerNo[r.invoiceNo]!==1)return;
  var bill=bills[JSON.stringify([r.ledgerInvoiceId,r.invoiceNo])];
  if(!bill||bill.apiRequestId!==r.requestId)return;
  result.push({ledgerInvoiceId:r.ledgerInvoiceId,invoiceNo:r.invoiceNo,accountId:r.accountId,
   accountName:r.accountName,accountRole:r.accountRole,roleSource:r.roleSource});
 });
 return result;
}
function props(){return PropertiesService.getScriptProperties()}
function ownerFile(id){
 if(!/^[A-Za-z0-9_-]{10,200}$/.test(String(id||'')))return null;
 var file=DriveApp.getFileById(id);
 if(file.isTrashed()||file.getOwner().getEmail().toLowerCase()!==String(OWNER_EMAIL).toLowerCase()||
  file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getSize()>2000000)return null;
 return file;
}
/** Owner Mobile API hook: read the private cache only; never calls the network. */
function read(state){
 try{
  var file=ownerFile(props().getProperty('SATORI_V2_ORDER_ORIGINS_FILE_ID'));
  if(!file)return [];
  return select(JSON.parse(file.getBlob().getDataAsString()),JSON.parse(state.values.satori_orders_v15));
 }catch(_){return []} // Missing provenance must never break financial synchronization.
}
function hex(bytes){return bytes.map(function(b){return ('0'+(b&255).toString(16)).slice(-2)}).join('')}
/** Time trigger body. Returns a non-secret status code. */
function refresh(){
 var p=props(),status='ERROR';
 var lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))return 'BUSY';
 try{
  var endpoint=String(p.getProperty('SATORI_V2_ORIGINS_ENDPOINT')||'');
  var secret=String(p.getProperty('SATORI_V2_ORIGINS_SECRET')||'');
  if(!/^https:\/\/[a-z0-9-]+\.onrender\.com\/api\/v2\/origins\/export$/.test(endpoint)||secret.length<32)
   return status='NOT_CONFIGURED';
  var ts=Date.now(),nonce=Utilities.getUuid().replace(/-/g,'');
  var signature=hex(Utilities.computeHmacSha256Signature(CONTEXT+'\n'+ts+'\n'+nonce,secret,Utilities.Charset.UTF_8));
  var response=UrlFetchApp.fetch(endpoint,{method:'post',contentType:'application/json',
   payload:JSON.stringify({ts:ts,nonce:nonce}),headers:{'x-satori-origins-signature':signature},
   muteHttpExceptions:true,followRedirects:false});
  if(response.getResponseCode()!==200)return status='HTTP_'+response.getResponseCode();
  var body=JSON.parse(response.getContentText());
  var document={schemaVersion:body.schemaVersion,source:body.source,generatedAt:body.generatedAt,entries:body.entries};
  if(body.ok!==true||!validDocument(document,Date.now()))return status='INVALID_EXPORT';
  // Keep only well-formed rows; select() re-checks everything against the ledger on read.
  document.entries=document.entries.filter(validEntry).map(function(r){return {ledgerInvoiceId:r.ledgerInvoiceId,
   invoiceNo:r.invoiceNo,accountId:r.accountId,accountName:r.accountName,accountRole:r.accountRole,
   roleSource:r.roleSource,requestId:r.requestId}});
  var content=JSON.stringify(document),file=null;
  try{file=ownerFile(p.getProperty('SATORI_V2_ORDER_ORIGINS_FILE_ID'))}catch(_){file=null}
  if(file)file.setContent(content);
  else{
   file=DriveApp.createFile(FILE_NAME,content,'application/json');
   file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);
   p.setProperty('SATORI_V2_ORDER_ORIGINS_FILE_ID',file.getId());
  }
  return status='OK_'+document.entries.length;
 }catch(_){return status='ERROR'}
 finally{
  try{p.setProperty('SATORI_V2_ORDER_ORIGINS_STATUS',JSON.stringify({status:status,at:new Date().toISOString()}))}catch(_){}
  lock.releaseLock();
 }
}
return {read:read,select:select,refresh:refresh,validEntry:validEntry};
})();

function satoriV2OrderOriginsRefreshTick(){return SatoriV2OrderOrigins.refresh()}
