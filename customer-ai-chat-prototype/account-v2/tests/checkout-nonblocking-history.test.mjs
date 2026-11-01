import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const begin=script.indexOf("$('submitTestOrder').onclick=async()=>{");
const end=script.indexOf('async function addChatOrderReceipt(selection)',begin);
const checkout=script.slice(begin,end);

test('successful checkout completes on canonical COMMITTED response before refreshing history',()=>{
 assert.ok(begin>=0&&end>begin);
 assert.match(checkout,/await call\('\/api\/v2\/confirm'/);
 assert.match(checkout,/if\(live&&result.state!=='COMMITTED'\)/);
 assert.match(checkout,/lastSubmittedCartKey=key/);
 assert.match(checkout,/renderTestInvoice\(q,result,live\)/);
 assert.match(checkout,/void loadOrders\(\)\.catch/);
 assert.doesNotMatch(checkout,/\n\s*await loadOrders\(\);\s*\n\s*toast\(live\?/);
 assert.match(checkout,/toast\(live\?/);
 assert.match(checkout,/finally\{updateDeliveryGate\(\)\}/);
 assert.doesNotThrow(()=>new vm.Script(script));
});

test('uncertain canonical result still requires manual reconciliation and never becomes success',()=>{
 assert.match(checkout,/if\(live&&result.state!=='COMMITTED'\)\{/);
 assert.match(checkout,/KHÔNG đặt lại đơn mới/);
 assert.match(checkout,/await loadOrders\(\);\s*return;/);
 assert.match(checkout,/lastTestRequestId/);
});

test('only read-only history is backgrounded, not quote, canonical submit or cart writes',()=>{
 assert.match(checkout,/const q=lastQuote&&lastTestRequestId/);
 assert.match(checkout,/q\.totalVnd!==priceShown\.totalVnd/);
 assert.match(checkout,/await call\('\/api\/v2\/confirm'/);
 assert.match(checkout,/requestId:lastTestRequestId,confirmed:true/);
 assert.doesNotMatch(checkout,/void call\('\/api\/v2\/confirm'/);
 assert.doesNotMatch(checkout,/setTimeout\([\s\S]*confirm/);
});
