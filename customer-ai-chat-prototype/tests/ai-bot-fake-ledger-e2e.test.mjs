/**
 * Gemini checkout preflight -> actual staging Apps Script BotApi.gs
 * against an IN-MEMORY FAKE Drive. Requires a second checkout of the Android/Bot
 * staging branch at ./bot-staging. Never calls Google, Render or production.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {preflightCheckout} from '../checkout-preflight.mjs';

const botPath=path.resolve(process.cwd(),'bot-staging/api/BotApi.gs');
assert.ok(fs.existsSync(botPath),'Bot staging branch must be checked out separately');
const source=fs.readFileSync(botPath,'utf8');
const secret='TEST_ISOLATED_HMAC_KEY_WITH_48_CHARACTERS_2026';
const fixtureProducts=[
 {code:'TP-00003',name:'Satori 500ml TEST',unit:'Thùng',spec:'24 chai',brand:'SATORI',listPrice:98000,unitPrice:78400,discountPercent:20},
 {code:'TP-00056',name:'Satori mãng cầu TEST',unit:'Thùng',spec:'24 chai',brand:'SATORI',listPrice:333333,unitPrice:266666,discountPercent:20},
 {code:'TP-00081',name:'Hikari 500ml TEST',unit:'Thùng',spec:'24 chai',brand:'HIKARI',listPrice:110000,unitPrice:88000,discountPercent:20}
];
const privateCustomer={verifiedByServer:true,profileId:'FAKE_VERIFY_ONLY',
 sourceReference:{id:7788,invoiceNo:12},name:'Khách Đơn Thử',phone:'0900000000',
 location:'123 Đường TEST, HCM',approvedDiscountPercent:20};
let state={revision:105,updatedAt:'2026-10-20T23:00:00.000Z',values:{
 satori_orders_v15:JSON.stringify([{id:7788,invoiceNo:12,name:privateCustomer.name,
  location:privateCustomer.location,phone:privateCustomer.phone,
  date:'20/10/2026',status:'Chưa thanh toán',total:78400,
  items:[{product:'Satori 500ml TEST',unit:'Thùng',code:'TP-00003',qty:1,unitPrice:78400}],
  timestamp:Date.now()-86400000}]),
 satori_catalogue_v15:JSON.stringify(fixtureProducts),
 satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]'
}};
let writes=0,backups=0,nonceNum=0;const used=new Map();
const scopeJson=JSON.stringify({
 'e2e-writer':{secret,enabled:true,scopes:['orders:read','catalogue:read','customers:read','orders:write']},
 'e2e-reader':{secret,enabled:true,scopes:['orders:read','catalogue:read','customers:read']}
});
const props={SATORI_BOT_CLIENTS_JSON:scopeJson,STATE_FILE_ID:'FAKE_LEDGER_DO_NOT_USE'};
const ctx={Date,JSON,Number,String,Object,Array,Math,Error,RegExp,Set,
 readState_:()=>structuredClone(state),
 PropertiesService:{getScriptProperties:()=>({getProperty:key=>props[key]})},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:body=>({text:body,setMimeType(){return this}})},
 CacheService:{getScriptCache:()=>({get:key=>used.get(key),put:(key,val)=>used.set(key,val)})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{Charset:{UTF_8:'UTF_8'},
  computeHmacSha256Signature:(message,k)=>[...crypto.createHmac('sha256',k).update(message,'utf8').digest()],
  getUuid:()=>crypto.randomUUID(),formatDate:()=> '21/10/2026'},
 DriveApp:{getFileById:id=>{
  assert.equal(id,'FAKE_LEDGER_DO_NOT_USE','only fake Drive ledger may be accessed');
  return {
   makeCopy:()=>{const snapshot=JSON.stringify(state);backups++;return {
    getId:()=>String(backups),getBlob:()=>({getDataAsString:()=>snapshot})}},
   setContent:next=>{state=JSON.parse(next);writes++}
  };
 }}
};
vm.createContext(ctx);vm.runInContext(source,ctx,{timeout:5000,filename:'BotApi.staging.gs'});
const call=(action,payload={},keyId='e2e-writer')=>{
 const envelope={keyId,timestamp:Date.now(),
  nonce:'test_nonce_'+String(++nonceNum).padStart(20,'0'),action,payload};
 envelope.signature=crypto.createHmac('sha256',secret)
  .update([envelope.keyId,envelope.timestamp,envelope.nonce,envelope.action,
   JSON.stringify(envelope.payload)].join('\n'),'utf8').digest('hex');
 return JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(envelope)}}).text);
};
let checked=0;const ok=(predicate,label)=>{assert.ok(predicate,label);checked++};
const status=call('system.status');
ok(status.ok&&status.revision===105&&status.data.orders===1,'status reports fake revision and fake order count');
const cats=call('catalogue.list',{},'e2e-reader');
ok(cats.ok&&cats.data.products.length===3&&cats.data.revision===105,'catalogue retrieved from same revision');
ok(writes===0&&backups===0,'read only discovery never persists');
const all=cats.data.products;
const lines=[{code:'TP-00003',qty:2},{code:'TP-00056',qty:3}];
const goods=2*78400+3*266666;
const vat=Math.round(goods*.08),ship=15000,total=goods+vat+ship;
const opts={revision:cats.revision,requestId:'web_android_ai_same_0001',customer:privateCustomer,
 source:all,lines,shippingAmount:ship,vatRate:8,expectedTotal:total,confirmedByCustomer:true};
const preflight=preflightCheckout(opts);
ok(preflight.payload.order.items.length===2&&preflight.payload.order.total===total,
 'AI preflight produces one two-product invoice with server-calculated amounts');
const created=call(preflight.action,preflight.payload);
ok(created.ok&&!created.data.duplicate&&created.revision===106,
 'real BotApi create action commits exactly one fake invoice and increments revision');
ok(created.data.order.invoiceNo===13&&created.data.order.items.length===2,
 'confirmed TEST invoice keeps both SKUs and assigns the next bill number');
ok(writes===1&&backups===1,'exactly one backup is verified before one fake Drive commit');
const retry=call(preflight.action,preflight.payload);
ok(retry.ok&&retry.data.duplicate===true&&retry.data.order.invoiceNo===created.data.order.invoiceNo,
 'lost-response retry is idempotent despite stale expected revision');
ok(writes===1&&backups===1&&state.revision===106,'safe retry never writes or makes another backup');
const hijack=structuredClone(preflight.payload);
hijack.order.items[0].qty=999;
hijack.order.total+=999*78400;
const conflict=call('orders.create',hijack);
ok(!conflict.ok&&conflict.error.code==='REQUEST_ID_CONFLICT',
 'same request ID cannot silently substitute a different basket');
ok(writes===1&&backups===1,'tampered idempotency retry never commits or backs up');
const stale=preflightCheckout({...opts,requestId:'web_android_ai_other_0002'});
const staleRes=call(stale.action,stale.payload);
ok(!staleRes.ok&&staleRes.error.code==='REVISION_CONFLICT',
 'another device cannot write using a stale source revision');
const untrusted=call('orders.create',preflight.payload,'e2e-reader');
ok(!untrusted.ok&&untrusted.error.code==='FORBIDDEN',
 'read-only AI Bot key cannot create any invoice');
const badLocation=preflightCheckout({...opts,revision:106,
 requestId:'web_android_ai_other_0003',
 customer:{...privateCustomer,location:'456 Địa điểm sai TEST'}});
const mismatch=call('orders.create',badLocation.payload);
ok(!mismatch.ok&&mismatch.error.code==='PROFILE_MISMATCH',
 'recipient/location on one account cannot silently switch delivery address');
const history=call('orders.list',{query:privateCustomer.name},'e2e-reader');
ok(history.ok&&history.data.totalMatches===2&&
 history.data.orders.some(x=>x.invoiceNo===created.data.order.invoiceNo),
 'web/Android history reads original and new invoice from the same fake ledger');
ok(writes===1&&backups===1,'history and rejected actions are read-only');
const changed=structuredClone(fixtureProducts);
changed[0].listPrice+=1000;
state={...state,revision:107,values:{...state.values,satori_catalogue_v15:JSON.stringify(changed)}};
const renewedCatalog=call('catalogue.list',{},'e2e-reader');
ok(renewedCatalog.ok&&renewedCatalog.revision===107,'a website catalogue edit advances source revision');
let quoteRejected=false;
try{preflightCheckout({...opts,revision:107,source:renewedCatalog.data.products,
 requestId:'web_android_ai_other_0004'})}
catch(err){quoteRejected=err.code==='QUOTE_STALE_OR_MISMATCH'}
ok(quoteRejected,'AI requires new customer confirmation when source price changes');
ok(writes===1&&backups===1,'price-change test does not modify invoices');
console.log('PASS '+checked+'/'+checked+
 ' real staged BotApi HMAC + source pricing + customer profile + idempotent multi-SKU FAKE-Drive E2E checks');
