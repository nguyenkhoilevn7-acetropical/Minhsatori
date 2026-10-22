/* Regression for Samsung screenshot: an entire spoken order is absolute,
   unlike a literal "thêm" request. All actions on an isolated TEST server. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir=mkdtempSync(path.join(tmpdir(),'satori-exact-cart-'));
const port=33000+Math.floor(Math.random()*5000),base='http://127.0.0.1:'+port;
const proc=spawn(process.execPath,[path.join(root,'server.mjs')],{
 env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',
  DEMO_DATA_DIR:dir,GEMINI_API_KEY:'',GEMINI_FREE_TIER_ONLY:'false',
  DEMO_ISOLATED_TEST_RATE:'1',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
let stderr='';proc.stdout.on('data',b=>stderr+=String(b));proc.stderr.on('data',b=>stderr+=String(b));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const request=async(path,payload)=>{const r=await fetch(base+path,{method:payload?'POST':'GET',
 headers:payload?{'content-type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined});
 return {status:r.status,body:await r.json()}};
let checks=0;function check(cond,label){assert.ok(cond,label);checks++}
let rev=0,token='demo-a';
const draft=async(action,code,qty)=>{
 const r=await request('/api/draft',{token,action,code,qty,expectedRevision:rev});
 check(r.status===200,'seed TEST cart: '+action);rev=r.body.draft.revision;return r.body.draft;};
const message=async(text,expectedRevision=rev)=>{
 const r=await request('/api/message',{token,message:text,unifiedDraft:true,expectedRevision});
 if(r.body.draft)rev=r.body.draft.revision;return r;};
const quantities=d=>Object.fromEntries(d.items.map(i=>[i.code,i.qty]));
try{
 let running=false;for(let i=0;i<100;i++){try{if((await request('/health')).body.ok){running=true;break}}catch{}await sleep(80)}
 check(running,'isolated sandbox is healthy');
 await draft('add','TP-00003',5);await draft('add','TP-00058',10);
 await draft('add','TP-00056',2); // Unmentioned third SKU must disappear in a NEW complete order.
 const oldRev=rev;
 const r=await message('Cho em 10 suối 500, 2 ổi');
 check(r.status===200&&!r.body.needMoreDetails,'recognize entire spoken shopping list: '+JSON.stringify(r.body).slice(0,450));
 const q=quantities(r.body.draft);
 check(q['TP-00003']===10&&q['TP-00058']===2,'spoken 10 water and 2 guava are exact, not prior+new');
 check(r.body.draft.items.length===2&&r.body.draft.items.reduce((sum,x)=>sum+x.qty,0)===12,
  'full order yields only two product lines and 12 cartons, no stale SKU');
 check(r.body.quote?.items?.length===2,'one revised combined TEST quote');
 check((await request('/api/history?token=demo-a')).body.orders.length===0,'parsing a quote never creates an invoice');
 const repeated=await message('Cho em 10 suối 500, 2 ổi');
 check(repeated.status===200&&quantities(repeated.body.draft)['TP-00003']===10&&
  quantities(repeated.body.draft)['TP-00058']===2,'repeated complete request remains 10+2');
 const stale=await message('Cho em 3 suối 500, 1 ổi',oldRev);
 check(stale.status===409,'stale second device cannot overwrite recent basket');
 const unchanged=await request('/api/draft?token=demo-a');
 check(unchanged.body.draft.items.reduce((sum,x)=>sum+x.qty,0)===12,'revision conflict leaves cart untouched');
 const extra=await message('Thêm 3 suối 500, 1 ổi');
 check(extra.status===200,'explicit multi-line addition accepted');
 check(quantities(extra.body.draft)['TP-00003']===13&&quantities(extra.body.draft)['TP-00058']===3,
  'literal thêm increments requested two lines only');
 const set=await message('Cho em 7 ổi hồng');
 check(set.status===200&&quantities(set.body.draft)['TP-00058']===7&&
   quantities(set.body.draft)['TP-00003']===13,'one-product quantity update sets selected SKU, preserves other SKU');
 const bad=await message('Cho em 4 trà sữa và 1 suối 500');
 const afterBad=await request('/api/draft?token=demo-a');
 check(afterBad.body.draft.items.reduce((n,i)=>n+i.qty,0)===20,
  'unknown product blocks mutation; never apply partial items: '+JSON.stringify({response:bad.body,actual:afterBad.body.draft.items}).slice(0,600));
 console.log('PASS '+checks+'/'+checks+' exact Vietnamese quantities, updates, additive edits, concurrency and no TEST invoice');
}catch(e){console.error('FAIL '+e.stack+'\\n'+stderr.slice(-2300));process.exitCode=1}
finally{proc.kill();rmSync(dir,{recursive:true,force:true})}
