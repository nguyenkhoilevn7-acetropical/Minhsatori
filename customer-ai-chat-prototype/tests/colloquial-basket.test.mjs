/* Customer shorthand: no package words required for catalogue-unique juice items.
 * No real customer IDs, invoices, Render calls or Gemini API requests.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseOneClause,parseColloquialBasket,completeColloquialFollowup} from '../multi-order.mjs';
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
parsed=parseColloquialBasket('Thêm 5 thùng 5 lít');
check(parsed?.pending?.missing?.qty===5&&parsed.pending.missing.unit==='thung',
 'explicit five 5L cartons retain the thùng unit');
check(/có vòi hay không vòi/i.test(
 (await import('../multi-order.mjs')).colloquialQuestion(parsed.pending.missing)),
 '5L followup asks ONLY spout when qty known');
let variant=completeColloquialFollowup(parsed.pending,'không vòi');
check(variant?.items?.some(x=>x.sku==='TP-00135'&&x.qty===5),
 'five 5L cartons no-spout resolved safely');
let binh=parseColloquialBasket('2 bình 5 lít');
check(binh?.pending?.missing?.qty===2&&binh.pending.missing.unit==='binh',
 '2 bình 5L is a valid official unit; ask only spout');
let withTap=completeColloquialFollowup(binh.pending,'có vòi');
check(withTap?.items?.some(x=>x.sku==='TP-00142'&&x.qty===2),
 '2 bình 5L có vòi maps exactly to TP-00142');
let withoutTap=completeColloquialFollowup(binh.pending,'không vòi');
check(withoutTap?.items?.some(x=>x.sku==='TP-00143'&&x.qty===2),
 '2 bình 5L không vòi maps exactly to TP-00143');
let unsized=parseColloquialBasket('Thêm 3 me, suối 5 lít');
check(unsized?.pending?.missing?.unit===null,'do not guess bình or thùng when unspecified');
check(/bình hay thùng/i.test((await import('../multi-order.mjs')).colloquialQuestion(unsized.pending.missing)),
 'unknown packaging asks customer which official unit');
let partial=completeColloquialFollowup(unsized.pending,'2 bình không vòi');
check(partial?.items.some(x=>x.sku==='TP-00143'&&x.qty===2)&&
 partial.items.some(x=>x.sku==='TP-00055'&&x.qty===3),
 'two-turn follow-up preserves me and selects 2 bình 5L không vòi');
check((await import('../multi-order.mjs')).colloquialQuestion({kind:'FIVE_LITRE',qty:5,unit:'binh',spout:null})===
 'Satori 5L: có vòi hay không vòi ạ?',
 'when unit is already bình, ask only the remaining spout');

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
  /me/i.test(r.data.message)&&/(5L|5 lít)/i.test(r.data.message),
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
 check(r.status===200&&r.data.draft?.items?.find(x=>x.code==='TP-00055')?.qty===3&&
  r.data.draft?.items?.find(x=>x.code==='TP-00058')?.qty===2&&r.data.draft?.items?.length===2,
  'new complete two-item sentence replaces stale basket atomically: exactly 3 me and 2 oi');
 const before=await draft();
 r=await send('3 me, 2 trà sữa',before.revision);
 check(r.data.needMoreDetails===true&&!r.data.quote,'unrecognized second product must not create a partial quote');
 check((await draft()).revision===before.revision,'unrecognized item never mutates existing cart');
 console.log('PASS '+checks+'/'+checks+' practical shorthand/5L/one-cart HTTP regressions');
}catch(err){console.error('FAIL '+String(err.stack||err)+'\n'+log.slice(-1300));process.exitCode=1}
finally{proc.kill();rmSync(dir,{recursive:true,force:true})}
