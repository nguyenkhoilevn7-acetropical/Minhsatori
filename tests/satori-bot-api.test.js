// Staged, self-contained Node tests: no network or Google Drive access.
const vm=require('node:vm'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../api/BotApi.gs'),'utf8'),secret='LOCAL_UNIT_TEST_SECRET_012345678901234567890';
assert.equal(fs.readFileSync(path.join(__dirname,'../api/AccountingCore.gs'),'utf8').trimEnd(),fs.readFileSync(path.join(__dirname,'../accounting-core.js'),'utf8').trimEnd(),'API and website must use identical accounting rules');
let data={revision:1,updatedAt:'2026-10-18T00:00:00Z',values:{satori_orders_v15:'[]',satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]'}},backs=0,writes=0,sequence=0;
const cache=new Map(),props={STATE_FILE_ID:'test-file',SATORI_BOT_CLIENTS_JSON:JSON.stringify({'bot-01':{secret,enabled:true,scopes:['orders:read','orders:write','orders:delete','customers:read','debt:read','payments:write']}})};
const context={
 Date,JSON,Number,String,Object,Array,Math,Error,RegExp,
 readState_:()=>JSON.parse(JSON.stringify(data)),
 ContentService:{MimeType:{JSON:'json'},createTextOutput(t){return {text:t,setMimeType(){return this}}}},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{Charset:{UTF_8:'UTF_8'},computeHmacSha256Signature:(m,k,charset)=>{assert.equal(charset,'UTF_8');return [...crypto.createHmac('sha256',k).update(m,'utf8').digest()];},getUuid:()=>String(++sequence),formatDate:()=> '19/10/2026'},
 DriveApp:{getFileById:()=>({makeCopy:()=>{const original=JSON.stringify(data);return {getId:()=>String(++backs),getBlob:()=>({getDataAsString:()=>original})}},setContent(s){data=JSON.parse(s);writes++}})}
};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../accounting-core.js'),'utf8'),context);vm.runInContext(source,context);
function call(action,payload={},override={}){
 const body={keyId:'bot-01',timestamp:Date.now(),nonce:'test_nonce_'+String(++sequence).padStart(20,'0'),action,payload};
 body.signature=crypto.createHmac('sha256',secret).update([body.keyId,body.timestamp,body.nonce,body.action,JSON.stringify(body.payload)].join('\n')).digest('hex');
 Object.assign(body,override);return JSON.parse(context.doPost({postData:{contents:JSON.stringify(body)}}).text);
}
assert.equal(call('system.status').data.orders,0);
const input={expectedRevision:1,requestId:'create-00001',confirmedNewCustomer:true,order:{name:'Test Customer',location:'123 Đường thử nghiệm',phone:'0901234567',items:[{product:'Satori 500 ml',qty:2,unitPrice:10000}],total:20000}};
assert.equal(call('orders.create',input).data.order.invoiceNo,1);
assert.equal(backs,1);assert.equal(data.revision,2);
const beforeExactRead={revision:data.revision,backs,writes};
const exact=call('orders.findByRequestId',{requestId:'create-00001'});
assert.equal(exact.ok,true);
assert.equal(exact.data.found,true);
assert.equal(exact.data.state,'COMMITTED');
assert.equal(exact.data.order.id,JSON.parse(data.values.satori_orders_v15)[0].id);
assert.equal(exact.data.order.invoiceNo,1);
assert.equal(exact.data.order.total,20000);
assert.equal(call('orders.findByRequestId',{requestId:'create-unknown-00001'}).data.state,'NOT_FOUND');
assert.equal(call('orders.findByRequestId',{requestId:'bad id'}).error.code,'INVALID_REQUEST');
assert.equal(data.revision,beforeExactRead.revision);
assert.equal(backs,beforeExactRead.backs);
assert.equal(writes,beforeExactRead.writes,'exact requestId recovery must be strictly read-only');

assert.equal(call('orders.create',input).data.duplicate,true);
// Formatting-only phone changes must not create a duplicate invoice, while changed content must fail.
assert.equal(call('orders.create',{
 ...input,order:{...input.order,phone:'0901 234 567'}
}).data.duplicate,true,'phone punctuation is canonicalized for a safe requestId replay');
assert.equal(call('orders.create',{
 ...input,order:{...input.order,phone:'0901 234 568'}
}).error.code,'REQUEST_ID_CONFLICT','a different phone cannot reuse a prior requestId');
assert.equal(backs,1);
assert.equal(call('orders.create',{...input,requestId:'create-00002'}).error.code,'REVISION_CONFLICT');
assert.equal(call('orders.create',{...input,requestId:'create-00003',expectedRevision:2,order:{...input.order,total:30000}}).error.code,'TOTAL_MISMATCH');
assert.equal(call('orders.list',{query:'Test Customer'}).data.totalMatches,1);
assert.equal(call('debt.summary').data.due,20000);
assert.equal(call('payments.markCustomerPaid',{expectedRevision:2,invoiceNo:1,confirmed:false}).error.code,'CONFIRMATION_REQUIRED');
assert.equal(call('payments.markCustomerPaid',{expectedRevision:2,invoiceNo:1,confirmed:true,amount:20000}).data.order.status,'Đã thanh toán');
assert.equal(call('debt.summary').data.due,0);assert.equal(backs,2);assert.equal(writes,2);

assert.equal(call('customers.search',{query:'Test Customer'}).data.profiles.total,1);
assert.equal(call('customers.search',{query:'Test Customer'}).data.profiles.profiles[0].location,'123 Đường thử nghiệm');
let originalOrder=JSON.parse(data.values.satori_orders_v15)[0];
const paidRemoval={expectedRevision:3,requestId:'delete-00001',confirmed:true,id:originalOrder.id,
 invoiceNo:1,expectedName:'Test Customer',expectedTotal:20000};
assert.equal(call('orders.delete',paidRemoval).error.code,'PAID_ORDER_PROTECTED');
assert.equal(backs,2);
const second={expectedRevision:3,requestId:'create-00004',customerRef:{id:originalOrder.id,invoiceNo:1},
 order:{name:originalOrder.name,phone:originalOrder.phone,location:originalOrder.location,
 items:[{product:'Satori 500 ml',qty:3,unitPrice:10000}],total:30000,deliveryDate:'2026-10-20'}};
const added=call('orders.create',second);
assert.equal(added.ok,true);assert.equal(added.data.order.invoiceNo,2);assert.equal(backs,3);
const remove={expectedRevision:4,requestId:'delete-00003',confirmed:true,
  id:added.data.order.id,invoiceNo:2,expectedName:'Test Customer',expectedTotal:30000};
assert.equal(call('orders.delete',{...remove,expectedTotal:29000}).error.code,'ORDER_CHANGED');
assert.equal(backs,3);
const gone=call('orders.delete',remove);
assert.equal(gone.ok,true);assert.equal(gone.data.deleted,true);
assert.equal(backs,4);assert.equal(data.revision,5);
assert.equal(JSON.parse(data.values.satori_trash_bin_v15).length,1);
assert.equal(JSON.parse(data.values.satori_deleted_invoice_nos)[0],2);
assert.equal(JSON.parse(data.values.satori_orders_v15).length,1);
assert.equal(call('orders.delete',remove).data.duplicate,true);
assert.equal(backs,4);
assert.equal(call('orders.create',second).error.code,'REUSED_REQUEST_ID');
const deletedRead=call('orders.findByRequestId',{requestId:'create-00004'});
assert.equal(deletedRead.ok,true);
assert.equal(deletedRead.data.found,true);
assert.equal(deletedRead.data.state,'DELETED');
assert.equal(deletedRead.data.order.invoiceNo,2);
assert.equal(backs,4,'lookup in trash must not create a Drive backup');
assert.equal(writes,4,'lookup in trash must not recreate a deleted invoice');

assert.equal(call('orders.create',{expectedRevision:5,requestId:'create-00005',
 order:{name:'Unknown',location:'ABC',items:[{product:'Satori 500 ml',qty:1,unitPrice:10000}]}}).error.code,'PROFILE_CONFIRMATION_REQUIRED');
assert.equal(backs,4);

const third=call('orders.create',{expectedRevision:5,requestId:'create-00006',confirmedNewCustomer:true,
 order:{name:'Another Test',phone:'0901122334',location:'Địa chỉ giao thử',
 items:[{product:'Satori 500 ml',qty:1,unitPrice:12000}],total:12000}});
assert.equal(third.ok,true);
assert.equal(third.data.order.invoiceNo,3); // #2 stays reserved after deletion.
assert.equal(data.revision,6);assert.equal(backs,5);
assert.equal(call('orders.delete',{expectedRevision:6,requestId:'delete-00007',confirmed:true,
 invoiceNo:3,expectedName:'Another Test',expectedTotal:12000}).error.code,'INVALID_ORDER');
assert.equal(backs,5);

assert.equal(call('system.status',{}, {signature:'0'.repeat(64)}).error.code,'AUTH_FAILED');
const pairBase={name:'Khach CTV',location:'123 test',status:'Chưa thanh toán',date:'19/10/2026',items:[{product:'Nuoc',qty:2,unitPrice:10000}]};
data={revision:20,updatedAt:'2026-10-19T00:00:00Z',values:{satori_orders_v15:JSON.stringify([{...pairBase,id:101,invoiceNo:101,total:20000},{...pairBase,id:102,invoiceNo:102,total:15000}])}};
const debt=call('debt.summary',{query:'Khach CTV'});assert.equal(debt.ok,true);assert.equal(debt.data.due,20000);assert.equal(debt.data.orders,1);assert.equal(debt.data.excludedReferenceCount,1);
assert.equal(call('debt.summary',{query:'102'}).data.due,0,'reference bill must not become debt when high sale outside filter');
console.log('PASS — debt agrees with ledger: excludes low CTV reference using full-state pairing before filtering');
console.log('PASS — authenticated customer profiles, create, soft delete, paid protection, backups, idempotency, revision, debt');


// Regression: legacy rows with the same invoice number must not affect each other.
// All customers, amounts and IDs here are synthetic fixtures, never real customer data.
const duplicateRows=[
 {id:200001,invoiceNo:85,name:'Fixture Shop A',location:'Address A',date:'10/10/2026',total:125000,status:'Chưa thanh toán'},
 {id:200002,invoiceNo:85,name:'Fixture Shop B',location:'Address B',date:'10/10/2026',total:250000,status:'Không Tính'}
];
data={revision:30,updatedAt:'2026-10-21T23:33:56Z',values:{
 satori_orders_v15:JSON.stringify(duplicateRows),satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]'
}};
const uniqueTarget={expectedRevision:30,invoiceNo:85,id:200001,expectedName:'Fixture Shop A',expectedTotal:125000,confirmed:true,amount:125000};
const initialWrites=writes;
assert.equal(call('payments.markCustomerPaid',{expectedRevision:30,invoiceNo:85,confirmed:true,amount:125000}).error.code,'INVALID_ORDER');
assert.equal(call('payments.markCustomerPaid',{...uniqueTarget,id:999}).error.code,'INVALID_ORDER');
assert.equal(call('payments.markCustomerPaid',{...uniqueTarget,expectedName:'Fixture Shop B'}).error.code,'ORDER_CHANGED');
assert.equal(call('payments.markCustomerPaid',{...uniqueTarget,amount:50000}).error.code,'TOTAL_MISMATCH');
assert.equal(call('payments.markCustomerPaid',{...uniqueTarget,receiptUrl:'http://example.com/forged.png'}).error.code,'INVALID_RECEIPT');
assert.equal(writes,initialWrites,'rejected payments must never persist');
const receiptUrl='https://drive.google.com/file/d/1kZZZZZZZZZZZZZZZZZZZZ/view';
const updatedReceipt=call('payments.markCustomerPaid',{...uniqueTarget,receiptUrl,receiptAt:'2026-10-22T16:10:00+07:00',paymentNote:'Offline test fixture: 125000 VND'});
assert.equal(updatedReceipt.ok,true);
assert.equal(updatedReceipt.data.order.status,'Đã thanh toán');
assert.equal(updatedReceipt.data.order.customerPaymentReceiptUrl,receiptUrl);
assert.equal(updatedReceipt.data.order.customerPaymentReceiptAt,'2026-10-22T16:10:00+07:00');
assert.equal(updatedReceipt.revision,31);
assert.equal(writes,initialWrites+1);
const after=JSON.parse(data.values.satori_orders_v15);
assert.equal(after[0].customerPaymentReceiptUrl,receiptUrl);
assert.equal(after[1].status,'Không Tính','unrelated record with same invoice number must remain untouched');
assert.equal(after[1].customerPaidAt,undefined);
assert.equal(call('debt.summary',{query:'Fixture Shop A'}).data.due,0);
assert.equal(call('payments.markCustomerPaid',{...uniqueTarget,expectedRevision:31}).data.alreadyPaid,true);
assert.equal(data.revision,31,'idempotent repeat must not rewrite the state');
console.log('PASS — duplicate invoice identity guard, receipt persistence, readback, shared revision, idempotency');


// Gemini real checkout may read an exact owner-approved policy only through
// the dedicated HMAC orders:ai:write scope. Synthetic customer/ledger only.
props.SATORI_BOT_CLIENTS_JSON=JSON.stringify({'bot-01':{
 secret,enabled:true,scopes:['orders:read','orders:write','orders:delete',
 'customers:read','debt:read','payments:write','orders:ai:write']}});
const fixture={id:899001,invoiceNo:899,name:'Fixture Customer Approved',
 phone:'0901 234 567',location:'123 Fake Test Street',total:110000};
const memory={id:'mem-fixture-001',name:fixture.name,aliases:[],
 defaultPhone:'0901234567',defaultLocation:fixture.location,receivers:[]};
const approval={customerMemoryId:memory.id,sourceOrderId:fixture.id,
 sourceInvoiceNo:fixture.invoiceNo,phone:'0901234567',
 location:fixture.location,enabled:true,reviewedByOwner:true,
 discountPercent:45,vatPercent:0,shippingAmount:0};
data={revision:40,updatedAt:'2026-10-22T15:00:00Z',values:{
 satori_orders_v15:JSON.stringify([fixture]),
 satori_ai_customer_memory:JSON.stringify([memory]),
 satori_ai_pricing_approvals_v1:JSON.stringify([approval]),
 satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]'}};
const beforeEligibilityWrites=writes,beforeEligibilityBackups=backs;
const query={customerMemoryId:memory.id,customerRef:{id:fixture.id,
 invoiceNo:fixture.invoiceNo}};
const elig=call('pricing.eligibility',query);
assert.equal(elig.ok,true);
assert.equal(elig.data.verifiedByServer,true);
assert.equal(elig.data.pricingApprovedByOwner,true);
assert.equal(elig.data.customerLoginVerified,false);
assert.equal(elig.data.profile.approvedDiscountPercent,45);
assert.equal(elig.data.profile.shippingAmount,0);
assert.equal(elig.data.revision,40);
assert.equal(call('pricing.eligibility',{...query,customerRef:{...query.customerRef,invoiceNo:900}}).error.code,'AI_PRICING_NOT_APPROVED');
assert.equal(call('pricing.eligibility',{...query,customerMemoryId:'wrong-memory-002'}).error.code,'AI_PRICING_NOT_APPROVED');
data.values.satori_ai_pricing_approvals_v1=JSON.stringify([approval,{...approval,enabled:false}]);
assert.equal(call('pricing.eligibility',query).error.code,'AI_PRICING_NOT_APPROVED');
data.values.satori_ai_pricing_approvals_v1=JSON.stringify([approval]);
data.values.satori_orders_v15=JSON.stringify([{...fixture,location:'999 Different Test Street'}]);
assert.equal(call('pricing.eligibility',query).error.code,'AI_CUSTOMER_UNVERIFIED');
assert.equal(writes,beforeEligibilityWrites,'eligibility never changes Drive');
assert.equal(backs,beforeEligibilityBackups,'eligibility never creates backups');
console.log('PASS — Gemini exact customer+location approved pricing eligibility, revocation, HMAC scope, no ledger mutation');


// Three-way payment-state commands: all invoices here are synthetic.
// Verify independent customer/Satori bits, duplicate number guards, audit history,
// idempotent requests, and preservation of unrelated customer rows.
data={revision:50,updatedAt:'2026-10-27T00:00:00Z',values:{
 satori_orders_v15:JSON.stringify([
  {id:501,invoiceNo:701,name:'Fixture Branch A',total:125000,status:'Chưa thanh toán'},
  {id:502,invoiceNo:701,name:'Fixture Branch B',total:250000,status:'Đã thanh toán',customerPaidAt:'2026-10-20T01:00:00.000Z'},
  {id:503,invoiceNo:702,name:'Fixture CTV Internal',total:80000,status:'Chưa thanh toán',pairRole:'collaborator'}
 ]),satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]'
}};
const readRows=()=>JSON.parse(data.values.satori_orders_v15);
const change=(action,{id=501,invoiceNo=701,expectedName='Fixture Branch A',expectedTotal=125000,
 requestId='test_correction_001',reason='Owner reconciled actual bank settlement',expectedRevision=data.revision,...rest}={})=>
 call(action,{expectedRevision,requestId,id,invoiceNo,expectedName,expectedTotal,
  confirmed:true,reason,...rest});
let correctionWrites=writes,correctionBackups=backs;
assert.equal(call('payments.markSatoriPaid',{expectedRevision:50,invoiceNo:701,
 confirmed:true,reason:'Confirmed'}).error.code,'INVALID_ORDER','must use immutable ID');
assert.equal(change('payments.markSatoriPaid',{expectedName:'Wrong Branch'}).error.code,'ORDER_CHANGED');
assert.equal(change('payments.markSatoriPaid',{expectedTotal:125001}).error.code,'ORDER_CHANGED');
assert.equal(change('payments.markSatoriPaid',{reason:''}).error.code,'REASON_REQUIRED');
assert.equal(change('payments.markSatoriPaid',{id:503,invoiceNo:702,
 expectedName:'Fixture CTV Internal',expectedTotal:80000}).error.code,'CTV_INTERNAL_NOT_RECEIVABLE');
assert.equal(writes,correctionWrites,'failed financial corrections may never write');
let settlement=change('payments.markSatoriPaid');
assert.equal(settlement.ok,true);
assert.equal(settlement.backupCreated,true);
assert.equal(data.revision,51);
assert.equal(settlement.data.satoriPaid,true);
assert.equal(settlement.data.customerPaid,false);
assert.equal(readRows()[0].status,'Đã TT Satori');
assert.equal(readRows()[0].paymentAudit.length,1);
assert.ok(readRows()[0].satoriPaidAt);
assert.equal(readRows()[1].customerPaidAt,'2026-10-20T01:00:00.000Z','another invoice with reused number stays unchanged');
assert.equal(call('orders.list',{query:'701'}).data.orders.filter(x=>x.id===501)[0].satoriPaid,true);
assert.equal(call('orders.list',{query:'701'}).data.orders.filter(x=>x.id===501)[0].customerPaid,false);
correctionWrites=writes;
let idempotent=change('payments.markSatoriPaid',{expectedRevision:50});
assert.equal(idempotent.data.alreadyApplied,true);
assert.equal(writes,correctionWrites,'repeated exact requestId does not write');
assert.equal(change('payments.markSatoriUnpaid',{requestId:'test_correction_001'}).error.code,'REQUEST_ID_CONFLICT');

let customer=call('payments.markCustomerPaid',{expectedRevision:51,invoiceNo:701,id:501,
 expectedName:'Fixture Branch A',expectedTotal:125000,confirmed:true,amount:125000,
 receiptUrl:'https://drive.google.com/file/d/1kZZZZZZZZZZZZZZZZZZZZ/view'});
assert.equal(customer.ok,true);
assert.equal(customer.data.order.status,'Đã TT Satori','customer receipt must not clear supplier settlement');
assert.equal(readRows()[0].customerPaidAt!==undefined,true);
assert.equal(readRows()[0].satoriPaidAt!==undefined,true);

let reverseCustomer=change('payments.markCustomerUnpaid',{requestId:'test_correction_002'});
assert.equal(reverseCustomer.ok,true);
assert.equal(reverseCustomer.data.customerPaid,false);
assert.equal(reverseCustomer.data.satoriPaid,true);
assert.equal(readRows()[0].status,'Đã TT Satori');
assert.equal(readRows()[0].customerPaidAt,null);
assert.equal(readRows()[0].paymentAudit[1].previousCustomerPaidAt!==null,true);
assert.equal(readRows()[0].paymentAudit[1].previousCustomerPaymentReceiptUrl,
 'https://drive.google.com/file/d/1kZZZZZZZZZZZZZZZZZZZZ/view');
assert.equal(readRows()[0].customerPaymentReceiptUrl,null,'invalidated customer receipt must not appear as active proof');
let undoSupplier=change('payments.markSatoriUnpaid',{requestId:'test_correction_003'});
assert.equal(undoSupplier.ok,true);
assert.equal(undoSupplier.data.customerPaid,false);
assert.equal(undoSupplier.data.satoriPaid,false);
assert.equal(readRows()[0].status,'Chưa thanh toán');
assert.equal(readRows()[0].satoriPaidAt,null);
assert.equal(readRows()[0].paymentAudit.length,3,'all changes leave a durable audit trail');
assert.equal(readRows()[1].status,'Đã thanh toán','reused invoiceNo different ID stays untouched');
assert.equal(readRows()[2].status,'Chưa thanh toán','internal CTV reference untouched');

let paidWithoutSatori=change('payments.markSatoriPaid',{id:502,invoiceNo:701,
 expectedName:'Fixture Branch B',expectedTotal:250000,requestId:'test_correction_004'});
assert.equal(paidWithoutSatori.data.customerPaid,true);
assert.equal(paidWithoutSatori.data.satoriPaid,true);
let undoSupplierOnly=change('payments.markSatoriUnpaid',{id:502,invoiceNo:701,
 expectedName:'Fixture Branch B',expectedTotal:250000,requestId:'test_correction_005'});
assert.equal(undoSupplierOnly.data.customerPaid,true);
assert.equal(readRows()[1].status,'Đã thanh toán','undo supplier must not erase customer payment');
assert.equal(writes,correctionWrites+5,'exactly five new correction/payment commits from replay point');
assert.equal(backs,correctionBackups+6,'every changed payment has a verified Drive prewrite backup');
console.log('PASS — three-way payment-state commands, exact-ID, correction audit, HMAC, Drive backup/readback, idempotency');
