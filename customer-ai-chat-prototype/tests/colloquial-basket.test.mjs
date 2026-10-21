/* Customer shorthand: no package words required for catalogue-unique juice items.
 * No real customer IDs, invoices, Render calls or Gemini API requests.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseOneClause,parseColloquialBasket,colloquialQuestion,completeColloquialFollowup,parseWaterClarificationBasket} from '../multi-order.mjs';
let checks=0;const check=(ok,msg)=>{assert.ok(ok,msg);checks++};
for(const [text,code,qty] of [
 ['3 me','TP-00055',3],['ba me','TP-00055',3],['thêm 3 me','TP-00055',3],
 ['2 mãng cầu','TP-00056',2],['5 ổi','TP-00058',5],['3 thùng me','TP-00055',3]
]){
 const parsed=parseOneClause(text);
 check(parsed?.sku===code&&parsed?.qty===qty,'unique juice catalogue keyword understood: '+text);
}
let parsed=parseColloquialBasket('Thêm 3 me, Suối 5 lit');
check(parsed?.pending?.items?.[0]?.sku==='TP-00055'&&parsed.pending.items[0].qty===3,
 'understand 3 cartons of tamarind before asking about 5 litres');
for(const spelling of ['5 lít','5L','5 lit','suối 5 lít','nước 5 lit']){
 const interpreted=parseColloquialBasket(spelling);
 check(interpreted?.pending?.missing?.kind==='FIVE_LITRE'&&interpreted.pending.missing.qty===null,
  'normalise 5-litre expressions without guessing carton quantity: '+spelling);
}
// The authoritative catalogue sells 5L both as a carton of four bottles
// and as an individual bottle, with separate SKUs and prices.
const compact=parseColloquialBasket('Thêm 5 thùng 5 lít');
check(compact?.pending?.missing?.unit==='thung'&&compact.pending.missing.qty===5,
 'five 5L cartons are understood, only spout variant needs confirmation');
check(!colloquialQuestion(compact.pending.missing).includes('bình lẻ hay')&&
 colloquialQuestion(compact.pending.missing).includes('có vòi hay không vòi'),
 'already specified thùng: no unnecessary bottle-versus-carton question');
check(parseColloquialBasket('5 thùng suối 5 lít có vòi')?.items?.[0]?.sku==='TP-00136',
 '5L 4-bottle carton with tap maps to TP-00136');
check(parseColloquialBasket('5 bình 5 lít có vòi')?.items?.[0]?.sku==='TP-00142',
 '5 individual 5L bottles with tap maps to TP-00142');
check(parseColloquialBasket('5 bình 5 lít không vòi')?.items?.[0]?.sku==='TP-00143',
 '5 individual 5L bottles without tap maps to TP-00143');
const loose=parseColloquialBasket('5 bình 5 lít');
check(loose?.pending?.missing?.unit==='binh'&&loose.pending.missing.qty===5,
 '5 bình 5L stays bottles, only tap variant remains unclear');
check(parseColloquialBasket('5 lít')?.pending?.missing?.unit===null,
 'unspecified 5L package must not silently default to thùng');
check(colloquialQuestion(parseColloquialBasket('5 lít').pending.missing).includes('bình lẻ hay thùng'),
 'ambiguous 5L clearly offers the two catalogue-backed package choices');
check(parsed.pending.missing.kind==='FIVE_LITRE'&&parsed.pending.missing.qty===null,
 'do not hallucinate quantity from 5-litre capacity');
let response=completeColloquialFollowup(parsed.pending,'2 thùng không vòi');
check(response?.items?.some(x=>x.sku==='TP-00135'&&x.qty===2),'5L no-spout resolved without asking customer to repeat me');
parsed=parseColloquialBasket('Thêm 3 thùng me, 2 thùng 5l');
check(parsed?.pending?.missing?.qty===2&&parsed.pending.missing.unit==='thung','retain 2 cartons pending spout choice');
response=completeColloquialFollowup(parsed.pending,'có vòi');
check(response?.items?.some(x=>x.sku==='TP-00136'&&x.qty===2),'explicit 5L with-spout carton');
parsed=parseColloquialBasket('3 me, 2 ổi');
check(parsed?.items?.length===2&&parsed.items[0].sku==='TP-00055'&&parsed.items[1].sku==='TP-00058',
 'two separate natural juice keywords from one text');
check(parseColloquialBasket('3 me, 2 thùng trà sữa')===null,'unsupported products never create a partial basket');
for(const phrase of ['5 suối','năm suối','cho anh 5 suối']){
 const result=parseWaterClarificationBasket(phrase);
 check(result?.pending?.water?.qty===5&&result.pending.water.unit==='thung',
  'unbranded shorthand '+phrase+' assumes carton, asks brand/volume without invented SKU');
}
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir=mkdtempSync(path.join(tmpdir(),'satori-natural-'));
const port=35110+Math.floor(Math.random()*300);
const base='http://127.0.0.1:'+port;
const proc=spawn(process.execPath,[path.join(root,'server.mjs')],{
 env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',DEMO_DATA_DIR:dir,
 GEMINI_API_KEY:'',GEMINI_FREE_TIER_ONLY:'false',GEMINI_SANDBOX_DRIVE_BRIDGE_URL:'',
 GEMINI_SANDBOX_BOOTSTRAP_ENCRYPTED_B64:'',NODE_ENV:'test',DEMO_ISOLATED_TEST_RATE:'1'},
 stdio:['ignore','pipe','pipe']});
let log='';proc.stdout.on('data',x=>log+=String(x));proc.stderr.on('data',x=>log+=String(x));
const token='demo-a~'+'9'.repeat(32);
const wait=t=>new Promise(done=>setTimeout(done,t));
const draft=async()=>{const r=await fetch(base+'/api/draft?token='+token);return (await r.json()).draft};
const send=async(text,revision)=>{const r=await fetch(base+'/api/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,message:text,unifiedDraft:true,expectedRevision:revision})});return {status:r.status,data:await r.json()}};
try{
 let ok=false;for(let i=0;i<110;i++){try{if((await fetch(base+'/health')).ok){ok=true;break}}catch{}await wait(75)}
 check(ok,'isolated server starts '+log.slice(-350));
 let r=await send('Thêm 3 me',0);
 check(r.status===200&&r.data.draft?.items?.find(x=>x.code==='TP-00055')?.qty===3,
  'single shorthand correctly ADDs tamarind without unit: '+JSON.stringify(r.data).slice(0,600));
 let rev=r.data.draft.revision;
 r=await send('Thêm 2 ổi',rev);
 check(r.status===200&&r.data.draft?.items?.find(x=>x.code==='TP-00058')?.qty===2,
  'second abbreviated product adds to shared basket, not separate bill');
 rev=r.data.draft.revision;
 r=await send('Thêm 3 me, Suối 5 lit',rev);
 check(r.status===200&&r.data.clarificationType==='COLLOQUIAL_PRODUCT'&&
  /me/i.test(r.data.message)&&/5 lít/i.test(r.data.message),
  'understand me, ask only missing qty/packaging/variant for water');
 check((await draft()).revision===rev,'ambiguous water never adds 3 me prematurely');
 r=await send('2 thùng không vòi',rev);
 check(r.status===200&&r.data.draft?.items?.find(x=>x.code==='TP-00135')?.qty===2,
  'two-turn no-spout water resolves as correct SKU');
 check(r.data.draft.items.find(x=>x.code==='TP-00055')?.qty===6,
  'previous 3 me plus new 3 me aggregated into one cart line');
 rev=r.data.draft.revision;
 r=await send('Thêm 3 Thùng me, 2 Thùng 5l',rev);
 check(r.data.clarificationType==='COLLOQUIAL_PRODUCT','known qty, unknown spout must ask only spout');
 check((await draft()).revision===rev,'partial basket state protected before spout confirmation');
 r=await send('Có vòi',rev);
 check(r.status===200&&r.data.draft?.items?.find(x=>x.code==='TP-00136')?.qty===2,
  'only confirmed spout variant added, same basket');
 rev=r.data.draft.revision;
 r=await send('3 me, 2 ổi',rev);
 check(r.status===200&&r.data.draft?.items?.find(x=>x.code==='TP-00055')?.qty===12,
  'two unique items in one natural sentence add atomically');
 const before=await draft();
 r=await send('3 me, 2 trà sữa',before.revision);
 check(r.data.needMoreDetails===true&&!r.data.quote,'unrecognized second product must not create a partial quote');
 check((await draft()).revision===before.revision,'unrecognized item never mutates existing cart');
 console.log('PASS '+checks+'/'+checks+' practical shorthand/5L/one-cart HTTP regressions');
}catch(err){console.error('FAIL '+String(err.stack||err)+'\n'+log.slice(-1300));process.exitCode=1}
finally{proc.kill();rmSync(dir,{recursive:true,force:true})}
