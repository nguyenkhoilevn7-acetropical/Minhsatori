import assert from 'node:assert/strict';
import {createRealInvoiceCoordinator} from '../real-invoice-coordinator.mjs';
import {isPreflightCheckoutResult} from '../checkout-preflight.mjs';
const source=[{code:'TP-00003',name:'Satori 500 ml',unit:'Thùng',listPrice:98000}];
const customer={verifiedByServer:true,profileId:'server_approved_01',
 approvedMemoryId:'memory_approved_01',sourceReference:{id:101,invoiceNo:101},
 name:'Khách kiểm thử',phone:'0900000000',location:'123 Test street',
 approvedDiscountPercent:45};
const context={sessionKey:'signed_session_1234',verifiedByServer:true,
 pricingApprovedByOwner:true,customer,source,revision:113,vatRate:0,shippingAmount:0};
let current=context;
const records=new Map();
const store={
 async putIfAbsent(id,row){if(records.has(id))return false;records.set(id,structuredClone(row));return true},
 async get(id){return structuredClone(records.get(id)??null)},
 async claim(id,from,to){const r=records.get(id);if(!r||r.status!==from)return false;r.status=to;return true},
 async finish(id,from,to,fields){const r=records.get(id);assert.equal(r.status,from);r.status=to;Object.assign(r,fields);}
};
let sends=0;
let failNext=false;
const sender=async({mode,checkout})=>{
 sends++;assert.equal(mode,'real');
 assert.equal(isPreflightCheckoutResult(checkout),true);
 assert.equal(checkout.payload.order.items[0].unitPrice,53900);
 if(failNext){failNext=false;throw Object.assign(Error('COMMIT_UNCERTAIN'),{code:'COMMIT_UNCERTAIN'})}
 return {invoiceNo:6012,revision:114,duplicate:false,confirmedByAuthoritativeLedger:true,requestId:checkout.payload.requestId};
};
let nextId=0,now=1792700000000,sessionAllowed=true;
const engine=createRealInvoiceCoordinator({resolveTrusted:async(s)=>
 s==='signed-cookie'&&sessionAllowed?current:null,
 intentStore:store,send:sender,now:()=>now,
 newId:()=>String(++nextId).padStart(32,'0')});
async function error(code,fn){await assert.rejects(fn,e=>e.code===code,'expected '+code)}
const quote=await engine.preview({session:'signed-cookie',lines:[{code:'TP-00003',qty:10}],
 deliveryNote:'Xin giao sớm'});
assert.equal(quote.total,539000);
assert.equal(quote.requiresExplicitConfirmation,true);
assert.equal(sends,0,'preview must never create a real invoice');
assert.equal(JSON.stringify(quote).includes('0900000000'),false,'no PII in preview');
await error('CONFIRMATION_REQUIRED',()=>engine.confirm({session:'signed-cookie',quoteId:quote.quoteId}));
const receipt=await engine.confirm({session:'signed-cookie',quoteId:quote.quoteId,confirmedByCustomer:true});
assert.equal(receipt.invoiceNo,6012);assert.equal(sends,1);
const duplicate=await engine.confirm({session:'signed-cookie',quoteId:quote.quoteId,confirmedByCustomer:true});
assert.equal(duplicate.duplicate,true);assert.equal(sends,1,'second click must NEVER resend');
// An attacker with only the quote ID must NEVER read the cached real bill.
await error('TRUSTED_CONTEXT_UNAVAILABLE',()=>engine.confirm({session:'stolen-quote-id',
 quoteId:quote.quoteId,confirmedByCustomer:true}));
sessionAllowed=false;
await error('TRUSTED_CONTEXT_UNAVAILABLE',()=>engine.confirm({session:'signed-cookie',
 quoteId:quote.quoteId,confirmedByCustomer:true}));
sessionAllowed=true;
current={...context,customer:{...customer,approvedDiscountPercent:40}};
await error('CUSTOMER_OR_PRICE_CHANGED',()=>engine.confirm({session:'signed-cookie',
 quoteId:quote.quoteId,confirmedByCustomer:true}));
current=context;
assert.equal(sends,1,'rejected receipt reads never resend');

const uncertainty=await engine.preview({session:'signed-cookie',lines:[{code:'TP-00003',qty:1}]});
failNext=true;
await error('COMMIT_UNCERTAIN',()=>engine.confirm({session:'signed-cookie',
 quoteId:uncertainty.quoteId,confirmedByCustomer:true}));
await error('COMMIT_UNCERTAIN_RECONCILE',()=>engine.confirm({session:'signed-cookie',
 quoteId:uncertainty.quoteId,confirmedByCustomer:true}));
assert.equal(sends,2,'uncertain commit never retried');
const stale=await engine.preview({session:'signed-cookie',lines:[{code:'TP-00003',qty:1}]});
current={...context,revision:114};
await error('QUOTE_STALE',()=>engine.confirm({session:'signed-cookie',
 quoteId:stale.quoteId,confirmedByCustomer:true}));
assert.equal(sends,2);
current={...context,customer:{...customer,approvedDiscountPercent:40}};
await error('CUSTOMER_OR_PRICE_CHANGED',()=>engine.confirm({session:'signed-cookie',
 quoteId:stale.quoteId,confirmedByCustomer:true}));
const tampered=await engine.preview({session:'signed-cookie',lines:[{code:'TP-00003',qty:1}]});
records.get(tampered.quoteId).lines[0].qty=2;
await error('QUOTE_STALE',()=>engine.confirm({session:'signed-cookie',
 quoteId:tampered.quoteId,confirmedByCustomer:true}));
current=context;
const exp=await engine.preview({session:'signed-cookie',lines:[{code:'TP-00003',qty:1}]});
now+=600001;
await error('QUOTE_EXPIRED',()=>engine.confirm({session:'signed-cookie',
 quoteId:exp.quoteId,confirmedByCustomer:true}));
assert.equal(sends,2);
await assert.rejects(async()=>createRealInvoiceCoordinator({resolveTrusted:async()=>current,
 intentStore:{}}),e=>e.code==='DURABLE_BACKEND_REQUIRED');
console.log('PASS server-owned one-time signed Gemini invoice, quote display, cross-device duplicate click, uncertain-commit freeze, stale quote and price policy change (FAKE backend only)');
