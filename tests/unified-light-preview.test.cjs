const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
const afterHead=html.slice(html.indexOf('</head>')+7);
function fnv32(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)}return (h>>>0).toString(16).padStart(8,'0')}

test('legacy V18.3 HTML body is byte-for-byte logically unchanged',()=>{
 assert.equal(fnv32(afterHead),'0e1acc25','Body drift: do not touch invoice/payment/backup/Google Drive runtime');
 assert.match(html,/<\/body>\s*<\/html>/);
});
test('new appearance is query opt-in, never default or production rollout',()=>{
 assert.match(html,/get\('satoriUiPreview'\)\s*===\s*'1'/);
 assert.match(html,/document\.documentElement\.classList\.add\('satori-light-review'\)/);
 assert.match(html,/html\.satori-light-review #tab-sheet/);
 assert.match(html,/@media screen/);
 assert.doesNotMatch(html,/<body[^>]*satori-light-review/);
});
test('full accounting workflow and existing controls remain in markup',()=>{
 for(const id of ['tab-input','tab-archive','tab-sheet','tab-catalogue','tab-aimemory',
   'archiveCardsContainer','sheetsTableBody','busPhone','busLocation','itemsContainer',
   'paymentStatus','shippingOption','vatOption','deliveryNote']){
   assert.ok(html.includes('id="'+id+'"'),id);
 }
 for(const callback of ['renderArchiveInvoices','calculateTotals','syncLiveFromGoogleDrive',
   'openBackupRestoreModal','renderAIMemoryTable','openTrashBinModal','switchTab']){
   assert.ok(html.includes(callback),callback);
 }
});
