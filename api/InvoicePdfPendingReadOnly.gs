/**
 * Minh Satori PDF queue inspection — READ ONLY, mobile-friendly add-on.
 * Keep InvoicePdfArchive.gs unchanged. No doGet/doPost, no trigger, no writes.
 * Read-only preflight: checkSatoriPdfQueueOnly().
 */
var SatoriPdfQueueRead=(function(){
  'use strict';
  var TEMPLATE='SATORI_PDF_VIETQR_20261021';

  function canonical(o){
    return JSON.stringify([o.invoiceNo,o.date,o.name,o.phone,o.location,
      o.deliveryNote,o.taxCode,o.status,o.items,o.product,o.qty,
      o.listPrice,o.unitPrice,o.vat,o.vatAmount,o.shippingAmount])+
      '\n'+TEMPLATE;
  }
  function digest(bytes){
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes)
      .map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');
  }
  function pending(s,p){
    if(!s||!s.values||typeof s.values.satori_orders_v15!=='string')
      throw Error('PDF_QUEUE_LEDGER_MISSING');
    var folderId=PropertiesService.getScriptProperties()
      .getProperty('SATORI_PDF_ARCHIVE_FOLDER_ID');
    if(!folderId)throw Error('PDF_ARCHIVE_FOLDER_NOT_CONFIGURED');
    var folder=DriveApp.getFolderById(folderId);
    var orders=JSON.parse(s.values.satori_orders_v15);
    if(!Array.isArray(orders))throw Error('PDF_QUEUE_INVALID_LEDGER');

    // Default: new/updated invoices in the past seven days only.
    // Older invoices need an explicit separate, owner-approved backfill.
    var minDate=Date.now()-7*86400000;
    var includeOlder=!!(p&&p.includeOlder===true);
    var max=Math.min(4,Math.max(1,Number(p&&p.limit)||4));
    var eligible=orders.filter(function(o){
      if(!o||o.status==='Đã hủy'||o.status==='Không Tính')return false;
      var no=Number(o.invoiceNo),total=Number(o.total);
      var id=Number(o.id);
      if(!Number.isSafeInteger(no)||no<=0||
         !Number.isSafeInteger(total)||total<0||
         !Array.isArray(o.items)||o.items.length===0||
         !Number.isSafeInteger(id))return false;
      var changedAt=Date.parse(String(o.updatedAt||''));
      return includeOlder||id>=minDate||
        (Number.isFinite(changedAt)&&changedAt>=minDate);
    }).sort(function(a,b){return Number(b.invoiceNo)-Number(a.invoiceNo)});

    var jobs=[];
    for(var i=0;i<eligible.length&&jobs.length<max;i++){
      var o=eligible[i],versionKey=canonical(o);
      var hash=digest(Utilities.newBlob(versionKey).getBytes()).slice(0,16);
      var name='MinhSatori_HD'+o.invoiceNo+'_v'+hash+'.pdf';
      if(folder.getFilesByName(name).hasNext())continue;
      var fields=['id','invoiceNo','date','name','phone','location',
        'deliveryNote','taxCode','status','items','product','qty',
        'listPrice','unitPrice','vat','vatAmount','shippingAmount','total'];
      var safe={};fields.forEach(function(k){if(o[k]!==undefined)safe[k]=o[k]});
      jobs.push({order:safe,versionKey:versionKey});
    }
    return {revision:s.revision,jobs:jobs,limit:max};
  }
  return {pending:pending};
})();

function checkSatoriPdfQueueOnly(){
  var state=readState_();
  var queue=SatoriPdfQueueRead.pending(state,{limit:4});
  var result={revision:state.revision,pendingCount:queue.jobs.length,
    pendingInvoices:queue.jobs.map(function(job){return Number(job.order.invoiceNo)})};
  console.log(JSON.stringify(result));
  return result;
}
