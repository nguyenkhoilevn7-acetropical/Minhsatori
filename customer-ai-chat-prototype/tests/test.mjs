import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url)),DIR=path.dirname(HERE),temp=mkdtempSync(path.join(tmpdir(),'ms-chat-test-'));
const port=29000+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
const proc=spawn(process.execPath,['--import',pathToFileURL(path.join(HERE,'mock-openai.mjs')).href,path.join(DIR,'server.mjs')],{env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',DEMO_DATA_DIR:temp,OPENAI_API_KEY:'MOCK_TEST_ONLY_NO_REAL_KEY'},stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';proc.stdout.on('data',b=>stdout+=b);proc.stderr.on('data',b=>stderr+=b);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const get=async u=>{const r=await fetch(origin+u);return {status:r.status,body:await r.json()}};
const post=async (p,data)=>{const r=await fetch(origin+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});return {status:r.status,body:await r.json()}};
let tests=0;const check=(cond,message)=>{assert.ok(cond,message);tests++};
try{
 let healthy=false;for(let i=0;i<50;i++){try{const r=await get('/health');if(r.body.ok){healthy=true;break}}catch{}await pause(100)}check(healthy,'server started');
 const a=await get('/api/session?token=demo-a'),b=await get('/api/session?token=demo-b');
 check(a.body.profile.discount===20,'A discount 20');check(b.body.profile.discount===35,'B discount 35');
 const bad=await get('/api/session?token=unknown');check(bad.status===404,'unknown link denied');
 const qA=await post('/api/message',{token:'demo-a',message:'Cho tôi 10 thùng nước Satori 5L'});
 check(qA.body.ok,'A quote generated');check(qA.body.quote.total===950400,'A total calculated on server');
 const qB=await post('/api/message',{token:'demo-b',message:'Cho tôi 10 thùng nước Satori 5L'});
 check(qB.body.quote.total===772200,'B total has different discount');
 const changed=await post('/api/message',{token:'demo-a',message:'Cho tôi 10 thùng 5L giao đến địa chỉ khác'});
 check(changed.body.needsHuman&&!changed.body.quote,'Changed address blocks discounted automatic order');
 const cross=await post('/api/confirm',{token:'demo-b',quoteId:qA.body.quote.quoteId,requestId:'test-cross-0111'});
 check(cross.status===409,'Customer B cannot confirm A quote');
 const confirm=await post('/api/confirm',{token:'demo-a',quoteId:qA.body.quote.quoteId,requestId:'test-idempotent-01'});
 check(confirm.body.ok&&confirm.body.order.status==='Chờ thanh toán','Confirm creates sandbox unpaid order');
 const again=await post('/api/confirm',{token:'demo-a',quoteId:qA.body.quote.quoteId,requestId:'test-idempotent-01'});
 check(again.body.duplicate&&again.body.order.ref===confirm.body.order.ref,'Repeat confirm no duplicate');
 const healthy2=await get('/health');check(healthy2.body.orders===1,'Only 1 local sandbox order');
 const pdf=await fetch(origin+'/api/invoice/'+confirm.body.order.ref+'?token=demo-a');const buf=Buffer.from(await pdf.arrayBuffer());
 check(pdf.status===200&&buf.subarray(0,4).toString()==='%PDF','Generated Unicode PDF');
 const denied=await fetch(origin+'/api/invoice/'+confirm.body.order.ref+'?token=demo-b');check(denied.status===404,'Cross-customer PDF access denied');
 console.log(`PASS ${tests}/${tests} sandbox tests; PDF ${buf.length} bytes; production untouched`);
}catch(e){console.error('FAIL:',e.message);console.error('server:',stdout,stderr);process.exitCode=1}
finally{proc.kill();rmSync(temp,{recursive:true,force:true})}