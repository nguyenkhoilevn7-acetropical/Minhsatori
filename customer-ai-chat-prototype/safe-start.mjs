/**
 * Sandbox-only fail-closed supervisor.
 * Run the existing server unchanged; if its integrity/staleness guard refuses
 * the encrypted bootstrap, keep Render reachable in a read-only maintenance
 * state. NEVER skip the guard, replace backups, or reinitialize customer data.
 */
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import {decryptArchive,makeDriveBackupWorker} from './drive-backup.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const HOST=process.env.DEMO_BIND||'127.0.0.1';
const PORT=Number(process.env.PORT||8787);
let maintenance=null;
let terminating=false;
let archivalStatus='not_started';
let rescueInProgress=false,previewStarted=false,child=null;

// Salvage the ORIGINAL authenticated archive into Google Drive, without
// rewriting its timestamp, replacing the Render environment snapshot, or
// starting a new empty transactional state. Fail closed if Drive is unavailable.
async function preserveRecoveryArchive(){
 const encoded=String(process.env.GEMINI_SANDBOX_BOOTSTRAP_ENCRYPTED_B64||'');
 if(!encoded){archivalStatus='missing';return false}
 archivalStatus='verifying';
 try{
  if(encoded.length>6000000)throw Error('OVERSIZE');
  const key=Buffer.from(String(process.env.GEMINI_SANDBOX_DRIVE_ENCRYPTION_KEY_B64||''),'base64');
  const envelope=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
  const state=decryptArchive(envelope,key); // validates authenticated content and backup checksum
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  const archive=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8'));
  const records=state.profiles.length+state.orders.length+state.changeRequests.length+state.drafts.length+state.phrases.length;
  if(records===0){archivalStatus='empty_verified';return false}
  const worker=makeDriveBackupWorker(()=>archive);
  const receipt=await worker.syncNow();
  if(!receipt?.lastFileId)throw Error('NO_RECEIPT');
  const restored=await worker.readArchive(receipt.lastFileId); // verifies remote HMAC + SHA + AES + backup checksum
  if(JSON.stringify(state)!==JSON.stringify(restored))throw Error('REMOTE_MISMATCH');
  archivalStatus='verified';
  console.info('SANDBOX_RESCUE_ARCHIVE_VERIFIED','orders='+state.orders.length,'profiles='+state.profiles.length);
  return true;
 }catch{
  archivalStatus='failed';
  console.warn('SANDBOX_RESCUE_ARCHIVE_NOT_VERIFIED');
  return false;
 }
}

function startMaintenance(){
 if(maintenance||terminating)return;
 const page='<!doctype html><html lang="vi"><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>Minh Satori - Bảo trì bản thử</title>'+
  '<style>body{font:16px system-ui,sans-serif;line-height:1.6;background:#f5f8fc;'+
  'color:#173651;max-width:680px;margin:12vh auto;padding:24px}main{background:white;'+
  'padding:28px;border:1px solid #dbe5f0;border-radius:18px}h1{font-size:23px}</style>'+
  '<main><h1>Minh Satori đang bảo trì bản thử</h1>'+
  '<p>Bản sao dữ liệu thử cần được xác minh trước khi hệ thống tiếp tục hoạt động.'+
  ' Trang quản trị, chat đặt hàng và thao tác ghi hiện đều tạm khóa.</p>'+
  '<p>Quản trị viên đang kiểm tra việc khôi phục an toàn. Xin vui lòng thử lại sau.</p>'+
  '</main></html>';
 maintenance=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Retry-After','120');
  if(req.method==='GET'&&(req.url==='/health'||req.url==='/api/recovery-status')){
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8',
    'Content-Security-Policy':"default-src 'none'"});
   return res.end(JSON.stringify({
    ok:req.url==='/health',sandbox:true,ready:false,maintenance:true,
    code:'BOOTSTRAP_RECOVERY_REQUIRED',archiveBackup:archivalStatus
   }));
  }
  if(req.method==='GET'&&(new URL(req.url,'http://localhost').pathname==='/'||new URL(req.url,'http://localhost').pathname==='/admin'||new URL(req.url,'http://localhost').pathname==='/admin/'||/^\/c\/(?:demo-[ab]|[A-Za-z0-9_-]{40,96})\/?$/.test(new URL(req.url,'http://localhost').pathname))){
   res.writeHead(503,{'Content-Type':'text/html; charset=utf-8',
    'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});
   return res.end(page);
  }
  res.writeHead(503,{'Content-Type':'application/json; charset=utf-8',
   'Content-Security-Policy':"default-src 'none'"});
  return res.end(JSON.stringify({ok:false,sandbox:true,maintenance:true,
   error:'BOOTSTRAP_RECOVERY_REQUIRED',
   message:'Bản thử đang bảo trì an toàn; không nhận thao tác thay đổi dữ liệu.'}));
 });
 maintenance.on('error',()=>{console.error('SANDBOX_MAINTENANCE_PORT_FAILED');process.exitCode=78});
 maintenance.listen(PORT,HOST,()=>console.warn('SANDBOX_MAINTENANCE_LISTENING - writes disabled'));
}

// Only after the original authenticated TEST archive has been uploaded and
// independently fetched/decrypted can we open a SEPARATE ephemeral demo.
// Confirmations, admin writes, backup workers and profile mutations are disabled
// in the new process. Never pass original customer profiles or orders to it.
function startPreview(){
 if(terminating||previewStarted)return;
 previewStarted=true;
 let dir;
 try{dir=fs.mkdtempSync(path.join(os.tmpdir(),'minh-satori-gemini-chat-preview-'))}
 catch{console.error('SANDBOX_PREVIEW_STORAGE_UNAVAILABLE');startMaintenance();return}
 const env={...process.env,DEMO_DATA_DIR:dir,
  GEMINI_SANDBOX_BOOTSTRAP_ENCRYPTED_B64:'',
  GEMINI_SANDBOX_DRIVE_BRIDGE_URL:'',GEMINI_SANDBOX_DRIVE_HMAC_KEY:'',
  GEMINI_SANDBOX_EMERGENCY_DEMO_ONLY:'1'};
 // Distinguish parent backup readiness from the intentionally isolated preview.
 // This does NOT mean the Render Environment lost its endpoint or HMAC.
 console.info('SANDBOX_PREVIEW_DRIVE_BACKUP_DISABLED_BY_DESIGN - parent archive already readback-verified');
 child=spawn(process.execPath,[path.join(HERE,'server.mjs')],{cwd:HERE,env,stdio:'inherit'});
 child.on('error',()=>{console.error('SANDBOX_PREVIEW_PROCESS_FAILED');startMaintenance()});
 child.on('exit',(code)=>{if(!terminating){console.error('SANDBOX_PREVIEW_STOPPED',Number.isInteger(code)?code:'signal');startMaintenance()}});
 console.warn('SANDBOX_RESCUED_CHAT_PREVIEW_STARTING - orders and admin writes disabled');
}
async function attemptPreviewAfterVerifiedRescue(){
 if(rescueInProgress||previewStarted||terminating)return;
 rescueInProgress=true;
 const verified=await preserveRecoveryArchive();
 if(!verified||terminating)return; // fail closed if remote backup wasn't read back
 if(maintenance){maintenance.close(()=>{maintenance=null;startPreview()})}
 else startPreview();
}
child=spawn(process.execPath,[path.join(HERE,'server.mjs')],{
 cwd:HERE,env:process.env,stdio:'inherit'
});
child.on('error',()=>{
 console.error('SANDBOX_CHILD_START_FAILED');
 startMaintenance();
 void attemptPreviewAfterVerifiedRescue();
});
child.on('exit',(code)=>{
 if(terminating)return;
 console.error('SANDBOX_CHILD_UNAVAILABLE',Number.isInteger(code)?code:'signal');
 startMaintenance();
 void attemptPreviewAfterVerifiedRescue();
});
for(const signal of ['SIGTERM','SIGINT']){
 process.on(signal,()=>{
  terminating=true;
  if(child&&child.exitCode===null)child.kill(signal);
  if(maintenance)maintenance.close();
  setTimeout(()=>process.exit(0),1000).unref();
 });
}
