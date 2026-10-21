import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createSandboxBackup} from '../sandbox-backup.mjs';
import {encryptArchive,decryptArchive,makeDriveBackupWorker} from '../drive-backup.mjs';

const key=crypto.randomBytes(32);
const orderCustomer='KH-SANDBOX-'+crypto.randomUUID();
const profile={id:orderCustomer,tokenHash:crypto.createHash('sha256').update('secret demo token').digest('hex'),
 name:'KH TEST ẨN DANH',phone:'0900000000',address:'Địa chỉ thử nghiệm không có thật',discount:20,
 ship:8,vatRate:0,enabled:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
const fakeOrder={ref:'TEST-ABCDEF1234',sandbox:true,profileId:orderCustomer,
 requestId:orderCustomer+'|fake-request-12345',subtotal:100000,shipping:8000,
 vatAmount:0,total:108000,product:'Nước thử nghiệm',status:'Chờ thanh toán'};
const archive=createSandboxBackup({profiles:[profile],changeRequests:[],orders:[fakeOrder]});
let checks=0;const test=(ok,msg)=>{assert.ok(ok,msg);checks++};
const envelope=encryptArchive(archive,key);
test(envelope.encrypted===true&&envelope.algorithm==='AES-256-GCM','encrypted envelope');
test(!JSON.stringify(envelope).includes('KH TEST ẨN DANH'),'no plaintext personal data');
test(decryptArchive(envelope,key).orders[0].ref==='TEST-ABCDEF1234','verified encrypted restore');
const wrong=crypto.randomBytes(32);
assert.throws(()=>decryptArchive(envelope,wrong));checks++;
assert.throws(()=>decryptArchive({...envelope,tag:'AAAAAAAAAAAAAAAAAAAAAA=='},key));checks++;
const saved={GEMINI_SANDBOX_DRIVE_BRIDGE_URL:process.env.GEMINI_SANDBOX_DRIVE_BRIDGE_URL,
 GEMINI_SANDBOX_DRIVE_HMAC_KEY:process.env.GEMINI_SANDBOX_DRIVE_HMAC_KEY,
 GEMINI_SANDBOX_DRIVE_ENCRYPTION_KEY_B64:process.env.GEMINI_SANDBOX_DRIVE_ENCRYPTION_KEY_B64};
process.env.GEMINI_SANDBOX_DRIVE_BRIDGE_URL='https://script.google.com/macros/s/'+'A'.repeat(48)+'/exec';
process.env.GEMINI_SANDBOX_DRIVE_HMAC_KEY='fake-hmac-key-just-for-tests-12345678901234567890';
process.env.GEMINI_SANDBOX_DRIVE_ENCRYPTION_KEY_B64=key.toString('base64');
const originalFetch=globalThis.fetch;
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
let storage=null,writes=0;
globalThis.fetch=async(url,options)=>{
 const body=JSON.parse(options.body);
 const argument=body.operation==='put'?body.payload:body.fileId;
 const actual=crypto.createHmac('sha256',process.env.GEMINI_SANDBOX_DRIVE_HMAC_KEY)
  .update([body.operation,body.ts,body.nonce,sha(argument)].join('\\n')).digest('hex');
 test(actual===body.signature,'HMAC signature validates');
 if(body.operation==='put'){
  writes++;storage=argument;
  test(!storage.includes('KH TEST ẨN DANH'),'stored document encrypted');
  return {ok:true,text:async()=>JSON.stringify({ok:true,operation:'put',sha256:sha(argument),fileId:'file_'+'A'.repeat(30)})};
 }
 if(body.operation==='get')
  return {ok:true,text:async()=>JSON.stringify({ok:true,operation:'get',sha256:sha(storage),fileId:argument,payload:storage})};
 throw Error('unexpected operation');
};
try{
 const worker=makeDriveBackupWorker(()=>archive);
 test(worker.status().configured,'bridge configured in isolated unit test');
 const first=await worker.syncNow();
 test(first.ok&&!first.skipped,'first backup acknowledged by receiver');
 test(writes===1&&worker.status().lastVerifiedUploadAt,'verified snapshot status');
 const repeated=await worker.syncNow();
 test(repeated.skipped&&writes===1,'deduplicate unchanged backup');
 const restored=await worker.readArchive(first.lastFileId);
 test(restored.profiles.length===1&&restored.orders.length===1,'remote encrypted recovery');
 test(restored.orders[0].total===108000,'all financial fields retained');
 console.log('PASS '+checks+'/'+checks+' encrypted Gemini-to-Drive backup, authenticated transport, dedupe, safe restore; NO Google calls');
}finally{
 globalThis.fetch=originalFetch;
 for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v}
}
