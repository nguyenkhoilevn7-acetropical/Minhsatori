/**
 * OWNER-ONLY PDF rendering gateway. No order edits, no Google Drive credentials
 * and no Gemini API calls. Return PDF bytes to the signed Apps Script scheduler.
 * The owner scheduler verifies the PDF again and archives through DriveApp.
 */
import crypto from 'node:crypto';
import {renderOriginalWebsitePdf,canonicalPdfVersion} from './original-website-pdf.mjs';

const allowedNonce=/^[a-f0-9]{32,64}$/;
const secureCompare=(a,b)=>typeof a==='string'&&typeof b==='string'&&
  a.length===64&&b.length===64&&
  crypto.timingSafeEqual(Buffer.from(a,'utf8'),Buffer.from(b,'utf8'));
function hash(s){return crypto.createHash('sha256').update(s,'utf8').digest('hex')}
export function requestSignature(secret,body){
 const {ts,nonce,order,versionKey}=body;
 return crypto.createHmac('sha256',secret)
   .update([ts,nonce,versionKey,hash(JSON.stringify(order))].join('\n'),'utf8')
   .digest('hex');
}
export function createOriginalPdfGateway({env=process.env,now=Date.now,render=renderOriginalWebsitePdf}={}){
 const seen=new Map();
 const configured=()=>typeof env.SATORI_PDF_RENDER_SECRET==='string'&&
   env.SATORI_PDF_RENDER_SECRET.length>=32;
 async function process(body){
   if(!configured())throw Error('PDF_RENDER_DISABLED');
   if(!body||typeof body!=='object'||Array.isArray(body)||
      !Number.isSafeInteger(body.ts)||Math.abs(now()-body.ts)>120000||
      !allowedNonce.test(body.nonce||'')||
      typeof body.versionKey!=='string'||body.versionKey.length>500000||
      !body.order||typeof body.order!=='object'||Array.isArray(body.order))
     throw Error('PDF_RENDER_BAD_REQUEST');
   const secret=env.SATORI_PDF_RENDER_SECRET;
   const expected=requestSignature(secret,body);
   if(!secureCompare(expected,body.signature))throw Error('PDF_RENDER_AUTH_FAILED');
   const old=seen.get(body.nonce);
   if(old!==undefined&&now()-old<300000)throw Error('PDF_RENDER_REPLAYED');
   if(seen.size>256)for(const [nonce,when] of seen)
     if(now()-when>300000)seen.delete(nonce);
   if(seen.size>256)seen.clear(); // bounded runtime metadata, never customer data
   seen.set(body.nonce,now());
   if(canonicalPdfVersion(body.order)!==body.versionKey)
     throw Error('PDF_RENDER_VERSION_MISMATCH');
   const pdf=await render(body.order);
   if(pdf.versionKey!==body.versionKey||
      !Buffer.isBuffer(pdf.bytes)||pdf.bytes.length>3*1024*1024||
      !/^[a-f0-9]{64}$/.test(pdf.sha256))
     throw Error('PDF_RENDER_OUTPUT_INVALID');
   return {ok:true,invoiceNo:Number(body.order.invoiceNo),versionKey:pdf.versionKey,
     pdfSha256:pdf.sha256,pdfBase64:pdf.bytes.toString('base64')};
 }
 return Object.freeze({process,configured});
}
