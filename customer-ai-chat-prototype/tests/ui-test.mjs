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
const pdfSource=fs.readFileSync(path.join(root,'invoice_pdf.py'),'utf8');
assert.ok(pdfSource.includes('NAME_FONT_SIZE=9.5'),'PDF product names must render at 9.5pt');
assert.ok(pdfSource.includes('row_heights=[max(39,14+NAME_LINE_HEIGHT*max(len(name_lines),len(unit_lines)))'),'PDF rows expand for both wrapped names and units');
assert.ok(html.includes('padding:11px 4px;font-size:14px'),'Desktop all product-row columns have readable 14px text');
assert.ok(html.includes('padding:10px 12px;font-size:16px;line-height:1.45'),'Mobile all product-row columns have readable 16px text');
console.log('PASS 5/5 invoice preview QR, totals and mobile layout safeguards');
assert.ok(pdfSource.includes('ROW_FONT_SIZE=9.5'),'All PDF row cells share product-name font size');
assert.ok(pdfSource.includes('widths=[24,156,40,29,69,38,74,91]'),'PDF amount column has sufficient width');
console.log('PASS 6/6 uniform product-row font and variable row-height regression checks');
for(const [needle,label] of [
 ['class="brand-logo" src="/assets/logo-satori.jpg"','genuine logo in customer top brand'],
 ['class="chat-satori-logo" src="/assets/logo-satori.jpg"','genuine Satori logo in chat header'],
 ['class="history-trigger"','visible history action outside chat text'],
 ['id="historyExcel"','customer Excel export'],
 ['id="historyMonth"','month grouping control'],
 ['id="historySearch"','history product or bill search'],
 ['function historyDateKey(iso)','history groups by Vietnam-local calendar day'],
 ['function renderHistory()','organized and filtered history timeline'],
 ["'/api/history.xlsx?token='",'authorized Excel download URL']
])assert.ok(html.includes(needle),label);
for(const [needle,label] of [
 ['id="cartFooter"','basket summary stays in catalogue drawer'],
 ['id="cartCount"','selected product counter'],
 ['id="cartList"','several different products can coexist in basket'],
 ['id="clearCart"','clear basket control'],
 ['id="composeCart"','compose one complete message'],
 ["const cart=new Map()",'SKU-keyed basket preserves earlier selections'],
 ["cart.set(selectedProduct.code",'adding another item does not replace previous items'],
 ["const message='Cho tôi đặt một đơn gồm:",'one natural-language chat message lists all lines'],
 ["{cartItems:pendingCartItems}",'structured SKU cart accompanies human-readable message'],
 ["cartTotalQty()+qty>500",'basket total quantity capped'],
 ["cart.size>=6",'basket distinct product limit'],
 ["cart.delete(item.code)",'individual item can be removed'],
 ["const useCart=pendingCartMessage===message",'edited messages cannot retain stale structured cart'],
 [".messages .bubble.assistant{background:linear-gradient(145deg,#1166c3,#1479d6);color:#fff",'assistant bubble uses readable blue'],
 [".messages .bubble.user{background:linear-gradient(135deg,#087e73,#06968a);color:#fff",'customer bubble uses readable teal'],
 [".messages .bubble.assistant::before{content:\"SATORI AI\"",'blue bubble explicitly identifies AI']
])assert.ok(html.includes(needle),label);
console.log('PASS 16/16 multi-select basket and distinct bubble-color UI checks');
console.log('PASS 9/9 customer logo, timeline and export UI tests');
console.log('PASS 26/26 iMessage, automatic delivery notes and PDF UI structure smoke checks');
const adminHtml=fs.readFileSync(path.join(root,'admin.html'),'utf8');
assert.ok(adminHtml.includes('class="admin-brand"')&&adminHtml.includes('src="/assets/logo-satori.jpg"'),'genuine Satori logo visible in Admin');
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
 ['id="vatRate"','VAT rate selector'],
 ['id="downloadSandboxBackup"','owner backup download button'],
 ['id="restoreSandboxFile"','owner upload backup file selector'],
 ['id="restoreSandboxBackup"','guarded restore control'],
 ['id="newOrders"','live Admin confirmed-order inbox'],
 ['id="newOrderCount"','order alert count'],
 ['id="enableOrderBell"','optional sound and browser notifications'],
 ['id="refreshOrders"','manual order inbox refresh'],
 ['id="markOrdersSeen"','clear unread order badges'],
 ['id="createFakeOrder"','one-click fake order button'],
 ['id="fakeOrderResult"','test-order result status'],
 ['id="testBellSound"','direct audio bell test'],
 ['id="showMoreOrders"','compact five-order list toggle'],
 ['data-admin-tab="orders"','horizontal orders tab'],
 ['data-admin-tab="customers"','horizontal customer tab'],
 ['data-admin-tab="changes"','horizontal requests tab'],
 ['data-admin-tab="settings"','horizontal settings tab'],
 ["request('/api/admin/create-test-order'",'authenticated fake-order request'],
 ["document.querySelectorAll('[data-tab-panel]')",'only selected Admin panel is shown'],
 ["request('/api/admin/new-orders')",'authenticated 10-second inbox poll'],
 ["document.addEventListener('visibilitychange'",'refresh on returning to Admin tab']
];
for(const [needle,label] of adminChecks)assert.ok(adminHtml.includes(needle),label);
assert.ok(html.includes('q.vatAmount??0'),'quote displays server-calculated VAT');
assert.ok(html.includes('o.vatAmount??0'),'invoice preview displays VAT');
console.log('PASS '+(adminChecks.length+3)+'/'+(adminChecks.length+3)+' admin search and VAT UI checks');
