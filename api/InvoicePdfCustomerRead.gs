/**
 * Additive, read-only module for the ORIGINAL PDF in the private Drive archive.
 * Must be installed in the EXISTING owner Apps Script project with the BotApi
 * action below; NEVER create a second doPost or a public Drive permission.
 */
var SatoriCustomerPdfRead=(function(){
 'use strict';
 var template='SATORI_PDF_VIETQR_20261021';
 function deny(code){var e=new Error(code);e.code=code;throw e;}
 function digest(bytes){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes)
   .map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');}
 function originalVersion(o){
  return JSON.stringify([o.invoiceNo,o.date,o.name,o.phone,o.location,o.deliveryNote,
   o.taxCode,o.status,o.items,o.product,o.qty,o.listPrice,o.unitPrice,o.vat,
   o.vatAmount,o.shippingAmount])+'\n'+template;
 }
 function read(state,p){
  // BotApi has already authenticated the isolated pdf:read HMAC credential.
  if(!p||!Number.isSafeInteger(p.invoiceNo)||p.invoiceNo<=0||
    !/^[A-Za-z0-9_-]{1,80}$/.test(String(p.id||''))||
    !Number.isSafeInteger(p.expectedTotal)||p.expectedTotal<0)
    deny('PDF_BAD_REQUEST');
  var orders=JSON.parse(state.values.satori_orders_v15||'[]');
  if(!Array.isArray(orders))deny('PDF_INVALID_LEDGER');
  var found=orders.filter(function(o){
   return Number(o.invoiceNo)===p.invoiceNo&&String(o.id)===String(p.id);
  });
  if(found.length!==1||Number(found[0].total)!==p.expectedTotal)
   deny('PDF_NOT_READY');
  var order=found[0];
  if(order.status==='Đã hủy'||order.status==='Không Tính')deny('PDF_NOT_READY');
  var folderId=PropertiesService.getScriptProperties().getProperty('SATORI_PDF_ARCHIVE_FOLDER_ID');
  if(!folderId)deny('PDF_ARCHIVE_MISSING');
  var version=originalVersion(order);
  var versionHash=digest(Utilities.newBlob(version).getBytes()).slice(0,16);
  var name='MinhSatori_HD'+p.invoiceNo+'_v'+versionHash+'.pdf';
  var files=DriveApp.getFolderById(folderId).getFilesByName(name);
  if(!files.hasNext())deny('PDF_NOT_READY');
  var file=files.next();
  if(files.hasNext()||file.getMimeType()!=='application/pdf'||
    file.getSize()<100||file.getSize()>3*1024*1024)deny('PDF_ARCHIVE_MISSING');
  var bytes=file.getBlob().getBytes();
  if(bytes.length<100||bytes.length>3*1024*1024||
    bytes.slice(0,5).map(function(x){return String.fromCharCode(x&255);}).join('')!=='%PDF-')
    deny('PDF_ARCHIVE_MISSING');
  // A concurrent invoice edit must not release a now-stale document.
  var latest=JSON.parse(readState_().values.satori_orders_v15||'[]');
  var same=latest.filter(function(o){
   return Number(o.invoiceNo)===p.invoiceNo&&String(o.id)===String(p.id);
  });
  if(same.length!==1||originalVersion(same[0])!==version)deny('PDF_VERSION_STALE');
  return {invoiceNo:p.invoiceNo,id:String(p.id),total:p.expectedTotal,
   versionHash:versionHash,sha256:digest(bytes),pdfBase64:Utilities.base64Encode(bytes)};
 }
 return {read:read};
})();
