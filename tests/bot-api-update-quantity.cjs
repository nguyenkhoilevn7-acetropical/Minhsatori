// Isolated production-like quantity and PDF source tests. No network, no live invoices.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),vm=require('node:vm'),fs=require('node:fs');
const code=fs.readFileSync(__dirname+'/../api/BotApi.gs','utf8').replace("message:err.code?err.message:'Không xử lý được; kiểm tra nhật ký hệ thống'",'message:err.message'),secret='LOCAL_TEST_QUANTITY_SECRET_012345678901234';
const original={id:222,invoiceNo:5930,apiRequestId:'fake-create-test',__syncId:'fake-sync-id',date:'21/10/2026',name:'Dung',phone:'0988388992',
 location:'SANDBOX sân cầu lông D36',status:'Chưa thanh toán',items:[{id:'line-500',code:'TP-00003',product:'Nước tinh khiết Satori 500ml',unit:'Thùng',
 qty:15,listPrice:98000,unitPrice:73500,discountAmount:24500,subtotal:1102500}],qty:15,goodsTotal:1102500,vat:'no',
 vatAmount:0,shippingAmount:0,total:1102500,deliveryNote:'Giao buổi chiều',taxCode:''};
let data={revision:7,updatedAt:'2026-10-21T09:00:00Z',values:{satori_orders_v15:JSON.stringify([original])}},backups=0,writes=0,seq=0;
const clients=JSON.stringify({'test-bot':{enabled:true,secret,scopes:['orders:read','orders:write']}});
const ctx={Date,JSON,Number,String,Array,Object,Math,Error,RegExp,Set,
 readState_:()=>JSON.parse(JSON.stringify(data)),
 ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({text:t,setMimeType(){return this}})},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>({STATE_FILE_ID:'fake-file',SATORI_BOT_CLIENTS_JSON:clients})[k]})},
 CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{computeHmacSha256Signature:(m,k)=>[...crypto.createHmac('sha256',k).update(m).digest()],getUuid:()=>String(++seq),formatDate:()=> '21/10/2026'},
 DriveApp:{getFileById:()=>({makeCopy(){const snapshot=JSON.stringify(data);return {getId:()=>String(++backups),getBlob:()=>({getDataAsString:()=>snapshot})}},setContent(x){writes++;data=JSON.parse(x)}})}
};
vm.createContext(ctx);vm.runInContext(code,ctx);
function call(action,payload={}){
 const body={keyId:'test-bot',timestamp:Date.now(),nonce:'unit-test-nonce-'+String(++seq).padStart(20,'0'),action,payload};
 body.signature=crypto.createHmac('sha256',secret).update([body.keyId,body.timestamp,body.nonce,action,JSON.stringify(payload)].join('\n')).digest('hex');
 return JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(body)}}).text);
}
const payload={expectedRevision:7,requestId:'change-qty-001',id:222,invoiceNo:5930,expectedName:'Dung',expectedTotal:1102500,itemId:'line-500',qty:20,confirmed:true};
const pdfBefore=call('orders.pdfSource',{id:222,invoiceNo:5930});
if(!pdfBefore.ok)console.error('DIAGNOSTIC',pdfBefore.error);assert.equal(pdfBefore.ok,true);assert.equal(pdfBefore.data.order.deliveryNote,'Giao buổi chiều');
assert.equal(pdfBefore.data.order.items[0].qty,15);assert.equal(writes,0);
assert.equal(call('orders.updateQty',{...payload,confirmed:false}).error.code,'CONFIRMATION_REQUIRED');
assert.equal(call('orders.updateQty',{...payload,expectedTotal:1102000}).error.code,'ORDER_CHANGED');
assert.equal(call('orders.updateQty',{...payload,itemId:'another-line'}).error.code,'INVALID_ITEM');
assert.equal(call('orders.updateQty',{...payload,qty:0}).error.code,'INVALID_ITEM');
assert.equal(writes,0);
const ok=call('orders.updateQty',payload);assert.equal(ok.ok,true);assert.equal(ok.backupCreated,true);
assert.equal(ok.data.order.items[0].qty,20);
assert.equal(ok.data.order.total,1470000);assert.equal(data.revision,8);assert.equal(backups,1);assert.equal(writes,1);
const changed=JSON.parse(data.values.satori_orders_v15)[0];
assert.equal(changed.phone,original.phone);assert.equal(changed.location,original.location);
assert.equal(changed.__syncId,original.__syncId);assert.equal(changed.items[0].discountAmount,24500);
assert.equal(changed.items[0].listPrice,98000);assert.equal(changed.items[0].unitPrice,73500);
assert.equal(changed.goodsTotal,1470000);assert.equal(changed.status,'Chưa thanh toán');
assert.equal(call('orders.updateQty',payload).data.duplicate,true);assert.equal(writes,1);
assert.equal(call('orders.updateQty',{...payload,qty:10}).error.code,'REUSED_REQUEST_ID');assert.equal(writes,1);
assert.equal(call('orders.updateQty',{...payload,requestId:'change-qty-002',qty:10}).error.code,'REVISION_CONFLICT');
const pdfAfter=call('orders.pdfSource',{id:222,invoiceNo:5930});
assert.equal(pdfAfter.data.order.total,1470000);assert.equal(pdfAfter.data.order.items[0].qty,20);
assert.equal('apiQtyEditHistory' in pdfAfter.data.order,false);
assert.equal(call('orders.pdfSource',{id:223,invoiceNo:5930}).error.code,'INVALID_ORDER');
changed.status='Đã thanh toán';changed.customerPaidAt='2026-10-21T10:00:00Z';data.values.satori_orders_v15=JSON.stringify([changed]);
assert.equal(call('orders.updateQty',{...payload,requestId:'change-qty-003',expectedRevision:8,expectedTotal:1470000,qty:21}).error.code,'PAID_ORDER_PROTECTED');
assert.equal(writes,1);
console.log('PASS — quantity guarded; revision; idempotence; paid protection; unchanged customer/prices; source PDF readonly');
