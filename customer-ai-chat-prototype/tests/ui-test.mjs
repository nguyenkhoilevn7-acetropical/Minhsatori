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
assert.ok(html.includes('invoiceItems.map'),'all product lines appear in invoice preview');
assert.ok(html.includes('q.items'),'quote supports multiple product lines');
assert.ok(html.includes('note.value=q.deliveryNote||\'\''),'delivery note auto-filled by server');
assert.ok(!html.includes('for(const hours of [2,3])'),'customers do not need manual hour preset buttons');
assert.ok(html.includes('deliveryNote});const o=res.order;'),'delivery note sent with confirmation');
assert.ok(html.includes('invoice-delivery-note'),'invoice preview displays delivery note');
assert.ok(html.includes('/assets/logo-satori.jpg'),'original logo displayed on invoice');
assert.ok(!html.includes('GEMINI_API_KEY'),'never inline API secrets');
for(const [needle,label] of [['data-label="Thành tiền"','mobile product totals have label'],['.invoice-table-wrap table{width:100%;min-width:0;table-layout:fixed','wide preview grid fits paper'],['/api/invoice-qr/','QR image fetched from protected sandbox server'],['invoice-signatures','sale and receiving signatures match reference form'],['moneyInWords(o.total)','invoice preview includes amount in Vietnamese words']])assert.ok(html.includes(needle),label);
console.log('PASS 5/5 invoice preview QR, totals and mobile layout safeguards');
console.log('PASS 26/26 iMessage, automatic delivery notes and PDF UI structure smoke checks');
const adminHtml=fs.readFileSync(path.join(root,'admin.html'),'utf8');
const adminScript=adminHtml.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(adminScript,'Admin inline script exists');
new vm.Script(adminScript[1],{filename:'customer-admin-inline.js'});
const adminChecks=[
 ['id="existingCustomer"','customer dropdown'],
 ['id="customerSearch"','customer name or phone lookup'],
 ['id="customerSuggestions"','accessible matches'],
 ['function chooseCustomer(c)','existing customer autofill'],
 ['id="newCustomer"','new customer mode'],
 ["$('createButton').disabled=true","guard against duplicate selected customer creation"],
 ['vatRate:Number','VAT sent in admin form'],
 ['id="vatRate"','VAT rate selector']
];
for(const [needle,label] of adminChecks)assert.ok(adminHtml.includes(needle),label);
assert.ok(html.includes('q.vatAmount??0'),'quote displays server-calculated VAT');
assert.ok(html.includes('o.vatAmount??0'),'invoice preview displays VAT');
console.log('PASS '+(adminChecks.length+3)+'/'+(adminChecks.length+3)+' admin search and VAT UI checks');
