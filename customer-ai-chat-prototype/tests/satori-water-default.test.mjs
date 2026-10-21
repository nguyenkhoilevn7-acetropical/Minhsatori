/** Realistic Vietnamese order shorthand, offline TEST-only; no invoice writes. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseRules} from '../free-parser.mjs';
import {parseMultiOrder,parseOneClause} from '../multi-order.mjs';
import {parseCustomerMessage} from '../order-with-notes.mjs';
import {productFor} from '../catalogue.mjs';
const profile={name:'Khách test',discount:20,ship:8};
for(const words of ['10 suối 500','10 thùng suối 500ml','5 thùng nước suối 500','5 thùng Satori 500ml']){
 const p=parseRules(words,profile);
 assert.equal(productFor(p?.sku)?.code,'TP-00003','brand defaults to Satori: '+words);
 assert.ok(!p.needMoreDetails,'no redundant Hikari question: '+words);
}
assert.equal(productFor(parseRules('5 thùng Hikari 500ml',profile)?.sku)?.code,'TP-00081','explicit Hikari stays Hikari');
assert.equal(productFor(parseRules('10 suối 350',profile)?.sku)?.code,'TP-00001','350 means Satori 350ml');
assert.equal(parseOneClause('5 chai Satori 500ml',profile),null,'loose bottles never silently become cartons');
const two=parseMultiOrder('Cho 5 thùng suối 500ml, 3 thùng Hikari 500ml',profile);
assert.deepEqual(two?.items?.map(x=>[x.sku,x.qty]),[['TP-00003',5],['TP-00081',3]]);
const withNote=parseCustomerMessage('Cho 10 suối 500ml, 2 mãng cầu. Lưu ý giao sau 2h chiều',profile);
assert.equal(withNote?.water,null,'sized Satori is not pending brand clarification');
assert.deepEqual(withNote?.items?.map(x=>[x.sku,x.qty]),[['TP-00003',10],['TP-00056',2]]);
const dir=mkdtempSync(path.join(tmpdir(),'satori-water-default-')),originPort=41400+Math.floor(Math.random()*450);
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const proc=spawn(process.execPath,[path.join(root,'server.mjs')],{
 env:{...process.env,PORT:String(originPort),DEMO_BIND:'127.0.0.1',
  DEMO_DATA_DIR:dir,NODE_ENV:'test',DEMO_ISOLATED_TEST_RATE:'1',
  GEMINI_API_KEY:'',GEMINI_FREE_TIER_ONLY:'false',
  GEMINI_SANDBOX_BOOTSTRAP_ENCRYPTED_B64:'',GEMINI_SANDBOX_DRIVE_BRIDGE_URL:''},
 stdio:['ignore','pipe','pipe']
});
const origin='http://127.0.0.1:'+originPort,sleep=ms=>new Promise(r=>setTimeout(r,ms));
let logs='';proc.stderr.on('data',b=>logs+=String(b));proc.stdout.on('data',b=>logs+=String(b));
try{
 let ready=false;
 for(let i=0;i<100;i++){
  try{const r=await fetch(origin+'/health');if(r.ok){ready=true;break}}catch{}
  await sleep(75);
 }
 assert.ok(ready,'synthetic HTTP server starts '+logs.slice(-600));
 const quote=async message=>{
  const res=await fetch(origin+'/api/message',{method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({token:'demo-a',message})});
  assert.equal(res.status,200,'server reply '+message);
  return res.json();
 };
 for(const message of ['Cho 10 thùng nước suối 500ml','Cho 5 thùng Hikari 500ml']){
  const data=await quote(message);
  assert.ok(!data.needMoreDetails,'no unnecessary brand clarification: '+message);
  assert.equal(data.quote?.code,message.includes('Hikari')?'TP-00081':'TP-00003',
    'exact invoice SKU is selected from catalogue');
 }
 console.log('PASS Satori water default: shorthand, composite, explicit Hikari, note and HTTP; no orders confirmed');
}finally{proc.kill();await sleep(65);rmSync(dir,{recursive:true,force:true})}
