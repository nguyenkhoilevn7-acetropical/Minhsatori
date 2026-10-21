/* One customer: button -> chat -> quantity edit -> only one TEST bill, no live AI or production. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data=mkdtempSync(path.join(tmpdir(),'satori-unified-draft-'));
const port=31100+Math.floor(Math.random()*500),base='http://127.0.0.1:'+port;
const proc=spawn(process.execPath,[path.join(root,'server.mjs')],{
 env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',
  DEMO_DATA_DIR:data,GEMINI_API_KEY:'',GEMINI_FREE_TIER_ONLY:'false',
  DEMO_ISOLATED_TEST_RATE:'1',NODE_ENV:'test'},
 stdio:['ignore','pipe','pipe']});
let stderr='';proc.stderr.on('data',v=>stderr+=String(v));proc.stdout.on('data',v=>stderr+=String(v));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=async url=>{const r=await fetch(base+url);return {status:r.status,data:await r.json()}};
const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}};
let n=0;const check=(ok,why)=>{assert.ok(ok,why);n++};
const token='demo-a';
let revision=0;
async function change(action,code,qty){
 const r=await post('/api/draft',{token,action,code,qty,expectedRevision:revision});
 check(r.status===200&&r.data.draft?.revision===revision+1,action+' changes draft revision');
 revision=r.data.draft.revision;
 return r.data.draft;
}
async function chat(message){
 const r=await post('/api/message',{token,message,unifiedDraft:true,expectedRevision:revision});
 if(r.data.draft)revision=r.data.draft.revision;
 return r;
}
try{
 let ready=false;for(let i=0;i<120;i++){try{const r=await get('/health');if(r.data.ok){ready=true;break}}catch{}await sleep(60)}
 check(ready,'server starts with isolated fake data');
 const empty=await get('/api/draft?token=demo-a');
 check(empty.status===200&&empty.data.draft.items.length===0,'empty server basket');
 await change('add','TP-00003',1);  // suggested Satori 500
 let d=await change('add','TP-00136',1); // suggested Satori 5L
 check(d.items.length===2,'two different suggested products in one basket');
 const first=await chat('Cho tôi 2 thùng nước ép mãng cầu');
 check(first.status===200&&first.data.quote?.items?.length===3,'natural chat merges third product into existing basket');
 check(first.data.draft.items.reduce((v,i)=>v+i.qty,0)===4,'all button and typed quantities retained');
 const attack=await chat('Thêm 2 thùng Satori 500ml giao đến 999 Đường Lạ');
 check(attack.status===200&&attack.data.needsHuman===true&&
   attack.data.draft.items.find(x=>x.code==='TP-00003').qty===1,
   'delivery destination change never bypasses verification through cart editing');
 const ambiguousExtra=await chat('2 thùng nữa');
 check(ambiguousExtra.status===200&&ambiguousExtra.data.needMoreDetails===true,
   'short follow-up does not guess among multiple products');
 const oldQuote=first.data.quote;
 const followup=await chat('Thêm 3 thùng Satori 500ml');
 check(followup.status===200&&followup.data.draft.items.find(x=>x.code==='TP-00003').qty===4,'follow-up adds to chosen SKU, not another bill');
 let stale=await post('/api/confirm',{token,quoteId:oldQuote.quoteId,requestId:'unified-old-quote-one'});
 check(stale.status===409,'previous quote cannot be used to create another TEST bill');
 const update=await chat('Đổi Satori 500ml thành 5 thùng');
 check(update.status===200&&update.data.draft?.items?.find(x=>x.code==='TP-00003')?.qty===5,'change quantity replaces rather than adds: '+JSON.stringify({status:update.status,body:update.data}).slice(0,500));
 const remove=await chat('Bỏ mãng cầu');
 check(remove.status===200&&remove.data.draft.items.length===2,'remove item by natural chat');
 const unclear=await chat('Thêm 2 thùng nữa');
 check(unclear.status===200&&unclear.data.needMoreDetails===true,'ambiguous follow-up does not guess product in multi-item basket');
 const persisted=await get('/api/draft?token=demo-a');
 check(persisted.data.draft.items.length===2&&persisted.data.draft.revision===revision,'refresh gets exactly same server basket');
 const other=await get('/api/draft?token=demo-b');
 check(other.data.draft.items.length===0,'other customer sees none of customer A basket');
 const final=await post('/api/draft',{token,action:'quote',expectedRevision:revision});
 check(final.status===200&&final.data.quote.items.length===2,'one combined final quote');
 const ids=final.data.quote.items.map(i=>i.code).sort();
 check(ids.join(',')==='TP-00003,TP-00136','combined quote contains correct distinct SKUs');
 const subtotal=final.data.quote.items.reduce((v,i)=>v+i.subtotal,0);
 check(final.data.quote.subtotal===subtotal&&final.data.quote.total===subtotal+final.data.quote.shipping+final.data.quote.vatAmount,'discount, shipping and VAT calculated once');
 const confirmed=await post('/api/confirm',{token,quoteId:final.data.quote.quoteId,requestId:'unified-final-order-1'});
 check(confirmed.status===200&&confirmed.data.order.items.length===2&&confirmed.data.order.sandbox===true,'one TEST invoice contains entire basket');
 const repeat=await post('/api/confirm',{token,quoteId:final.data.quote.quoteId,requestId:'unified-final-order-1'});
 check(repeat.status===200&&repeat.data.duplicate===true&&repeat.data.order.ref===confirmed.data.order.ref,'confirm retry is idempotent');
 const history=await get('/api/history?token=demo-a');
 check(history.data.orders.filter(i=>i.ref===confirmed.data.order.ref).length===1,'only one history invoice created');
 const suggested=await get('/api/suggestions?token=demo-a');
 check(suggested.status===200&&suggested.data.suggestions.some(i=>i.code==='TP-00003'&&i.orderCount>=1),
   'suggestions track this customer confirmed TEST invoice');
 const bSuggested=await get('/api/suggestions?token=demo-b');
 check(bSuggested.status===200&&!bSuggested.data.suggestions.some(i=>i.orderCount>0),
   'other customer never sees profile A purchase history');
 const forbiddenSuggestions=await get('/api/suggestions?token=invalid-link');
 check(forbiddenSuggestions.status===403,'invalid token cannot request suggestions');
 const after=await get('/api/draft?token=demo-a');
 check(after.data.draft.items.length===0,'draft clears only after explicit confirmation');
 const pdf=await fetch(base+'/api/invoice/'+confirmed.data.order.ref+'?token=demo-a&view=1');
 check(pdf.status===200&&pdf.headers.get('content-disposition')?.startsWith('inline;'),'combined PDF can be viewed without forced download');
 console.log('PASS '+n+'/'+n+' unified chip + chat + edits + quote + PDF + one TEST invoice');
}catch(error){console.error('FAIL '+error.message+'\n'+stderr.slice(-3000));process.exitCode=1}
finally{proc.kill();rmSync(data,{recursive:true,force:true})}
