import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readArchivedInvoicePdf,originalPdfReadConfigured} from '../pdf-authenticated-read.mjs';

const env={SATORI_PDF_READ_ENDPOINT:'https://script.google.com/macros/s/fake/exec',
 SATORI_PDF_READ_KEY_ID:'pdf-reader',SATORI_PDF_READ_HMAC_SECRET:'x'.repeat(40)};
const order={invoiceNo:5955,ledgerId:'canonical_5955',expectedTotal:1512000};
const pdf=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(120,66)]);
const digest=crypto.createHash('sha256').update(pdf).digest('hex');
function response({wrongInvoice=false,wrongDigest=false,upstreamError=false}={}){
 return {
  ok:true,headers:{get:()=>null},
  text:async()=>JSON.stringify(upstreamError?{ok:false,error:{code:'PDF_NOT_READY'}}:{
   ok:true,action:'pdf.get',data:{invoiceNo:wrongInvoice?1:5955,
    id:order.ledgerId,total:order.expectedTotal,sha256:wrongDigest?'f'.repeat(64):digest,
    versionHash:'a'.repeat(16),pdfBase64:pdf.toString('base64')}
  })
 };
}
test('PDF bridge disabled without a separate least-privilege credential',async()=>{
 assert.equal(originalPdfReadConfigured({}),false);
 await assert.rejects(readArchivedInvoicePdf(order,{env:{}}),/PDF_READ_DISABLED/);
});
test('signed PDF request uses exact canonical id, number and amount',async()=>{
 let request;
 const x=await readArchivedInvoicePdf(order,{env,now:()=>1793500000000,
  nonce:()=> '0123456789abcdef0123456789abcdef',
  fetcher:async(url,params)=>{request=JSON.parse(params.body);return response()}
 });
 assert.equal(request.action,'pdf.get');
 assert.deepEqual(request.payload,{invoiceNo:5955,id:order.ledgerId,expectedTotal:1512000});
 const secret=env.SATORI_PDF_READ_HMAC_SECRET;
 const expected=crypto.createHmac('sha256',secret)
  .update([env.SATORI_PDF_READ_KEY_ID,request.timestamp,request.nonce,
   request.action,JSON.stringify(request.payload)].join('\n')).digest('hex');
 assert.equal(request.signature,expected);
 assert.equal(x.bytes.toString('hex'),pdf.toString('hex'));
 assert.equal(x.sha256,digest);
});
test('forged archive invoice, digest, missing file and wrong caller input rejected',async()=>{
 for(const option of [{wrongInvoice:true},{wrongDigest:true}]){
  await assert.rejects(readArchivedInvoicePdf(order,{env,fetcher:async()=>response(option)}),
   /PDF_ARCHIVE_VERIFICATION_FAILED/);
 }
 await assert.rejects(readArchivedInvoicePdf(order,{env,fetcher:async()=>response({upstreamError:true})}),
  /PDF_NOT_READY/);
 await assert.rejects(readArchivedInvoicePdf({...order,ledgerId:'../secret'},{env}),/PDF_INVOICE_ID_INVALID/);
});
test('account V2 route requires confirmed ownership before sending private PDF bytes',async()=>{
 const {readFileSync}=await import('node:fs');
 const src=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const route=src.split('const pdfMatch=')[1].split("if(pathname==='/api/v2/orders'",1)[0];
 assert.match(route,/r\.account_id=\$2 AND q\.account_id=\$2/);
 assert.match(route,/r\.state='COMMITTED'/);
 assert.match(route,/ledger_invoice_total/);
 assert.match(route,/readArchivedInvoicePdf/);
 assert.match(route,/cache-control':'private, no-store/);
 assert.doesNotMatch(route,/drive\.google\.com|orders\.create|payments\.mark/);
});
