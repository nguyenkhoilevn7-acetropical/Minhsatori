const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const html=readFileSync('index.html','utf8');

test('accounting UI theme is optional and screen-only',()=>{
 assert.match(html,/id="s25-ledger-style"/);
 assert.match(html,/id="s25-ledger-controller"/);
 assert.match(html,/@media screen/);
 assert.match(html,/satori\.ui\.v25d/);
 assert.match(html,/data-s25-depth/);
 assert.match(html,/data-s25-swatch/);
 assert.match(html,/id="invoicePreview"/);
 assert.match(html,/id="modalInvoiceContent"/);
});
test('existing real accounting actions remain',()=>{
 for(const marker of ["switchTab('input')","switchTab('archive')",
   "switchTab('sheet')","openTrashBinModal()","openBackupRestoreModal()"]){
    assert.ok(html.includes(marker),'missing '+marker);
 }
});
