import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp=mkdtempSync(path.join(tmpdir(),'satori-multi-location-'));
const admin='SANDBOX_ONLY_LONG_ADMIN_TOKEN_1234567890';
const port=39000+Math.floor(Math.random()*2500);
const origin='http://127.0.0.1:'+port;
const processRef=spawn(process.execPath,[path.join(root,'server.mjs')],{
 env:{...process.env,DEMO_DATA_DIR:temp,PORT:String(port),DEMO_BIND:'127.0.0.1',
 CUSTOMER_LINKS_ADMIN_TOKEN:admin,GEMINI_API_KEY:'',SATORI_READ_ENDPOINT:'',SATORI_READ_KEY_ID:'',SATORI_READ_HMAC_SECRET:''},
 stdio:'ignore'});
const call=async(route,method='GET',body,authorized=false)=>{
 const response=await fetch(origin+route,{method,
 headers:{...(body?{'content-type':'application/json'}:{}),...(authorized?{authorization:'Bearer '+admin}:{})},
 body:body?JSON.stringify(body):undefined});
 return {status:response.status,data:await response.json()};
};
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
try{
 let live=false;for(let n=0;n<90;n++){try{if((await call('/health')).status===200){live=true;break}}catch{}await delay(80)}
 assert.ok(live,'fake-data server started');
 const created=await call('/api/admin/customers','POST',{name:'Tracy Sài Gòn TEST',
  phone:'0900000088',address:'1 Đường Mẫu, Quận 1',discount:20,ship:8,vatRate:0},true);
 assert.equal(created.status,201);
 const id=created.data.customer.id,token=decodeURIComponent(new URL(created.data.customerLink).pathname.split('/').at(-1));
 const base='/api/admin/customers/'+id+'/locations';
 assert.equal((await call(base,'GET')).status,401,'no anonymous address list through admin');
 const added=await call(base,'POST',{label:'Chi nhánh Quận 7',recipient:'Người nhận Q7',
  phone:'0900000077',address:'7 Đường Mẫu, Quận 7'},true);
 assert.equal(added.status,200);
 const idQ7=added.data.customer.locations.find(x=>x.label==='Chi nhánh Quận 7')?.id;
 assert.ok(idQ7,'second address stored on same original customer');
 // One newly created reseller can immediately own several approved destinations
 // without manually creating the link first and editing later.
 const bundled=await call('/api/admin/customers','POST',{
  name:'Dai ly multiple branch TEST',phone:'0900000098',address:'11 Đường Mẫu Quận 1',
  discount:20,ship:8,vatRate:0,locations:[
   {label:'Chi nhánh A',recipient:'Kho A',phone:'0900000091',address:'12 Đường Mẫu Quận 3'},
   {label:'Chi nhánh B',recipient:'Kho B',phone:'0900000092',address:'13 Đường Mẫu Quận 8'}
  ]
 },true);
 assert.equal(bundled.status,201,'one create action creates multiple delivery points');
 assert.equal(bundled.data.customer.locations.length,3);
 assert.equal(bundled.data.customer.locations[2].recipient,'Kho B');
 assert.equal((await call('/api/session?token='+encodeURIComponent(new URL(bundled.data.customerLink).pathname.split('/').at(-1)))).data.profile.locations.length,3);
 const invalid=await call('/api/admin/customers','POST',{
  name:'Invalid Branch TEST',phone:'0900000097',address:'14 Đường Mẫu Quận 1',
  discount:20,ship:8,vatRate:0,locations:[
   {label:'Chi nhánh A',recipient:'Kho A',phone:'0900000091',address:'15 Đường Mẫu Quận 3'},
   {label:'Chi nhánh A',recipient:'Kho B',phone:'0900000092',address:'16 Đường Mẫu Quận 8'}
  ]
 },true);
 assert.equal(invalid.status,409,'duplicate branch labels rejected before any customer is created');
 const stillMissing=await call('/api/admin/customers','GET',undefined,true);
 assert.ok(!stillMissing.data.customers.some(x=>x.phone==='0900000097'),'invalid multi-address form makes no partial writes');
 const view=await fetch(origin+'/admin').then(x=>x.text());
 assert.ok(view.includes('id="addCustomerLocation"'),'admin create form contains the requested add-address control');
 assert.ok(view.includes('id="manageSelectedLocations"'),'existing reseller has location shortcut');
 const chatView=await fetch(origin+'/c/demo-a').then(x=>x.text());
 assert.ok(chatView.includes('id="locationsToggle"'),'customer UI contains branch selector');
 const session=await call('/api/session?token='+encodeURIComponent(token));
 assert.equal(session.data.profile.locations.length,2);
 assert.equal(session.data.profile.multipleDeliveryLocations,true);
 const first=await call('/api/message','POST',{token,message:'Cho 2 thùng Satori 500ml',
  unifiedDraft:true,expectedRevision:0});
 assert.equal(first.status,200);
 assert.equal(first.data.quote?.locationRequired,true,'multi-address quote cannot silently pick primary');
 const rejected=await call('/api/confirm','POST',{token,quoteId:first.data.quote.quoteId,
  requestId:'multi-test-before-select-1'});
 assert.equal(rejected.status,409,'confirmation blocked until branch selected');
 const current=await call('/api/draft?token='+encodeURIComponent(token));
 const chosen=await call('/api/draft','POST',{token,action:'destination',locationId:idQ7,
  expectedRevision:current.data.draft.revision});
 assert.equal(chosen.status,200);
 assert.equal(chosen.data.draft.locationId,idQ7);
 const quote=await call('/api/draft','POST',{token,action:'quote',
  expectedRevision:chosen.data.draft.revision});
 assert.equal(quote.status,200);
 assert.equal(quote.data.quote.address,'7 Đường Mẫu, Quận 7');
 assert.equal(quote.data.quote.phone,'0900000077');
 assert.equal(quote.data.quote.recipient,'Người nhận Q7');
 const success=await call('/api/confirm','POST',{token,quoteId:quote.data.quote.quoteId,
  requestId:'multi-test-selected-2'});
 assert.equal(success.status,200);
 assert.equal(success.data.order.deliveryLocationId,idQ7);
 assert.equal(success.data.order.name,'Tracy Sài Gòn TEST');
 const fake=await call('/api/draft','POST',{token,action:'destination',locationId:'not-in-customer',
  expectedRevision:chosen.data.draft.revision});
 assert.equal(fake.status,400,'cannot select a foreign/unapproved destination');
 const next=await call('/api/draft?token='+encodeURIComponent(token));
 const chat=await call('/api/message','POST',{token,
  message:'Giao Chi nhánh Quận 7',unifiedDraft:true,expectedRevision:next.data.draft.revision});
 assert.equal(chat.status,200);
 assert.equal(chat.data.draft?.locationId,idQ7,'chat can identify the approved branch by name');
 const combinedDraft=await call('/api/draft?token='+encodeURIComponent(token));
 const combined=await call('/api/message','POST',{token,
  message:'Cho 3 thùng Satori 500ml giao Chi nhánh Quận 7',
  unifiedDraft:true,expectedRevision:combinedDraft.data.draft.revision});
 assert.equal(combined.status,200,'mixed product and destination reaches chat handler');
 assert.equal(combined.data.draft?.locationId,idQ7,'combined message selects known branch');
 assert.ok(combined.data.quote?.qty===3,'combined message preserves the requested quantity');
 assert.equal(combined.data.quote?.address,'7 Đường Mẫu, Quận 7','mixed message quote uses approved destination');
 console.log('Multi-location sandbox HTTP checks PASS');
}finally{
 processRef.kill();rmSync(temp,{recursive:true,force:true});
}