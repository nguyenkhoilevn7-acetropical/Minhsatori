/**
 * Encrypted TEST-ONLY remote snapshots. Google Drive is a BACKUP TARGET,
 * not a transactional database. No OAuth token, personal data or key is
 * committed to GitHub or sent to Gemini.
 */
import crypto from 'node:crypto';
import {verifySandboxBackup} from './sandbox-backup.mjs';
export const ENVELOPE_FORMAT='minh-satori-gemini-drive-envelope-v1';
const digest=s=>crypto.createHash('sha256').update(s,'utf8').digest('hex');
const validUrl=s=>/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,180}\/exec$/.test(s);
function config(){
 const url=String(process.env.GEMINI_SANDBOX_DRIVE_BRIDGE_URL||'').trim();
 const auth=String(process.env.GEMINI_SANDBOX_DRIVE_HMAC_KEY||'');
 const bytes=Buffer.from(String(process.env.GEMINI_SANDBOX_DRIVE_ENCRYPTION_KEY_B64||''),'base64');
 return validUrl(url)&&auth.length>=32&&bytes.length===32?{url,auth,key:bytes}:null;
}
export function encryptArchive(archive,key){
 if(!Buffer.isBuffer(key)||key.length!==32)throw Error('INVALID_ENCRYPTION_KEY');
 const plaintext=Buffer.from(JSON.stringify(archive),'utf8');
 if(plaintext.length<20||plaintext.length>1_500_000)throw Error('BACKUP_TOO_LARGE');
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
 return {format:ENVELOPE_FORMAT,encrypted:true,algorithm:'AES-256-GCM',
  iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
  ciphertext:ciphertext.toString('base64')};
}
export function decryptArchive(envelope,key){
 if(!envelope||envelope.format!==ENVELOPE_FORMAT||envelope.encrypted!==true||
    envelope.algorithm!=='AES-256-GCM'||!Buffer.isBuffer(key)||key.length!==32)
   throw Error('INVALID_BACKUP_ENVELOPE');
 const iv=Buffer.from(String(envelope.iv||''),'base64');
 const tag=Buffer.from(String(envelope.tag||''),'base64');
 const body=Buffer.from(String(envelope.ciphertext||''),'base64');
 if(iv.length!==12||tag.length!==16||body.length<20||body.length>1_500_000)
   throw Error('INVALID_BACKUP_ENVELOPE');
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
 decipher.setAuthTag(tag);
 const json=Buffer.concat([decipher.update(body),decipher.final()]).toString('utf8');
 return verifySandboxBackup(JSON.parse(json)); // SHA-256 + strict sandbox-only format
}
async function signedPost(cfg,operation,content){
 const ts=Date.now(),nonce=crypto.randomBytes(24).toString('base64url');
 const payload={operation,ts,nonce,...(operation==='put'?{payload:content}:{fileId:content})};
 const canonical=[operation,ts,nonce,digest(content)].join('\\n');
 payload.signature=crypto.createHmac('sha256',cfg.auth).update(canonical).digest('hex');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),14000);
 try{
  const response=await fetch(cfg.url,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(payload),signal:controller.signal,redirect:'follow'});
  if(!response.ok)throw Error('BRIDGE_HTTP_'+response.status);
  const text=await response.text();
  if(text.length>4_500_000)throw Error('BRIDGE_RESPONSE_TOO_LARGE');
  const result=JSON.parse(text);
  if(!result?.ok||result.operation!==operation)throw Error('BRIDGE_REJECTED_'+String(result?.error||'UNKNOWN').slice(0,30));
  if(operation==='put'&&(result.sha256!==digest(content)||!result.fileId))throw Error('BACKUP_ACK_MISMATCH');
  if(operation==='get'&&(result.sha256!==digest(result.payload)||result.fileId!==content))throw Error('BACKUP_FETCH_MISMATCH');
  return result;
 }finally{clearTimeout(timer)}
}
// Emit fixed diagnostic categories only; never emit environment secrets, backup contents,
// URLs, request bodies, customer data or raw network exceptions to service logs.
function reportBackupFailure(error){
 const code=String(error?.message||'');
 const safe=/^(DRIVE_BACKUP_NOT_CONFIGURED|BACKUP_TOO_LARGE|BRIDGE_ACK_MISMATCH|BACKUP_ACK_MISMATCH|BRIDGE_RESPONSE_TOO_LARGE|BRIDGE_REJECTED_[A-Z_]+|BRIDGE_HTTP_[0-9]{3})$/.test(code)
  ?code:'BRIDGE_NETWORK_OR_UNKNOWN_ERROR';
 console.warn('SANDBOX_DRIVE_BACKUP_FAILED',safe);
}
export function makeDriveBackupWorker(readState){
 let lastSuccessAt=null,lastFileId=null,lastFingerprint=null,lastFailure=null,inFlight=null,timer=null,interval=null;
 const active=()=>config()!==null;
 async function syncNow(){
  if(inFlight)return inFlight;
  inFlight=(async()=>{
   const cfg=config();if(!cfg)throw Error('DRIVE_BACKUP_NOT_CONFIGURED');
   const archive=readState();
   const fingerprint=digest(JSON.stringify(archive.snapshot?.profiles||[])+
    JSON.stringify(archive.snapshot?.changeRequests||[])+JSON.stringify(archive.snapshot?.orders||[])+
    JSON.stringify(archive.snapshot?.drafts||[]));
   if(lastFingerprint===fingerprint)return {ok:true,skipped:true,lastSuccessAt,lastFileId};
   const envelope=encryptArchive(archive,cfg.key);
   const response=await signedPost(cfg,'put',JSON.stringify(envelope));
   lastFingerprint=fingerprint;lastSuccessAt=new Date().toISOString();
   lastFileId=response.fileId;lastFailure=null;
   return {ok:true,skipped:false,lastSuccessAt,lastFileId};
  })().catch(e=>{lastFailure=String(e?.message||'BACKUP_FAILED').slice(0,120);throw e}).finally(()=>{inFlight=null});
  return inFlight;
 }
 const schedule=()=>{
  if(!active()||timer)return;
  timer=setTimeout(()=>{timer=null;syncNow().catch(reportBackupFailure)},5000);
  timer.unref?.();
 };
 const start=()=>{
  const urlOk=validUrl(String(process.env.GEMINI_SANDBOX_DRIVE_BRIDGE_URL||'').trim());
  const hmacOk=String(process.env.GEMINI_SANDBOX_DRIVE_HMAC_KEY||'').length>=32;
  const aesOk=Buffer.from(String(process.env.GEMINI_SANDBOX_DRIVE_ENCRYPTION_KEY_B64||''),'base64').length===32;
  console.info('SANDBOX_DRIVE_BACKUP_READINESS',
   'url='+Number(urlOk),'hmac='+Number(hmacOk),'aes='+Number(aesOk));
  if(!active()||interval)return;
  timer=setTimeout(()=>{timer=null;syncNow().catch(reportBackupFailure)},15000);timer.unref?.();
  interval=setInterval(schedule,5*60_000);interval.unref?.();
 };
 async function readArchive(fileId){
  const cfg=config();if(!cfg)throw Error('DRIVE_BACKUP_NOT_CONFIGURED');
  if(!/^[A-Za-z0-9_-]{20,140}$/.test(String(fileId||'')))throw Error('INVALID_BACKUP_FILE_ID');
  const response=await signedPost(cfg,'get',fileId);
  return decryptArchive(JSON.parse(response.payload),cfg.key);
 }
 const status=()=>({configured:active(),lastVerifiedUploadAt:lastSuccessAt,
  lastVerifiedFileId:lastFileId,lastError:lastFailure,
  guaranteedDurable:false,description:'encrypted Drive snapshots only; not a transactional database'});
 return {syncNow,schedule,start,readArchive,status};
}
