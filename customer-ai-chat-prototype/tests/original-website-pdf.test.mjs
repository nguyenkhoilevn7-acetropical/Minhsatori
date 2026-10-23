// FAKE orders only. This test cannot access a live invoice, HMAC key or Drive.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {renderOriginalWebsitePdf,canonicalPdfVersion} from '../original-website-pdf.mjs';
import {createOriginalPdfGateway,requestSignature} from '../original-pdf-gateway.mjs';
const t0=Date.now();
const makeOrder=total=>({id:t0,invoiceNo:9001,date:'23/10/2026',
  name:'KHÁCH TEST KHÔNG GIAO',phone:'0000000000',location:'Nội bộ test',
  status:'Chưa thanh toán',items:[{product:'Satori 350ml fake',qty:1,
    listPrice:total,unitPrice:total,unit:'Thùng'}],vatAmount:0,shippingAmount:0,total});
for(const total of [0,45000]){
  const invoice=makeOrder(total);
  const r=await renderOriginalWebsitePdf(invoice);
  assert.ok(r.bytes.subarray(0,5).toString()==='%PDF-','must generate real PDF');
  assert.ok(r.bytes.length>=4000,'PDF must not be empty');
  assert.equal(r.sha256,crypto.createHash('sha256').update(r.bytes).digest('hex'));
  assert.equal(r.versionKey,canonicalPdfVersion(invoice));
}
const secret='only-offline-fake-secret-32-characters-long-TEST';
const gateway=createOriginalPdfGateway({env:{SATORI_PDF_RENDER_SECRET:secret}});
const order=makeOrder(45000),body={ts:Date.now(),nonce:crypto.randomBytes(16).toString('hex'),
  order,versionKey:canonicalPdfVersion(order)};
const signed={...body,signature:requestSignature(secret,body)};
const result=await gateway.process(signed);
assert.equal(result.ok,true);
assert.equal(result.invoiceNo,9001);
assert.ok(Buffer.from(result.pdfBase64,'base64').subarray(0,5).toString()==='%PDF-');
await assert.rejects(gateway.process(signed),/PDF_RENDER_REPLAYED/);
await assert.rejects(gateway.process({...signed,nonce:'a'.repeat(32)}),/PDF_RENDER_AUTH_FAILED/);
const altered={...signed,order:{...order,total:90000},nonce:'b'.repeat(32)};
await assert.rejects(gateway.process(altered),/PDF_RENDER_AUTH_FAILED/);
assert.equal(createOriginalPdfGateway({env:{}}).configured(),false);
console.log('PASS headless original pdfmake: 0đ + 45,000đ QR, HMAC, replay, SHA256, same template version');
