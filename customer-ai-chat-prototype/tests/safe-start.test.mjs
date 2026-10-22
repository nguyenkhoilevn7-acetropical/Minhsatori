/* Verify the sandbox supervisor keeps Render online but writes blocked on
 * stale/tampered encrypted bootstrap. All customers and orders are synthetic. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtempSync,existsSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSandboxBackup} from '../sandbox-backup.mjs';
import {encryptArchive} from '../drive-backup.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// The rescued preview intentionally disables its own backup worker, even
// when the parent successfully uploaded and read back the authenticated archive.
// Protect against falsely diagnosing missing Render Environment variables.
const safeStartSource=readFileSync(path.join(root,'safe-start.mjs'),'utf8');
const previewPart=safeStartSource.slice(safeStartSource.indexOf('function startPreview(){'),
 safeStartSource.indexOf('async function attemptPreviewAfterVerifiedRescue(){'));
assert.match(previewPart,/GEMINI_SANDBOX_DRIVE_BRIDGE_URL:'',GEMINI_SANDBOX_DRIVE_HMAC_KEY:''/,
 'ephemeral preview explicitly clears its own bridge credentials');
assert.match(previewPart,/SANDBOX_PREVIEW_DRIVE_BACKUP_DISABLED_BY_DESIGN/,
 'startup diagnostic identifies intentional per-child shutdown');
assert.match(safeStartSource,/const verified=await preserveRecoveryArchive\(\)/,
 'separate parent only opens preview after authenticated backup readback');

const key=crypto.randomBytes(32);
const archive=()=>createSandboxBackup({profiles:[],changeRequests:[],orders:[]});
const stale=archive();
stale.snapshot.exportedAt=new Date(Date.now()-2*60*60*1000).toISOString();
stale.checksum=crypto.createHash('sha256').update(JSON.stringify(stale.snapshot)).digest('hex');
const expired=Buffer.from(JSON.stringify(encryptArchive(stale,key))).toString('base64');
const tampered=Buffer.from(JSON.stringify({...encryptArchive(archive(),key),tag:crypto.randomBytes(16).toString('base64')})).toString('base64');
const current=Buffer.from(JSON.stringify(encryptArchive(archive(),key))).toString('base64');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function checkCase(label,encoded,shouldMaintain,port){
 const dir=mkdtempSync(path.join(tmpdir(),'satori-maintenance-'));
 const origin='http://127.0.0.1:'+port;
 const proc=spawn(process.execPath,[path.join(root,'safe-start.mjs')],{
  env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',DEMO_DATA_DIR:dir,
   GEMINI_API_KEY:'',GEMINI_FREE_TIER_ONLY:'false',
   GEMINI_SANDBOX_DRIVE_BRIDGE_URL:'',GEMINI_SANDBOX_DRIVE_HMAC_KEY:'',
   GEMINI_SANDBOX_DRIVE_ENCRYPTION_KEY_B64:key.toString('base64'),
   GEMINI_SANDBOX_BOOTSTRAP_ENCRYPTED_B64:encoded},
  stdio:['ignore','pipe','pipe']
 });
 let logs='';proc.stdout.on('data',x=>logs+=String(x));proc.stderr.on('data',x=>logs+=String(x));
 try{
  let health=null;
  for(let i=0;i<120;i++){
   try{const r=await fetch(origin+'/health');if(r.ok){health=await r.json();break}}catch{}
   await sleep(75);
  }
  assert.ok(health,'health endpoint reachable: '+label+' '+logs.slice(-600));
  if(shouldMaintain){
   assert.equal(health.ready,false,'never advertise recovery mode as ready');
   assert.equal(health.maintenance,true);
   assert.equal(health.code,'BOOTSTRAP_RECOVERY_REQUIRED');
   const status=await (await fetch(origin+'/api/recovery-status')).json();
   assert.equal(status.ready,false);
   assert.ok(['verifying','failed','empty_verified','missing'].includes(status.archiveBackup),'recovery status is visible without secrets');
   for(const pathName of ['/','/admin','/admin/','/admin?source=smartphone','/c/demo-a']){
    const r=await fetch(origin+pathName);
    assert.equal(r.status,503,'all human interfaces blocked: '+pathName);
    assert.match(await r.text(),/bảo trì/);
   }
   for(const [method,pathName] of [
    ['GET','/api/admin/sandbox-backup'],
    ['POST','/api/admin/customers'],
    ['POST','/api/confirm'],
    ['POST','/api/message'],
    ['POST','/api/admin/drive-backup/now'],
    ['GET','/api/history?token=demo-a']
   ]){
    const r=await fetch(origin+pathName,{method});
    assert.equal(r.status,503,'API locked: '+pathName);
    assert.equal((await r.json()).error,'BOOTSTRAP_RECOVERY_REQUIRED');
   }
   assert.ok(!existsSync(path.join(dir,'orders.json')),'cannot create empty replacement orders file');
   assert.match(logs,/SANDBOX_MAINTENANCE_LISTENING/);
  }else{
   assert.notEqual(health.maintenance,true,'valid fresh bootstrap runs original application');
   assert.equal(health.orders,0);
   assert.equal((await fetch(origin+'/c/demo-a')).status,200);
  }
  assert.ok(!logs.includes(key.toString('base64')),'encryption key never logged');
  console.log('PASS safe bootstrap supervisor: '+label);
 }finally{
  proc.kill();await sleep(60);rmSync(dir,{recursive:true,force:true});
 }
}
const port=36000+Math.floor(Math.random()*1000);
await checkCase('stale encrypted snapshot -> maintenance',expired,true,port);
await checkCase('tampered archive -> maintenance',tampered,true,port+1);
await checkCase('fresh authenticated archive -> application',current,false,port+2);
