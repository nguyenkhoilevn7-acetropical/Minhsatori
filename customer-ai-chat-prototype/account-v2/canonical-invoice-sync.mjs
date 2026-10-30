/**
 * A single canonical order and a single WEBSITE-GENERATED PDF per exact
 * invoice version across Gemini V2, owner website, and Android.
 *
 * Pure contract. This module intentionally neither authors invoices nor
 * builds PDFs: they must first exist on the signed Apps Script ledger and
 * the private, owner-approved Drive PDF archive.
 */
const fail=code=>{const e=new Error(code);e.code=code;throw e};
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{10,128}$/.test(v);
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const pdfId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{15,200}$/.test(v);
const isInvoiceNo=v=>Number.isSafeInteger(v)&&v>0;
const isLedgerId=v=>(typeof v==='string'&&v.length>0&&v.length<=80)||
 (Number.isSafeInteger(v)&&v>0);
/** No three generated PDFs, no inferred link from invoiceNo, no name matching. */
export function assertSameCanonicalInvoice(invoice,pdf){
 if(!invoice||typeof invoice!=='object'||invoice.state!=='COMMITTED'||
   !isInvoiceNo(invoice.invoiceNo)||!isLedgerId(invoice.ledgerId)||
   !id(invoice.requestId))fail('CANONICAL_INVOICE_NOT_COMMITTED');
 if(!pdf||pdf.source!=='original-website-pdfmake-drive'||
   !isInvoiceNo(pdf.invoiceNo)||!isLedgerId(pdf.ledgerId)||
   pdf.invoiceNo!==invoice.invoiceNo||String(pdf.ledgerId)!==String(invoice.ledgerId)||
   !pdfId(pdf.driveFileId)||!digest(pdf.sha256)||
   typeof pdf.versionKey!=='string'||pdf.versionKey.length<15||pdf.versionKey.length>500000)
  fail('ORIGINAL_PDF_MISMATCH');
 return Object.freeze({
  invoiceNo:invoice.invoiceNo,ledgerId:String(invoice.ledgerId),
  requestId:invoice.requestId,
  document:{source:'original-website-pdfmake-drive',
   driveFileId:pdf.driveFileId,sha256:pdf.sha256,versionKey:pdf.versionKey}
 });
}
/** A safe user-facing status: never invent a fileId or URL before Drive readback. */
export function canonicalInvoiceDocumentStatus(order){
 const committed=order?.state==='COMMITTED'&&isInvoiceNo(order.invoiceNo);
 return Object.freeze({source:'original-website-pdfmake-drive',
  status:committed?'AWAITING_VERIFIED_DRIVE_PDF':'AWAITING_CANONICAL_INVOICE',
  shareable:false});
}
export function assertSharedPdfMetadataForAllClients(committed,archive){
 const ref=assertSameCanonicalInvoice(committed,archive);
 return Object.freeze({
  gemini:ref.document,website:ref.document,android:ref.document
 });
}

/**
 * Reuse V1's ledger-backed receipt identity, never its ephemeral demo PDF.
 * These fields come only from an account-scoped V2 journal row committed after
 * exact signed Bot API readback. No file link may be created from invoice number.
 */
export function canonicalReceiptForAccountOrder(order){
 if(!order||order.state!=='COMMITTED'||!isInvoiceNo(Number(order.invoiceNo))||
   !id(order.requestId)||order.currency!=='VND')return null;
 const amount=Number(order.totalVnd);
 if(!Number.isSafeInteger(amount)||amount<0||amount>100_000_000_000)return null;
 return Object.freeze({
  invoiceNo:Number(order.invoiceNo),requestId:order.requestId,
  currency:'VND',totalVnd:amount,
  pdf:canonicalInvoiceDocumentStatus(order)
 });
}
