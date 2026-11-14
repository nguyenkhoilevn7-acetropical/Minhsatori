/**
 * Server-side only, read-only bridge to the ORIGINAL PDF archived by Apps Script.
 * The caller must first verify the authenticated V2 account owns the COMMITTED
 * canonical invoice. No public Drive links and no PDF regeneration.
 */
import crypto from 'node:crypto';
const idRe=/^[A-Za-z0-9_-]{1,80}$/;
const endpointRe=/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=code=>{const err=new Error(code);err.code=code;throw err};
export function originalPdfReadConfigured(env=process.env){
 return endpointRe.test(String(env.SATORI_PDF_READ_ENDPOINT||'')) &&
   /^[A-Za-z0-9_-]{3,64}$/.test(String(env.SATORI_PDF_READ_KEY_ID||'')) &&
   String(env.SATORI_PDF_READ_HMAC_SECRET||'').length>=32;
}
/** PDF actions use their OWN least-privilege HMAC key, not the Bot writer key. */
export async function readArchivedInvoicePdf({invoiceNo,ledgerId,expectedTotal},{
 env=process.env,fetcher=fetch,now=Date.now,nonce=()=>crypto.randomBytes(18).toString('hex')
}={}){
 if(!Number.isSafeInteger(invoiceNo)||invoiceNo<1||!idRe.test(String(ledgerId))||
   !Number.isSafeInteger(expectedTotal)||expectedTotal<0||expectedTotal>100_000_000_000)
  fail('PDF_INVOICE_ID_INVALID');
 if(!originalPdfReadConfigured(env))fail('PDF_READ_DISABLED');
 const keyId=env.SATORI_PDF_READ_KEY_ID,action='pdf.get';
 const payload={invoiceNo,id:String(ledgerId),expectedTotal};
 const timestamp=now(),n=nonce();
 const signature=crypto.createHmac('sha256',env.SATORI_PDF_READ_HMAC_SECRET)
   .update([keyId,timestamp,n,action,JSON.stringify(payload)].join('\n'),'utf8')
   .digest('hex');
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);
 let result;
 try{
  result=await fetcher(env.SATORI_PDF_READ_ENDPOINT,{
   method:'POST',signal:controller.signal,
   headers:{'content-type':'application/json'},
   body:JSON.stringify({keyId,timestamp,nonce:n,action,payload,signature}),
   redirect:'follow'
  });
  if(!result.ok)fail('PDF_ARCHIVE_UPSTREAM_UNAVAILABLE');
  // A PDF is bounded to 3 MiB. Reject overlarge JSON without buffering it all.
  const length=Number(result.headers?.get?.('content-length')||0);
  if(length>4_300_000)fail('PDF_ARCHIVE_TOO_LARGE');
  const raw=await result.text();
  if(raw.length>4_300_000)fail('PDF_ARCHIVE_TOO_LARGE');
  let reply;
  try{reply=JSON.parse(raw)}catch{fail('PDF_ARCHIVE_INVALID_RESPONSE')}
  if(!reply?.ok){
   if(['PDF_NOT_READY','PDF_ARCHIVE_MISSING','PDF_VERSION_STALE'].includes(reply?.error?.code))
    fail('PDF_NOT_READY');
   fail('PDF_ARCHIVE_UPSTREAM_UNAVAILABLE');
  }
  const data=reply.data;
  if(reply.action!==action||!data||data.invoiceNo!==invoiceNo||
     String(data.id)!==String(ledgerId)||data.total!==expectedTotal||
     !/^[a-f0-9]{64}$/.test(data.sha256||'')||
     !/^[a-f0-9]{16}$/.test(data.versionHash||'')||
     typeof data.pdfBase64!=='string'||data.pdfBase64.length>4_200_000||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(data.pdfBase64))
   fail('PDF_ARCHIVE_VERIFICATION_FAILED');
  const bytes=Buffer.from(data.pdfBase64,'base64');
  if(bytes.length<100||bytes.length>3*1024*1024||
     bytes.subarray(0,5).toString('ascii')!=='%PDF-'||
     sha(bytes)!==data.sha256)fail('PDF_ARCHIVE_VERIFICATION_FAILED');
  return {bytes,sha256:data.sha256,invoiceNo,versionHash:data.versionHash};
 }finally{clearTimeout(timeout)}
}
