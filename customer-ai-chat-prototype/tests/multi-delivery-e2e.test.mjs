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
 console.log('Multi-location sandbox HTTP checks PASS');
}finally{
 processRef.kill();rmSync(temp,{recursive:true,force:true});
}