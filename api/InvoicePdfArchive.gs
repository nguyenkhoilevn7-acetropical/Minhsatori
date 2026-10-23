/**
 * Owner-only Google Apps Script archive endpoint.
 * Add as a NEW .gs file to the existing authenticated Minh Satori Drive Sync project.
 * Configure SATORI_PDF_ARCHIVE_FOLDER_ID in Script Properties; never expose it publicly.
 * DO NOT modify STATE_FILE_ID or install a new doPost/doGet here.
 */
var SatoriInvoicePdfArchive=(function(){
  'use strict';
  var suffix='SATORI_PDF_VIETQR_20261021';
  function fail(message){throw Error(message);}
  function canonical(o){
    return JSON.stringify([o.invoiceNo,o.date,o.name,o.phone,o.location,o.deliveryNote,
      o.taxCode,o.status,o.items,o.product,o.qty,o.listPrice,o.unitPrice,
      o.vat,o.vatAmount,o.shippingAmount])+'\n'+suffix;
  }
  function digest(bytes){
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes)
      .map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');
  }
  function archive(p){
    requireOwner_();
    if(!p||typeof p!=='object')fail('Thiếu nội dung PDF.');
    var no=Number(p.invoiceNo),total=Number(p.total);
    if(!Number.isSafeInteger(no)||no<1||!Number.isSafeInteger(total)||total<0||
       typeof p.id!=='string'||p.id.length>80)fail('Thông tin hóa đơn không hợp lệ.');
    if(typeof p.versionKey!=='string'||p.versionKey.length>500000||
       typeof p.pdfSha256!=='string'||!/^[a-f0-9]{64}$/.test(p.pdfSha256)||
       typeof p.pdfBase64!=='string'||p.pdfBase64.length<100||p.pdfBase64.length>4200000)
       fail('Tệp PDF hoặc xác thực nội dung không hợp lệ.');
    var state=readState_();
    var list=JSON.parse(state.values.satori_orders_v15||'[]');
    var matches=list.filter(function(o){return Number(o.invoiceNo)===no&&String(o.id)===p.id;});
    if(matches.length!==1)fail('Không tìm thấy đúng hóa đơn trên Google Drive.');
    var o=matches[0];
    if(Number(o.total)!==total||canonical(o)!==p.versionKey)
       fail('Hóa đơn đã thay đổi trên Drive. Cần tạo lại PDF mới nhất.');
    var bytes=Utilities.base64Decode(p.pdfBase64);
    if(bytes.length<100||bytes.length>3*1024*1024||
       bytes.slice(0,5).map(function(x){return String.fromCharCode(x&255);}).join('')!=='%PDF-')
       fail('Dữ liệu không phải PDF hợp lệ.');
    if(digest(bytes)!==p.pdfSha256)fail('Kiểm tra SHA-256 PDF thất bại.');
    var props=PropertiesService.getScriptProperties();
    var folderId=props.getProperty('SATORI_PDF_ARCHIVE_FOLDER_ID');
    if(!folderId)fail('Chưa cấu hình thư mục PDF trên Google Drive.');
    var lock=LockService.getScriptLock();lock.waitLock(30000);
    try{
      // Guard a concurrent edit between the initial check and creating the file.
      var latest=readState_(),live=JSON.parse(latest.values.satori_orders_v15||'[]');
      var exact=live.filter(function(row){return Number(row.invoiceNo)===no&&String(row.id)===p.id;});
      if(exact.length!==1||canonical(exact[0])!==p.versionKey)fail('Hóa đơn vừa thay đổi; không lưu phiên bản lỗi thời.');
      var folder=DriveApp.getFolderById(folderId);
      var version=digest(Utilities.newBlob(p.versionKey).getBytes()).slice(0,16);
      var name='MinhSatori_HD'+no+'_v'+version+'.pdf';
      var existing=folder.getFilesByName(name);
      if(existing.hasNext()){
        var file=existing.next();
        return {fileId:file.getId(),invoiceNo:no,versionKey:p.versionKey,duplicate:true};
      }
      var saved=folder.createFile(Utilities.newBlob(bytes,'application/pdf',name));
      saved.setDescription(JSON.stringify({source:'Minh Satori website pdfmake',
        invoiceNo:no,total:total,version:version,createdAt:new Date().toISOString()}));
      if(saved.getSize()!==bytes.length)fail('Drive chưa xác minh đúng kích thước PDF.');
      return {fileId:saved.getId(),invoiceNo:no,versionKey:p.versionKey,duplicate:false};
    } finally {lock.releaseLock();}
  }
function pending(s,p){
    if(!s||!s.values||typeof s.values.satori_orders_v15!=='string')
      fail('Chưa có dữ liệu hóa đơn đồng bộ');
    var folderId=PropertiesService.getScriptProperties().getProperty('SATORI_PDF_ARCHIVE_FOLDER_ID');
    if(!folderId)fail('Chưa cấu hình thư mục lưu PDF');
    var folder=DriveApp.getFolderById(folderId);
    var list=JSON.parse(s.values.satori_orders_v15||'[]');
    if(!Array.isArray(list))fail('Dữ liệu hóa đơn không hợp lệ');
    var cutoff=Date.now()-7*86400000,limit=Math.min(4,Math.max(1,Number(p&&p.limit)||4));
    var found=[];
    // This HMAC-authenticated endpoint returns only a bounded number of fresh
    // Bot-created orders, not all customer records or deleted invoices.
    var eligible=list.filter(function(o){
      return o&&typeof o.apiRequestId==='string'&&o.apiRequestId.length>=8&&
        Number.isSafeInteger(Number(o.id))&&Number(o.id)>=cutoff&&
        Number.isSafeInteger(Number(o.invoiceNo))&&Number(o.invoiceNo)>0&&
        Number.isSafeInteger(Number(o.total))&&Number(o.total)>=0&&
        Array.isArray(o.items)&&o.items.length>0;
    }).sort(function(a,b){return Number(b.invoiceNo)-Number(a.invoiceNo);}).slice(0,40);
    for(var i=0;i<eligible.length&&found.length<limit;i++){
      var o=eligible[i],key=canonical(o);
      var hash=digest(Utilities.newBlob(key).getBytes()).slice(0,16);
      var name='MinhSatori_HD'+o.invoiceNo+'_v'+hash+'.pdf';
      if(folder.getFilesByName(name).hasNext())continue;
      // Copy only the canonical PDF fields. Never expose internal commission,
      // unrelated customers, user tokens, HMAC keys or ledger backup content.
      var fields=['id','invoiceNo','date','name','phone','location','deliveryNote',
        'taxCode','status','items','product','qty','listPrice','unitPrice',
        'vat','vatAmount','shippingAmount','total'];
      var order={};fields.forEach(function(k){if(o[k]!==undefined)order[k]=o[k]});
      found.push({order:order,versionKey:key});
    }
    return {revision:s.revision,jobs:found,limit:limit};
  }
  return {archive:archive,pending:pending};

})();
/**
 * Read-only owner preflight. Run from the Apps Script editor before redeploying.
 * No invoice or Drive document is created, altered or deleted by this check.
 */
function satoriPdfArchivePreflight(){
  requireOwner_();
  var p=PropertiesService.getScriptProperties();
  var folderId=p.getProperty('SATORI_PDF_ARCHIVE_FOLDER_ID');
  if(!folderId)throw Error('Thiếu SATORI_PDF_ARCHIVE_FOLDER_ID trong Script Properties.');
  var state=readState_();
  if(!state||!state.values||typeof state.values.satori_orders_v15!=='string')
    throw Error('Không đọc được cấu trúc hóa đơn hiện tại.');
  var list=JSON.parse(state.values.satori_orders_v15);
  if(!Array.isArray(list))throw Error('Danh sách hóa đơn trên Drive không hợp lệ.');
  var folder=DriveApp.getFolderById(folderId);
  return {ok:true,revision:state.revision,orders:list.length,
    folderName:folder.getName(),archiveConfigured:true,ordersModified:false};
}
function satoriSaveInvoicePdf(p){return SatoriInvoicePdfArchive.archive(p);}
/** Call this INSIDE the existing doGet HTML script after const f=... has been declared. */
function satoriPdfArchiveBridgeJs_(appOrigin){
  var channel='minhsatori-pdf-archive-v1',allowed=JSON.stringify(appOrigin);
  return 'window.addEventListener("message",function(e){'+
    'if(e.origin!=='+allowed+'||e.source!==f.contentWindow||!e.data||e.data.channel!=='+JSON.stringify(channel)+')return;'+
    'var m=e.data;if(m.type==="hello"){f.contentWindow.postMessage({channel:'+JSON.stringify(channel)+',type:"capabilities",enabled:true},'+allowed+');return;}'+
    'if(m.type!=="put")return;'+
    'var ok=function(x){f.contentWindow.postMessage({channel:'+JSON.stringify(channel)+',type:"stored",fileId:x.fileId,invoiceNo:x.invoiceNo,versionKey:x.versionKey},'+allowed+');};'+
    'var error=function(x){f.contentWindow.postMessage({channel:'+JSON.stringify(channel)+',type:"error",error:String(x.message||x)},'+allowed+');};'+
    'google.script.run.withSuccessHandler(ok).withFailureHandler(error).satoriSaveInvoicePdf(m.payload);});';
}
