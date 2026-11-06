/** Owner-only read of a separately reviewed PostgreSQL provenance export.
 * Does not write invoices, ledger revision, permissions, or financial data.
 * SATORI_V2_ORDER_ORIGINS_FILE_ID must identify a private owner-controlled
 * JSON export from account-v2/tools/export-order-origins.mjs. Never use a URL.
 */
var SatoriV2OrderOrigins=(function(){
'use strict';
function text(v,max){return typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max}
function select(document,orders){
 if(!document||document.schemaVersion!==1||
   document.source!=='satori-v2-postgresql-committed'||
   !Array.isArray(document.entries)||document.entries.length>50000||!Array.isArray(orders))return [];
 var generated=Date.parse(document.generatedAt);
 if(!Number.isFinite(generated)||generated>Date.now()+60000||Date.now()-generated>86400000)return [];
 var grouped=Object.create(null),ledger=Object.create(null);
 function key(id,no){return JSON.stringify([String(id),String(no)])}
 orders.forEach(function(o){if(o&&o.id!=null&&o.invoiceNo!=null){
  var k=key(o.id,o.invoiceNo);(ledger[k]||(ledger[k]=[])).push(o);
 }});
 document.entries.forEach(function(r){if(r&&r.ledgerInvoiceId!=null&&r.invoiceNo!=null){
  var k=key(r.ledgerInvoiceId,r.invoiceNo);(grouped[k]||(grouped[k]=[])).push(r);
 }});
 var result=[];
 Object.keys(grouped).forEach(function(k){
  var rows=grouped[k],bills=ledger[k];
  if(rows.length!==1||!bills||bills.length!==1)return;
  var r=rows[0],bill=bills[0];
  if(!text(r.ledgerInvoiceId,100)||!text(r.invoiceNo,24)||!text(r.accountId,100)||
   !text(r.accountName,150)||['retail','agency','collaborator'].indexOf(r.accountRole)<0||
   !text(r.requestId,100)||bill.apiRequestId!==r.requestId)return;
  result.push({ledgerInvoiceId:r.ledgerInvoiceId,invoiceNo:r.invoiceNo,
   accountId:r.accountId,accountName:r.accountName,accountRole:r.accountRole});
 });
 return result;
}
function read(state){
 try{
  var id=String(PropertiesService.getScriptProperties().getProperty('SATORI_V2_ORDER_ORIGINS_FILE_ID')||'');
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(id))return [];
  var file=DriveApp.getFileById(id);
  if(file.getOwner().getEmail().toLowerCase()!==String(OWNER_EMAIL).toLowerCase()||
   file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getSize()>2000000)return [];
  return select(JSON.parse(file.getBlob().getDataAsString()),JSON.parse(state.values.satori_orders_v15));
 }catch(_){return []} // Missing provenance must never break financial synchronization.
}
return {read:read,select:select};
})();
