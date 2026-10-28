import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 assertSameCanonicalInvoice,assertSharedPdfMetadataForAllClients,
 canonicalInvoiceDocumentStatus
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
 assert.match(android,/WebsiteInvoicePdf\.render\(/,
  'Android still locally generates PDFs; release must replace this for canonical invoices');
});
