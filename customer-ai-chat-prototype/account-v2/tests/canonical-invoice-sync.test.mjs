import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 assertSameCanonicalInvoice,assertSharedPdfMetadataForAllClients,
 canonicalInvoiceDocumentStatus,canonicalReceiptForAccountOrder
} from '../canonical-invoice-sync.mjs';

const invoice={state:'COMMITTED',invoiceNo:5931,ledgerId:'1700000000000',
 requestId:'8c2d2d12-e125-4b2f-bd00-9d6ef0e2f371'};
const pdf={source:'original-website-pdfmake-drive',invoiceNo:5931,
 ledgerId:'1700000000000',driveFileId:'1AbCdef0123456789_XyZ0',
 sha256:'a'.repeat(64),versionKey:'[5931,"2026-10-28","Khách thử"]\nSATORI_PDF_VIETQR_20261021'};
test('Gemini Website Android point to the identical single original website PDF',()=>{
 const shared=assertSharedPdfMetadataForAllClients(invoice,pdf);
 assert.deepEqual(shared.gemini,shared.website);
 assert.deepEqual(shared.website,shared.android);
 assert.equal(shared.android.driveFileId,pdf.driveFileId);
 assert.equal(shared.gemini.sha256,pdf.sha256);
 assert.equal(assertSameCanonicalInvoice(invoice,pdf).invoiceNo,5931);
});
test('cannot claim an original PDF for a non-committed or unverified invoice',()=>{
 for(const state of ['PENDING_INTEGRATION','UNCERTAIN','RELAY_PENDING','REJECTED']){
  assert.throws(()=>assertSameCanonicalInvoice({...invoice,state},pdf),{code:'CANONICAL_INVOICE_NOT_COMMITTED'});
 }
 const notYet=canonicalInvoiceDocumentStatus({...invoice,state:'UNCERTAIN'});
 assert.deepEqual(notYet,{source:'original-website-pdfmake-drive',
  status:'AWAITING_CANONICAL_INVOICE',shareable:false});
 const doc=canonicalInvoiceDocumentStatus(invoice);
 assert.equal(doc.shareable,false);
 assert.equal(doc.status,'AWAITING_VERIFIED_DRIVE_PDF');
 assert.equal('url' in doc,false,'no invented Drive link');
});
test('cannot substitute another invoice, file version, a public link or a locally generated PDF',()=>{
 for(const tampered of [
  {...pdf,invoiceNo:5932},{...pdf,ledgerId:'1700000000001'},
  {...pdf,sha256:'f'},{...pdf,driveFileId:'https://drive.google.com/file/d/abc'},
  {...pdf,source:'android-pdfdocument'}, {...pdf,source:'gemini-generated'},
  {...pdf,versionKey:''}
 ]){
  assert.throws(()=>assertSameCanonicalInvoice(invoice,tampered),{code:'ORIGINAL_PDF_MISMATCH'});
 }
});
test('V2 order read remains account-scoped and never claims PDFs are ready early',()=>{
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');

 assert.match(router,/WHERE r.account_id=\$1 AND q.account_id=\$1/);
 assert.match(router,/canonicalInvoiceDocumentStatus\(x\)/);
 assert.match(router,/REAL_CHECKOUT_GATE_NOT_VERIFIED/);
 // Native Android is maintained on the main Android branch; this isolated
 // V2 contract test must not depend on absent Android files or global variables.
});

test('V1-style Gemini receipt is available ONLY after canonical V2 journal commit',()=>{
 const row={state:'COMMITTED',invoiceNo:5931,
  requestId:'8c2d2d12-e125-4b2f-bd00-9d6ef0e2f371',
  totalVnd:'1060000',currency:'VND'};
 const receipt=canonicalReceiptForAccountOrder(row);
 assert.deepEqual(receipt,{invoiceNo:5931,requestId:row.requestId,
  currency:'VND',totalVnd:1060000,
  pdf:{source:'original-website-pdfmake-drive',
   status:'AWAITING_VERIFIED_DRIVE_PDF',shareable:false}});
 assert.equal('pdfUrl' in receipt,false);
 for(const invalid of [
  {...row,state:'PENDING_INTEGRATION'},
  {...row,state:'UNCERTAIN'},
  {...row,state:'REJECTED'},
  {...row,invoiceNo:0},
  {...row,requestId:'bad'},
  {...row,totalVnd:'-5'},
  {...row,totalVnd:'not money'},
  {...row,currency:'USD'},
  {...row,invoiceNo:'5931x'}
 ])assert.equal(canonicalReceiptForAccountOrder(invalid),null);
});
test('receipt button is inaccessible for unverified/test-only requests; PDF never invented',()=>{
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
 assert.match(router,/WHERE r.account_id=\$1 AND q.account_id=\$1/);
 assert.match(router,/canonicalReceiptForAccountOrder\(x\)/);
 assert.match(router,/verified:receipt!==null/);
 assert.match(html,/if\(verified&&o\.receipt\)/);
 assert.match(html,/function showCommittedReceipt\(order\)/);
 assert.match(html,/order\?\.verified!==true\|\|order\.state!=='COMMITTED'/);
 assert.match(html,/AWAITING_VERIFIED_DRIVE_PDF/);
 assert.match(html,/Chưa có link tải chính thức/);
 assert.doesNotMatch(html,/window\.open\(.*driveFileId/);
 assert.match(router,/REAL_CHECKOUT_GATE_NOT_VERIFIED/);
});
