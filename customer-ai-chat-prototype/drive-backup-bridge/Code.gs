/**
 * Minh Satori / Gemini CUSTOMER SANDBOX — Google Drive backup transport.
 * Accept ONLY encrypted, authenticated, timestamped backups.
 * Create as a STANDALONE Apps Script project, never paste into production.
 *
 * Script properties configured privately by owner:
 * GEMINI_SANDBOX_BACKUP_FOLDER_ID = dedicated TEST-only folder ID
 * GEMINI_SANDBOX_BACKUP_HMAC_KEY = random private >=32-character secret
 * Deploy Web App: execute as owner; access Anyone (HMAC validates caller).
 * This bridge CANNOT create orders, inspect plaintext backups or call production.
 */
const BACKUP_FORMAT='minh-satori-gemini-drive-envelope-v1';
const MAX_PAYLOAD=4000000;
function hex(bytes){return bytes.map(b=>('0'+(b&255).toString(16)).slice(-2)).join('')}
function sha(s){return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8))}
function sign(message,key){return hex(Utilities.computeHmacSha256Signature(message,key,Utilities.Charset.UTF_8))}
function eq(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
function response(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)}
function doGet(){return response({ok:false,error:'POST_SIGNED_REQUEST_ONLY'})}
function doPost(e){
 try{
  const body=String(e?.postData?.contents||'');
  if(!body||body.length>MAX_PAYLOAD+8192)throw Error('INVALID_REQUEST');
  const r=JSON.parse(body);
  if(!r||!['put','get'].includes(r.operation)||!Number.isSafeInteger(r.ts)||
     !/^[-a-zA-Z0-9_]{24,90}$/.test(String(r.nonce||''))||!/^([a-f0-9]{64})$/.test(String(r.signature||'')))throw Error('INVALID_REQUEST');
  if(Math.abs(Date.now()-r.ts)>180000)throw Error('EXPIRED');
  const props=PropertiesService.getScriptProperties();
  const key=props.getProperty('GEMINI_SANDBOX_BACKUP_HMAC_KEY')||'';
  const folderId=props.getProperty('GEMINI_SANDBOX_BACKUP_FOLDER_ID')||'';
  if(key.length<32||!/^[-_a-zA-Z0-9]{15,128}$/.test(folderId))throw Error('NOT_CONFIGURED');
  const msg=r.operation+'\\n'+r.ts+'\\n'+r.nonce+'\\n'+sha(r.operation==='put'?String(r.payload||''):String(r.fileId||''));
  if(!eq(sign(msg,key),r.signature))throw Error('UNAUTHORIZED');
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))throw Error('BUSY');
  try{
   const cache=CacheService.getScriptCache(),once='nonce:'+sha(r.nonce);
   if(cache.get(once))throw Error('REPLAY');
   cache.put(once,'1',300);
   const folder=DriveApp.getFolderById(folderId);
   if(r.operation==='put'){
    const payload=String(r.payload||'');
    if(payload.length<40||payload.length>MAX_PAYLOAD)throw Error('INVALID_PAYLOAD');
    const pack=JSON.parse(payload);
    if(pack.format!==BACKUP_FORMAT||pack.encrypted!==true||
       !/^[a-zA-Z0-9+/=]+$/.test(String(pack.ciphertext||''))||
       !/^[a-zA-Z0-9+/=]+$/.test(String(pack.iv||''))||
       !/^[a-zA-Z0-9+/=]+$/.test(String(pack.tag||'')))throw Error('INVALID_PAYLOAD');
    const filename='gemini-sandbox-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+Utilities.getUuid().slice(0,8)+'.encrypted.json';
    const file=folder.createFile(Utilities.newBlob(payload,'application/json',filename));
    file.setDescription('Minh Satori Gemini SANDBOX encrypted-only backup; not a production invoice');
    return response({ok:true,operation:'put',fileId:file.getId(),bytes:payload.length,sha256:sha(payload)});
   }
   if(!/^[a-zA-Z0-9_-]{20,140}$/.test(String(r.fileId||'')))throw Error('INVALID_FILE');
   const file=DriveApp.getFileById(r.fileId);
   const parents=file.getParents();let allowed=false;
   while(parents.hasNext())if(parents.next().getId()===folderId)allowed=true;
   if(!allowed)throw Error('FILE_OUTSIDE_SANDBOX');
   if(file.getSize()>MAX_PAYLOAD)throw Error('INVALID_SIZE');
   const payload=file.getBlob().getDataAsString('UTF-8');
   if(payload.length>MAX_PAYLOAD||JSON.parse(payload).format!==BACKUP_FORMAT)throw Error('INVALID_PAYLOAD');
   return response({ok:true,operation:'get',fileId:r.fileId,payload,sha256:sha(payload)});
  } finally{lock.releaseLock()}
 }catch(error){
  // Never echo request contents or secrets to caller/Google execution logs.
  return response({ok:false,error:['UNAUTHORIZED','REPLAY','EXPIRED','NOT_CONFIGURED','BUSY','FILE_OUTSIDE_SANDBOX','INVALID_FILE','INVALID_SIZE','INVALID_PAYLOAD'].includes(error.message)?error.message:'BACKUP_REQUEST_FAILED'});
 }
}
