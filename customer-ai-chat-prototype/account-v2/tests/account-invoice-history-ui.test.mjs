import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
test('invoice history UI parses and is visible from customer account',()=>{
 assert.doesNotThrow(()=>new vm.Script(inline));
 for(const target of ['customerInvoiceRows','customerInvoiceStatus','customerInvoiceDetail','accountInvoiceHistory']){
  assert.match(html,new RegExp('id="'+target+'"'));
 }
 assert.match(inline,/accountInvoiceHistory'\)\.onclick=\(\)=>view\('orders'\)/);
 assert.match(inline,/loadCustomerInvoiceHistory\(\)/);
});
test('history is account scoped and never inferred from phone/name',()=>{
 assert.match(inline,/call\('\/api\/v2\/invoices'\+query,undefined,'GET'\)/);
 assert.match(inline,/call\('\/api\/v2\/invoices\?id='\+encodeURIComponent\(id\),undefined,'GET'\)/);
 assert.match(inline,/invoice\.id!==id/);
 assert.match(html,/Chỉ hiển thị hóa đơn gốc đã được Admin xác minh/);
});
test('no fallback PDF renderer: download only exact endpoint, SHA-256 verified',()=>{
 assert.match(inline,/pdf\?\.available!==true/);
 assert.match(inline,/invoice-document/);
 assert.match(inline,/crypto\.subtle\.digest\('SHA-256',bytes\)/);
 assert.match(inline,/computed!==pdf\.sha256/);
 assert.match(inline,/response\.headers\.get\('x-content-sha256'\)!==pdf\.sha256/);
 assert.match(inline,/PDF gốc chưa có hoặc chưa được đối soát/);
 assert.doesNotMatch(inline,/new jsPDF\(|pdfMake\.createPdf\(/);
});

test('in-app Gemini invoice command opens identical verified PDF or account history',()=>{
 assert.match(inline,/result\.invoiceReference/);
 assert.match(inline,/await downloadVerifiedCustomerInvoice\(invoice\)/);
 assert.match(inline,/await loadCustomerInvoiceDetail\(ref\.id\)/);
 assert.match(inline,/result\.invoiceReferences/);
 assert.match(inline,/🧾 Xem hóa đơn/);
 assert.doesNotMatch(inline,/geminiPdf|renderGeminiInvoicePdf/);
});
