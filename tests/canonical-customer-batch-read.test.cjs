const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const raw=fs.readFileSync(require.resolve('../api/BotApi.gs'),'utf8');
const secret='original-read-test-secret-'.padEnd(40,'x');
const example={id:'immutable-0001',invoiceNo:101,date:'01/11/2026',name:'Receiver',
 phone:'0900000000',location:'Verified address',status:'Chưa thanh toán',total:90000,
 items:[{product:'Satori 350ml',qty:2,unitPrice:40000,listPrice:50000}],
 shippingAmount:8000,vatAmount:2000,deliveryNote:'giao sau 2h'};
let writes=0;
const state={revision:195,values:{satori_orders_v15:JSON.stringify([example])}};
const props={SATORI_BOT_CLIENTS_JSON:JSON.stringify({'reader':{
 secret,enabled:true,scopes:['orders:read']}})};
const context={
 Date,JSON,Number,String,Object,Array,Math,Error,RegExp,
 readState_:()=>JSON.parse(JSON.stringify(state)),
 ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({text:t,setMimeType(){return this}})},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},
 CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{Charset:{UTF_8:'utf8'},computeHmacSha256Signature:(s,k)=>[...crypto.createHmac('sha256',k).update(s,'utf8').digest()]},
 DriveApp:{getFileById:()=>{writes++;throw Error('WRITE_DISALLOWED')}}
};
vm.runInNewContext(raw,context);
let ctr=0;
function call(action,payload){
 const body={keyId:'reader',timestamp:Date.now(),nonce:'exactnonce'+String(++ctr).padStart(24,'0'),action,payload};
 body.signature=crypto.createHmac('sha256',secret)
  .update([body.keyId,body.timestamp,body.nonce,body.action,JSON.stringify(body.payload)].join('\n'))
  .digest('hex');
 return JSON.parse(context.doPost({postData:{contents:JSON.stringify(body)}}).text);
}
test('exact batch returns updated amounts and payment state without write or CTV metadata',()=>{
 const result=call('orders.getExactBatch',{refs:[{id:'immutable-0001',invoiceNo:101}]});
 assert.equal(result.ok,true);
 const row=result.data.orders[0];
 assert.equal(row.id,example.id);
 assert.equal(row.totalVnd,90000);
 assert.equal(row.items[0].lineTotal,80000);
 assert.equal(row.shippingVnd,8000);
 assert.equal(row.vatVnd,2000);
 assert.equal(row.customerPaid,false);
 assert.equal(row.deliveryNote,'giao sau 2h');
 assert.ok(!('pairCommissionAmount' in row));
 assert.equal(result.revision,195);
 assert.equal(writes,0);
});
test('missing exact identity not matched by name, and invalid refs rejected',()=>{
 const missing=call('orders.getExactBatch',{refs:[{id:'wrong-id',invoiceNo:101}]});
 assert.equal(missing.ok,true);
 assert.equal(missing.data.orders[0].missing,true);
 assert.equal(call('orders.getExactBatch',{refs:[{id:'immutable-0001',invoiceNo:101},{id:'immutable-0001',invoiceNo:101}]}).error.code,'EXACT_BATCH_DUPLICATE');
 assert.equal(call('orders.getExactBatch',{refs:[{id:'immutable-0001',invoiceNo:101},{id:'wrong id',invoiceNo:102}]}).error.code,'EXACT_BATCH_INVALID');
 assert.equal(writes,0);
});
test('updated customer payment, excluded and cancelled states are read from canonical row',()=>{
 const order=JSON.parse(state.values.satori_orders_v15)[0];
 order.status='Đã thanh toán';order.customerPaidAt='2026-11-01T12:00:00Z';
 state.values.satori_orders_v15=JSON.stringify([order]);
 assert.equal(call('orders.getExactBatch',{refs:[{id:order.id,invoiceNo:101}]}).data.orders[0].customerPaid,true);
 order.status='Không Tính';state.values.satori_orders_v15=JSON.stringify([order]);
 const noCount=call('orders.getExactBatch',{refs:[{id:order.id,invoiceNo:101}]}).data.orders[0];
 assert.equal(noCount.totalVnd,0);
 assert.equal(noCount.customerPaid,false);
 assert.equal(noCount.excluded,true);
 assert.equal(writes,0);
});
