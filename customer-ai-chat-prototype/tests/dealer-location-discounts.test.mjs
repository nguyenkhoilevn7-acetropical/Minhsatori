import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const admin='DEALER_TEST_OWNER_abcdefghijklmnopqrstuvwxyz_0123456789';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){
 const s=createServer();await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
 const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;
}
test('one Minh Satori sandbox link: 17 locations, distinct owner rates, quote change and no duplicate invoice',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'minh-satori-dealer-prices-'));
 const port=await freePort(),origin='http://127.0.0.1:'+port;
 const proc=spawn(process.execPath,[join(root,'server.mjs')],{
   env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',
    DEMO_DATA_DIR:dir,CUSTOMER_LINKS_ADMIN_TOKEN:admin,
    GEMINI_API_KEY:'',GEMINI_OWNER_ONLY_REAL_PILOT:'0',
    GEMINI_SANDBOX_EMERGENCY_DEMO_ONLY:'0',
    SATORI_READ_ENDPOINT:'',SATORI_READ_KEY_ID:'',SATORI_READ_HMAC_SECRET:''},
   stdio:'ignore'
 });
 const request=async(path,method='GET',body,asAdmin=false)=>{
  const r=await fetch(origin+path,{method,headers:{
    ...(body?{'content-type':'application/json'}:{}),
    ...(asAdmin?{authorization:'Bearer '+admin}:{})
  },body:body?JSON.stringify(body):undefined});
  return {status:r.status,data:await r.json()};
 };
 try{
  let ready=false;for(let i=0;i<100;i++){
   try{if((await request('/health')).status===200){ready=true;break;}}catch{}
   await pause(100);
  }
  assert.ok(ready,'sandbox must start');
  const extras=Array.from({length:16},(_,i)=>({
   label:'Điểm giao '+(i+2),recipient:'Người nhận '+(i+2),
   phone:'090'+String(i+1).padStart(7,'0'),
   address:'Số '+(i+2)+' đường Giả Lập, Thành phố Mẫu',
   discountPercent:i%2?30:25
  }));
  const create=await request('/api/admin/customers','POST',{
   name:'Đại lý mẫu 17 điểm giao',phone:'0909999988',
   address:'Số 1 đường Giả Lập, Thành phố Mẫu',
   discount:20,ship:0,vatRate:0,locations:extras
  },true);
  assert.equal(create.status,201,JSON.stringify(create.data));
  assert.equal(create.data.customer.locations.length,17);
  assert.ok(create.data.customerLink.includes('/c/'));
  const token=decodeURIComponent(new URL(create.data.customerLink).pathname.split('/').at(-1));
  const params='token='+encodeURIComponent(token);
  const session=await request('/api/session?'+params);
  assert.equal(session.data.profile.locations.length,17);
  const places=session.data.profile.locations;
  const samples=[[0,20],[1,25],[2,30]];
  for(const [index,discount] of samples){
   const r=await request('/api/catalogue?'+params+'&locationId='+places[index].id);
   assert.equal(r.status,200,JSON.stringify(r.data));
   assert.equal(r.data.discount,discount);
   const p=r.data.products[0];
   assert.equal(p.unitPrice,Math.round(p.listPrice*(100-discount)/100));
  }
  assert.equal((await request('/api/catalogue?'+params)).status,409,
   'multiple locations must require explicit selection for price');
  assert.equal((await request('/api/catalogue?token=invalid&locationId='+places[1].id)).status,403);
  let draft=(await request('/api/draft?'+params)).data.draft;
  let add=await request('/api/draft','POST',{token,action:'add',
   code:'TP-00001',qty:2,expectedRevision:draft.revision});
  assert.equal(add.status,200,JSON.stringify(add.data));
  draft=add.data.draft;
  let pick=await request('/api/draft','POST',{token,action:'destination',
   locationId:places[1].id,expectedRevision:draft.revision});
  assert.equal(pick.status,200);
  draft=pick.data.draft;
  let quoted=await request('/api/draft','POST',{token,action:'quote',
   expectedRevision:draft.revision});
  assert.equal(quoted.status,200,JSON.stringify(quoted.data));
  assert.equal(quoted.data.quote.discount,25);
  const old=quoted.data.quote;
  const changed=await request('/api/admin/customers/'+create.data.customer.id+
   '/locations/'+places[1].id,'PATCH',{...extras[0],discountPercent:30},true);
  assert.equal(changed.status,200,JSON.stringify(changed.data));
  const stale=await request('/api/confirm','POST',{token,quoteId:old.quoteId,
   requestId:'old-dealer-price-0001',expectedDraftRevision:draft.revision});
  assert.equal(stale.status,409,'stale 25% quote must not become a 30% order');
  assert.equal(stale.data.error,'PROFILE_CHANGED');
  quoted=await request('/api/draft','POST',{token,action:'quote',
   expectedRevision:draft.revision});
  assert.equal(quoted.status,200);
  assert.equal(quoted.data.quote.discount,30);
  const confirmation={token,quoteId:quoted.data.quote.quoteId,
   requestId:'dealer-once-only-0001',expectedDraftRevision:draft.revision};
  const saved=await request('/api/confirm','POST',confirmation);
  assert.equal(saved.status,200,JSON.stringify(saved.data));
  assert.equal(saved.data.order.discount,30);
  assert.equal(saved.data.order.deliveryLocationId,places[1].id);
  const replay=await request('/api/confirm','POST',confirmation);
  assert.equal(replay.status,200);
  assert.equal(replay.data.duplicate,true);
  assert.equal(replay.data.order.ref,saved.data.order.ref);
  const history=await request('/api/history?'+params);
  assert.equal(history.data.count,1,'same request must generate only one TEST invoice');
  const list=await request('/api/admin/customers','GET',undefined,true);
  assert.equal(list.data.customers.length,1,'17 destinations are one dealer, not 17 accounts');
  assert.equal(list.data.customers[0].locations.length,17);
 } finally {proc.kill('SIGTERM');await pause(100);rmSync(dir,{recursive:true,force:true});}
});
