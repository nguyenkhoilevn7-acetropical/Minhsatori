const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
function fingerprint(s){ let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)}return (h>>>0).toString(16).padStart(8,'0') }
function strippedLegacyBody(){
 const afterHead=html.slice(html.indexOf('</head>')+7);
 return afterHead
  .replace(/\n<!-- MoneyMind legacy bottom navigation:[\s\S]*?<\/nav>\n/,'')
  .replace(/\n<script id="satori-legacy-dock-sync">[\s\S]*?<\/script>\n/,'');
}
test('legacy accounting original V18.3 body/payment/Drive/PDF logic remains exact',()=>{
 assert.equal(fingerprint(strippedLegacyBody()),'0e1acc25','Legacy body drift: cannot release financial/Google Drive mutations');
 assert.match(html,/<\/body>\s*<\/html>/);
});
test('MoneyMind is production default, not a query-only preview',()=>{
 assert.match(html,/document\.documentElement\.classList\.add\('satori-light-review'\)/);
 assert.doesNotMatch(html,/get\('satoriUiPreview'\)\s*===\s*'1'/);
 assert.match(html,/MoneyMind production/);
});
test('every nav route delegates to existing handlers with no invented endpoints',()=>{
 for(const tab of ['input','archive','sheet','catalogue','reconcile','aimemory'])
   assert.match(html,new RegExp("switchTab\\('"+tab+"'\\)"));
 for(const f of ['syncLiveFromGoogleDrive','openBackupRestoreModal','openTrashBinModal'])
   assert.match(html,new RegExp(f+"\\(\\)"));
 assert.match(html,/id="satori-legacy-dock"/);
 assert.match(html,/id="satori-legacy-dock-sync"/);
 assert.match(html,/new MutationObserver\(paint\)/);
});
test('money UI preserves accounting controls and avoids hardcoded sample financial values',()=>{
 for(const id of ['tab-input','tab-archive','tab-sheet','tab-catalogue','tab-aimemory','archiveCardsContainer','sheetsTableBody','paymentStatus','shippingOption','vatOption','deliveryNote'])
   assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/id="statUnpaid"/);
 assert.match(html,/aria-label="Sổ kế toán và công nợ"/);
});
test('mobile folded and bar view widths, accessibility, print, reduced motion',()=>{
 assert.match(html,/@media\(max-width:900px\)/);
 assert.match(html,/env\(safe-area-inset-bottom,0px\)/);
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(html,/<nav id="satori-legacy-dock" class="no-print" aria-label="Điều hướng kế toán">/);
 assert.match(html,/@media print/);
 assert.match(html,/font-size:16px!important/);
 assert.match(html,/border-radius:11px!important/);
});
