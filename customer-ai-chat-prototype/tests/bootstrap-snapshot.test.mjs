/* End-to-end TEST-only encrypted snapshot bootstrap on new container. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSandboxBackup} from '../sandbox-backup.mjs';
import {encryptArchive} from '../drive-backup.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir=mkdtempSync(path.join(tmpdir(),'satori-boot-'));
const port=33150+Math.floor(Math.random()*500),base='http://127.0.0.1:'+port;
const token='demo-a';
const key=crypto.randomBytes(32);
const draftKey=crypto.createHash('sha256').update('minh-satori-sandbox-draft-v1:'+token).digest('hex');
const order={ref:'TEST-BOOTRECOVER123',sandbox:true,profileId:'KH-DEMO-A',
 requestId:'KH-DEMO-A|bootstrap-check-001',subtotal:9000,shipping:0,vatAmount:0,total:9000,status:'Chờ thanh toán'};
const arch=createSandboxBackup({profiles:[],changeRequests:[],orders:[order],
 drafts:[{key:draftKey,revision:1,updatedAt:Date.now(),items:[{code:'TP-00058',qty:10}]}]});
const envelope=encryptArchive(arch,key);
const proc=spawn(process.execPath,[path.join(root,'server.mjs')],{
 env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',DEMO_DATA_DIR:dir,
  GEMINI_FREE_TIER_ONLY:'false',GEMINI_API_KEY:'',
  GEMINI_SANDBOX_DRIVE_BRIDGE_URL:'',
  GEMINI_SANDBOX_DRIVE_HMAC_KEY:'',
  GEMINI_SANDBOX_DRIVE_ENCRYPTION_KEY_B64:key.toString('base64'),
  GEMINI_SANDBOX_BOOTSTRAP_ENCRYPTED_B64:Buffer.from(JSON.stringify(envelope)).toString('base64')},
 stdio:['ignore','pipe','pipe']});
let log='';proc.stdout.on('data',x=>log+=String(x));proc.stderr.on('data',x=>log+=String(x));
const sleep=t=>new Promise(r=>setTimeout(r,t));
try{
 let health=null;
 for(let i=0;i<100;i++){try{const r=await fetch(base+'/health');if(r.ok){health=await r.json();break}}catch{}await sleep(70)}
 assert.ok(health, 'service starts after encrypted authenticated recovery '+log.slice(-1300));
 assert.equal(health.orders,1,'restored exactly one TEST invoice before serving requests');
 const draft=await (await fetch(base+'/api/draft?token=demo-a')).json();
 assert.equal(draft.draft.revision,1,'revision survives cold bootstrap');
 assert.equal(draft.draft.items[0].qty,10,'unfinished basket survives deployment');
 const history=await (await fetch(base+'/api/history?token=demo-a')).json();
 assert.ok(history.orders.some(x=>x.ref===order.ref),'same TEST invoice visible in history');
 assert.ok(log.includes('SANDBOX_BOOTSTRAP_RESTORED'),'safe nonsecret readiness diagnostic');
 assert.ok(!log.includes(key.toString('base64')),'never logs decryption secret');
 console.log('PASS sandbox encrypted bootstrap restores one invoice and pending cart before listening');
} finally {proc.kill();rmSync(dir,{recursive:true,force:true})}
