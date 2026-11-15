/**
 * Minh Satori — orders.cancel (SOFT cancel) for the signed Bot API.
 * STAGING SOURCE ONLY: not deployed by this PR. Owner deploys after review.
 *
 * Contract (same shape as removeOrder/updateUnpaidOrder inside BotApi write()):
 *   SatoriOrderCancel.cancel(s, all, p, actor) -> {modified, extras?, result}
 *
 *  - Never deletes: the invoice row stays in satori_orders_v15 with
 *    status "Đã hủy" (already excluded from debt/profit by active()).
 *    Previous status, who, when and why are stored on the row and appended to
 *    satori_order_cancel_audit_v1 (append-only).
 *  - Idempotent by requestId: a repeated request returns duplicate:true and
 *    writes nothing (modified:false), so a second confirm never cancels twice.
 *  - Refuses: wrong revision, unknown/ambiguous invoice, name/total changed,
 *    already cancelled / "Không Tính", customer paid, Satori paid, CTV pair.
 *
 * Integration in BotApi.gs (3 small edits, see GROK_LEDGER_TOOLS.md):
 *   SCOPES: 'orders.cancel':'orders:cancel'
 *   write(): action==='orders.cancel'?SatoriOrderCancel.cancel(s,all,p,actor):
 *   handle(): add identity.action==='orders.cancel' to isWrite
 * Grant scope orders:cancel ONLY to the isolated V2 writer key.
 */
var SatoriOrderCancel=(function(){
'use strict';
var AUDIT_KEY='satori_order_cancel_audit_v1';
function fail(code,message){var e=new Error(message);e.code=code;throw e;}
function need(x,code,message){if(!x)fail(code,message);}
function norm(v){return String(v==null?'':v).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/Đ/g,'d').toLowerCase().replace(/\btreky\b/g,'traky').trim();}
function audit(s){
 var a=JSON.parse(s.values[AUDIT_KEY]||'[]');
 need(Array.isArray(a)&&a.length<50000,'INVALID_STATE','Nhật ký hủy hóa đơn không hợp lệ');return a;
}
function cancel(s,all,p,actor,nowMs){
 need(p&&p.confirmed===true,'CONFIRMATION_REQUIRED','Chưa xác nhận hủy hóa đơn');
 var requestId=String(p.requestId||'');
 need(/^[a-zA-Z0-9_-]{8,100}$/.test(requestId),'INVALID_REQUEST','Thiếu requestId chống thao tác lặp');
 need(Number.isSafeInteger(p.invoiceNo)&&p.invoiceNo>0&&p.id!==undefined&&p.id!==null,
  'INVALID_ORDER','Cần số hóa đơn và ID chính xác');
 var reason=String(p.reason||'').replace(/[\u0000-\u001f]/g,' ').trim();
 need(reason.length>=3&&reason.length<=300,'REASON_REQUIRED','Cần lý do hủy (3-300 ký tự)');
 var log=audit(s);
 // Replay of the SAME request: answer from the row, never write again.
 var prior=all.filter(function(o){return o.apiCancelRequestId===requestId});
 if(prior.length){
  need(prior.length===1&&String(prior[0].id)===String(p.id)&&Number(prior[0].invoiceNo)===p.invoiceNo,
   'REUSED_REQUEST_ID','Mã yêu cầu đã dùng cho hóa đơn khác');
  return {modified:false,result:{cancelled:true,duplicate:true,id:prior[0].id,invoiceNo:prior[0].invoiceNo,status:prior[0].status}};
 }
 need(Number.isInteger(p.expectedRevision),'REVISION_REQUIRED','Thiếu expectedRevision');
 need(s.revision===p.expectedRevision,'REVISION_CONFLICT','Dữ liệu vừa được cập nhật, hãy đọc lại');
 need(!log.some(function(x){return x&&x.requestId===requestId}),'REUSED_REQUEST_ID','Mã yêu cầu đã được dùng');
 need(!all.some(function(o){return Object.keys(o).some(function(k){return /^api.*RequestId$/.test(k)&&o[k]===requestId})}),
  'REUSED_REQUEST_ID','Mã yêu cầu đã dùng cho thao tác khác');
 var found=all.filter(function(o){return Number(o.invoiceNo)===p.invoiceNo&&String(o.id)===String(p.id)});
 need(found.length===1,'INVALID_ORDER','Hóa đơn không còn tồn tại hoặc mã bị trùng');
 var o=found[0];
 need(o.status!=='Đã hủy','ALREADY_CANCELLED','Hóa đơn đã ở trạng thái Đã hủy');
 need(o.status!=='Không Tính','NOT_COUNTED','Hóa đơn đang Không Tính');
 need(norm(o.name)===norm(p.expectedName)&&Number(o.total)===Number(p.expectedTotal),
  'ORDER_CHANGED','Tên khách hoặc tổng tiền đã khác');
 need(o.status!=='Đã thanh toán'&&!o.customerPaidAt&&o.status!=='Đã TT Satori'&&!o.satoriPaidAt,
  'PAID_ORDER_PROTECTED','Hóa đơn đã ghi nhận thanh toán; không hủy được');
 need(!o.pairGroupId,'PAIRED_ORDER_LOCKED','Không hủy riêng một hóa đơn của cặp CTV');
 var now=nowMs||Date.now(),at=new Date(now).toISOString(),by=String(actor||'unknown').slice(0,80);
 var previousStatus=o.status||'Chưa thanh toán';
 o.statusBeforeCancel=previousStatus;
 o.status='Đã hủy';
 o.cancelledAt=at;o.cancelledBy=by;o.cancelReason=reason;
 o.apiCancelRequestId=requestId;o.updatedAt=at;
 log.push({requestId:requestId,id:o.id,invoiceNo:o.invoiceNo,at:at,actor:by,reason:reason,
  previousStatus:previousStatus,total:o.total,source:String(p.actor||'').slice(0,80)});
 return {modified:true,extras:(function(){var x={};x[AUDIT_KEY]=JSON.stringify(log);return x})(),
  result:{cancelled:true,duplicate:false,id:o.id,invoiceNo:o.invoiceNo,status:o.status,cancelledAt:at}};
}
return {cancel:cancel,AUDIT_KEY:AUDIT_KEY};
})();
if(typeof module!=='undefined')module.exports=SatoriOrderCancel;
