/** Two browser tabs / two Samsung devices, one TEST invoice per shared basket. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.dirname(here),temp=mkdtempSync(path.join(tmpdir(),'satori-two-devices-'));
const port=42000+Math.floor(Math.random()*2000),host='http://127.0.0.1:'+port;
const admin='FAKE_TEST_ONLY_ADMIN_NO_REAL_SECRET_000001';
const proc=spawn(process.execPath,[path.join(root,'server.mjs')],{
 env:{...process.env,DEMO_DATA_DIR:temp,PORT:String(port),DEMO_BIND:'127.0.0.1',
  CUSTOMER_LINKS_ADMIN_TOKEN:admin,GEMINI_API_KEY:'',GEMINI_FREE_TIER_ONLY:'false',
  SATORI_READ_ENDPOINT:'',SATORI_READ_KEY_ID:'',SATORI_READ_HMAC_SECRET:'',
  GEMINI_SANDBOX_BOOTSTRAP_ENCRYPTED_B64:'',GEMINI_SANDBOX_EMERGENCY_DEMO_ONLY:'0'},
 stdio:'ignore'
});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const req=async(url,method='GET',body,owner=false)=>{
 const res=await fetch(host+url,{method,
  headers:{...(body?{'content-type':'application/json'}:{}),
   ...(owner?{authorization:'Bearer '+admin}:{})},
  body:body?JSON.stringify(body):undefined});
 return {status:res.status,data:await res.json()};
};
try{
 let started=false;
 for(let i=0;i<100;i++){try{if((await req('/health')).status===200){started=true;break}}catch{}
  await pause(80)}
 assert.ok(started,'isolated Gemini sandbox started');
 const created=await req('/api/admin/customers','POST',
  {name:'TWO DEVICE TEST ONLY',phone:'0900000044',address:'123 đường giả lập Quận 1',
   discount:20,ship:0,vatRate:0},true);
 assert.equal(created.status,201);
 const token=new URL(created.data.customerLink).pathname.split('/').at(-1);
 const add=await req('/api/draft','POST',
  {token,action:'add',code:'TP-00003',qty:2,expectedRevision:0});
 assert.equal(add.status,200,'first phone added 2 cartons');
 const rev=add.data.draft.revision;
 const a=await req('/api/draft','POST',{token,action:'quote',expectedRevision:rev});
 assert.equal(a.status,200,'phone A sees shared quote');
 const b=await req('/api/draft','POST',{token,action:'quote',expectedRevision:rev});
 assert.equal(b.status,200,'phone B sees same shared basket');
 assert.notEqual(a.data.quote.quoteId,b.data.quote.quoteId,'quotes differ across devices');
 assert.equal(a.data.quote.draftRevision,rev);
 assert.equal(b.data.quote.draftRevision,rev);
 const confirmed=await req('/api/confirm','POST',{token,
  quoteId:b.data.quote.quoteId,requestId:'phone-b-idempotency-001',expectedDraftRevision:rev});
 assert.equal(confirmed.status,200,'B confirms first');
 assert.equal(confirmed.data.duplicate,false);
 assert.match(confirmed.data.order.ref,/^TEST-[0-9A-F]{10}$/);
 const staleOtherPhone=await req('/api/confirm','POST',{token,
  quoteId:a.data.quote.quoteId,requestId:'phone-a-idempotency-002',expectedDraftRevision:rev});
 assert.equal(staleOtherPhone.status,200,'A gets confirmed invoice even after quote expired');
 assert.equal(staleOtherPhone.data.duplicate,true,'same server basket deduplicated');
 assert.equal(staleOtherPhone.data.order.ref,confirmed.data.order.ref);
 const retry=await req('/api/confirm','POST',{token,
  quoteId:b.data.quote.quoteId,requestId:'phone-b-idempotency-001',expectedDraftRevision:rev});
 assert.equal(retry.status,200);
 assert.equal(retry.data.duplicate,true,'same device retry deduplicated');
 const history=await req('/api/history?token='+encodeURIComponent(token));
 assert.equal(history.status,200);
 assert.equal(history.data.orders.length,1,'one shared TEST bill, not two');
 const untrusted=await req('/api/confirm','POST',{token,
  quoteId:'not-an-existing-quote',requestId:'unknown-quote-try-003',expectedDraftRevision:rev+1000});
 assert.equal(untrusted.status,409,'arbitrary claimed revision does not create an invoice');
 // New basket revision is a new legitimate order; the old draft is never reused.
 const next=await req('/api/draft?token='+encodeURIComponent(token));
 assert.equal(next.data.draft.items.length,0,'cleared only after successful persistence');
 const add2=await req('/api/draft','POST',{token,action:'add',code:'TP-00056',qty:3,
  expectedRevision:next.data.draft.revision});
 assert.equal(add2.status,200);
 const quote2=await req('/api/draft','POST',{token,action:'quote',expectedRevision:add2.data.draft.revision});
 assert.equal(quote2.status,200);
 const mismatch=await req('/api/confirm','POST',{token,quoteId:quote2.data.quote.quoteId,
  requestId:'wrong-draft-claim-004',expectedDraftRevision:rev});
 assert.equal(mismatch.status,409,'cannot bind new quote to previous revision');
 const second=await req('/api/confirm','POST',{token,quoteId:quote2.data.quote.quoteId,
  requestId:'legitimate-next-bill-005',expectedDraftRevision:add2.data.draft.revision});
 assert.equal(second.status,200,'different basket can create another TEST bill');
 assert.notEqual(second.data.order.ref,confirmed.data.order.ref);
 const latest=await req('/api/history?token='+encodeURIComponent(token));
 assert.equal(latest.data.orders.length,2);
 console.log('PASS two-device shared TEST cart: single invoice per revision, safe retries, fresh subsequent order');
}finally{
 proc.kill();await pause(75);rmSync(temp,{recursive:true,force:true});
}
