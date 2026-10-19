// Staged, self-contained Node tests: no network or Google Drive access.
const vm=require('node:vm'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../api/BotApi.gs'),'utf8'),secret='LOCAL_UNIT_TEST_SECRET_012345678901234567890';
let data={revision:1,updatedAt:'2026-10-18T00:00:00Z',values:{satori_orders_v15:'[]'}},backs=0,writes=0,sequence=0;
const cache=new Map(),props={STATE_FILE_ID:'test-file',SATORI_BOT_CLIENTS_JSON:JSON.stringify({'bot-01':{secret,enabled:true,scopes:['orders:read','orders:write','debt:read','payments:write']}})};
const context={
 Date,JSON,Number,String,Object,Array,Math,Error,RegExp,
 readState_:()=>JSON.parse(JSON.stringify(data)),
 ContentService:{MimeType:{JSON:'json'},createTextOutput(t){return {text:t,setMimeType(){return this}}}},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{computeHmacSha256Signature:(m,k)=>[...crypto.createHmac('sha256',k).update(m).digest()],getUuid:()=>String(++sequence),formatDate:()=> '19/10/2026'},
 DriveApp:{getFileById:()=>({makeCopy:()=>{const original=JSON.stringify(data);return {getId:()=>String(++backs),getBlob:()=>({getDataAsString:()=>original})}},setContent(s){data=JSON.parse(s);writes++}})}
};
vm.createContext(context);vm.runInContext(source,context);
function call(action,payload={},override={}){
 const body={keyId:'bot-01',timestamp:Date.now(),nonce:'test_nonce_'+String(++sequence).padStart(20,'0'),action,payload};
 body.signature=crypto.createHmac('sha256',secret).update([body.keyId,body.timestamp,body.nonce,body.action,JSON.stringify(body.payload)].join('\n')).digest('hex');
 Object.assign(body,override);return JSON.parse(context.doPost({postData:{contents:JSON.stringify(body)}}).text);
}
assert.equal(call('system.status').data.orders,0);
const input={expectedRevision:1,requestId:'create-00001',order:{name:'Test Customer',items:[{product:'Satori 500 ml',qty:2,unitPrice:10000}],total:20000}};
assert.equal(call('orders.create',input).data.order.invoiceNo,1);
assert.equal(backs,1);assert.equal(data.revision,2);
assert.equal(call('orders.create',input).data.duplicate,true);
assert.equal(backs,1);
assert.equal(call('orders.create',{...input,requestId:'create-00002'}).error.code,'REVISION_CONFLICT');
assert.equal(call('orders.create',{...input,requestId:'create-00003',expectedRevision:2,order:{...input.order,total:30000}}).error.code,'TOTAL_MISMATCH');
assert.equal(call('orders.list',{query:'Test Customer'}).data.totalMatches,1);
assert.equal(call('debt.summary').data.due,20000);
assert.equal(call('payments.markCustomerPaid',{expectedRevision:2,invoiceNo:1,confirmed:false}).error.code,'CONFIRMATION_REQUIRED');
assert.equal(call('payments.markCustomerPaid',{expectedRevision:2,invoiceNo:1,confirmed:true,amount:20000}).data.order.status,'Đã thanh toán');
assert.equal(call('debt.summary').data.due,0);assert.equal(backs,2);assert.equal(writes,2);
assert.equal(call('system.status',{}, {signature:'0'.repeat(64)}).error.code,'AUTH_FAILED');
console.log('PASS — authentication, create, idempotency, revision, amount, paid status, backups, debt');