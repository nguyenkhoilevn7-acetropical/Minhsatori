/**
 * Owner-owned schedule: archive the SAME pdfmake document as the website
 * without any browser session. An Apps Script time trigger invokes a private
 * HMAC-protected Render renderer, then verifies bytes and current Drive order
 * via SatoriInvoicePdfArchive.archive().
 *
 * Do not put the HMAC secret in GitHub, chat, logs or PDF file metadata.
 * One-time private Script Property: SATORI_PDF_RENDER_SECRET.
 * Mirror that exact secret in Render's Environment only.
 */
var SatoriPdfHeadless=(function(){
'use strict';
var ENDPOINT='https://minh-satori-customer-ai-gemini.onrender.com/api/internal/original-pdf';
var VERSION='SATORI_PDF_VIETQR_20261021';
function digest(bytes){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes)
  .map(function(b){return ('0'+(b&255).toString(16)).slice(-2)}).join('')}
function sign(s,msg){return Utilities.computeHmacSha256Signature(msg,s,Utilities.Charset.UTF_8)
  .map(function(b){return ('0'+(b&255).toString(16)).slice(-2)}).join('')}
function ready(){
  var secret=PropertiesService.getScriptProperties().getProperty('SATORI_PDF_RENDER_SECRET');
  if(!secret||secret.length<32)throw Error('PDF_RENDER_SECRET_MISSING');
  if(typeof SatoriInvoicePdfArchive==='undefined'||
     typeof SatoriInvoicePdfArchive.pending!=='function')
     throw Error('PDF_ARCHIVE_MODULE_MISSING');
  return secret;
}
function preflight(){
  requireOwner_();
  ready();
  var s=readState_(),pending=SatoriInvoicePdfArchive.pending(s,{limit:2});
  var triggers=ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction()==='satoriPdfHeadlessTick';
  });
  return {ok:true,revision:s.revision,pending:pending.jobs.length,
    triggerCount:triggers.length,configured:true};
}
function install(){
  var status=preflight();if(status.triggerCount>0)
    return {ok:true,alreadyInstalled:true,triggerCount:status.triggerCount};
  ScriptApp.newTrigger('satoriPdfHeadlessTick').timeBased().everyMinutes(1).create();
  return {ok:true,installed:true,intervalMinutes:1};
}
function tick(){
  requireOwner_();
  var secret=ready(),lock=CacheService.getScriptCache();
  if(lock.get('satori-pdf-headless-running')==='1')return {ok:true,busy:true};
  lock.put('satori-pdf-headless-running','1',110);
  var attempted=0,archived=0,skipped=0;
  try{
    var s=readState_(),jobs=SatoriInvoicePdfArchive.pending(s,{limit:2}).jobs;
    for(var i=0;i<jobs.length;i++){
      var job=jobs[i],o=job.order,versionKey=job.versionKey;
      attempted++;
      try{
        if(versionKey.indexOf('\n'+VERSION)<0)throw Error('PDF_VERSION_INVALID');
        var ts=Date.now(),nonce=Utilities.getUuid().replace(/-/g,'');
        var canonical=[ts,nonce,versionKey,digest(Utilities.newBlob(JSON.stringify(o)).getBytes())].join('\n');
        var request={ts:ts,nonce:nonce,order:o,versionKey:versionKey,
          signature:sign(secret,canonical)};
        var response=UrlFetchApp.fetch(ENDPOINT,{
          method:'post',contentType:'application/json',payload:JSON.stringify(request),
          muteHttpExceptions:true,followRedirects:false
        });
        if(response.getResponseCode()!==200)throw Error('PDF_RENDER_HTTP');
        var answer=JSON.parse(response.getContentText());
        if(!answer.ok||answer.versionKey!==versionKey||
           Number(answer.invoiceNo)!==Number(o.invoiceNo)||
           !/^[a-f0-9]{64}$/.test(answer.pdfSha256||'')||
           typeof answer.pdfBase64!=='string'||answer.pdfBase64.length>4200000)
          throw Error('PDF_RENDER_INVALID_ACK');
        var bytes=Utilities.base64Decode(answer.pdfBase64);
        if(bytes.length<100||bytes.length>3*1024*1024||
           bytes.slice(0,5).map(function(b){return String.fromCharCode(b&255)}).join('')!=='%PDF-'||
           digest(bytes)!==answer.pdfSha256)throw Error('PDF_HASH_MISMATCH');
        // archive rechecks CURRENT Drive state/version under the script lock and
        // never mutates the ledger. It deduplicates by invoice/version filename.
        var saved=SatoriInvoicePdfArchive.archive({id:String(o.id),invoiceNo:Number(o.invoiceNo),
          total:Number(o.total),versionKey:versionKey,pdfSha256:answer.pdfSha256,
          pdfBase64:answer.pdfBase64});
        if(saved&&saved.fileId)archived++;
      }catch(e){
        // Fixed error class only, never log customer name, address, secret,
        // request/response body or PDF bytes.
        var safe=['PDF_VERSION_INVALID','PDF_RENDER_HTTP','PDF_RENDER_INVALID_ACK',
          'PDF_HASH_MISMATCH'].indexOf(e.message)>=0?e.message:'PDF_ARCHIVE_RETRY';
        console.warn('PDF_HEADLESS_JOB_NOT_ARCHIVED',safe);
        skipped++;
      }
    }
    return {ok:true,attempted:attempted,archived:archived,notArchived:skipped,
      revision:s.revision};
  }finally{lock.remove('satori-pdf-headless-running')}
}
return {preflight:preflight,install:install,tick:tick};
})();
function satoriPdfHeadlessPreflight(){return SatoriPdfHeadless.preflight()}
function satoriPdfHeadlessInstall(){return SatoriPdfHeadless.install()}
function satoriPdfHeadlessTick(){return SatoriPdfHeadless.tick()}
