const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function fnv32(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)}return(h>>>0).toString(16).padStart(8,'0')}
function fnSource(name){
 const start=html.indexOf('function '+name+'(');
 assert.ok(start>=0,'required accounting function missing: '+name);
 const sub=html.slice(start);
 const regex=/\n\s*(?:async\s+)?function\s+[a-zA-Z_$][\w$]*\s*\(/g;
 regex.lastIndex=16;
 const next=regex.exec(sub);
 return sub.slice(0,next?next.index:20000);
}
test('all protected accounting and payment entrypoints remain byte-identical to V18.3',()=>{
 for(const [name,fingerprint] of Object.entries({
  renderTable:'99dcafd5',
  handleSaveAndGenerate:'c34b724e',
  calculateTotals:'8bea3861',
  syncLiveFromGoogleDrive:'4e21c7aa',
  updateStatus:'967b3133',
  downloadInvoiceById:'f5da17da',
  viewInvoiceDetailModal:'887fb9a0',
  deleteArchiveInvoice:'165f6985'
 })){
  assert.equal(fnv32(fnSource(name)),fingerprint,'Business method changed: '+name);
 }
 assert.match(html,/<\/body>\s*<\/html>/);
});
test('MoneyMind V2 is one consolidated screen-only design with no stacked conflicting CSS',()=>{
 assert.match(html,/MINH SATORI • MONEY MIND UI V2/);
 assert.doesNotMatch(html,/END MINH SATORI LEGACY REVIEW-ONLY UI/);
 assert.doesNotMatch(html,/MONEY-MIND SATORI FLAT TEAL/);
 assert.doesNotMatch(html,/MoneyMind production — visual styles only/);
 assert.match(html,/document\.documentElement\.classList\.add\('satori-light-review'\)/);
 assert.match(html,/@media screen/);
 assert.match(html,/@media print/);
 assert.match(html,/#invoicePreview/);
 assert.match(html,/#modalInvoiceContent/);
});
test('mobile header has logo on left and settings/menu on right, right drawer accessible',()=>{
 for(const id of ['appHeader','satori-web-header-actions','satori-web-menu-trigger','satori-web-drawer',
  'satori-web-drawer-backdrop','satori-legacy-dock','syncIconMobile','syncStatusBadge']){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 }
 assert.match(html,/aria-expanded="false"/);
 assert.match(html,/onclick="satoriToggleWebDrawer\(true\)"/);
 assert.match(html,/transform:translateX\(105%\)/);
 assert.match(html,/satoriToggleWebDrawer\(false\)/);
 assert.match(html,/event\.key==='Escape'/);
 assert.match(html,/openGoogleSyncModal\(\)/);
 assert.match(html,/resetCatalogueToDefault\(\)/);
 assert.match(html,/triggerPwaInstall\(\)/);
});
test('invoice cards are compact but preserve all original actions',()=>{
 assert.match(html,/card\.className = "ms-invoice-card flex flex-col justify-between"/);
 assert.match(html,/class="ms-card-head"/);
 assert.match(html,/class="ms-card-items"/);
 assert.match(html,/class="ms-card-actions"/);
 assert.match(html,/class="ms-money font-bold text-sm font-mono"/);
 for(const action of ['viewInvoiceDetailModal','downloadInvoiceById','duplicateOrder','editOrder','deleteArchiveInvoice']){
  assert.ok(fnSource('renderArchiveInvoices').includes(action+'('),action);
 }
});
test('accounting ledger becomes stacked semantic card rows on mobile, with red financial amounts',()=>{
 assert.match(html,/@media\(max-width:760px\)/);
 assert.match(html,/#sheetsTableBody tr\{display:grid!important/);
 assert.match(html,/#sheetsTableBody td:nth-child\(12\)::before\{content:"Thanh toán";\}/);
 assert.match(html,/#sheetsTableBody td:nth-child\(13\)::before\{content:"Thao tác";\}/);
 assert.match(html,/#sheetsTableBody td:nth-child\(10\)/);
 assert.match(html,/--ms-red:#d72535/);
 assert.match(html,/#archiveFilterTotal,#statTotalRevenue/);
});
test('original accounting DOM and data-source warning kept',()=>{
 for(const id of ['tab-input','tab-archive','tab-sheet','tab-reconcile','tab-catalogue','tab-aimemory','orderForm','busName','busPhone','busLocation','invoiceNo','paymentStatus','shippingOption','vatOption','deliveryNote','invoicePreview','archiveCardsContainer','sheetsTableBody']){
  assert.ok(html.includes('id="'+id+'"'),'missing '+id);
 }
 assert.match(html,/satori-local-data-note/);
 assert.match(html,/Mở Minh Satori đồng bộ Drive/);
 assert.doesNotMatch(html,/Active Update Notification Banner/);
});
test('all inline JavaScript parses, including UI drawer and full accounting runtime',()=>{
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
 let parsed=0;
 for(const script of scripts){
  const tag=script[0].slice(0,script[0].indexOf('>')+1);
  if(tag.includes('src=')||tag.includes('application/ld+json'))continue;
  const js=script[1].trim();
  if(!js)continue;
  assert.doesNotThrow(()=>new vm.Script(js), 'inline JS parse failed at index '+script.index);
  parsed++;
 }
 assert.ok(parsed>=5,'inline JS script coverage');
});
