/**
 * Real screenshot regression: "10 thùng suối, 2 thùng mãng cầu, 3 ổi".
 * Tests the HTTP server, user follow-ups, and distinct demo/browser carts.
 * All tokens are anonymous fake data and NO invoice is confirmed.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseWaterClarificationBasket,waterClarificationAnswer} from '../multi-order.mjs';
const parsed=parseWaterClarificationBasket('10 thùng suối, 2 thùng mãng cầu, 3 ổi');
assert.equal(parsed?.reason,'WATER_REQUIRES_BRAND_OR_SIZE');
assert.equal(parsed.pending.water.qty,10);
assert.equal(parsed.pending.water.size,null);
assert.deepEqual(parsed.pending.items,[{sku:'TP-00056',qty:2},{sku:'TP-00058',qty:3}]);
assert.deepEqual(waterClarificationAnswer('Satori 500ml'),{brand:'satori',size:500});
assert.deepEqual(waterClarificationAnswer('500ml'),{brand:null,size:500});
assert.equal(waterClarificationAnswer('Satori 10 thùng'),null);
assert.equal(parseWaterClarificationBasket('10 thùng suối, 2 thùng trà sữa, 3 ổi'),null,
 'unknown food cannot be accepted into a partial basket');
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data=mkdtempSync(path.join(tmpdir(),'satori-short-order-'));
const port=34500+Math.floor(Math.random()*400);
const base='http://127.0.0.1:'+port;
const proc=spawn(process.execPath,[path.join(root,'server.mjs')],{
 env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',DEMO_DATA_DIR:data,
  GEMINI_FREE_TIER_ONLY:'false',GEMINI_API_KEY:'',
  GEMINI_SANDBOX_DRIVE_BRIDGE_URL:'',GEMINI_SANDBOX_BOOTSTRAP_ENCRYPTED_B64:'',
  NODE_ENV:'test',DEMO_ISOLATED_TEST_RATE:'1'},
 stdio:['ignore','pipe','pipe']});
let log='';proc.stdout.on('data',t=>log+=String(t));proc.stderr.on('data',t=>log+=String(t));
const tokenA='demo-a~'+'1'.repeat(32),tokenB='demo-a~'+'2'.repeat(32);
const get=async t=>{const r=await fetch(base+'/api/draft?token='+encodeURIComponent(t));return r.json()};
const send=async(t,message,revision)=>{
 const r=await fetch(base+'/api/message',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({token:t,message,unifiedDraft:true,expectedRevision:revision})});
 return {status:r.status,body:await r.json()};
};
const wait=ms=>new Promise(done=>setTimeout(done,ms));
let checks=0;const test=(value,name)=>{assert.ok(value,name);checks++};
try{
 let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(base+'/health');if(r.ok){ready=true;break}}catch{}await wait(75)}
 test(ready,'server starts '+log.slice(-500));
 let a=await get(tokenA),b=await get(tokenB);
 test(a.draft?.revision===0&&a.draft.items.length===0&&b.draft.items.length===0,'two browsers start empty');
 let r=await send(tokenA,'10 thùng suối, 2 thùng mãng cầu, 3 ổi',0);
 test(r.status===200&&r.body.clarificationType==='WATER_BRAND_SIZE',
  'all 3 items understood, specific water question asked: '+JSON.stringify(r.body).slice(0,600));
 test(/10 thùng nước suối/.test(r.body.message)&&/2 Thùng/.test(r.body.message)&&/3 Thùng/.test(r.body.message),'AI must mention every quantity and known product');
 a=await get(tokenA);
 test(a.draft.revision===0&&a.draft.items.length===0,'no partial draft writes while waiting');
 r=await send(tokenA,'Satori',0);
 test(r.status===200&&r.body.clarificationType==='WATER_BRAND_SIZE'&&/350ml/.test(r.body.message),'brand-only answer retains full order and requests volume');
 r=await send(tokenA,'500ml',0);
 test(r.status===200&&r.body.draft?.items?.length===3&&r.body.quote?.items?.length===3,
 'brand+volume follow-ups atomically fill all 3 products: '+JSON.stringify(r.body).slice(0,700));
 const items=new Map(r.body.draft.items.map(x=>[x.code,x.qty]));
 test(items.get('TP-00003')===10&&items.get('TP-00056')===2&&items.get('TP-00058')===3,
 '10 Satori water + 2 soursop + 3 pink guava preserved exactly');
 test(r.body.draft.items.reduce((n,x)=>n+x.qty,0)===15,'no extra 20 old units in screenshot');
 b=await get(tokenB);
 test(b.draft?.revision===0&&b.draft.items.length===0,'second visitor same public demo URL has independent empty cart');
 const snapshot=await fetch(base+'/api/admin/backup',{headers:{Authorization:'Bearer FAKE_TOKEN'}});
 test(snapshot.status===401||snapshot.status===404,'public user cannot obtain admin backup');
 r=await send(tokenB,'10 thùng suối, 2 thùng mãng cầu, 3 ổi',0);
 test(r.body.clarificationType==='WATER_BRAND_SIZE','other browser can independently start same words');
 r=await send(tokenB,'Hikari 500ml',0);
 test(r.body.draft?.items?.find(x=>x.code==='TP-00081')?.qty===10,'Hikari followup correctly fills 10 cartons');
 a=await get(tokenA);
 test(a.draft.items.some(x=>x.code==='TP-00003')&&!a.draft.items.some(x=>x.code==='TP-00081'),
  'another browser cannot mutate this basket');
 const stale=await send(tokenA,'10 thùng suối, 2 thùng mãng cầu, 3 ổi',0);
 test(stale.status===409,'stale client revision cannot overwrite a customer basket');
 console.log('PASS '+checks+'/'+checks+' real screenshot, atomic followups, isolated demo carts');
}catch(e){console.error('FAIL '+String(e.stack||e)+'\n'+log.slice(-1800));process.exitCode=1}
finally{proc.kill();rmSync(data,{recursive:true,force:true})}
