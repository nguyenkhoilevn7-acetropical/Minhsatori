/**
 * Minh Satori — orders.auditHistory (READ-ONLY) for the signed Bot API.
 * STAGING SOURCE ONLY: not deployed by this PR. Owner deploys after review.
 *
 * Contract used by the V2 server (grok-ledger-read.mjs auditHistory ->
 * readMinhSatori('orders.auditHistory', {invoiceNo, id})):
 *   request payload : {invoiceNo: positive integer, id: string /^[A-Za-z0-9_-]{1,80}$/}
 *   response data   : {invoiceNo, id, location: 'live'|'trash', status,
 *                      entries: [...oldest -> newest], sources: [...], truncated}
 *   BotApi.gs gates it: scope orders:read AND client.role === 'owner'.
 *
 * Reads ONLY what the ledger already stores. Never invents an event or a time:
 *  - the invoice row itself: creation facts (timestamp/date, source, apiRequestId)
 *  - satori_order_cancel_audit_v1 (append-only HỦY log, BotApiOrderCancel.gs)
 *  - any array on the row whose name ends in "Audit" or "History"
 *    (paymentAudit today; edit/update logs if the production BotApi stores them)
 *  - any ledger key satori_*audit* that is a JSON array of entries carrying
 *    the same id + invoiceNo (other than the cancel log above)
 *  - satori_trash_bin_v15 when the invoice is currently in the 30-day trash
 *  - apiRestoreRequestId on the row (restored from trash; time not stored => at:null)
 * Never writes: no backup, no setContent, no lock-held mutation.
 */
var SatoriOrderAuditHistory=(function(){
'use strict';
var CANCEL_AUDIT_KEY='satori_order_cancel_audit_v1';
var MAX_ENTRIES=200,MAX_ENTRY_CHARS=4000;
function fail(code,message){var e=new Error(message);e.code=code;throw e;}
function need(x,code,message){if(!x)fail(code,message);}
function parseArray(raw,label){
 if(raw==null||raw==='')return [];
 var x;
 try{x=JSON.parse(raw)}catch(e){fail('INVALID_STATE','Dữ liệu '+label+' hỏng')}
 need(Array.isArray(x),'INVALID_STATE','Dữ liệu '+label+' không phải danh sách');
 return x;
}
function isoOrNull(v){
 if(v==null||v==='')return null;
 if(typeof v==='number'){
  if(!Number.isFinite(v)||v<946684800000||v>4102444800000)return null;
  return new Date(v).toISOString();
 }
 var t=Date.parse(String(v));
 return Number.isFinite(t)?new Date(t).toISOString():null;
}
function text(v,max){return v==null?null:String(v).replace(/[\u0000-\u001f]/g,' ').slice(0,max||300);}
function sameOrder(x,p){return x&&String(x.id)===p.id&&Number(x.invoiceNo)===p.invoiceNo;}
/** Copy of one stored entry, bounded in size, without changing what it says. */
function bounded(entry){
 var raw=JSON.stringify(entry==null?null:entry);
 if(raw.length<=MAX_ENTRY_CHARS)return JSON.parse(raw);
 return {truncatedEntry:true,preview:raw.slice(0,MAX_ENTRY_CHARS)};
}
function entry(kind,source,at,fields,original){
 return {at:at,kind:kind,source:source,
  requestId:text(fields.requestId,100),actor:text(fields.actor,80),reason:text(fields.reason,300),
  previousStatus:text(fields.previousStatus,40),newStatus:text(fields.newStatus,40),
  data:original===undefined?null:bounded(original)};
}
function find(s,all,p){
 var live=all.filter(function(o){return sameOrder(o,p)});
 need(live.length<=1,'ORDER_AMBIGUOUS','Số hóa đơn và ID bị trùng trong sổ');
 if(live.length===1)return {order:live[0],location:'live',trashItem:null};
 var trash=parseArray(s.values.satori_trash_bin_v15,'thùng rác');
 var hits=trash.filter(function(t){return t&&sameOrder(t.order,p)});
 need(hits.length<=1,'ORDER_AMBIGUOUS','Thùng rác có nhiều hóa đơn trùng mã');
 need(hits.length===1,'ORDER_NOT_FOUND','Không tìm thấy hóa đơn trong sổ hoặc thùng rác');
 return {order:hits[0].order,location:'trash',trashItem:hits[0]};
}
function read(s,all,p){
 need(p&&typeof p==='object'&&!Array.isArray(p),'INVALID_REQUEST','Payload không hợp lệ');
 need(Object.keys(p).every(function(k){return k==='invoiceNo'||k==='id'}),'INVALID_REQUEST','Chỉ nhận invoiceNo và id');
 need(Number.isSafeInteger(p.invoiceNo)&&p.invoiceNo>0,'INVALID_ORDER','Cần số hóa đơn chính xác');
 need(typeof p.id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(p.id),'INVALID_ORDER','Cần ID hóa đơn chính xác');
 var hit=find(s,all,p),o=hit.order,entries=[],sources=['invoice_row'];

 // 1) Creation facts stored on the row.
 var createdAt=isoOrNull(o.timestamp);
 if(createdAt||o.date){
  entries.push(entry('created','invoice_row',createdAt,
   {requestId:o.apiRequestId,actor:o.source||null},
   {date:o.date||null,source:o.source||null,originalTotal:o.total}));
 }
 // 2) Append-only cancel log (HỦY = status "Đã hủy", 0 đ, kept in system).
 var cancelLog=parseArray(s.values[CANCEL_AUDIT_KEY],'nhật ký hủy');
 var cancels=cancelLog.filter(function(x){return sameOrder(x,p)});
 if(cancels.length)sources.push(CANCEL_AUDIT_KEY);
 cancels.forEach(function(x){
  entries.push(entry('cancelled',CANCEL_AUDIT_KEY,isoOrNull(x.at),
   {requestId:x.requestId,actor:x.actor,reason:x.reason,previousStatus:x.previousStatus,newStatus:'Đã hủy'},x));
 });
 // 3) Arrays stored on the row itself (paymentAudit, edit/update histories).
 Object.keys(o).filter(function(k){return /(Audit|History)$/.test(k)&&Array.isArray(o[k])}).sort().forEach(function(k){
  if(o[k].length)sources.push('invoice_row.'+k);
  o[k].forEach(function(x){
   x=x&&typeof x==='object'?x:{value:x};
   entries.push(entry(String(x.action||x.kind||(k==='paymentAudit'?'payment':k)),'invoice_row.'+k,
    isoOrNull(x.recordedAt||x.at||x.updatedAt||x.editedAt||x.timestamp),
    {requestId:x.requestId,actor:x.actor||x.by||x.source,reason:x.reason,
     previousStatus:x.previousStatus,newStatus:x.newStatus},x));
  });
 });
 // 4) Other ledger-level audit logs (satori_*audit*), exact id + invoiceNo only.
 Object.keys(s.values).filter(function(k){return /^satori_[a-z0-9_]*audit[a-z0-9_]*$/.test(k)&&k!==CANCEL_AUDIT_KEY}).sort().forEach(function(k){
  var list;
  try{list=JSON.parse(s.values[k])}catch(e){return}
  if(!Array.isArray(list))return;
  var mine=list.filter(function(x){return sameOrder(x,p)});
  if(mine.length)sources.push(k);
  mine.forEach(function(x){
   entries.push(entry(String(x.action||x.kind||'audit'),k,isoOrNull(x.at||x.recordedAt||x.updatedAt||x.timestamp),
    {requestId:x.requestId,actor:x.actor||x.by,reason:x.reason,previousStatus:x.previousStatus,newStatus:x.newStatus},x));
  });
 });
 // 5) Trash bin (XÓA): only while the invoice is in the 30-day bin.
 if(hit.trashItem){
  sources.push('satori_trash_bin_v15');
  entries.push(entry('deleted_to_trash','satori_trash_bin_v15',isoOrNull(hit.trashItem.deletedAt),
   {requestId:hit.trashItem.apiDeleteRequestId},
   {deletedAt:isoOrNull(hit.trashItem.deletedAt),expiresAt:isoOrNull(hit.trashItem.expiresAt)}));
 }
 // 6) Restored from trash by the Bot API. The restore time is not stored separately.
 if(o.apiRestoreRequestId){
  entries.push(entry('restored_from_trash','invoice_row',null,{requestId:o.apiRestoreRequestId},
   {note:'Thời điểm khôi phục không được lưu riêng trong sổ'}));
 }
 // Oldest -> newest; entries without a stored time keep their source order at the end.
 var indexed=entries.map(function(e,i){return {e:e,i:i}});
 indexed.sort(function(a,b){
  if(a.e.at&&b.e.at)return a.e.at<b.e.at?-1:a.e.at>b.e.at?1:a.i-b.i;
  if(a.e.at)return -1;if(b.e.at)return 1;return a.i-b.i;
 });
 entries=indexed.map(function(x){return x.e});
 var truncated=entries.length>MAX_ENTRIES;
 return {revision:s.revision,invoiceNo:Number(o.invoiceNo),id:String(o.id),location:hit.location,
  status:String(o.status||''),entries:truncated?entries.slice(-MAX_ENTRIES):entries,
  totalEntries:entries.length,truncated:truncated,sources:sources,readOnly:true};
}
return {read:read,CANCEL_AUDIT_KEY:CANCEL_AUDIT_KEY};
})();
if(typeof module!=='undefined')module.exports=SatoriOrderAuditHistory;
