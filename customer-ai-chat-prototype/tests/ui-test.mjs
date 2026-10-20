/* Static UI compile / accessibility smoke test. No browser, no user data, no external requests. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const match=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match,'inline app script exists');
new vm.Script(match[1],{filename:'customer-chat-inline.js'});
for(const [needle,description] of [
 ['id="allProductsButton"','All Products menu button'],
 ['id="catalogBackdrop"','catalogue overlay'],
 ['id="catalogSearch"','catalogue search'],
 ['id="catalogFilters"','brand filters'],
 ['id="catalogItems"','product item list'],
 ['id="selectedQuantity"','quantity selector'],
 ["fetch('/api/catalogue?token='","server-driven product list"],
 ['bubble.user','iMessage-style user messages'],
 ['.bubble.assistant','assistant message styling'],
 ['@media(max-width:760px)','mobile CSS'],
 ["serverPost('/api/confirm'","customer confirmation before new order"]
])assert.ok(html.includes(needle),description);
assert.ok(html.trim().endsWith('</html>'),'complete HTML document');
assert.ok(html.includes('id="printInvoice" href="#" download hidden>⬇ Tải PDF về máy'),'invoice modal uses a direct-download anchor');
assert.ok(!html.includes('window.print()'),'invoice download never invokes browser print dialog');
assert.ok(!html.includes("link.target='_blank'"),'confirmation download does not open an extra tab');
assert.ok(html.includes("download.href='/api/invoice/'"),'history links use direct PDF endpoint');
assert.ok(html.includes('delivery-note-block'),'delivery instructions field appears before order confirmation');
assert.ok(html.includes('for(const hours of [2,3])'),'quick options for 2 and 3 hours');
assert.ok(html.includes('deliveryNote});const o=res.order;'),'delivery note sent with confirmation');
assert.ok(html.includes('invoice-delivery-note'),'invoice preview displays delivery note');
assert.ok(html.includes('/assets/logo-satori.jpg'),'original logo displayed on invoice');
assert.ok(!html.includes('GEMINI_API_KEY'),'never inline API secrets');
console.log('PASS 23/23 iMessage, delivery notes and PDF UI structure smoke checks');
