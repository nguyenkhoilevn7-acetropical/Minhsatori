/** Names of outbound PDFs only; never changes ledger IDs, hashes, or PDF bytes. */
export function invoicePdfFilename({invoiceNo,recipientName,date}) {
 const n=Number(invoiceNo);
 if(!Number.isSafeInteger(n)||n<1)throw Error('PDF_FILENAME_NUMBER_REQUIRED');
 const recipient=String(recipientName??'').normalize('NFC')
  .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g,' ')
  .replace(/\s+/g,' ').trim().slice(0,80);
 if(!recipient||recipient==='.'||recipient==='..')throw Error('PDF_FILENAME_RECIPIENT_REQUIRED');
 const raw=String(date??'').trim();
 const vi=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
 const iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
 if(!vi&&!iso)throw Error('PDF_FILENAME_ORDER_DATE_REQUIRED');
 const y=Number(vi?vi[3]:iso[1]),m=Number(vi?vi[2]:iso[2]),d=Number(vi?vi[1]:iso[3]);
 const dt=new Date(Date.UTC(y,m-1,d));
 if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)
  throw Error('PDF_FILENAME_ORDER_DATE_REQUIRED');
 return n+' - '+recipient+' - '+String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')+'.pdf';
}
export function invoicePdfDisposition(disposition,data) {
 if(!['inline','attachment'].includes(disposition))throw Error('PDF_DISPOSITION_INVALID');
 const filename=invoicePdfFilename(data);
 const ascii=filename.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/đ/g,'d').replace(/Đ/g,'D').replace(/[^\x20-\x7e]/g,'_').replace(/["\\]/g,'_');
 return disposition+'; filename="'+ascii+'"; filename*=UTF-8'+String.fromCharCode(39,39)+encodeURIComponent(filename);
}
