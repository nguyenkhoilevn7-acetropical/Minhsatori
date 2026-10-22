/* Production launch gates stay fail-closed even if Render flags are set.
 * No external API or real invoice data are used. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const token='TEST_ONLY_OWNER_TOKEN_123456789012345678901';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let n=0;
const check=(ok,label)=>{assert.ok(ok,label);n++};
for(const [index,preview] of [false,true].entries()){
 const dir=mkdtempSync(path.join(tmpdir(),'minh-satori-gates-'));
 const port=38900+Math.floor(Math.random()*3000),origin='http://127.0.0.1:'+port;
 const processHandle=spawn(process.execPath,[path.join(root,'server.mjs')],{
  env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',
   DEMO_DATA_DIR:dir,CUSTOMER_LINKS_ADMIN_TOKEN:token,NODE_ENV:'test',
   GEMINI_API_KEY:'',GEMINI_FREE_TIER_ONLY:'false',
   GEMINI_SANDBOX_BOOTSTRAP_ENCRYPTED_B64:'',
   GEMINI_SANDBOX_DRIVE_BRIDGE_URL:'',GEMINI_SANDBOX_DRIVE_HMAC_KEY:'',
   GEMINI_SANDBOX_EMERGENCY_DEMO_ONLY:preview?'1':'0',
   // A flag by itself must never switch this isolated server into live sales.
   SATORI_REAL_CHECKOUT_ENABLED:'1',SATORI_TEST_CHECKOUT_ENABLED:'1'},
  stdio:['ignore','pipe','pipe']});
 let log='';processHandle.stderr.on('data',b=>log+=String(b));processHandle.stdout.on('data',b=>log+=String(b));
 try{
  let health;
  for(let attempts=0;attempts<110;attempts++){
   try{const response=await fetch(origin+'/health');if(response.ok){health=await response.json();break}}catch{}
   await delay(65);
  }
  check(health?.ok===true,'HTTP healthy in test sandbox '+preview+' '+log.slice(-400));
  check(health.sandbox===true&&health.ready===!preview,'truthful readiness when preview='+preview);
  check(health.productionCheckoutEnabled===false&&health.productionLaunchReady===false,
   'REAL flag never enables production checkout');
  check(health.mode===(preview?'sandbox_emergency_preview':'sandbox_isolated'),'correct explicit mode');
  const denied=await fetch(origin+'/api/admin/production-readiness');
  check(denied.status===401,'no public operational admin read');
  const result=await fetch(origin+'/api/admin/production-readiness',{
   headers:{authorization:'Bearer '+token}});
  check(result.status===200,'authorized admin can inspect readiness');
  const data=await result.json();
  check(data.ok===true&&data.productionLaunchReady===false&&data.productionCheckoutEnabled===false,
   'administrative report cannot declare real sales ready');
  for(const block of ['productionCheckoutWired','verifiedCustomerIdentityWired',
   'authoritativeCatalogPriceSyncWired','approvedCustomerDiscountWired',
   'durableTransactionalStoreWired']){
   check(data.gates[block]===false&&data.blockers.includes(block),'blocking gate: '+block);
  }
  check(data.gates.sandboxDriveBackupBridgeConfigured===false,
   'missing Drive bridge keeps backup gate red');
  check(data.demoOnly===preview,'mode independently checked in admin report');
  if(preview){
   const res=await fetch(origin+'/api/confirm',{method:'POST',
    headers:{'content-type':'application/json'},body:'{}'});
   check(res.status===503,'preview refuses order creation');
  }
 }finally{
  processHandle.kill();rmSync(dir,{recursive:true,force:true});
 }
}
console.log('PASS '+n+'/'+n+' production launch gates, preview denial and explicit no-live-write status');
