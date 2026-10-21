/* Regression: typed Vietnamese juice + optional product buttons = one pending draft / one TEST invoice. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseRules} from '../free-parser.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html=readFileSync(path.join(root,'index.html'),'utf8');
assert.match(html,/id="productsToggle"[^>]*aria-expanded="false"/);
assert.match(html,/class="secondary-tools" id="secondaryTools" hidden/);
assert.match(html,/\.server-mode \.shop-hero\{display:none\}/);
for(const [message,sku,qty] of [
 ['10 ổi hồng','TP-00058',10],['cho anh 10 ổi hồng','TP-00058',10],
 ['đặt 5 mãng cầu','TP-00056',5],['12 nước ép me','TP-00055',12]
]){const parsed=parseRules(message);assert.equal(parsed?.sku,sku,message);assert.equal(parsed?.qty,qty,message)}
for(const invalid of ['10 lon ổi hồng','20 chai mãng cầu','1000 ổi hồng']){
 const parsed=parseRules(invalid);
 assert.ok(!parsed||parsed.qty===0||parsed.needMoreDetails,invalid+' cannot silently become a carton order');
}

const data=mkdtempSync(path.join(tmpdir(),'satori-chat-first-'));
const port=33000+Math.floor(Math.random()*800),base='http://127.0.0.1:'+port;
const child=spawn(process.execPath,[path.join(root,'server.mjs')],{
 env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',DEMO_DATA_DIR:data,
  GEMINI_API_KEY:'',GEMINI_FREE_TIER_ONLY:'false',DEMO_ISOLATED_TEST_RATE:'1',NODE_ENV:'test'},
 stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',v=>logs+=String(v));child.stderr.on('data',v=>logs+=String(v));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const call=async(url,body)=>{
 const r=await fetch(base+url,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});
 return {status:r.status,data:await r.json()};
};
let revision=0;const token='demo-a';
async function message(text){
 const result=await call('/api/message',{token,message:text,unifiedDraft:true,expectedRevision:revision});
 if(result.data.draft)revision=result.data.draft.revision;
 return result;
}
try{
 let ready=false;for(let i=0;i<120;i++){
  try{ready=Boolean((await call('/health')).data.ok);if(ready)break}catch{}
  await sleep(60);
 }
 assert.ok(ready,'isolated server ready');
 let r=await message('10 ổi hồng');
 assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.draft?.items?.[0]?.code,'TP-00058');
 assert.equal(r.data.draft.items[0].qty,10);
 r=await call('/api/draft',{token,action:'add',code:'TP-00056',qty:2,expectedRevision:revision});
 assert.equal(r.status,200,JSON.stringify(r.data));revision=r.data.draft.revision;
 assert.equal(r.data.draft.items.length,2);
 r=await message('thêm 3 ổi hồng');
 assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.draft.items.find(x=>x.code==='TP-00058').qty,13);
 r=await message('5 mãng cầu');
 assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.draft.items.find(x=>x.code==='TP-00056').qty,7);
 assert.equal(r.data.quote.items.length,2,'typed and clicked products share a single quote');
 const old=r.data.quote;
 r=await message('thêm 1 ổi hồng');
 assert.equal(r.data.draft.items.find(x=>x.code==='TP-00058').qty,14);
 const stale=await call('/api/confirm',{token,quoteId:old.quoteId,requestId:'chat-first-stale-01'});
 assert.equal(stale.status,409,'old quote cannot generate an extra bill');
 const final=await call('/api/draft',{token,action:'quote',expectedRevision:revision});
 assert.equal(final.status,200);
 const conf=await call('/api/confirm',{token,quoteId:final.data.quote.quoteId,requestId:'chat-first-once-01'});
 assert.equal(conf.status,200,JSON.stringify(conf.data));assert.equal(conf.data.order.items.length,2);
 const history=await call('/api/history?token=demo-a');
 assert.equal(history.data.orders.filter(o=>o.ref===conf.data.order.ref).length,1);
 const duplicate=await call('/api/confirm',{token,quoteId:final.data.quote.quoteId,requestId:'chat-first-once-01'});
 assert.equal(duplicate.data.duplicate,true);assert.equal(duplicate.data.order.ref,conf.data.order.ref);
 assert.equal((await call('/api/draft?token=demo-a')).data.draft.items.length,0);
 console.log('PASS chat-first juice aliases, hidden recommendations, shared TEST cart and one confirmed bill');
}catch(error){console.error('FAIL '+error.message+'\n'+logs.slice(-2000));process.exitCode=1}
finally{child.kill();rmSync(data,{recursive:true,force:true})}
