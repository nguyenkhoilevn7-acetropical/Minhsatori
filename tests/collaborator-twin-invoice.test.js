// Offline fake Drive + fake HMAC; absolutely no real invoices or network traffic.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(root,'api/BotApi.gs'),'utf8');
const serverAccounting=fs.readFileSync(path.join(root,'api/AccountingCore.gs'),'utf8');
const webAccounting=fs.readFileSync(path.join(root,'accounting-core.js'),'utf8');
assert.equal(serverAccounting.trimEnd(),webAccounting.trimEnd(),'web and server must pair identically');
const secret='TEST_FAKE_HMAC_012345678901234567890123456789';
const collaborators=[
 {id:'ctv-01',name:'CTV thử 01',active:true,discountPercent:35},
 {id:'ctv-02',name:'CTV thử 02',active:true,discountPercent:30}
];
let ledger={revision:1,updatedAt:'2026-10-22T00:00:00Z',values:{
 satori_orders_v15:'[]',satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]',
 satori_collaborators_v1:JSON.stringify(collaborators),
 satori_catalogue_v15:JSON.stringify([
  {code:'TP-00003',name:'Nước Satori 500ml',unit:'Thùng',listPrice:98000},
  {code:'TP-00136',name:'Nước Satori 5L',unit:'Thùng',listPrice:110000}
 ])}};
let backups=0,writes=0;
const clients=()=>JSON.stringify({'bot':{secret,enabled:true,scopes:[
 'orders:read','debt:read','collaborators:pair:read','collaborators:pair:approve','collaborators:pair:write'
]}});
const props={STATE_FILE_ID:'FAKE_DRIVE',SATORI_BOT_CLIENTS_JSON:clients()};
const context={
 Date,JSON,Number,String,Object,Array,Math,Error,RegExp,
 readState_:()=>JSON.parse(JSON.stringify(ledger)),
 ContentService:{MimeType:{JSON:'json'},createTextOutput(t){return {text:t,setMimeType(){return this}}}},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},
 CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{Charset:{UTF_8:'UTF_8'},computeHmacSha256Signature:(m,k)=>[...crypto.createHmac('sha256',k).update(m,'utf8').digest()],
 getUuid:()=>crypto.randomUUID(),formatDate:()=> '22/10/2026'},
 DriveApp:{getFileById:()=>({makeCopy:()=>{const original=JSON.stringify(ledger);return {getId:()=>String(++backups),getBlob:()=>({getDataAsString:()=>original})}},setContent(s){ledger=JSON.parse(s);writes++}})}
};
vm.createContext(context);
vm.runInContext(webAccounting,context);
vm.runInContext(script,context);
let counter=0;
function call(action,payload={}){
 const o={keyId:'bot',timestamp:Date.now(),nonce:'test_nonce_'+String(++counter).padStart(20,'0'),action,payload};
 o.signature=crypto.createHmac('sha256',secret).update(
 [o.keyId,o.timestamp,o.nonce,o.action,JSON.stringify(payload)].join('\n')).digest('hex');
 return JSON.parse(context.doPost({postData:{contents:JSON.stringify(o)}}).text);
}
const policy={collaboratorId:'ctv-01',enabled:true,customerDiscountPercent:20,
 collaboratorDiscountPercent:35,shippingPercent:8,vatPercent:0,
 confirmed:true,requestId:'config-ctv-01',expectedRevision:1};


const noConfig=call('orders.create.pair',{
 expectedRevision:1,requestId:'pre-00001',collaboratorId:'ctv-01',
 expectedPolicyVersion:'fake',confirmedNewCustomer:true,
 order:{name:'Fictitious',phone:'0900000000',location:'123 Fake road',items:[{code:'TP-00003',qty:10}]}
});
assert.equal(noConfig.error.code,'PAIR_NOT_ENABLED');
assert.equal(backups,0);assert.equal(writes,0);

const createConfig=call('collaborators.pair.configure',policy);
assert.equal(createConfig.ok,true);
assert.equal(createConfig.data.policy.enabled,true);
assert.equal(backups,1);assert.equal(ledger.revision,2);
assert.equal(call('collaborators.pair.configure',policy).data.duplicate,true);
assert.equal(backups,1);
assert.equal(call('collaborators.pair.configure',{...policy,enabled:false}).error.code,'REQUEST_ID_CONFLICT');
const v1=createConfig.data.policy.policyVersion;

const quote={expectedRevision:2,requestId:'order-ctv-00001',collaboratorId:'ctv-01',
 expectedPolicyVersion:v1,confirmedNewCustomer:true,
 order:{name:'Synthetic Customer',phone:'0900000011',location:'123 Fake Test Road',
  items:[{code:'TP-00003',qty:10}],
  deliveryNote:'Giao sớm'}};
const beforePairBackups=backups,beforePairWrites=writes;
const pair=call('orders.create.pair',quote);
assert.equal(pair.ok,true,JSON.stringify(pair.error));
assert.equal(pair.data.duplicate,false);
assert.equal(pair.data.customerInvoice.total,846720);
assert.equal(pair.data.collaboratorInvoice.total,687960);
assert.equal(pair.data.difference,158760);
assert.equal(pair.data.customerInvoice.pairRole,'customer');
assert.equal(pair.data.collaboratorInvoice.pairRole,'collaborator');
assert.equal(pair.data.customerInvoice.name,'Synthetic Customer','customer bill must show real buyer');
assert.equal(pair.data.collaboratorInvoice.name,'CTV thử 01','internal bill must be billed to the associated collaborator');
assert.equal(pair.data.collaboratorInvoice.pairCustomerName,'Synthetic Customer');
assert.equal(pair.data.customerInvoice.pairCollaboratorName,'CTV thử 01');
assert.equal(pair.data.customerInvoice.pairInvoiceNo,pair.data.collaboratorInvoice.invoiceNo);
assert.equal(pair.data.collaboratorInvoice.pairInvoiceNo,pair.data.customerInvoice.invoiceNo);
assert.equal(backups,beforePairBackups+1,'one Drive backup for both invoices');
assert.equal(writes,beforePairWrites+1,'one atomic Drive commit for both invoices');
assert.equal(ledger.revision,3);
const all=JSON.parse(ledger.values.satori_orders_v15);
assert.equal(all.length,2);assert.equal(new Set(all.map(o=>o.pairGroupId)).size,1);
const calc=context.SatoriAccountingCore.calculate(all,collaborators);
assert.equal(calc.pairs.length,1);
assert.equal(calc.pairs[0].profit,147000,'CTV commission is the merchandise difference, excluding shipping and VAT');
assert.equal(pair.data.commissionAmount,147000);
assert.equal(pair.data.difference,158760,'gross difference is preserved for accounting reconciliation only');
assert.equal(calc.rows.filter(row=>row.secondary).length,1);
const debt=call('debt.summary',{query:'Synthetic Customer'});
assert.equal(debt.ok,true);assert.equal(debt.data.orders,1);
assert.equal(debt.data.due,846720);
assert.equal(debt.data.excludedReferenceCount,1);
assert.equal(call('orders.list',{query:'CTV thử 01'}).data.totalMatches,2,
 'owner CTV search must show both linked invoices');
assert.equal(call('orders.list',{query:'Synthetic Customer'}).data.totalMatches,2,
 'buyer search must also find the internal paired invoice for bookkeeping');

const customerOrder=all.find(o=>o.pairRole==='customer');
const ctvOrder=all.find(o=>o.pairRole==='collaborator');
const beforeReject=writes;
const del=call('orders.delete',{expectedRevision:3,requestId:'del-pair-test-01',
 confirmed:true,id:customerOrder.id,invoiceNo:customerOrder.invoiceNo,
 expectedName:customerOrder.name,expectedTotal:customerOrder.total});
assert.equal(del.error.code,'FORBIDDEN','pair deletion also needs owner deletion scope');
const withDeletion=JSON.parse(props.SATORI_BOT_CLIENTS_JSON);
withDeletion.bot.scopes.push('orders:delete','payments:write');
props.SATORI_BOT_CLIENTS_JSON=JSON.stringify(withDeletion);
assert.equal(call('orders.delete',{expectedRevision:3,requestId:'del-pair-test-02',
 confirmed:true,id:customerOrder.id,invoiceNo:customerOrder.invoiceNo,
 expectedName:customerOrder.name,expectedTotal:customerOrder.total}).error.code,'PAIRED_ORDER_LOCKED');
assert.equal(call('payments.markCustomerPaid',{expectedRevision:3,
 invoiceNo:ctvOrder.invoiceNo,id:ctvOrder.id,
 expectedName:ctvOrder.name,expectedTotal:ctvOrder.total,
 confirmed:true,amount:ctvOrder.total}).error.code,'CTV_INTERNAL_NOT_RECEIVABLE');
assert.equal(writes,beforeReject,'unsafe pair operations must never write Drive');

const duplicate=call('orders.create.pair',quote);
assert.equal(duplicate.data.duplicate,true);
assert.equal(duplicate.data.customerInvoice.invoiceNo,pair.data.customerInvoice.invoiceNo);
assert.equal(writes,beforePairWrites+1);
assert.equal(call('orders.create.pair',{...quote,order:{...quote.order,items:[{code:'TP-00003',qty:9}]}}).error.code,'REQUEST_ID_CONFLICT');
assert.equal(call('orders.create.pair',{...quote,order:{...quote.order,phone:'0900000099'}}).error.code,'REQUEST_ID_CONFLICT');
assert.equal(call('orders.create',quote).error.code,'FORBIDDEN');

const policy2={...policy,collaboratorId:'ctv-02',
 customerDiscountPercent:10,collaboratorDiscountPercent:30,
 shippingPercent:0,requestId:'config-ctv-02',expectedRevision:3};
const secondConfig=call('collaborators.pair.configure',policy2);
assert.equal(secondConfig.ok,true);
assert.equal(secondConfig.data.policy.customerDiscountPercent,10);
assert.equal(call('collaborators.pair.list').data.policies.length,2);
assert.equal(call('collaborators.pair.list').data.collaborators.length,2);
assert.equal(call('collaborators.pair.list').data.collaborators[0].name,'CTV thử 01');
const secondOrder={...quote,requestId:'order-ctv-00002',expectedRevision:4,
 collaboratorId:'ctv-02',expectedPolicyVersion:secondConfig.data.policy.policyVersion,
 order:{...quote.order,name:'Another Fake Customer',phone:'0900000033',location:'456 Example Road',
  items:[{code:'TP-00136',qty:3}]}};
const other=call('orders.create.pair',secondOrder);
assert.equal(other.ok,true);
assert.equal(other.data.customerInvoice.total,297000);
assert.equal(other.data.collaboratorInvoice.total,231000);
assert.equal(other.data.difference,66000);
assert.equal(JSON.parse(ledger.values.satori_orders_v15).length,4);
const all2=JSON.parse(ledger.values.satori_orders_v15);
assert.equal(context.SatoriAccountingCore.calculate(all2,collaborators).pairs.length,2);
assert.equal(call('debt.summary').data.orders,2);
assert.equal(call('debt.summary').data.excludedReferenceCount,2);

const disabled=call('collaborators.pair.configure',{...policy,
 requestId:'disable-ctv-01',enabled:false,expectedRevision:5});
assert.equal(disabled.ok,true);
const disabledOrder=call('orders.create.pair',{...quote,requestId:'order-ctv-00003',
 expectedRevision:6,expectedPolicyVersion:disabled.data.policy.policyVersion});
assert.equal(disabledOrder.error.code,'PAIR_NOT_ENABLED');
assert.equal(call('orders.create.pair',quote).data.duplicate,true,
 'old identical replay must stay idempotent after disabling a policy');
assert.equal(call('orders.create.pair',{...secondOrder,requestId:'new-ctv-02',expectedRevision:6,
 expectedPolicyVersion:'invalid-policy-version'}).error.code,'PAIR_POLICY_CHANGED');
assert.equal(JSON.parse(ledger.values.satori_orders_v15).length,4);

const malformed=structuredClone(all2);
malformed[0].pairInvoiceNo=123456;
const safeModel=context.SatoriAccountingCore.calculate(malformed,collaborators);
assert.equal(safeModel.pairs.length,1,'malformed link must never be inferred');
assert.equal(safeModel.review.length,1);
assert.equal(safeModel.rows.filter(x=>x.secondary).length,1);
const unauthorized=JSON.parse(props.SATORI_BOT_CLIENTS_JSON);
unauthorized.bot.scopes=unauthorized.bot.scopes.filter(x=>x!=='collaborators:pair:approve');
props.SATORI_BOT_CLIENTS_JSON=JSON.stringify(unauthorized);
assert.equal(call('collaborators.pair.configure',{...policy,requestId:'extra-00001'}).error.code,'FORBIDDEN');
console.log('PASS per-CTV optional policy, two discounts, atomic two invoices, request replay, disabled toggle, per-CTV independent rates, explicit linked accounting, zero double receivables, offline only');
