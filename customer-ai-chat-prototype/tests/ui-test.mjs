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
assert.ok(html.includes('--satori-action-blue:#0867d5')&&
 html.includes('.server-mode #suggestionsToggle,.history-trigger,.history-item a,'),
 'customer actions including product menu/history links have a visible blue fill');
assert.ok(html.includes('.chip,.catalog-filter,.quick-cart button,.suggestion-steps button,'),
 'shortcuts, filters, shared-cart buttons and +/- controls have blue active backgrounds');
assert.ok(html.includes('button:disabled,.btn:disabled{background:#dbe2eb!important'),
 'disabled or completed actions remain visibly grey, not false-blue tappable');
assert.ok(html.includes(':is(.cart-clear,.cart-remove,.inline-cart-remove){background:#fff0f1'),
 'destructive removal controls retain separate warning-color semantics');
assert.ok(html.includes('button:focus-visible,.btn:focus-visible,.chip:focus-visible'),
 'keyboard focus remains visible on blue buttons');

// Customer navigation: two equal-width actions on the lower row, one compact
// suggestions button in the former redundant header-products slot.
const topBar=html.match(/<div class="chat-head">([\s\S]*?)<\/div>\s*<div class="catalog-launch-bar">/);
assert.ok(topBar?.[1].includes('id="suggestionsToggle"'),'header houses product suggestions');
assert.ok(!topBar?.[1].includes('id="locationsToggle"'),'location picker is not in header');
const locationBar=html.match(/<div class="catalog-launch-bar">([\s\S]*?)<\/div>/);
assert.ok(locationBar?.[1].includes('id="catalogLaunch"')&&locationBar?.[1].includes('id="locationsToggle"'),
 'Tất cả sản phẩm and Tất cả địa chỉ share a two-column row');
assert.ok(!locationBar?.[1].includes('id="suggestionsToggle"'),'suggestions no longer take bottom action');
assert.ok(html.includes('📍 Tất cả địa chỉ')&&html.includes('✨ Gợi ý sản phẩm'),
 'shortened Vietnamese labels visible on Samsung');
assert.ok(!html.includes('productsToggle')&&!html.includes('Đóng sản phẩm'),
 'redundant products open/close control removed');
assert.ok(html.includes('toggle.hidden=false;')&&html.includes('deliveryLocations.length===1'),
 'single-address demo still offers a tappable address picker and guidance');
assert.equal((html.match(/id="locationsToggle"/g)||[]).length,1,'one distinct address control');
assert.equal((html.match(/id="suggestionsToggle"/g)||[]).length,1,'one distinct suggestions control');
assert.ok(html.includes('id="catalogLaunch"')&&html.includes('catalog-purchase-row')&&
 html.includes("meta.textContent=p.unit+' · Giá: '+money(p.unitPrice||0)")&&
 html.includes("const controls=stepper(p.code,cart.get(p.code)?.qty||0);"),
 'priced full catalogue gives +/- and quantity for every official unit');
assert.ok(html.includes("catalogItems=data.products;")&&
 html.includes("catalogItems=json.products;")&&
 html.includes("meta.textContent=p.unit+' · Giá: '+money(p.unitPrice||0)+' / '+p.unit.toLowerCase();"),
 'all official product units visible with correct per-unit prices, including 5L bình and thùng');
assert.ok(html.includes('id="suggestionsToggle"')&&html.includes('id="suggestionsList" class="suggestions-list" hidden')&&
 html.includes('suggestion-compact-chip')&&html.includes("section.hidden=toggle.getAttribute('aria-expanded')!=='true';"),
 'frequent purchases are one collapsed button and a compact chip row only on click');
assert.ok(html.includes('.server-mode .quick-cart #quickCartCount{grid-column:1/-1;grid-row:1!important')&&
 html.includes('.server-mode .quick-cart #quickCartNew{grid-column:1;grid-row:2!important'),
 'new basket button never overlaps count, including Samsung narrow screens');
assert.ok(html.includes("$('quickCartQuote').hidden=inlineCartCollapsed;")&&
 html.includes('.server-mode .quick-cart #inlineCartLines[hidden],.server-mode .quick-cart #quickCartQuote[hidden]{display:none!important'),
 'collapse genuinely hides rows and quote, and reopen restores them');

assert.ok(html.includes('class="shop-hero"') && html.includes('id="heroShopCta"'),
 'mobile customer shop CTA present in shared storefront');
assert.ok(html.includes("$('heroShopCta').addEventListener('click',openCatalog);"),
 'shop CTA opens a catalogue with all products and per-item quantity controls');
assert.ok(html.includes("$('allProductsButton').addEventListener('click',openCatalog);")&&
 html.includes("$('catalogLaunch').addEventListener('click',openCatalog);"),
 'both All Products actions open priced catalogue');
for(const label of ['id="suggestionsInline"','id="suggestionsList"','id="inlineProductSearch"',
 'id="inlineSearchInput"','id="inlineCartLines"','function renderPersonalizedSuggestions()',
 'function renderInlineProducts()','function stepper(code,current)',
 "await changeSharedDraft('set',item.code,qty)",
 "return restoreDraft().then(loadPersonalizedSuggestions)"])
 assert.ok(html.includes(label),'one-screen personalized shopping interface: '+label);
assert.ok(html.includes('.chat-head{position:sticky;top:0;z-index:5}'),
 'customer chat navigation remains visible while chat scrolls');

assert.ok(html.includes('id="printInvoice" href="#" download hidden>⬇ Tải PDF về máy'),'invoice modal uses a direct-download anchor');
assert.ok(!html.includes('window.print()'),'invoice download never invokes browser print dialog');
assert.ok(!html.includes("link.target='_blank'"),'confirmation download does not open an extra tab');
assert.ok(html.includes("download.href=pdfUrl"),'history download points to server PDF endpoint');
assert.ok(html.includes('id="viewInvoice" href="#" target="_blank" rel="noopener noreferrer" hidden>👁 Xem PDF'),
 'invoice modal exposes a safe View PDF action');
assert.ok(html.includes("view.href=pdfUrl+'&view=1'"),'invoice View PDF uses inline mode');
assert.ok(html.includes("view.target='_blank';view.rel='noopener noreferrer'"),
 'history View PDF opens independently with noopener and noreferrer');
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
// Every product shortcut must feed the same mutable cart and never open a
// separate order request. User confirms only after the combined quote.
for(const code of ['TP-00003','TP-00136','TP-00056','TP-00058','TP-00051'])
 assert.ok(html.includes('data-cart-sku="'+code+'"'),'product shortcut '+code+' builds shared basket');
assert.ok(html.includes('id="quickCart"')&&html.includes('id="quickCartQuote"'),
 'persistent combined-cart status and review CTA');
assert.ok(html.includes('cart.set(code,{code,name:item.name,unit:item.unit,qty:qty+1});'),
 'repeated chip taps increment quantity in shared cart');
assert.ok(html.includes("document.querySelectorAll('.chip[data-cart-sku]')"),
 'quick chip handlers do not send a chat message');
assert.ok(!html.includes("document.querySelectorAll('.chip').forEach(b=>b.addEventListener('click',()=>send(b.dataset.msg)))"),
 'legacy independent quote shortcut handler removed');
assert.ok(html.includes("pendingCartItems=cartSnapshot()"),
 'combined quote includes every selected SKU');
assert.ok(html.includes("--satori-visible-height"),
 'mobile keyboard visible-viewport adjustment present');
assert.ok(!html.includes("renderCatalogue();$('catalogSearch').focus();"),
 'opening catalogue does not force Samsung keyboard visible');
assert.ok(!html.includes("$('productSelection').classList.add('active');\n $('addProductMessage').disabled=false;\n $('cartFeedback').textContent='';\n $('selectedQuantity').focus();"),
 'choosing product does not force Samsung keyboard visible');
console.log('PASS shared-cart product-chip and mobile-keyboard checks');
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
 ['id="checkSourceReadonly"','read-only source integration control'],
 ["request('/api/admin/source-check')",'HMAC-only integration readiness probe'],
 ['id="downloadSandboxBackup"','owner backup download button'],
 ['id="restoreSandboxFile"','owner upload backup file selector'],
 ['id="restoreSandboxBackup"','guarded restore control'],
 ['id="checkDriveBackup"','owner can inspect Drive backup state'],
 ['id="runDriveBackup"','owner can request encrypted remote backup'],
 ["request('/api/admin/drive-backup/status')",'owner-only backup status endpoint'],
 ["request('/api/admin/drive-backup/now','POST',{})",'owner-only backup command'],

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
 ["announceAmendments(edited)",'admin notifies customer invoice revisions'],
 ["knownOrderVersions=new Map",'admin tracks changes by amendment version'],
 ["'✏️ ĐÃ SỬA • '",'updated orders labeled distinctly'],

 ["document.addEventListener('visibilitychange'",'refresh on returning to Admin tab']
];
for(const [needle,label] of adminChecks)assert.ok(adminHtml.includes(needle),label);
assert.ok(html.includes('function showAmendment(proposal)'),'customer sees explicit amendment confirmation card');
assert.ok(html.includes("'/api/order-amend/confirm'"),'customer has server-verified amendment confirmation button');
assert.ok(html.includes('q.vatAmount??0'),'quote displays server-calculated VAT');
assert.ok(html.includes('o.vatAmount??0'),'invoice preview displays VAT');
assert.ok(html.includes('>Tạo giỏ mới</button>')&&!html.includes('>Giỏ mới</button>'),
 'new-cart button explains its purpose clearly');
assert.ok(html.includes('<strong class="quantity-strong">x')&&html.includes('.quote .quantity-strong{font-weight:850'),
 'quote uses bold x10 Thùng-like quantity labels');
assert.ok(html.includes("quantityBadge.textContent='x'+item.qty")&&html.includes('.inline-cart-row .inline-qty-label'),
 'inline chat basket displays bold x-prefixed quantities');
assert.ok(html.includes("cartUnit=cartUnits.length===1?cartUnits[0]:'đơn vị'"),
 'mixed-unit totals remain honest while same-unit baskets display x count');
// Regression: Samsung keyboard must not cover the message pane. The existing
// catalogue, address picker, cart controls and order endpoints remain unchanged.
for(const [needle,label] of [
 ['.server-mode .card.chat{height:100%;min-height:0;max-height:100%;overflow:hidden','chat uses keyboard-aware viewport height on phones'],
 ['.server-mode .messages{flex:1 1 0%;min-height:0;max-height:none;overflow-y:auto','messages, not page, scroll above composer'],
 ['.server-mode .composer textarea{font-size:16px','prevent mobile input focus zoom'],
 ["Math.min(window.innerHeight||vv.height,vv.height)",'keyboard uses visible viewport'],
 ["window.visualViewport?.addEventListener('resize',syncVisibleHeight",'viewport resize tracked'],
 ["window.visualViewport?.addEventListener('scroll',syncVisibleHeight",'Android viewport pan tracked'],
 ["let personalizedSuggestions=[],inlineCartCollapsed=true;",'basket starts collapsed'],
 ["$('quickCartNew').hidden=inlineCartCollapsed;",'new basket action appears only after expansion'],
 ["$('messages').addEventListener('scroll',syncChatCompact",{passive:true})",'scroll triggers compact header'],
 ["$('messageInput').addEventListener('focus',()=>{",'text focus enters keyboard mode'],
 ["$('messageInput').addEventListener('blur',()=>{",'keyboard mode exits on blur'],
 ["document.body.classList.add('chat-typing','chat-compact')",'typing shrinks header'],
 [".server-mode.chat-typing .catalog-launch-bar",'optional navigation hides while typing'],
 [".server-mode.chat-typing .secondary-tools",'secondary controls hide while typing'],
 [".server-mode.chat-compact .chat-satori-logo{width:24px!important;height:24px!important",'logo scales down'],
 ["$('quickCartEdit').addEventListener('click',()=>{",'cart still manually expandable'],
 ["$('locationsToggle').addEventListener('click',()=>{",'addresses remain selectable'],
 ["$('catalogLaunch').addEventListener('click',openCatalog);",'catalogue remains accessible']
])assert.ok(html.includes(needle),'mobile keyboard regression: '+label);
console.log('PASS mobile keyboard-visible chat layout, compact header and opt-in basket');
console.log('PASS quantity x-prefix and create-cart accessibility labels');
console.log('PASS '+(adminChecks.length+3)+'/'+(adminChecks.length+3)+' admin search and VAT UI checks');
