import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const pdfUI=inline.split('function attachVerifiedPdfUi(order){')[1]?.split('function showCommittedReceipt(order){')[0]||'';

test('V2 invoice view provides original PDF view/download/native file share',()=>{
 assert.ok(pdfUI.length>100);
 assert.match(pdfUI,/\/api\/v2\/orders\//);
 assert.match(pdfUI,/credentials:'same-origin'/);
 assert.match(pdfUI,/cache:'no-store'/);
 assert.match(pdfUI,/application\/pdf/);
 assert.match(pdfUI,/blob\.size>3\*1024\*1024/);
 for(const label of ['👁 Xem PDF','⬇ Tải PDF','↗ Chia sẻ PDF'])assert.ok(pdfUI.includes(label));
 assert.match(pdfUI,/navigator\.canShare/);
 assert.match(pdfUI,/navigator\.share\(\{files:\[file\]/);
 assert.match(pdfUI,/new File\(\[blob\]/);
 assert.match(pdfUI,/\.download=name/);
 assert.match(pdfUI,/b\.disabled=true/);
 assert.match(pdfUI,/buttons\.forEach\(b=>b\.disabled=false\)/);
 assert.doesNotMatch(pdfUI,/drive\.google\.com|\.setSharing\(/);
});
test('PDF buttons attach to separate invoice detail without modifying Gemini',()=>{
 const detail=inline.split('function showCommittedReceipt(order){')[1]
  ?.split('async function loadOrders(){')[0]||'';
 assert.match(detail,/attachVerifiedPdfUi\(order\)/);
 assert.match(detail,/order\?\.verified!==true/);
 assert.match(detail,/view\('invoiceDetail'\)/);
 assert.doesNotMatch(detail,/\$\('messages'\)|view\('chat'\)/);
 assert.doesNotThrow(()=>new vm.Script(inline));
});
