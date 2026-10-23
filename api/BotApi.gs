/**
 * Minh Satori bot integration — staging only.
 * Add to the SAME Google Apps Script project as readState_()/driveCommit().
 * The shared getScriptLock prevents lost updates between bots and website.
 * This GitHub branch is NOT deployed, and contains no credentials.
 */
var SatoriBotApi=(function(){
'use strict';
var ORDER_KEY='satori_orders_v15', PRICE_APPROVAL_KEY='satori_ai_pricing_approvals_v1';
var SCOPES={'system.status':'orders:read','orders.list':'orders:read',
 'debt.summary':'debt:read','customers.search':'customers:read','catalogue.list':'catalogue:read','orders.create':'orders:write',
 'orders.create.ai':'orders:ai:write','pricing.approve':'pricing:approve','pricing.eligibility':'orders:ai:write','orders.delete':'orders:delete',
 'trash.list':'orders:read','orders.restore':'orders:write',
 'payments.markCustomerPaid':'payments:write',
 'collaborators.pair.list':'collaborators:pair:read',
 'collaborators.pair.configure':'collaborators:pair:approve','collaborators.mark':'collaborators:pair:approve',
 'orders.create.pair':'collaborators:pair:write'};
function fail(code,message){var e=new Error(message);e.code=code;throw e;}
function need(x,code,message){if(!x)fail(code,message);}
function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function norm(v){return String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().replace(/\btreky\b/g,'traky').trim();}
function money(v){var n=Number(v);need(Number.isFinite(n)&&n>=0&&n<=1e11,'INVALID_AMOUNT','Số tiền không hợp lệ');return n;}
function signed(secret,data){return Utilities.computeHmacSha256Signature(data,secret,Utilities.Charset.UTF_8).map(function(b){return ('0'+(b&255).toString(16)).slice(-2)}).join('');}
function equalSig(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;var x=0;for(var i=0;i<64;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
function auth(o){
 need(o&&typeof o==='object'&&!Array.isArray(o),'INVALID_REQUEST','Dữ liệu không hợp lệ');
 need(/^[a-zA-Z0-9_-]{3,64}$/.test(o.keyId||'')&&/^[a-zA-Z0-9_-]{16,128}$/.test(o.nonce||''),'AUTH_FAILED','Không thể xác thực');
 need(Number.isSafeInteger(o.timestamp)&&Math.abs(Date.now()-o.timestamp)<300000,'EXPIRED','Yêu cầu hết hạn');
 need(Object.prototype.hasOwnProperty.call(SCOPES,o.action),'INVALID_ACTION','Lệnh không hỗ trợ');
 var all=JSON.parse(PropertiesService.getScriptProperties().getProperty('SATORI_BOT_CLIENTS_JSON')||'{}');
 var client=Object.prototype.hasOwnProperty.call(all,o.keyId)?all[o.keyId]:null;
 need(client&&client.enabled!==false&&typeof client.secret==='string'&&client.secret.length>=32,'AUTH_FAILED','Không thể xác thực');
 need(Array.isArray(client.scopes)&&client.scopes.includes(SCOPES[o.action]),'FORBIDDEN','Bot không có quyền');
 var p=o.payload==null?{}:o.payload;
 need(p&&typeof p==='object'&&!Array.isArray(p),'INVALID_REQUEST','Payload không hợp lệ');
 var msg=[o.keyId,o.timestamp,o.nonce,o.action,JSON.stringify(p)].join('\n');
 need(equalSig(signed(client.secret,msg),o.signature),'AUTH_FAILED','Không thể xác thực');
 return {action:o.action,payload:p,nonce:o.keyId+':'+o.nonce};
}
function state(){
 var x=readState_();need(Number.isInteger(x.revision)&&x.values&&typeof x.values[ORDER_KEY]==='string','INVALID_STATE','Dữ liệu Drive không hợp lệ');return x;
}
function rows(s){var x=JSON.parse(s.values[ORDER_KEY]);need(Array.isArray(x),'INVALID_STATE','Dữ liệu hóa đơn hỏng');return x;}
function version(s,p){need(Number.isInteger(p.expectedRevision),'REVISION_REQUIRED','Thiếu expectedRevision');need(s.revision===p.expectedRevision,'REVISION_CONFLICT','Dữ liệu vừa được cập nhật, hãy đọc lại');}
function visible(o){return {pairGroupId:o.pairGroupId||null,pairRole:o.pairRole||null,pairInvoiceNo:o.pairInvoiceNo||null,collaboratorId:o.collaboratorId||null,pairDiscountPercent:o.pairDiscountPercent??null,pairCommissionAmount:o.pairCommissionAmount??null,pairCustomerName:o.pairCustomerName||null,pairCollaboratorName:o.pairCollaboratorName||null,id:o.id,invoiceNo:o.invoiceNo,date:o.date,name:o.name,phone:o.phone,location:o.location,items:o.items||[],product:o.product||'',qty:o.qty||0,total:o.total,status:o.status,customerPaidAt:o.customerPaidAt||null,customerPaymentReceiptUrl:o.customerPaymentReceiptUrl||null,customerPaymentReceiptAt:o.customerPaymentReceiptAt||null,customerPaymentNote:o.customerPaymentNote||null,shippingAmount:o.shippingAmount||0,vatAmount:o.vatAmount||0,deliveryNote:o.deliveryNote||'',deliveryDate:o.deliveryDate||null,updatedAt:o.updatedAt||null};}
function iso(date){
 var m=String(date||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!m)return /^\d{4}-\d{2}-\d{2}$/.test(date)?date:'';
 var d=new Date(Date.UTC(+m[3],+m[2]-1,+m[1]));
 if(d.getUTCFullYear()!==+m[3]||d.getUTCMonth()+1!==+m[2]||d.getUTCDate()!==+m[1])return '';
 return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
}
function select(all,p){
 var q=norm(p.query||''),digits=String(p.query||'').replace(/\D/g,'');
 return all.filter(function(o){
  if(q&&![o.name,o.pairCustomerName,o.pairCollaboratorName,o.collaboratorId,o.phone,o.customerCode,o.customerId,o.clientCode,o.invoiceNo].some(function(v){return norm(v).includes(q)})&&!(digits.length>=5&&String(o.phone||'').replace(/\D/g,'').includes(digits)))return false;
  if(p.status&&o.status!==p.status)return false;
  var date=iso(o.date);if((p.from||p.to)&&(!date||(p.from&&date<p.from)||(p.to&&date>p.to)))return false;
  return true;
 });
}
function active(o){return !['Đã hủy','Không Tính'].includes(o.status);}
function paid(o){return o.status==='Đã thanh toán'||!!o.customerPaidAt;}

function locKey(o){
 return [norm(o.name),norm(o.location).replace(/[^a-z0-9]+/g,' ').trim(),String(o.phone||'').replace(/\D/g,'').slice(-9)].join('|');
}
function searchProfiles(all,p){
 var q=norm(p.query||''),needle=String(p.phone||'').replace(/\D/g,'');
 need(q.length>=2||needle.length>=7,'INVALID_QUERY','Cần tên từ 2 ký tự hoặc số điện thoại từ 7 chữ số');
 var a={};
 all.forEach(function(o){
   if(q&&!norm(o.name).includes(q)&&!norm(o.location).includes(q))return;
   if(needle&&!String(o.phone||'').replace(/\D/g,'').includes(needle))return;
   var k=locKey(o),t=Number(o.timestamp||o.id)||0,g=a[k];
   if(!g)a[k]=g={key:k,name:o.name,phone:o.phone||'',location:o.location||'',count:0,
      ref:{id:o.id,invoiceNo:o.invoiceNo},lastDate:o.date,sourceInvoiceNo:o.invoiceNo,timestamp:t};
   g.count++;
   if(t>g.timestamp){g.ref={id:o.id,invoiceNo:o.invoiceNo};g.lastDate=o.date;g.sourceInvoiceNo=o.invoiceNo;g.timestamp=t}
 });
 var list=Object.keys(a).map(function(k){return a[k]}).sort(function(a,b){return b.timestamp-a.timestamp});
 return {total:list.length,requiresSelection:list.length>1,profiles:list.slice(0,Math.min(100,Math.max(1,Number(p.limit)||50)))};
}
function checkProfile(all,o,p){
 if(p.customerRef){
   var r=p.customerRef;
   var refs=all.filter(function(v){return String(v.id)===String(r.id)&&Number(v.invoiceNo)===Number(r.invoiceNo)});
   need(refs.length===1,'PROFILE_CHANGED','Khách tham chiếu không còn hợp lệ');
   var v=refs[0];
   need(norm(v.name)===norm(o.name)&&norm(v.location)===norm(o.location)&&
      String(v.phone||'').replace(/\D/g,'')===String(o.phone||'').replace(/\D/g,''),
      'PROFILE_MISMATCH','Tên, địa chỉ hoặc số điện thoại chưa khớp điểm giao đã chọn');
 } else {
   need(p.confirmedNewCustomer===true,'PROFILE_CONFIRMATION_REQUIRED','Chọn đúng điểm giao hoặc xác nhận khách mới');
   need(String(o.location||'').trim().length>=5,'INVALID_ORDER','Khách mới phải có địa chỉ');
 }
}
function removeOrder(s,all,p){
 need(p.confirmed===true,'CONFIRMATION_REQUIRED','Chưa xác nhận xóa hóa đơn');
 need(/^[a-zA-Z0-9_-]{8,100}$/.test(String(p.requestId||'')),
  'INVALID_REQUEST','Thiếu requestId chống thao tác lặp');
 var trash=JSON.parse(s.values.satori_trash_bin_v15||'[]');
 var previous=trash.find(function(t){return t.apiDeleteRequestId===p.requestId});
 if(previous)return {modified:false,result:{duplicate:true,deleted:true,invoiceNo:previous.order.invoiceNo}};
 version(s,p);
 need(Number.isSafeInteger(p.invoiceNo)&&p.invoiceNo>0&&p.id!==undefined,
   'INVALID_ORDER','Cần số hóa đơn và ID');
 need(String(p.expectedName||'').trim().length>=2&&Number.isFinite(p.expectedTotal),
   'CONFIRMATION_REQUIRED','Cần tên khách và tổng tiền để xác nhận');
 var found=all.filter(function(o){return Number(o.invoiceNo)===p.invoiceNo&&String(o.id)===String(p.id)});
 need(found.length===1,'INVALID_ORDER','Hóa đơn không còn tồn tại hoặc mã bị trùng');
 var o=found[0];
 need(!o.pairGroupId,'PAIRED_ORDER_LOCKED',
  'Không thể xóa riêng một hóa đơn của cặp CTV; cần xử lý đồng bộ cả cặp');
 need(norm(o.name)===norm(p.expectedName)&&Number(o.total)===p.expectedTotal,
   'ORDER_CHANGED','Tên khách hoặc tổng tiền đã khác');
 need(!['Đã thanh toán','Đã TT Satori'].includes(o.status)&&!o.customerPaidAt,
   'PAID_ORDER_PROTECTED','Không được xóa hóa đơn đã thu tiền qua Bot');
 var exists=all.some(function(v){return v.apiRequestId===p.requestId})||
     trash.some(function(t){return t.order&&t.order.apiRequestId===p.requestId});
 need(!exists,'REUSED_REQUEST_ID','Mã yêu cầu đã được dùng cho thao tác khác');
 var now=Date.now();
 trash.unshift({order:o,deletedAt:now,
   deletedDateStr:Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','dd/MM/yyyy HH:mm'),
   expiresAt:now+30*86400000,apiDeleteRequestId:p.requestId});
 all.splice(all.indexOf(o),1);
 var deleted=JSON.parse(s.values.satori_deleted_invoice_nos||'[]');
 if(!deleted.some(function(v){return Number(v)===Number(o.invoiceNo)}))deleted.push(o.invoiceNo);
 return {modified:true,extras:{satori_trash_bin_v15:JSON.stringify(trash),
   satori_deleted_invoice_nos:JSON.stringify(deleted)},
   result:{deleted:true,id:o.id,invoiceNo:o.invoiceNo,restorable:true}};
}
function recoverOrder(s,all,p){
 need(p.confirmed===true,'CONFIRMATION_REQUIRED','Chưa xác nhận khôi phục hóa đơn');
 need(/^[a-zA-Z0-9_-]{8,100}$/.test(String(p.requestId||'')),'INVALID_REQUEST','Thiếu requestId chống khôi phục lặp');
 var previous=all.find(function(o){return o.apiRestoreRequestId===p.requestId});
 if(previous){
  need(String(previous.id)===String(p.id)&&Number(previous.invoiceNo)===p.invoiceNo,'REUSED_REQUEST_ID','Mã yêu cầu đã dùng cho hóa đơn khác');
  return {modified:false,result:{restored:true,duplicate:true,order:visible(previous)}};
 }
 version(s,p);
 need(Number.isSafeInteger(p.invoiceNo)&&p.invoiceNo>0&&p.id!==undefined,'INVALID_ORDER','Cần số hóa đơn và ID');
 need(String(p.expectedName||'').trim().length>=2&&Number.isFinite(p.expectedTotal),'CONFIRMATION_REQUIRED','Cần tên khách và tổng tiền xác nhận');
 var trash=JSON.parse(s.values.satori_trash_bin_v15||'[]');
 need(Array.isArray(trash),'INVALID_STATE','Dữ liệu thùng rác hỏng');
 var found=trash.filter(function(t){return t.order&&String(t.order.id)===String(p.id)&&Number(t.order.invoiceNo)===p.invoiceNo});
 need(found.length===1,'TRASH_NOT_FOUND','Hóa đơn không còn trong thùng rác hoặc mã không duy nhất');
 var item=found[0],o=item.order,now=Date.now();
 need(Number.isFinite(item.deletedAt)&&item.deletedAt<=now&&now-item.deletedAt<30*86400000&&(!item.expiresAt||item.expiresAt>now),'TRASH_EXPIRED','Hóa đơn đã hết thời hạn khôi phục 30 ngày');
 need(norm(o.name)===norm(p.expectedName)&&Number(o.total)===p.expectedTotal,'ORDER_CHANGED','Tên khách hoặc tổng tiền đã thay đổi');
 need(!all.some(function(v){return String(v.id)===String(o.id)||Number(v.invoiceNo)===p.invoiceNo}),'RESTORE_CONFLICT','Trùng ID hoặc số hóa đơn đang có; không ghi đè');
 need(!all.some(function(v){return v.apiRequestId===p.requestId})&&!trash.some(function(t){return t.apiDeleteRequestId===p.requestId||t.order&&(t.order.apiRequestId===p.requestId||t.order.apiRestoreRequestId===p.requestId)}),'REUSED_REQUEST_ID','Mã yêu cầu đã dùng cho thao tác khác');
 var restored=Object.assign({},o,{apiRestoreRequestId:p.requestId,updatedAt:now});
 all.unshift(restored);trash.splice(trash.indexOf(item),1);
 var deleted=JSON.parse(s.values.satori_deleted_invoice_nos||'[]');
 need(Array.isArray(deleted),'INVALID_STATE','Dữ liệu số hóa đơn đã xóa hỏng');
 deleted=deleted.filter(function(n){return Number(n)!==p.invoiceNo});
 return {modified:true,extras:{satori_trash_bin_v15:JSON.stringify(trash),satori_deleted_invoice_nos:JSON.stringify(deleted)},result:{restored:true,duplicate:false,order:visible(restored)}};
}
function sameCreateIntent(saved,provided){
 // A requestId is bound to the entire intended order, not just its invoice number.
 // Compare only canonical fields already persisted in the Drive ledger, so a lost
 // HTTP reply can be retried without another backup/write. Modified carts fail.
 if(!provided||typeof provided!=='object'||Array.isArray(provided)||
    !Array.isArray(provided.items)||!Array.isArray(saved.items)||
    provided.items.length!==saved.items.length)return false;
 if(norm(saved.name)!==norm(provided.name)||
    norm(saved.location)!==norm(provided.location)||
    String(saved.phone||'').replace(/\D/g,'')!==String(provided.phone||'').replace(/\D/g,'')||
    Number(saved.total)!==Number(provided.total))return false;
 if(Number(saved.shippingAmount||0)!==Number(provided.shippingAmount||0)||
    Number(saved.vatAmount||0)!==Number(provided.vatAmount||0)||
    String(saved.deliveryNote||'')!==String(provided.deliveryNote||'')||
    String(saved.deliveryDate||'')!==String(provided.deliveryDate||''))return false;
 return provided.items.every(function(item,i){
  var old=saved.items[i];
  return item&&old&&String(item.code||'')===String(old.code||'')&&
   norm(item.product||item.name)===norm(old.product)&&
   String(item.unit||'Thùng')===String(old.unit||'Thùng')&&
   Number(item.qty)===Number(old.qty)&&
   Number(item.unitPrice)===Number(old.unitPrice)&&
   Number(item.listPrice==null?item.unitPrice:item.listPrice)===Number(old.listPrice);
 });
}
function approveAIPricing(s,all,p){
 // An entirely separate HMAC owner scope is required to approve or revoke AI
 // discounts. Browser AI customer memory must NEVER self-authorize this key.
 need(p.confirmed===true,'CONFIRMATION_REQUIRED','Cần quản trị xác nhận duyệt giá');
 var requestId=String(p.requestId||'');
 need(/^[a-zA-Z0-9_-]{8,100}$/.test(requestId),'INVALID_REQUEST','Thiếu mã yêu cầu duyệt giá');
 var id=String(p.customerMemoryId||'');
 need(/^[a-zA-Z0-9_-]{4,100}$/.test(id),'INVALID_ORDER','Mã hồ sơ khách không hợp lệ');
 var entries=JSON.parse(s.values[PRICE_APPROVAL_KEY]||'[]');
 need(Array.isArray(entries)&&entries.length<10000,'INVALID_STATE',
  'Nhật ký duyệt giá đã đầy hoặc không hợp lệ');
 var same=entries.filter(function(x){return x&&x.approvalRequestId===requestId});
 var params={customerMemoryId:id,sourceOrderId:p.customerRef&&p.customerRef.id,
  sourceInvoiceNo:p.customerRef&&p.customerRef.invoiceNo,
  phone:String(p.phone||'').replace(/\D/g,''),location:String(p.location||'').trim(),
  discountPercent:p.discountPercent,vatPercent:p.vatPercent,shippingAmount:p.shippingAmount,
  enabled:p.enabled===true};
 need(p.enabled===true||p.enabled===false,'INVALID_ORDER','Cần trạng thái duyệt hoặc thu hồi');
 if(same.length){
  need(same.length===1&&Object.keys(params).every(function(k){return same[0][k]===params[k]}),
   'REQUEST_ID_CONFLICT','Mã duyệt giá đã sử dụng với nội dung khác');
  return {modified:false,result:{duplicate:true,approved:same[0].enabled,customerMemoryId:id}};
 }
 version(s,p);
 need(typeof s.values.satori_ai_customer_memory==='string','AI_CUSTOMER_UNVERIFIED',
  'Không có hồ sơ khách nguồn');
 var memories=JSON.parse(s.values.satori_ai_customer_memory);
 need(Array.isArray(memories),'INVALID_STATE','Bộ nhớ AI chưa hợp lệ');
 var match=memories.filter(function(m){return m&&m.id===id});
 need(match.length===1,'AI_CUSTOMER_UNVERIFIED','Hồ sơ khách chưa duy nhất');
 var cust=match[0];
 var names=[cust.name].concat(Array.isArray(cust.aliases)?cust.aliases:[]);
 var source=all.filter(function(o){return p.customerRef&&
  String(o.id)===String(p.customerRef.id)&&Number(o.invoiceNo)===Number(p.customerRef.invoiceNo)});
 need(source.length===1&&names.some(function(n){return norm(n)===norm(source[0].name)})&&
  norm(source[0].location)===norm(params.location)&&
  String(source[0].phone||'').replace(/\D/g,'')===params.phone,
  'AI_CUSTOMER_UNVERIFIED','Hồ sơ khách, hóa đơn tham chiếu và điểm giao không khớp');
 var addresses=[{phone:cust.defaultPhone,location:cust.defaultLocation}]
  .concat(Array.isArray(cust.receivers)?cust.receivers:[]);
 need(params.phone.length>=8&&params.location.length>=5&&addresses.some(function(a){
  return a&&String(a.phone||'').replace(/\D/g,'')===params.phone&&
   norm(a.location)===norm(params.location);
 }), 'AI_CUSTOMER_UNVERIFIED','Điểm giao chưa có trong hồ sơ khách');
 need(typeof p.discountPercent==='number'&&Number.isFinite(p.discountPercent)&&
  p.discountPercent>=0&&p.discountPercent<=70&&
  [0,5,8,10].includes(p.vatPercent)&&
  Number.isSafeInteger(p.shippingAmount)&&p.shippingAmount>=0&&p.shippingAmount<=1000000,
  'INVALID_PRICE_POLICY','Chưa xác minh mức chiết khấu, VAT hoặc phí giao');
 entries.push(Object.assign({},params,{reviewedByOwner:true,
  approvalRequestId:requestId,approvedAt:Date.now()}));
 return {modified:true,extras:{satori_ai_pricing_approvals_v1:JSON.stringify(entries)},
  result:{approved:p.enabled===true,customerMemoryId:id,duplicate:false}};
}
function checkAIPricing(s,o,p){
 // Dedicated HMAC action orders.create.ai requires orders:ai:write scope.
 // Authenticated API callers CANNOT select the customer's percentage in payload.
 // Owner-approved policy is read again from the versioned Drive ledger while locked.
 var id=String(p.customerMemoryId||'');
 need(/^[a-zA-Z0-9_-]{4,100}$/.test(id),'AI_PRICING_NOT_APPROVED',
  'Chưa có mã hồ sơ chiết khấu đã được duyệt');
 need(typeof s.values.satori_ai_customer_memory==='string','AI_PRICING_NOT_APPROVED',
  'Chưa có dữ liệu chiết khấu duyệt trên Drive');
 var memories=JSON.parse(s.values.satori_ai_customer_memory);
 need(Array.isArray(memories)&&memories.length<=10000,'INVALID_STATE','Bộ nhớ khách không hợp lệ');
 var found=memories.filter(function(x){return x&&x.id===id});
 need(found.length===1,'AI_PRICING_NOT_APPROVED','Hồ sơ duyệt không duy nhất');
 var mem=found[0],approvals=JSON.parse(s.values[PRICE_APPROVAL_KEY]||'[]');
 need(Array.isArray(approvals)&&approvals.length<=10000,'INVALID_STATE',
  'Nhật ký duyệt giá không hợp lệ');
 // Approvals are stored independently from editable/learned AI customer memory.
 // The last matching approval (including revocation) is authoritative.
 var records=approvals.filter(function(x){return x&&x.customerMemoryId===id});
 var policy=records.length?records[records.length-1]:null;
 need(policy&&policy.enabled===true&&policy.reviewedByOwner===true,
  'AI_PRICING_NOT_APPROVED','Chiết khấu AI chưa được người quản trị phê duyệt');
 // A pricing approval belongs to one historical source invoice and one exact
 // delivery destination, not merely to the customer company name.
 need(p.customerRef&&p.customerRef.id!=null&&Number.isSafeInteger(p.customerRef.invoiceNo)&&
  String(policy.sourceOrderId)===String(p.customerRef.id)&&
  Number(policy.sourceInvoiceNo)===p.customerRef.invoiceNo&&
  String(policy.phone||'').replace(/\D/g,'')===String(o.phone||'').replace(/\D/g,'')&&
  norm(policy.location)===norm(o.location),
  'AI_PRICING_NOT_APPROVED','Điểm giao chưa có phê duyệt giá riêng');
 var pct=policy.discountPercent,vatPct=policy.vatPercent,shipping=policy.shippingAmount;
 need(typeof pct==='number'&&Number.isFinite(pct)&&pct>=0&&pct<=70,
  'AI_PRICING_NOT_APPROVED','Mức chiết khấu chưa được xác thực');
 need([0,5,8,10].includes(vatPct)&&Number.isSafeInteger(shipping)&&shipping>=0&&shipping<=1000000,
  'AI_PRICING_NOT_APPROVED','Thuế và phí giao chưa được duyệt');
 var phone=String(o.phone||'').replace(/\D/g,''),loc=norm(o.location);
 var name=norm(o.name),matches=[mem.name].concat(Array.isArray(mem.aliases)?mem.aliases:[]);
 need(matches.some(function(n){return norm(n)===name}),'AI_CUSTOMER_UNVERIFIED',
  'Tên khách chưa được xác minh trong sổ khách');
 var addresses=[{phone:mem.defaultPhone,location:mem.defaultLocation}]
  .concat(Array.isArray(mem.receivers)?mem.receivers:[]);
 need(phone.length>=8&&loc.length>=5&&addresses.some(function(x){
  return x&&String(x.phone||'').replace(/\D/g,'')===phone&&norm(x.location)===loc;
 }), 'AI_CUSTOMER_UNVERIFIED','Điểm giao hoặc số điện thoại chưa được duyệt');
 need(typeof s.values.satori_catalogue_v15==='string','AI_SOURCE_CATALOGUE_MISSING',
  'Chưa có bảng giá chuẩn trên Drive');
 var source=JSON.parse(s.values.satori_catalogue_v15);
 need(Array.isArray(source)&&source.length>0&&source.length<=200,
  'AI_SOURCE_CATALOGUE_MISSING','Bảng giá nguồn không hợp lệ');
 var codes={},sum=0,units=0,goods=0;
 source.forEach(function(x){
  need(x&&/^TP-[0-9]{5}$/.test(x.code||'')&&!codes[x.code]&&
   Number.isSafeInteger(x.listPrice)&&x.listPrice>=0&&x.listPrice<=1e9,
   'AI_SOURCE_CATALOGUE_INVALID','Bảng giá nguồn có mã hoặc giá không hợp lệ');
  codes[x.code]=x;
 });
 need(Array.isArray(o.items)&&o.items.length>=1&&o.items.length<=6,
  'AI_ITEM_LIMIT','Giỏ AI phải có 1 đến 6 mặt hàng');
 o.items.forEach(function(i){
  need(i&&typeof i.code==='string'&&codes[i.code]&&!codes[i.code]._aiSeen,
   'AI_UNKNOWN_PRODUCT','Sản phẩm không được phép hoặc bị lặp');
  var sourceItem=codes[i.code];sourceItem._aiSeen=true;
  need(Number.isSafeInteger(i.qty)&&i.qty>=1&&i.qty<=500,
   'AI_ITEM_LIMIT','Số lượng sản phẩm không hợp lệ');
  units+=i.qty;
  var cost=Math.round(sourceItem.listPrice*(100-pct)/100);
  need(norm(i.product||i.name)===norm(sourceItem.name)&&
   String(i.unit||'')===String(sourceItem.unit)&&
   Number(i.listPrice)===sourceItem.listPrice&&Number(i.unitPrice)===cost,
   'AI_PRICE_MISMATCH','Tên, đơn vị hoặc giá AI khác bảng giá đã duyệt');
  goods+=cost*i.qty;sum++;
 });
 need(units<=500&&goods<=1e11,'AI_ITEM_LIMIT','Giỏ hàng vượt giới hạn');
 var vat=Math.round(goods*vatPct/100),total=goods+shipping+vat;
 need(Number(o.shippingAmount||0)===shipping&&Number(o.vatAmount||0)===vat&&
  Number(o.total)===total,'AI_PRICE_MISMATCH',
  'Thuế, phí giao hoặc tổng tiền không khớp duyệt giá trên Drive');
}

// Optional collaborator twin invoice policy — OFF until explicitly approved for each
// collaborator with a separate server-only HMAC scope. No hard-coded CTV name.
var PAIR_POLICY_KEY='satori_collaborator_pair_policies_v1';
function pairPolicies(s){
 var x=JSON.parse(s.values[PAIR_POLICY_KEY]||'[]');
 need(Array.isArray(x)&&x.length<=10000,'INVALID_STATE','Chính sách hóa đơn đôi không hợp lệ');
 return x;
}
function collaborator(s,id){
 var list=JSON.parse(s.values.satori_collaborators_v1||'[]');
 need(Array.isArray(list)&&list.length<=10000,'INVALID_STATE','Danh sách cộng tác viên không hợp lệ');
 var rows=list.filter(function(x){return x&&String(x.id)===String(id)});
 need(rows.length===1&&rows[0].active===true&&typeof rows[0].name==='string'&&rows[0].name.trim().length>=2&&rows[0].name.length<=150,'COLLABORATOR_NOT_ACTIVE','Cộng tác viên chưa hoạt động');
 return rows[0];
}
function pairPolicyFor(s,id){
 var list=pairPolicies(s).filter(function(x){return x.collaboratorId===id});
 need(list.length<=1,'INVALID_STATE','Chính sách cộng tác viên bị trùng');
 return list[0]||null;
}
function validPairPolicy(p){
 need(p&&typeof p==='object'&&typeof p.enabled==='boolean'&&
 Number.isSafeInteger(p.customerDiscountPercent)&&p.customerDiscountPercent>=0&&p.customerDiscountPercent<=70&&
 Number.isSafeInteger(p.collaboratorDiscountPercent)&&p.collaboratorDiscountPercent>=0&&p.collaboratorDiscountPercent<=70&&
 p.collaboratorDiscountPercent>p.customerDiscountPercent&&
 Number.isSafeInteger(p.shippingPercent)&&p.shippingPercent>=0&&p.shippingPercent<=30&&
 [0,5,8,10].includes(p.vatPercent),
 'PAIR_POLICY_INVALID','Phải cấu hình CK khách, CK CTV, phí giao, VAT hợp lệ và CK CTV cao hơn CK khách');
}
function validatedCtvDestinations(s,refs){
 need(Array.isArray(refs)&&refs.length>=1&&refs.length<=20,'CTV_DESTINATIONS_INVALID','Duyệt 1–20 điểm giao');
 var all=rows(s),keys={},unique={};
 return refs.map(function(r){
  need(r&&r.id!=null&&Number.isSafeInteger(r.invoiceNo)&&r.invoiceNo>0,'CTV_DESTINATIONS_INVALID','Thiếu tham chiếu');
  var source=all.filter(function(o){return String(o.id)===String(r.id)&&Number(o.invoiceNo)===r.invoiceNo&&!o.pairRole});
  need(source.length===1,'CTV_DESTINATION_UNVERIFIED','Điểm giao không có hóa đơn gốc duy nhất');
  var o=source[0],phone=String(o.phone||'').replace(/\D/g,''),address=norm(o.location);
  need(phone.length>=8&&address.length>=5&&norm(o.name).length>=2,'CTV_DESTINATION_UNVERIFIED','Thiếu điểm giao');
  var k=String(o.id)+'|'+o.invoiceNo,u=norm(o.name)+'|'+phone+'|'+address;
  need(!keys[k]&&!unique[u],'CTV_DESTINATIONS_DUPLICATE','Điểm giao trùng');keys[k]=true;unique[u]=true;
  return {id:o.id,invoiceNo:o.invoiceNo};
 });
}
function markCollaborator(s,p){
 need(p.confirmed===true,'CONFIRMATION_REQUIRED','Chưa phê duyệt vai trò');
 need(typeof p.requestId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(p.requestId),'INVALID_REQUEST','Thiếu requestId');
 need(p.customerRef&&p.customerRef.id!=null&&Number.isSafeInteger(p.customerRef.invoiceNo),'INVALID_REQUEST','Chọn hóa đơn nguồn');
 var all=rows(s),matches=all.filter(function(o){
  return String(o.id)===String(p.customerRef.id)&&Number(o.invoiceNo)===p.customerRef.invoiceNo&&!o.pairRole;
 });
 need(matches.length===1&&norm(matches[0].name).length>=2,'CTV_SOURCE_UNVERIFIED','Không tìm được khách trong sổ');
 var source=matches[0],id='ctv_'+String(source.id).replace(/[^A-Za-z0-9_-]/g,'');
 need(/^[A-Za-z0-9_-]{4,100}$/.test(id),'CTV_INVALID_ID','Không tạo được mã CTV');
 var list=JSON.parse(s.values.satori_collaborators_v1||'[]');
 need(Array.isArray(list)&&list.length<=10000,'INVALID_STATE','Danh sách CTV không hợp lệ');
 var same=list.filter(function(x){return x.id===id});
 need(same.length<=1,'INVALID_STATE','Trùng mã CTV');
 if(same.length&&same[0].markRequestId===p.requestId)
  return {modified:false,result:{duplicate:true,collaboratorId:id,active:same[0].active}};
 need(!list.some(function(x){return x.markRequestId===p.requestId}),'REQUEST_ID_CONFLICT','Mã yêu cầu đã sử dụng');
 version(s,p);
 var next={id:id,name:source.name,active:p.enabled===true,
  sourceInvoiceNo:source.invoiceNo,sourceOrderId:source.id,
  markRequestId:p.requestId,updatedAt:Date.now(),reviewedByOwner:true};
 list=list.filter(function(x){return x.id!==id});
 list.push(next);
 return {modified:true,extras:{satori_collaborators_v1:JSON.stringify(list)},
  result:{collaboratorId:id,active:next.active,duplicate:false}};
}
function configurePair(s,p){
 var id=String(p.collaboratorId||''),requestId=String(p.requestId||'');
 need(/^[A-Za-z0-9_-]{4,100}$/.test(id)&&/^[A-Za-z0-9_-]{8,100}$/.test(requestId),
 'INVALID_REQUEST','Cần mã cộng tác viên và requestId');
 need(p.confirmed===true,'CONFIRMATION_REQUIRED','Chưa duyệt bật/tắt hóa đơn đôi');
 collaborator(s,id);
 validPairPolicy(p);
 var policy=pairPolicyFor(s,id);
 var fields=['enabled','customerDiscountPercent','collaboratorDiscountPercent','shippingPercent','vatPercent'];
 var authorizedDestinations=p.authorizedDestinations===undefined?
  (Array.isArray(policy&&policy.authorizedDestinations)?policy.authorizedDestinations:[]):
  validatedCtvDestinations(s,p.authorizedDestinations);
 if(policy&&policy.configRequestId===requestId){
  need(fields.every(function(k){return policy[k]===p[k]})&&
   JSON.stringify(policy.authorizedDestinations||[])===JSON.stringify(authorizedDestinations),'REQUEST_ID_CONFLICT',
   'Cùng mã yêu cầu nhưng chính sách khác');
  return {modified:false,result:{duplicate:true,policy:policy}};
 }
 need(!pairPolicies(s).some(function(x){return x.configRequestId===requestId}),
  'REQUEST_ID_CONFLICT','Mã duyệt chính sách đã dùng');
 version(s,p);
 var next=Object.assign({},Object.fromEntries(fields.map(function(k){return [k,p[k]]})),{
  collaboratorId:id,authorizedDestinations:authorizedDestinations,policyVersion:Utilities.getUuid(),configRequestId:requestId,
  updatedAt:Date.now(),reviewedByOwner:true
 });
 var list=pairPolicies(s).filter(function(x){return x.collaboratorId!==id});
 list.push(next);
 return {modified:true,extras:{[PAIR_POLICY_KEY]:JSON.stringify(list)},
  result:{duplicate:false,policy:next}};
}
function pairRequestIntent(p){
 var o=p.order||{},items=o.items||[];
 need(typeof o.name==='string'&&o.name.trim().length>=2&&o.name.length<=150&&
  typeof o.location==='string'&&o.location.trim().length>=5&&o.location.length<=500&&
  typeof o.phone==='string'&&o.phone.length<=60&&
  Array.isArray(items)&&items.length>=1&&items.length<=6,
  'INVALID_ORDER','Cần thông tin khách và tối đa 6 mặt hàng');
 need(String(o.deliveryNote||'').length<=300&&String(o.deliveryDate||'').length<=10,
  'INVALID_ORDER','Lưu ý giao hàng hoặc ngày giao không hợp lệ');
 var normalized=items.map(function(x){
  need(x&&typeof x.code==='string'&&/^TP-[0-9]{5}$/.test(x.code)&&
    Number.isSafeInteger(x.qty)&&x.qty>=1&&x.qty<=500,'INVALID_ITEM','Sai mã hoặc số lượng sản phẩm');
  return {code:x.code,qty:x.qty};
 });
 var keys=normalized.map(function(x){return x.code});
 need(new Set(keys).size===keys.length&&normalized.reduce(function(n,x){return n+x.qty},0)<=500,
  'INVALID_ITEM','Mã sản phẩm trùng hoặc vượt quá 500 đơn vị');
 return JSON.stringify({
  collaboratorId:String(p.collaboratorId||''),policyVersion:String(p.expectedPolicyVersion||''),
  name:norm(o.name),phone:String(o.phone).replace(/\D/g,''),location:norm(o.location),
  items:normalized,deliveryNote:String(o.deliveryNote||''),deliveryDate:String(o.deliveryDate||''),
  customerRef:p.customerRef?{id:String(p.customerRef.id),invoiceNo:Number(p.customerRef.invoiceNo)}:null,
  confirmedNewCustomer:p.confirmedNewCustomer===true
 });
}
function createPair(s,all,p){
 var requestId=String(p.requestId||'');
 need(/^[A-Za-z0-9_-]{8,100}$/.test(requestId),
  'INVALID_REQUEST','Cần requestId chống gửi hai lần');
 var fingerprint=pairRequestIntent(p);
 var already=all.filter(function(o){return o.pairRequestId===requestId});
 if(already.length){
  need(already.length===2&&already.every(function(o){return o.pairIntent===fingerprint})&&
   new Set(already.map(function(o){return o.pairRole})).size===2&&
   already.every(function(o){return ['customer','collaborator'].includes(o.pairRole)})&&
   already[0].pairGroupId===already[1].pairGroupId,
   'REQUEST_ID_CONFLICT','Cặp hóa đơn của mã yêu cầu đã thay đổi hoặc bị thiếu');
  return {modified:false,result:{duplicate:true,pairGroupId:already[0].pairGroupId,
   customerInvoice:visible(already.find(function(o){return o.pairRole==='customer'})),
   collaboratorInvoice:visible(already.find(function(o){return o.pairRole==='collaborator'}))}};
 }
 need(!all.some(function(o){return o.apiRequestId===requestId})&&
  !JSON.parse(s.values.satori_trash_bin_v15||'[]').some(function(t){
   return t.order&&(t.order.apiRequestId===requestId||t.order.pairRequestId===requestId);
  }),'REQUEST_ID_CONFLICT','Mã yêu cầu đã dùng trong đơn khác hoặc thùng rác');
 version(s,p);
 var id=String(p.collaboratorId||''),partner=collaborator(s,id),
  policy=pairPolicyFor(s,id);
 need(policy&&policy.enabled===true&&policy.reviewedByOwner===true,
  'PAIR_NOT_ENABLED','Chưa bật hóa đơn đôi cho cộng tác viên này');
 validPairPolicy(policy);
 need(p.expectedPolicyVersion===policy.policyVersion,
  'PAIR_POLICY_CHANGED','Chính sách giảm giá vừa đổi, cần xác nhận lại');
 if(Array.isArray(policy.authorizedDestinations)&&policy.authorizedDestinations.length>0){
  need(p.customerRef&&policy.authorizedDestinations.some(function(d){
   return String(d.id)===String(p.customerRef.id)&&d.invoiceNo===p.customerRef.invoiceNo;
  }),'CTV_DESTINATION_NOT_APPROVED','Địa chỉ chưa được chủ duyệt');
 }
 checkProfile(all,p.order,p);
 var catalogue=JSON.parse(s.values.satori_catalogue_v15||'[]');
 need(Array.isArray(catalogue)&&catalogue.length>0&&catalogue.length<=200,
  'CATALOGUE_NOT_PERSISTED','Chưa có bảng giá chuẩn');
 var entries=new Map();
 catalogue.forEach(function(x){
  need(x&&/^TP-[0-9]{5}$/.test(x.code||'')&&!entries.has(x.code)&&
   Number.isSafeInteger(x.listPrice)&&x.listPrice>=0&&x.listPrice<=1e9&&
   typeof x.name==='string'&&x.name.length>=2&&
   typeof x.unit==='string'&&x.unit.length>0,
  'INVALID_CATALOGUE','Bảng giá nguồn có sản phẩm trùng/sai');
  entries.set(x.code,x);
 });
 var basket=p.order.items.map(function(i){
  var item=entries.get(i.code);
  need(!!item,'INVALID_ITEM','Mặt hàng không có trong bảng giá chuẩn');
  return {code:item.code,product:item.name,unit:item.unit,qty:i.qty,listPrice:item.listPrice};
 });
 var bin=JSON.parse(s.values.satori_trash_bin_v15||'[]');
 var reserved=JSON.parse(s.values.satori_deleted_invoice_nos||'[]');
 var highest=all.map(function(o){return Number(o.invoiceNo)||0})
  .concat(bin.map(function(t){return Number(t.order&&t.order.invoiceNo)||0}))
  .concat(reserved.map(function(x){return Number(x)||0}))
  .reduce(function(a,b){return Math.max(a,b)},0);
 need(Number.isSafeInteger(highest+2),'INVALID_STATE','Không thể cấp số hóa đơn');
 var first=highest+1,second=highest+2,rawId=Date.now();
 var used=new Set(all.map(function(o){return String(o.id)}).concat(
  bin.map(function(t){return String(t.order&&t.order.id)})));
 while(used.has(String(rawId))||used.has(String(rawId+1)))rawId+=2;
 var group='pair_'+Utilities.getUuid(),date=Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','dd/MM/yyyy');
 function one(role,invoiceNo,idValue,percentage,other){
  var items=basket.map(function(i){
   var price=Math.round(i.listPrice*(100-percentage)/100);
   return {id:Utilities.getUuid(),code:i.code,product:i.product,unit:i.unit,qty:i.qty,
    listPrice:i.listPrice,unitPrice:price,discountPercent:percentage,
    discountAmount:i.listPrice-price,subtotal:price*i.qty};
  });
  var goods=items.reduce(function(n,i){return n+i.subtotal},0);
  var shipping=Math.round(goods*policy.shippingPercent/100),vat=Math.round(goods*policy.vatPercent/100);
  var total=goods+shipping+vat;
  need(Number.isSafeInteger(total)&&total>=0&&total<=1e11,
   'INVALID_AMOUNT','Tiền hóa đơn không hợp lệ');
  return {id:idValue,__syncId:Utilities.getUuid(),apiRequestId:requestId,
   pairRequestId:requestId,pairIntent:fingerprint,pairGroupId:group,
   pairRole:role,pairInvoiceNo:other,collaboratorId:id,
   pairCustomerName:p.order.name.trim(),pairCollaboratorName:partner.name.trim(),
   pairPolicyVersion:policy.policyVersion,pairDiscountPercent:percentage,
   pairShippingPercent:policy.shippingPercent,pairVatPercent:policy.vatPercent,
   invoiceNo:invoiceNo,date:date,timestamp:Date.now(),
   name:role==='collaborator'?partner.name.trim():p.order.name.trim(),
   phone:String(p.order.phone||''),location:String(p.order.location||''),items:items,
   product:items.map(function(i){return i.product+' x'+i.qty}).join(', '),
   qty:items.reduce(function(n,i){return n+i.qty},0),goodsTotal:goods,
   shippingAmount:shipping,vatAmount:vat,vat:vat?'yes':'no',total:total,
   status:'Chưa thanh toán',source:'bot_api_pair',
   deliveryDate:String(p.order.deliveryDate||'').slice(0,10)||null,
   deliveryNote:String(p.order.deliveryNote||'')};
 }
 var customer=one('customer',first,rawId,policy.customerDiscountPercent,second);
 var settlement=one('collaborator',second,rawId+1,policy.collaboratorDiscountPercent,first);
 need(customer.total>settlement.total,'PAIR_POLICY_INVALID',
  'Bill khách phải cao hơn bill CTV');
 var commissionAmount=customer.goodsTotal-settlement.goodsTotal;
 need(commissionAmount>0,'PAIR_POLICY_INVALID','Hoa hồng CTV phải dương');
 customer.pairCommissionAmount=commissionAmount;
 settlement.pairCommissionAmount=commissionAmount;
 all.unshift(customer,settlement);
 return {modified:true,result:{duplicate:false,pairGroupId:group,
  customerInvoice:visible(customer),collaboratorInvoice:visible(settlement),
  difference:customer.total-settlement.total,commissionAmount:commissionAmount,customerGoodsTotal:customer.goodsTotal,collaboratorGoodsTotal:settlement.goodsTotal}};
}

function create(s,all,p,aiMode){
 var req=String(p.requestId||'');need(/^[a-zA-Z0-9_-]{8,100}$/.test(req),'INVALID_REQUEST','Thiếu requestId hợp lệ');
 var old=all.find(function(o){return o.apiRequestId===req});
 if(old){
  need(!old.pairGroupId,'REQUEST_ID_CONFLICT','Mã yêu cầu đã thuộc một cặp hóa đơn');
  if(aiMode)need(old.source==='bot_api_ai'&&old.aiPricingMemoryId===p.customerMemoryId,
   'REQUEST_ID_CONFLICT','Yêu cầu trùng mã nhưng không thuộc cùng khách AI');
  need(sameCreateIntent(old,p.order),'REQUEST_ID_CONFLICT',
   'Mã requestId đã được dùng cho nội dung đơn khác, cần tạo yêu cầu mới');
  return {modified:false,result:{order:visible(old),duplicate:true}};
 }
 var bin=JSON.parse(s.values.satori_trash_bin_v15||'[]');
 need(!bin.some(function(t){return t.order&&t.order.apiRequestId===req}),'REUSED_REQUEST_ID','Đơn cũ đã chuyển vào thùng rác');
 version(s,p);
 var o=p.order;need(o&&typeof o==='object'&&String(o.name||'').trim().length>=2,'INVALID_ORDER','Thiếu tên khách');
 need(Array.isArray(o.items)&&o.items.length>0&&o.items.length<=50,'INVALID_ORDER','Danh sách sản phẩm không hợp lệ');
 var name=String(o.name).trim(),phone=String(o.phone||''),location=String(o.location||'');
 need(name.length<=150&&phone.length<=60&&location.length<=500,'INVALID_ORDER','Thông tin khách quá dài');
 checkProfile(all,o,p);
 if(aiMode)checkAIPricing(s,o,p);
 var items=o.items.map(function(i){
  need(i&&String(i.product||i.name||'').trim().length>=2,'INVALID_ITEM','Thiếu tên sản phẩm');
  var qty=Number(i.qty),price=money(i.unitPrice);need(Number.isSafeInteger(qty)&&qty>0&&qty<=100000,'INVALID_ITEM','Sai số lượng');
  var list=i.listPrice==null?price:money(i.listPrice);
  return {id:Utilities.getUuid(),code:String(i.code||'').slice(0,50),product:String(i.product||i.name).slice(0,200),
   unit:String(i.unit||'Thùng').slice(0,30),qty:qty,unitPrice:price,listPrice:list,discountAmount:list-price,subtotal:Math.round(qty*price)};
 });
 var goods=Math.round(items.reduce(function(v,i){return v+i.qty*i.unitPrice},0));
 var ship=money(o.shippingAmount==null?0:o.shippingAmount),vat=money(o.vatAmount==null?0:o.vatAmount),total=Math.round(goods+ship+vat);
 need(total<=1e11,'INVALID_AMOUNT','Tổng tiền vượt giới hạn');
 if(o.total!==undefined)need(money(o.total)===total,'TOTAL_MISMATCH','Tổng tiền không khớp');
 var reserved=JSON.parse(s.values.satori_deleted_invoice_nos||'[]');
 var history=all.map(function(o){return Number(o.invoiceNo)||0})
  .concat(bin.map(function(t){return Number(t.order&&t.order.invoiceNo)||0}))
  .concat(reserved.map(function(n){return Number(n)||0}));
 var invoice=1+history.reduce(function(a,b){return Math.max(a,b)},0);
 need(Number.isSafeInteger(invoice)&&invoice>0,'INVALID_ORDER','Không thể cấp số hóa đơn mới');
 var id=Date.now();while(all.some(function(i){return String(i.id)===String(id)})||bin.some(function(t){return String(t.order&&t.order.id)===String(id)}))id++;
 var next={id:id,__syncId:Utilities.getUuid(),apiRequestId:req,invoiceNo:invoice,
  deliveryDate:String(o.deliveryDate||'').slice(0,10)||null,
  date:Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','dd/MM/yyyy'),timestamp:Date.now(),
  name:name,phone:phone,location:location,items:items,
  product:items.map(function(i){return i.product+' x'+i.qty}).join(', '),qty:items.reduce(function(v,i){return v+i.qty},0),
  goodsTotal:goods,shippingAmount:ship,vatAmount:vat,vat:vat?'yes':'no',total:total,status:'Chưa thanh toán',source:aiMode?'bot_api_ai':'bot_api',
  aiPricingMemoryId:aiMode?p.customerMemoryId:null,
  deliveryNote:String(o.deliveryNote||'').slice(0,1000)};
 all.unshift(next);return {modified:true,result:{order:visible(next),duplicate:false}};
}

function markPaid(s,all,p){
 version(s,p);
 need(Number.isSafeInteger(p.invoiceNo)&&p.invoiceNo>0,'INVALID_ORDER','Thiếu số hóa đơn');
 // Historical imports can share an invoiceNo. Only allow that number alone when unique.
 // An explicit id must match exactly one row alongside invoiceNo.
 var hasId=p.id!==undefined&&p.id!==null;
 need(!hasId||(typeof p.id==='string'||Number.isSafeInteger(p.id))&&String(p.id).length>0,
   'INVALID_ORDER','ID hóa đơn không hợp lệ');
 var match=all.filter(function(o){return Number(o.invoiceNo)===p.invoiceNo&&(!hasId||String(o.id)===String(p.id))});
 need(match.length===1&&active(match[0]),'INVALID_ORDER','Hóa đơn không duy nhất, không tồn tại hoặc đã hủy');
 var old=match[0];
 need(old.pairRole!=='collaborator','CTV_INTERNAL_NOT_RECEIVABLE',
  'Bill CTV nội bộ chỉ để đối soát, không ghi nhận thanh toán khách');
 // For a duplicate invoice number, require the name and total as additional guards.
 if(hasId){
   need(typeof p.expectedName==='string'&&p.expectedName.trim().length>=2&&Number.isFinite(p.expectedTotal),
     'CONFIRMATION_REQUIRED','Cần tên khách và tổng tiền xác nhận');
   need(norm(old.name)===norm(p.expectedName)&&money(old.total)===money(p.expectedTotal),
     'ORDER_CHANGED','Tên khách hoặc tổng tiền đã thay đổi');
 }
 need(p.confirmed===true,'CONFIRMATION_REQUIRED','Cần xác nhận thực nhận tiền');
 need(p.amount!==undefined&&money(p.amount)===money(old.total),'TOTAL_MISMATCH','Tiền thanh toán không khớp');
 // Never silently overwrite an already-paid invoice or its existing proof.
 if(paid(old))return {modified:false,result:{order:visible(old),alreadyPaid:true}};
 var extra={};
 if(p.receiptUrl!==undefined){
   need(typeof p.receiptUrl==='string'&&/^https:\/\/drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]{10,}\/(?:view|preview)(?:\?[^#]*)?$/.test(p.receiptUrl)&&p.receiptUrl.length<=500,
     'INVALID_RECEIPT','Chỉ nhận liên kết biên lai Google Drive hợp lệ');
   extra.customerPaymentReceiptUrl=p.receiptUrl;
 }
 if(p.receiptAt!==undefined){
   need(typeof p.receiptAt==='string'&&/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?\+07:00$/.test(p.receiptAt)&&!isNaN(Date.parse(p.receiptAt)),
     'INVALID_RECEIPT','Thời gian chuyển khoản không hợp lệ');
   extra.customerPaymentReceiptAt=p.receiptAt;
 }
 if(p.paymentNote!==undefined){
   need(typeof p.paymentNote==='string'&&p.paymentNote.length<=300,'INVALID_RECEIPT','Ghi chú thanh toán không hợp lệ');
   extra.customerPaymentNote=p.paymentNote;
 }
 var updated=Object.assign({},old,extra,{customerPaidAt:new Date().toISOString(),updatedAt:Date.now()});
 if(updated.status!=='Đã TT Satori')updated.status='Đã thanh toán';
 all[all.indexOf(old)]=updated;return {modified:true,result:{order:visible(updated),alreadyPaid:false}};
}
/**
 * Owner-authorised, bounded proof that a single customer+delivery destination
 * has a current, separately owner-approved pricing policy. A Gemini backend
 * must still authenticate the real person before using this response.
 * There is no browser/Android read path; the HMAC caller needs orders:ai:write.
 */
function readApprovedAIPricing(s,all,p){
 var id=String(p.customerMemoryId||''),ref=p.customerRef;
 need(/^[A-Za-z0-9_-]{4,100}$/.test(id)&&ref&&ref.id!=null&&
  Number.isSafeInteger(ref.invoiceNo)&&ref.invoiceNo>0,
  'INVALID_REQUEST','Cần hồ sơ khách và hóa đơn tham chiếu xác định');
 need(typeof s.values.satori_ai_customer_memory==='string',
  'AI_PRICING_NOT_APPROVED','Chưa có hồ sơ khách chính thức');
 var memory=JSON.parse(s.values.satori_ai_customer_memory),
     policies=JSON.parse(s.values[PRICE_APPROVAL_KEY]||'[]');
 need(Array.isArray(memory)&&memory.length<=10000&&Array.isArray(policies)&&policies.length<=10000,
  'INVALID_STATE','Chính sách giá hoặc hồ sơ khách không hợp lệ');
 var candidates=memory.filter(function(m){return m&&m.id===id});
 need(candidates.length===1,'AI_PRICING_NOT_APPROVED','Không có duyệt giá cho hồ sơ này');
 var m=candidates[0];
 var records=policies.filter(function(a){return a&&a.customerMemoryId===id});
 var a=records.length?records[records.length-1]:null;
 need(a&&a.enabled===true&&a.reviewedByOwner===true,
  'AI_PRICING_NOT_APPROVED','Giá chưa được người quản trị duyệt hoặc đã thu hồi');
 need(String(a.sourceOrderId)===String(ref.id)&&Number(a.sourceInvoiceNo)===ref.invoiceNo,
  'AI_PRICING_NOT_APPROVED','Hóa đơn nguồn không khớp phê duyệt');
 var matches=all.filter(function(o){
  return String(o.id)===String(ref.id)&&Number(o.invoiceNo)===ref.invoiceNo;
 });
 need(matches.length===1,'AI_CUSTOMER_UNVERIFIED','Hóa đơn tham chiếu không duy nhất');
 var o=matches[0],aliases=[m.name].concat(Array.isArray(m.aliases)?m.aliases:[]);
 var phone=String(o.phone||'').replace(/\D/g,''),loc=norm(o.location);
 need(aliases.some(function(n){return norm(n)===norm(o.name)})&&
  phone.length>=8&&loc.length>=5&&
  String(a.phone||'').replace(/\D/g,'')===phone&&norm(a.location)===loc,
  'AI_CUSTOMER_UNVERIFIED','Tên hoặc điểm giao khác phê duyệt');
 var addresses=[{phone:m.defaultPhone,location:m.defaultLocation}]
  .concat(Array.isArray(m.receivers)?m.receivers:[]);
 need(addresses.some(function(v){return v&&
  String(v.phone||'').replace(/\D/g,'')===phone&&norm(v.location)===loc;}),
  'AI_CUSTOMER_UNVERIFIED','Điểm giao không nằm trong hồ sơ đã xác minh');
 need(typeof a.discountPercent==='number'&&Number.isFinite(a.discountPercent)&&
  a.discountPercent>=0&&a.discountPercent<=70&&[0,5,8,10].includes(a.vatPercent)&&
  Number.isSafeInteger(a.shippingAmount)&&a.shippingAmount>=0&&a.shippingAmount<=1000000,
  'AI_PRICING_NOT_APPROVED','Chính sách duyệt giá không hợp lệ');
 return {revision:s.revision,source:'drive-ledger:owner-approved-pricing',
  verifiedByServer:true,pricingApprovedByOwner:true,customerMemoryId:id,
  profile:{name:o.name,phone:o.phone||'',location:o.location,
   sourceReference:{id:o.id,invoiceNo:o.invoiceNo},
   approvedDiscountPercent:a.discountPercent,vatRate:a.vatPercent,
   shippingAmount:a.shippingAmount},
  // This is NOT an authenticated login/OTP proof; caller must verify the person.
  customerLoginVerified:false};
}
function read(s,action,p){
 var all=rows(s);
 if(action==='collaborators.pair.list'){
  var ctv=JSON.parse(s.values.satori_collaborators_v1||'[]');
  need(Array.isArray(ctv)&&ctv.length<=10000,'INVALID_STATE','Danh sách cộng tác viên bị lỗi');
  return {revision:s.revision,policies:pairPolicies(s),collaborators:ctv.map(function(x){
    return {id:String(x.id||''),name:String(x.name||'').slice(0,120),active:x.active===true};
  }).filter(function(x){return /^[A-Za-z0-9_-]{4,100}$/.test(x.id)&&x.name.length>=2})};
 }
 if(action==='pricing.eligibility')return readApprovedAIPricing(s,all,p);
 if(action==='catalogue.list'){
  // Fail closed: a browser-local catalogue is not the authoritative shared ledger.
  need(typeof s.values.satori_catalogue_v15==='string','CATALOGUE_NOT_PERSISTED',
    'Bảng giá chưa được lưu đồng bộ trên Drive');
  var catalogue=JSON.parse(s.values.satori_catalogue_v15);
  need(Array.isArray(catalogue)&&catalogue.length>0&&catalogue.length<=200,
    'INVALID_CATALOGUE','Danh mục lưu trữ không hợp lệ');
  var codes={};
  var products=catalogue.map(function(item){
    need(item&&typeof item==='object'&&!Array.isArray(item)&&
      /^TP-[0-9]{5}$/.test(item.code||'')&&!codes[item.code],
      'INVALID_CATALOGUE','Mã sản phẩm trùng hoặc không hợp lệ');
    var name=String(item.name||'').trim(),unit=String(item.unit||'').trim(),
      listPrice=Number(item.listPrice),standardPrice=Number(item.unitPrice);
    need(name.length>=2&&name.length<=160&&unit.length>=1&&unit.length<=40&&
      Number.isSafeInteger(listPrice)&&listPrice>=0&&listPrice<=1e9&&
      Number.isSafeInteger(standardPrice)&&standardPrice>=0&&standardPrice<=1e9,
      'INVALID_CATALOGUE','Thông tin hoặc giá sản phẩm không hợp lệ');
    codes[item.code]=true;
    return {code:item.code,name:name,brand:String(item.brand||'').slice(0,40),
      spec:String(item.spec||'').slice(0,120),unit:unit,listPrice:listPrice,
      standardUnitPrice:standardPrice,standardDiscountPercent:Number(item.discountPercent||0)};
  });
  return {revision:s.revision,updatedAt:s.updatedAt,products:products,
    source:'drive-ledger:satori_catalogue_v15',total:products.length};
 }
 if(action==='trash.list'){
  var now=Date.now(),bin=JSON.parse(s.values.satori_trash_bin_v15||'[]');
  need(Array.isArray(bin),'INVALID_STATE','Dữ liệu thùng rác hỏng');
  var q=norm(p.query||'');
  var candidates=bin.filter(function(t){return t.order&&Number.isFinite(t.deletedAt)&&t.deletedAt<=now&&now-t.deletedAt<30*86400000&&(!t.expiresAt||t.expiresAt>now)});
  if(q)candidates=candidates.filter(function(t){var o=t.order;return [o.invoiceNo,o.name,o.phone,o.location].some(function(v){return norm(v).includes(q)})});
  return {revision:s.revision,totalMatches:candidates.length,invoices:candidates.slice(0,Math.min(100,Math.max(1,Number(p.limit)||30))).map(function(t){return {order:visible(t.order),deletedAt:t.deletedAt,expiresAt:t.expiresAt||t.deletedAt+30*86400000}})};
 }
 if(action==='system.status')return {revision:s.revision,updatedAt:s.updatedAt,orders:all.length};
 if(action==='customers.search')return {revision:s.revision,profiles:searchProfiles(all,p)};
 var found=select(all,p);
 if(action==='orders.list')return {revision:s.revision,totalMatches:found.length,orders:found.slice(0,Math.min(100,Math.max(1,Number(p.limit)||30))).map(visible)};
 if(action==='debt.summary'){
  need(typeof SatoriAccountingCore!=='undefined','CONFIG_MISSING','Thiếu AccountingCore.gs cho công nợ');
  var ledger=SatoriAccountingCore.calculate(all,[]),secondary=new Set(ledger.rows.filter(function(r){return r.secondary}).map(function(r){return r.order}));
  var excluded=found.filter(function(o){return active(o)&&secondary.has(o)}).length;
  found=found.filter(function(o){return active(o)&&!secondary.has(o)});var owed=found.filter(function(o){return !paid(o)});
  return {revision:s.revision,orders:found.length,unpaidCount:owed.length,
   excludedReferenceCount:excluded,reviewCount:ledger.rows.filter(function(r){return r.review&&found.includes(r.order)}).length,
   total:found.reduce(function(n,o){return n+Number(o.total||0)},0),
   due:owed.reduce(function(n,o){return n+Number(o.total||0)},0),
   unpaidInvoices:owed.slice(0,100).map(visible),truncated:owed.length>100};
 }
 fail('INVALID_ACTION','Lệnh không hỗ trợ');
}
function write(s,action,p){
 var all=rows(s),result=action==='collaborators.mark'?markCollaborator(s,p):
  action==='collaborators.pair.configure'?configurePair(s,p):
  action==='orders.create.pair'?createPair(s,all,p):
  action==='pricing.approve'?approveAIPricing(s,all,p):
  (action==='orders.create'||action==='orders.create.ai')?create(s,all,p,action==='orders.create.ai'):
  action==='orders.delete'?removeOrder(s,all,p):action==='orders.restore'?recoverOrder(s,all,p):markPaid(s,all,p);
 if(!result.modified)return {revision:s.revision,data:result.result};
 var props=PropertiesService.getScriptProperties(),fileId=props.getProperty('STATE_FILE_ID');
 need(!!fileId,'CONFIG_MISSING','Thiếu STATE_FILE_ID');
 var file=DriveApp.getFileById(fileId);
 var backup=file.makeCopy('MinhSatori_API_PreWrite_'+new Date().toISOString().replace(/[:.]/g,'-'));
 need(backup&&backup.getId(),'BACKUP_FAILED','Không tạo được bản sao trước ghi');
 var backedUp=JSON.parse(backup.getBlob().getDataAsString());
 need(JSON.stringify(backedUp)===JSON.stringify(s),'BACKUP_FAILED','Bản sao trước ghi không khớp dữ liệu hiện tại');
 var next={revision:s.revision+1,values:Object.assign({},s.values),updatedAt:new Date().toISOString()};
 next.values[ORDER_KEY]=JSON.stringify(all);
 if(result.extras)Object.keys(result.extras).forEach(function(k){next.values[k]=result.extras[k]});
 file.setContent(JSON.stringify(next));
 var check=state();need(check.revision===next.revision&&check.values[ORDER_KEY]===next.values[ORDER_KEY]&&
  (!result.extras||Object.keys(result.extras).every(function(k){return check.values[k]===result.extras[k]})),
  'COMMIT_UNVERIFIED','Chưa xác minh được ghi dữ liệu');
 return {revision:next.revision,data:result.result,backupCreated:true};
}
function handle(e){
 try{
  var raw=e&&e.postData&&e.postData.contents;
  need(typeof raw==='string'&&raw.length<=100000,'INVALID_REQUEST','Request quá lớn');
  var identity=auth(JSON.parse(raw)),lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
   var cache=CacheService.getScriptCache(),key='satoriapi:'+identity.nonce;
   need(!cache.get(key),'REPLAYED','Lệnh đã sử dụng');
   var s=state(),isWrite=identity.action==='collaborators.mark'||identity.action==='orders.create.pair'||identity.action==='collaborators.pair.configure'||identity.action==='orders.create'||identity.action==='orders.create.ai'||identity.action==='pricing.approve'||identity.action==='orders.delete'||identity.action==='orders.restore'||identity.action==='payments.markCustomerPaid';
   var result=isWrite?write(s,identity.action,identity.payload):{revision:s.revision,data:read(s,identity.action,identity.payload)};
   cache.put(key,'1',600);
   return json({ok:true,action:identity.action,revision:result.revision,data:result.data,backupCreated:!!result.backupCreated});
  }finally{lock.releaseLock()}
 }catch(err){return json({ok:false,error:{code:err.code||'ERROR',message:err.code?err.message:'Không xử lý được; kiểm tra nhật ký hệ thống'}})}
}
return {handle:handle};
})();
function doPost(e){return SatoriBotApi.handle(e)}


