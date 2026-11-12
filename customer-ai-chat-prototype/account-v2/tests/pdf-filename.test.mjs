import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {invoicePdfFilename,invoicePdfDisposition} from '../pdf-filename.mjs';

const order={invoiceNo:5988,recipientName:'Traky Sài Gòn',date:'12/11/2026'};
const expected='5988 - Traky Sài Gòn - 2026-11-12.pdf';
test('canonical saved number + recipient + order date; never UUID or hash',()=>{
 assert.equal(invoicePdfFilename(order),expected);
 assert.equal(invoicePdfFilename({...order,date:'2026-11-12'}),expected);
 assert.equal(invoicePdfFilename({...order,recipientName:'Cô/Lan: Bình Thạnh'}),'5988 - Cô Lan Bình Thạnh - 2026-11-12.pdf');
 assert.doesNotMatch(expected,/MinhSatori|HD_|[0-9a-f]{8}-[0-9a-f]{4}/);
});
test('invalid source date or recipient fails closed; header keeps UTF-8 safely',()=>{
 for(const data of [{...order,date:'31/02/2026'},{...order,date:''},{...order,recipientName:''},{...order,invoiceNo:0}])
  assert.throws(()=>invoicePdfFilename(data),/PDF_FILENAME_/);
 const head=invoicePdfDisposition('attachment',order);
 assert.ok(head.includes("filename*=UTF-8''"+encodeURIComponent(expected)));
 assert.doesNotMatch(head,/[\r\n]/);
});
test('V2 customer Web and protected API use same fields',()=>{
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 assert.match(router,/invoicePdfDisposition\(disposition/);
 assert.match(router,/recipientName:latest\.delivery\?\.recipientName/);
 const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
 const start=html.indexOf('function verifiedInvoicePdfFilename(order) {');
 const end=html.indexOf('function attachVerifiedPdfUi(order){',start);
 assert.ok(start>=0&&end>start);
 const fn=vm.runInNewContext(html.slice(start,end)+';verifiedInvoicePdfFilename',{}, {timeout:1000});
 assert.equal(fn({receipt:{invoiceNo:5988},delivery:{recipientName:order.recipientName},invoiceDate:order.date}),expected);
 assert.match(html,/const name=verifiedInvoicePdfFilename\(order\)/);
});
