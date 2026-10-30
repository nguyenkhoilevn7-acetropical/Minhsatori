// Offline connector-vs-Android payment action contract. No network or ledger writes.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const {tools,configuration}=await import('../connector/lib/satori.mjs');
 const enabled=tools({SATORI_ENABLE_WRITES:'true'});
 const readonly=tools({SATORI_ENABLE_WRITES:'false'});
 const names=[
  'satori_mark_customer_paid','satori_mark_customer_unpaid',
  'satori_mark_satori_paid','satori_mark_satori_unpaid'
 ];
 const actions=[
  'payments.markCustomerPaid','payments.markCustomerUnpaid',
  'payments.markSatoriPaid','payments.markSatoriUnpaid'
 ];
 assert.equal(configuration({SATORI_ENABLE_WRITES:'false'}).writesEnabled,false);
 assert.equal(configuration({SATORI_ENABLE_WRITES:'true'}).writesEnabled,true);
 for(let i=0;i<4;i++){
  const surface=enabled.find(t=>t.name===names[i]);
  assert.ok(surface,'Connector source missing ChatGPT payment tool '+names[i]);
  assert.equal(surface.annotations.readOnlyHint,false);
  assert.ok(!readonly.some(t=>t.name===names[i]),
   'Payment writes must not be offered when explicitly disabled');
  assert.ok(surface.inputSchema.required.includes('confirmed'));
  const mobile=fs.readFileSync(path.join(root,
   'android/app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt'),'utf8');
  const bridge=fs.readFileSync(path.join(root,'api/AndroidOwnerMobileApi.gs'),'utf8');
  const server=fs.readFileSync(path.join(root,'api/BotApi.gs'),'utf8');
  const pending=fs.readFileSync(path.join(root,
   'android/app/src/main/java/vn/minhsatori/app/PendingMobileWrite.kt'),'utf8');
  for(const [where,s] of [['Mobile UI',mobile],['Owner API',bridge],
      ['Server API',server],['Mobile idempotency',pending]]){
   assert.ok(s.includes(actions[i]),where+' missing '+actions[i]);
  }
  if(i>0){
   for(const key of ['expectedRevision','requestId','invoiceNo','id',
     'expectedName','expectedTotal','confirmed','reason']){
    assert.ok(surface.inputSchema.required.includes(key),
      'Correction tool must require '+key);
   }
  }
 }
 const owner=fs.readFileSync(path.join(root,'api/AndroidOwnerMobileApi.gs'),'utf8');
 assert.match(owner,/allowedActions:READ_ACTIONS.concat\(ownerWriteReady\(\)\?WRITE_ACTIONS:\[\]\)/,
  'Owner snapshot must not offer payment write when bridge is missing');
 const mobile=fs.readFileSync(path.join(root,
  'android/app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt'),'utf8');
 assert.ok(mobile.includes('if (!invoice.canChangePayment || !canAction(action) || isLoading) return'),
  'No optimistic payment action without authoritative owner permission');
 console.log('PASS: ChatGPT source declares four owner payment tools; Android/owner API agree; writes fail closed');
})().catch(error=>{console.error(error);process.exitCode=1;});
