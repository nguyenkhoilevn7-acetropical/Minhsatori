/**
 * The Samsung screenshot MUST NOT silently drop 2 me, 3 mãng cầu, the delivery
 * instruction or infer 5L with spout from 500ml. HTTP end to end, TEST only.
 */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {parseCustomerMessage,splitOrderAndNote,waterAnswer,finishWater} from '../order-with-notes.mjs';
const input='Cho anh 10 suối, 2 me, 3 mãng cầu. Lưu ý giao sau 2h chiều';
let count=0;
function check(ok,msg){assert.ok(ok,msg);count++}
const split=splitOrderAndNote(input);
check(split.orderText.includes('3 mãng cầu')&&split.noteText.includes('giao sau 2h chiều'),'Unicode lưu ý properly separates');
const p=parseCustomerMessage(input);
check(p?.kind==='order'&&p.items.length===2&&p.water?.qty===10,
 'all mentioned SKUs and water quantity retained as ONE pending order');
check(p.items.some(x=>x.sku==='TP-00055'&&x.qty===2)&&p.items.some(x=>x.sku==='TP-00056'&&x.qty===3),
 '2 me and 3 mãng cầu must not disappear');
check(p.delivery?.deliveryNote.includes('14:00')&&!p.delivery.clarification,
 '2h chiều is fixed 14:00, not 2 hours later');
check(waterAnswer('Suối 500ml')?.size===500&&!waterAnswer('Suối 500ml').brand,
 'water 500ml answer does not hallucinate Satori brand');
check(waterAnswer('Suối satori 500ml')?.brand==='satori','water Satori 500ml explicit brand');
const completed=finishWater(p,waterAnswer('Suối satori 500ml'));
check(completed?.items?.length===3&&completed.items.some(x=>x.sku==='TP-00003'&&x.qty===10)&&
 !completed.items.some(x=>x.sku==='TP-00136'),'cannot turn 500ml into 5L with spout');
check(parseCustomerMessage('10 suối, 2 me, 3 trà sữa. Lưu ý giao sau 2 giờ chiều').kind==='invalid',
 'unknown item blocks partial basket');
check(parseCustomerMessage('Lưu ý gọi trước khi đến').kind==='note-only','standalone note recognized');
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir=mkdtempSync(path.join(tmpdir(),'satori-screenshot-notes-'));
const port=35810+Math.floor(Math.random()*400),base='http://127.0.0.1:'+port;
const proc=spawn(process.execPath,[path.join(ROOT,'server.mjs')],{
 env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',
 DEMO_DATA_DIR:dir,GEMINI_API_KEY:'',GEMINI_FREE_TIER_ONLY:'false',
 GEMINI_SANDBOX_DRIVE_BRIDGE_URL:'',GEMINI_SANDBOX_BOOTSTRAP_ENCRYPTED_B64:'',
 NODE_ENV:'test',DEMO_ISOLATED_TEST_RATE:'1'},stdio:['ignore','pipe','pipe']});
let log='';proc.stdout.on('data',b=>log+=String(b));proc.stderr.on('data',b=>log+=String(b));
const a='demo-a~'+'a'.repeat(32),other='demo-a~'+'b'.repeat(32);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const get=async(token)=>{let r=await fetch(base+'/api/draft?token='+token);return (await r.json()).draft};
const say=async(token,message,rev)=>{let r=await fetch(base+'/api/message',{
 method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({token,message,unifiedDraft:true,expectedRevision:rev})});
 return {status:r.status,body:await r.json()}};
try{
 let ready=false;for(let i=0;i<110;i++){try{if((await fetch(base+'/health')).ok){ready=true;break}}catch{}await wait(65)}
 check(ready,'server started '+log.slice(-400));
 check((await get(a)).items.length===0&&(await get(other)).items.length===0,
  'new browser session must start with zero products');
 let r=await say(a,input,0);
 check(r.status===200&&r.body.clarificationType==='MIXED_WATER'&&
  /2 thùng/i.test(r.body.message)&&/3 thùng/i.test(r.body.message)&&/2h chiều/i.test(r.body.message),
  'one clarification message preserves full products and original note: '+JSON.stringify(r.body).slice(0,800));
 check((await get(a)).items.length===0,'no partial SKU before choosing water');
 r=await say(a,'Suối 500ml',0);
 check(r.status===200&&r.body.clarificationType==='MIXED_WATER'&&/Satori hay Hikari/i.test(r.body.message),
  '500ml needs brand, cannot auto pick Satori or 5L');
 r=await say(a,'Suối satori 500ml',0);
 check(r.status===200&&r.body.draft?.items?.length===3&&r.body.quote,
  'explicit water SKU commits three items atomically: '+JSON.stringify(r.body).slice(0,850));
 let ordered=new Map(r.body.draft.items.map(x=>[x.code,x.qty]));
 check(ordered.get('TP-00003')===10&&ordered.get('TP-00055')===2&&ordered.get('TP-00056')===3,
  'all three screenshot items exact, including product code 00003');
 check(!ordered.has('TP-00136')&&r.body.draft.items.reduce((n,x)=>n+x.qty,0)===15,
  'forbid surprise 10 cartons of 5L or extra previous products');
 check(r.body.quote.deliveryNote.includes('14:00'),'note survives into a quote');
 check((await get(a)).deliveryNote.includes('14:00'),'note persists inside revisioned draft');
 const quoted=await fetch(base+'/api/draft',{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({token:a,action:'quote',expectedRevision:r.body.draft.revision})});
 const liveQuote=(await quoted.json()).quote;
 check(liveQuote?.deliveryNote.includes('14:00'),'the quote button refresh does not erase note');
 check((await get(other)).items.length===0,'other browser still empty');
 const rev=r.body.draft.revision;
 r=await say(a,'Lưu ý giao sau 3h chiều, nhớ gọi trước',rev);
 check(r.status===200&&r.body.draft?.items.length===3&&r.body.quote?.deliveryNote.includes('15:00'),
  'standalone later note updates current basket without changing SKUs');
 check((await get(a)).items.length===3,'note-only request never inserts another item');
 const before=await get(a);
 r=await say(a,'Cho anh 10 suối, 2 me, 3 trà sữa. Lưu ý giao sau 2h chiều',before.revision);
 check(r.body.needMoreDetails&&(await get(a)).revision===before.revision,
  'unknown product cannot partially mutate existing basket');
 const clean=await get(other);
 r=await say(other,'Cho anh 10 suối, 2 me, 3 mãng cầu. Lưu ý giao sau 2h',clean.revision);
 check(r.body.clarificationType==='MIXED_WATER'&&(await get(other)).items.length===0,
  'ambiguous delivery plus water stores no SKU yet');
 r=await say(other,'Hikari 500ml',clean.revision);
 check(r.body.clarificationType==='MIXED_DELIVERY'&&(await get(other)).items.length===0,
  'after water brand selection still must clarify delivery time before ANY write');
 r=await say(other,'2h chiều',clean.revision);
 const after=r.body.draft;
 check(after.items.length===3&&after.items.some(x=>x.code==='TP-00081'&&x.qty===10)
   &&after.deliveryNote.includes('14:00'),
   'delivery followup atomically commits correct Hikari 500ml, juices and normalized note');
 console.log('PASS '+count+'/'+count+' screenshot multi-item+notes, no ghost 5L, quote-note persistence and multi-turn');
}catch(e){console.error('FAIL '+String(e.stack||e)+'\n'+log.slice(-1500));process.exitCode=1}
finally{proc.kill();rmSync(dir,{recursive:true,force:true})}
