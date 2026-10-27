/**
 * One immutable canonical PDF byte stream, consumed by web, Android and Gemini.
 * Sandbox-only: the default reader is deliberately disabled. An authenticated,
 * authorized provider must be injected after real-source readback approval.
 */
import {createHash} from 'node:crypto';
import {DomainError,isUuid} from './domain.mjs';
import {resolveSandboxPdf,disabledDriveReader} from './canonical-adapters.mjs';

const check=(ok,code)=>{if(!ok)throw new DomainError(code)};
export const SHARED_SANDBOX_PDF_PATH='/api/v2/sandbox-invoice-document';

export async function readSharedSandboxPdf(pool,actor,invoiceId,reader=disabledDriveReader){
 check(isUuid(invoiceId),'INVOICE_ID_INVALID');
 // The underlying resolver checks account ownership before and after remote IO,
 // and also protects against signed receipt revision/file-ID/hash races.
 const verified=await resolveSandboxPdf(pool,actor,{invoiceId},reader);
 check(verified.testOnly===true&&Buffer.isBuffer(verified.bytes)&&
  verified.mimeType==='application/pdf','PDF_CONTENT_INVALID');
 check(/^[a-f0-9]{64}$/.test(verified.sha256),'PDF_HASH_MISMATCH');
 const bytes=Buffer.from(verified.bytes);
 check(createHash('sha256').update(bytes).digest('hex')===verified.sha256,
  'PDF_HASH_MISMATCH');
 return {
  invoiceId,bytes,mimeType:'application/pdf',sha256:verified.sha256,
  revision:verified.revision,testOnly:true
 };
}

export function sendSharedPdf(res,document){
 check(document&&isUuid(document.invoiceId)&&document.testOnly===true,
  'PDF_DOCUMENT_INVALID');
 check(Buffer.isBuffer(document.bytes)&&document.bytes.length>5&&
  document.bytes.length<=10*1024*1024&&
  document.bytes.subarray(0,5).toString()==='%PDF-','PDF_CONTENT_INVALID');
 check(/^[a-f0-9]{64}$/.test(document.sha256)&&
  createHash('sha256').update(document.bytes).digest('hex')===document.sha256,
  'PDF_HASH_MISMATCH');
 const filename='MinhSatori-'+document.invoiceId+'.pdf';
 res.writeHead(200,{
  'content-type':'application/pdf',
  'content-disposition':'inline; filename="'+filename+'"',
  'content-length':String(document.bytes.length),
  'x-content-sha256':document.sha256,
  'etag':'"sha256-'+document.sha256+'"',
  'cache-control':'private, no-store, max-age=0',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'x-frame-options':'DENY'
 });
 res.end(document.bytes);
}
