/**
 * Owner-only PDF download: strictly read the exact signed ledger invoice.
 * This function MUST be called only after the V2 authenticated OWNER guard.
 * No invoice creation, modification, PDF archive write or public file URL.
 */
import {exactCurrentInvoiceFromOrdersList} from './local-invoice-read.mjs';
import {readMinhSatori} from '../satori-readonly.mjs';
import {renderCurrentV2Pdf} from './local-invoice-pdf.mjs';
import {invoicePdfFilename,invoicePdfDisposition} from './pdf-filename.mjs';

export function ownerPdfDownloadPath({invoiceNo,ledgerId}) {
 const n=Number(invoiceNo),id=String(ledgerId??'');
 if(!Number.isSafeInteger(n)||n<1||
    !/^[A-Za-z0-9_-]{1,80}$/.test(id))throw Error('OWNER_PDF_ID_INVALID');
 return '/api/v2/admin/invoices/'+n+'/'+id+'/pdf';
}

/**
 * Resolve a single canonical invoice by its number for the Owner PDF UI.
 * The signed ledger lookup is read-only; reject incomplete/ambiguous results.
 * Never derive an identity from recipient name, phone, or a chat attachment.
 */
export async function ownerPdfRefByNumber(invoiceNo,{reader=readMinhSatori}={}){
 const n=Number(invoiceNo);
 if(!Number.isSafeInteger(n)||n<1||n>999999999999)
  throw Error('OWNER_PDF_NUMBER_INVALID');
 const r=await reader('orders.list',{query:String(n),limit:100});
 if(!Number.isSafeInteger(r?.revision)||!r?.data||
    !Number.isSafeInteger(r.data.totalMatches)||
    r.data.totalMatches<1||r.data.totalMatches>100||
    !Array.isArray(r.data.orders)||r.data.orders.length!==r.data.totalMatches)
  throw Error('OWNER_PDF_LIST_INCOMPLETE');
 const exact=r.data.orders.filter(x=>Number(x?.invoiceNo)===n);
 if(exact.length!==1)throw Error('OWNER_PDF_AMBIGUOUS');
 const id=String(exact[0].id??'');
 if(!/^[A-Za-z0-9_-]{1,80}$/.test(id))throw Error('OWNER_PDF_ID_INVALID');
 return Object.freeze({invoiceNo:n,ledgerId:id});
}

export async function prepareOwnerPdfDownload(input,{
 read=exactCurrentInvoiceFromOrdersList,render=renderCurrentV2Pdf
}={}){
 const path=ownerPdfDownloadPath(input);
 const n=Number(input.invoiceNo),id=String(input.ledgerId);
 const found=await read({invoiceNo:n,ledgerId:id});
 const current=found?.current;
 if(!current||current.excluded||current.status==='Đã hủy'||
    current.status==='Không Tính'||
    Number(current.invoiceNo)!==n||String(current.id)!==id)
  throw Error('OWNER_PDF_CURRENT_INVOICE_REQUIRED');
 const source={invoiceNo:n,recipientName:current.delivery?.recipientName,date:current.date};
 const filename=invoicePdfFilename(source);
 const output=await render(current,{invoiceNo:n,ledgerId:id});
 if(!output||!Buffer.isBuffer(output.bytes)||output.bytes.length<100||
    output.bytes.length>3*1024*1024||
    output.bytes.subarray(0,5).toString('ascii')!=='%PDF-'||
    !/^[a-f0-9]{64}$/.test(output.sha256||''))
  throw Error('OWNER_PDF_RENDER_FAILED');
 return Object.freeze({path,filename,bytes:output.bytes,sha256:output.sha256,
  disposition:invoicePdfDisposition('attachment',source)});
}
