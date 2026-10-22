/** TEST-ONLY emergency chat preview. Never uses real customer or invoice data. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir=mkdtempSync(path.join(tmpdir(),'minh-satori-preview-e2e-'));
const port=38000+Math.floor(Math.random()*700);
const admin='PREVIEW_FAKE_ADMIN_AUTH_TOKEN_123456789_ABC';
const origin='http://127.0.0.1:'+port;
const proc=spawn(process.execPath,[path.join(root,'server.mjs')],{
 env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',DEMO_DATA_DIR:dir,
  CUSTOMER_LINKS_ADMIN_TOKEN:admin,GEMINI_API_KEY:'',GEMINI_FREE_TIER_ONLY:'false',
  GEMINI_SANDBOX_BOOTSTRAP_ENCRYPTED_B64:'',GEMINI_SANDBOX_DRIVE_BRIDGE_URL:'',
  GEMINI_SANDBOX_DRIVE_HMAC_KEY:'',GEMINI_SANDBOX_EMERGENCY_DEMO_ONLY:'1'},
 stdio:['ignore','pipe','pipe']
});
let logs='';proc.stdout.on('data',x=>logs+=String(x));proc.stderr.on('data',x=>logs+=String(x));
const sleep=x=>new Promise(r=>setTimeout(r,x));
try{
 let health=null;
 for(let i=0;i<120;i++){
  try{const r=await fetch(origin+'/health');if(r.ok){health=await r.json();break}}catch{}
  await sleep(75);
 }
 assert.ok(health,'preview must be reachable: '+logs.slice(-800));
 assert.equal(health.demoOnly,true);
 assert.equal(health.ready,false,'emergency preview must not advertise launch readiness');
 assert.equal(health.productionCheckoutEnabled,false);
 assert.equal(health.productionLaunchReady,false);
 assert.equal(health.mode,'sandbox_emergency_preview');
 assert.equal(health.orderSubmissionEnabled,false);
 assert.equal(health.draftPersistence,false);
 assert.equal(health.orders,0);
 for(const ui of ['/c/demo-a','/admin','/admin/']){
  const r=await fetch(origin+ui);assert.equal(r.status,200);
  const html=await r.text();assert.match(html,/Chế độ thử Gemini tạm thời/,'visible preview warning');
 }
 const session=await (await fetch(origin+'/api/session?token=demo-a')).json();
 assert.equal(session.demoOnly,true);assert.equal(session.orderSubmissionEnabled,false);
 const chat=await fetch(origin+'/api/message',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({token:'demo-a',message:'cho tôi 10 thùng nước satori 500ml'})});
 assert.equal(chat.status,200,'demo chat stays accessible');
 assert.equal((await chat.json()).ok,true);
 for(const [method,route] of [
  ['POST','/api/confirm'],
  ['POST','/api/admin/create-test-order'],['POST','/api/admin/drive-backup/restore'],
  ['POST','/api/admin/sandbox-backup'],['POST','/api/order-amend/confirm'],
  ['PUT','/api/admin/customers']
 ]){
  const r=await fetch(origin+route,{method,headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(r.status,503,'no writes in preview: '+route);
  assert.equal((await r.json()).error,'PREVIEW_ONLY_NO_WRITES');
 }
 // Only authenticated fake customer/location editor is permitted in this preview.
 const sample={name:'Đại lý mẫu Ảo',phone:'0900012345',address:'12 Test Street, TP HCM',
  discount:20,ship:8,vatRate:0,
  locations:[{label:'Chi nhánh 2',recipient:'Khách Demo',phone:'0900012346',
   address:'24 Test Street, TP HCM'}]};
 let unauthorized=await fetch(origin+'/api/admin/customers',{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify(sample)});
 assert.equal(unauthorized.status,401,'temporary editor still requires owner auth');
 let created=await fetch(origin+'/api/admin/customers',{method:'POST',
  headers:{'content-type':'application/json',authorization:'Bearer '+admin},
  body:JSON.stringify(sample)});
 assert.equal(created.status,201,'owner can create an ephemeral demo multi-location link');
 const p=await created.json();
 assert.equal(p.customer.locations.length,2,'both delivery locations saved together');
 const link=new URL(p.customerLink);
 const customerSession=await (await fetch(origin+'/api/session?token='+encodeURIComponent(
  link.pathname.slice(3)))).json();
 assert.equal(customerSession.profile.locations.length,2,'new temporary customer link exposes branches');
 const history=await (await fetch(origin+'/api/history?token=demo-a')).json();
 assert.ok(!Array.isArray(history.orders)||history.orders.length===0,
   'preview must NOT replay previous test invoices');
 console.log('PASS rescue Gemini preview: safe chat + banners, no invoice writes, authenticated temporary customer branches');
}finally{proc.kill();await sleep(60);rmSync(dir,{recursive:true,force:true})}
