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
 'debt.summary':'debt:read','customers.search':'customers:read','catalogue.list':'catalogue:read','orders.create':'orders:write','orders.create.ai':'orders:ai:write','pricing.approve':'pricing:approve','orders.update':'orders:write','orders.delete':'orders:delete','orders.restore':'orders:write','trash.list':'orders:read',
 'payments.markCustomerPaid':'payments:write','orders.create.test':'orders:test:write','orders.list.test':'orders:test:read'};
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
function visible(o){return {id:o.id,invoiceNo:o.invoiceNo,date:o.date,name:o.name,phone:o.phone,location:o.location,items:o.items||[],product:o.product||'',qty:o.qty||0,total:o.total,status:o.status,customerPaidAt:o.customerPaidAt||null,apiPaymentRequestId:o.apiPaymentRequestId||'',shippingAmount:o.shippingAmount||0,vatAmount:o.vatAmount||0,deliveryNote:o.deliveryNote||'',updatedAt:o.updatedAt||null,deliveryDate:o.deliveryDate||null};}
function iso(date){
 var m=String(date||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!m)return /^\d{4}-\d{2}-\d{2}$/.test(date)?date:'';
 var d=new Date(Date.UTC(+m[3],+m[2]-1,+m[1]));
 if(d.getUTCFullYear()!==+m[3]||d.getUTCMonth()+1!==+m[2]||d.getUTCDate()!==+m[1])return '';
 return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
}
function select(all,p){
 var q=norm(p.query||''),digits=String(p.query||'').replace(/\D/g,'');
 return all.filter(function(o){
  if(q&&![o.name,o.phone,o.customerCode,o.customerId,o.clientCode,o.invoiceNo].some(function(v){return norm(v).includes(q)})&&!(digits.length>=5&&String(o.phone||'').replace(/\D/g,'').includes(digits)))return false;
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
function sameCreateIntent(saved,provided){
 // A requestId is bound to the entire intended order, not just its invoice number.
 // Compare only canonical fields already persisted in the Drive ledger, so a lost
 // HTTP reply can be retried without another backup/write. Modified carts fail.
 if(!provided||typeof provided!=='object'||Array.isArray(provided)||
    !Array.isArray(provided.items)||!Array.isArray(saved.items)||
    provided.items.length!==saved.items.length)return false;
 if(norm(saved.name)!==norm(provided.name)||
    norm(saved.location)!==norm(provided.location)||
    String(saved.phone||'').replace(/\\D/g,'')!==String(provided.phone||'').replace(/\\D/g,'')||
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
  phone:String(p.phone||'').replace(/\\D/g,''),location:String(p.location||'').trim(),
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
  String(source[0].phone||'').replace(/\\D/g,'')===params.phone,
  'AI_CUSTOMER_UNVERIFIED','Hồ sơ khách, hóa đơn tham chiếu và điểm giao không khớp');
 var addresses=[{phone:cust.defaultPhone,location:cust.defaultLocation}]
  .concat(Array.isArray(cust.receivers)?cust.receivers:[]);
 need(params.phone.length>=8&&params.location.length>=5&&addresses.some(function(a){
  return a&&String(a.phone||'').replace(/\\D/g,'')===params.phone&&
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
  String(policy.phone||'').replace(/\\D/g,'')===String(o.phone||'').replace(/\\D/g,'')&&
  norm(policy.location)===norm(o.location),
  'AI_PRICING_NOT_APPROVED','Điểm giao chưa có phê duyệt giá riêng');
 var pct=policy.discountPercent,vatPct=policy.vatPercent,shipping=policy.shippingAmount;
 need(typeof pct==='number'&&Number.isFinite(pct)&&pct>=0&&pct<=70,
  'AI_PRICING_NOT_APPROVED','Mức chiết khấu chưa được xác thực');
 need([0,5,8,10].includes(vatPct)&&Number.isSafeInteger(shipping)&&shipping>=0&&shipping<=1000000,
  'AI_PRICING_NOT_APPROVED','Thuế và phí giao chưa được duyệt');
 var phone=String(o.phone||'').replace(/\\D/g,''),loc=norm(o.location);
 var name=norm(o.name),matches=[mem.name].concat(Array.isArray(mem.aliases)?mem.aliases:[]);
 need(matches.some(function(n){return norm(n)===name}),'AI_CUSTOMER_UNVERIFIED',
  'Tên khách chưa được xác minh trong sổ khách');
 var addresses=[{phone:mem.defaultPhone,location:mem.defaultLocation}]
  .concat(Array.isArray(mem.receivers)?mem.receivers:[]);
 need(phone.length>=8&&loc.length>=5&&addresses.some(function(x){
  return x&&String(x.phone||'').replace(/\\D/g,'')===phone&&norm(x.location)===loc;
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
function create(s,all,p,aiMode){
 var req=String(p.requestId||'');need(/^[a-zA-Z0-9_-]{8,100}$/.test(req),'INVALID_REQUEST','Thiếu requestId hợp lệ');
 var old=all.find(function(o){return o.apiRequestId===req});
 if(old){
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

function updateOrder(s,all,p){
 need(p.confirmed===true,'CONFIRMATION_REQUIRED','Cần xác nhận sửa hóa đơn');
 var req=String(p.requestId||'');
 need(/^[a-zA-Z0-9_-]{8,100}$/.test(req),'INVALID_REQUEST','Thiếu requestId');
 var repeated=all.find(function(o){return o.apiUpdateRequestId===req});
 if(repeated)return {modified:false,result:{order:visible(repeated),duplicate:true}};
 version(s,p);
 need(Number.isSafeInteger(p.invoiceNo)&&p.id!=null,'INVALID_ORDER','Thiếu mã hóa đơn');
 var matches=all.filter(function(o){return o.invoiceNo===p.invoiceNo&&String(o.id)===String(p.id)});
 need(matches.length===1,'ORDER_CHANGED','Hóa đơn đã thay đổi hoặc không tìm thấy');
 var old=matches[0];
 need(!paid(old)&&old.status!=='Đã TT Satori','PAID_ORDER_PROTECTED',
    'Hóa đơn đã thanh toán không được sửa tiền hàng qua API');
 need(norm(old.name)===norm(p.expectedName)&&Number(old.total)===Number(p.expectedTotal),
    'ORDER_CHANGED','Tên hoặc số tiền đã khác, hãy tải lại');
 var o=p.order;
 need(o&&typeof o==='object'&&String(o.name||'').trim().length>=2,'INVALID_ORDER','Thiếu tên khách');
 var name=String(o.name).trim(),phone=String(o.phone||'').trim(),location=String(o.location||'').trim();
 need(name.length<=150&&phone.length<=60&&location.length<=500,'INVALID_ORDER','Thông tin khách quá dài');
 need(Array.isArray(o.items)&&o.items.length>=1&&o.items.length<=50,'INVALID_ORDER','Thiếu danh sách hàng');
 var items=o.items.map(function(i){
  need(i&&String(i.product||i.name||'').trim().length>=2,'INVALID_ITEM','Thiếu sản phẩm');
  var qty=Number(i.qty),price=money(i.unitPrice);need(Number.isSafeInteger(qty)&&qty>0&&qty<=100000,'INVALID_ITEM','Sai số lượng');
  var list=i.listPrice==null?price:money(i.listPrice);
  return {id:Utilities.getUuid(),code:String(i.code||'').slice(0,50),product:String(i.product||i.name).slice(0,200),
   unit:String(i.unit||'Thùng').slice(0,30),qty:qty,unitPrice:price,listPrice:list,
   discountAmount:list-price,subtotal:Math.round(qty*price)};
 });
 var goods=items.reduce(function(v,i){return v+i.subtotal},0);
 var ship=money(o.shippingAmount==null?0:o.shippingAmount),vat=money(o.vatAmount==null?0:o.vatAmount);
 var total=Math.round(goods+ship+vat);
 need(total<=1e11,'INVALID_AMOUNT','Tổng tiền quá lớn');
 if(o.total!==undefined)need(money(o.total)===total,'TOTAL_MISMATCH','Tổng không khớp');
 var next=Object.assign({},old,{name:name,phone:phone,location:location,items:items,
  product:items.map(function(i){return i.product+' x'+i.qty}).join(', '),
  qty:items.reduce(function(v,i){return v+i.qty},0),goodsTotal:goods,
  shippingAmount:ship,vatAmount:vat,vat:vat?'yes':'no',total:total,
  deliveryNote:String(o.deliveryNote||'').slice(0,1000),
  deliveryDate:o.deliveryDate?String(o.deliveryDate).slice(0,10):old.deliveryDate,
  apiUpdateRequestId:req,updatedAt:Date.now()});
 all[all.indexOf(old)]=next;return {modified:true,result:{order:visible(next),duplicate:false}};
}
function restoreOrder(s,all,p){
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
function markPaid(s,all,p){
 need(Number.isSafeInteger(p.invoiceNo)&&p.invoiceNo>0,'INVALID_ORDER','Thiếu số hóa đơn');
 var match=all.filter(function(o){return Number(o.invoiceNo)===p.invoiceNo});
 need(match.length===1&&active(match[0]),'INVALID_ORDER','Hóa đơn không duy nhất hoặc đã hủy');
 var old=match[0];
 // Native callers bind the customer's payment to an exact invoice ID as well
 // as invoice number. Legacy ChatGPT Bot calls can omit ID for compatibility.
 if(p.id!==undefined&&p.id!==null){
  need(String(old.id)===String(p.id),'ORDER_CHANGED',
    'Hóa đơn đã thay đổi ID; tải lại trước khi xác nhận thanh toán');
 }
 // Verify confirmation and amount even on a repeated request. A lost mobile
 // response must not turn a successful payment into a revision conflict.
 need(p.confirmed===true,'CONFIRMATION_REQUIRED','Cần xác nhận thực nhận tiền');
 if(p.amount!==undefined)need(money(p.amount)===money(old.total),'TOTAL_MISMATCH','Tiền thanh toán không khớp');
 // Mobile callers supply a durable requestId; legacy Bot callers may omit it.
 // Never attribute another device's payment to this request after a lost reply.
 var paymentRequestId=p.requestId==null?'':String(p.requestId);
 if(paymentRequestId){
  need(/^[a-zA-Z0-9_-]{8,100}$/.test(paymentRequestId),
   'INVALID_REQUEST','Mã xác nhận thanh toán không hợp lệ');
  // Native requests must be bound to the invoice ID and the exact amount.
  // Historic Bot requests without requestId retain their original contract.
  need(p.id!==undefined&&p.id!==null&&String(p.id)===String(old.id),
   'ORDER_CHANGED','Thiếu hoặc không khớp ID hóa đơn để xác nhận thanh toán');
  need(p.amount!==undefined,'INVALID_AMOUNT',
   'Ứng dụng phải gửi chính xác tổng tiền hóa đơn');
 }
 if(paid(old))return {modified:false,result:{order:visible(old),alreadyPaid:true}};
 version(s,p);
 var updated=Object.assign({},old,{customerPaidAt:new Date().toISOString(),updatedAt:Date.now()});
 if(paymentRequestId)updated.apiPaymentRequestId=paymentRequestId;
 if(updated.status!=='Đã TT Satori')updated.status='Đã thanh toán';
 all[all.indexOf(old)]=updated;return {modified:true,result:{order:visible(updated),alreadyPaid:false}};
}
function read(s,action,p){
 var all=rows(s);
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
// Production ledger contains real invoices only. A TEST-marked request may
// be written solely through a separately authenticated sandbox endpoint and
// storage file; never copy it into satori_orders_v15 or increment its revision.
function hasTestMarker(p){
 if(!p||typeof p!=='object')return false;
 var target=p.order&&typeof p.order==='object'?p.order:{};
 function flag(v){return v===true||typeof v==='string'&&/^(test|testing|sandbox|test_only|test-only)$/i.test(v.trim());}
 function tagged(v){return Array.isArray(v)&&v.some(flag);}
 function markedNote(v){return typeof v==='string'&&/^\s*(?:\[TEST\]|TEST\s*ONLY\b|SANDBOX\s*ONLY\b)/i.test(v);}
 return flag(p.isTest)||flag(p.test)||flag(p.testMode)||flag(p.environment)||flag(p.mode)||
  flag(target.isTest)||flag(target.test)||flag(target.testMode)||flag(target.environment)||
  flag(target.mode)||flag(target.orderType)||flag(target.status)||
  tagged(p.tags)||tagged(target.tags)||
  markedNote(p.note)||markedNote(target.note)||markedNote(target.deliveryNote)||
  markedNote(target.name);
}
function write(s,action,p){
 need(!hasTestMarker(p),'TEST_ORDER_REQUIRES_SANDBOX',
   'Đơn TEST phải lưu trong kho thử nghiệm riêng; chưa được phép ghi vào sổ hóa đơn thật');
 var all=rows(s),result=action==='pricing.approve'?approveAIPricing(s,all,p):action==='orders.create'||action==='orders.create.ai'?create(s,all,p,action==='orders.create.ai'):action==='orders.update'?updateOrder(s,all,p):action==='orders.restore'?restoreOrder(s,all,p):action==='orders.delete'?removeOrder(s,all,p):markPaid(s,all,p);
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

function testLedger(action,p){
 var prop=PropertiesService.getScriptProperties();
 var testId=String(prop.getProperty('SATORI_TEST_STATE_FILE_ID')||'');
 var liveId=String(prop.getProperty('STATE_FILE_ID')||'');
 need(testId&&liveId&&testId!==liveId,'TEST_LEDGER_NOT_CONFIGURED','Kho TEST phải là tệp Drive khác sổ thật');
 var file=DriveApp.getFileById(testId),state;
 try{state=JSON.parse(file.getBlob().getDataAsString());}catch(e){fail('TEST_LEDGER_INVALID','Kho TEST hỏng');}
 need(state&&state.environment==='MINHSATORI_TEST_ONLY_V1'&&
   Number.isSafeInteger(state.revision)&&state.revision>=0&&
   Array.isArray(state.orders)&&state.orders.length<=1000,
   'TEST_LEDGER_INVALID','Kho TEST không được xác minh');
 if(action==='orders.list.test')return {revision:state.revision,
   data:{environment:'TEST_ONLY',financial:false,orders:state.orders.slice(-50),total:state.orders.length}};
 need(action==='orders.create.test','INVALID_ACTION','Lệnh TEST không hỗ trợ');
 need(p.confirmedSynthetic===true,'TEST_CONFIRMATION_REQUIRED','Cần xác nhận đơn TEST dùng dữ liệu giả');
 need(/^[A-Za-z0-9_-]{8,100}$/.test(String(p.requestId||'')),'INVALID_REQUEST','Mã đơn TEST không hợp lệ');
 var previous=state.orders.find(function(o){return o.requestId===p.requestId;});
 if(previous){
   need(JSON.stringify(previous.intent)===JSON.stringify(p.order),'REQUEST_ID_CONFLICT','TEST requestId đã dùng');
   return {revision:state.revision,data:{environment:'TEST_ONLY',financial:false,order:previous,duplicate:true}};
 }
 need(Number.isSafeInteger(p.expectedRevision)&&p.expectedRevision===state.revision,
   'TEST_REVISION_CONFLICT','Kho TEST vừa thay đổi');
 var o=p.order;
 need(o&&typeof o==='object'&&typeof o.name==='string'&&o.name.trim().length>=2&&
   Array.isArray(o.items)&&o.items.length>0&&o.items.length<=20&&
   o.items.every(function(i){return i&&typeof (i.product||i.name)==='string'&&
      Number.isSafeInteger(i.qty)&&i.qty>0&&i.qty<=500&&
      Number.isSafeInteger(i.unitPrice)&&i.unitPrice>=0;}),
   'INVALID_TEST_ORDER','Đơn TEST không hợp lệ');
 var nextRev=state.revision+1,ref='TEST-'+String(nextRev).padStart(6,'0');
 var added={id:ref,invoiceNo:ref,environment:'TEST_ONLY',financial:false,
  requestId:p.requestId,intent:JSON.parse(JSON.stringify(o)),createdAt:new Date().toISOString()};
 var next={environment:'MINHSATORI_TEST_ONLY_V1',revision:nextRev,orders:state.orders.concat([added])};
 file.setContent(JSON.stringify(next));
 var check;
 try{check=JSON.parse(file.getBlob().getDataAsString());}catch(e){fail('TEST_COMMIT_UNVERIFIED','Chưa xác minh ghi TEST');}
 need(JSON.stringify(check)===JSON.stringify(next),'TEST_COMMIT_UNVERIFIED','Chưa xác minh ghi TEST');
 return {revision:nextRev,data:{environment:'TEST_ONLY',financial:false,order:added,duplicate:false}};
}

function handle(e){
 try{
  var raw=e&&e.postData&&e.postData.contents;
  need(typeof raw==='string'&&raw.length<=100000,'INVALID_REQUEST','Request quá lớn');
  var identity=auth(JSON.parse(raw)),lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
   var cache=CacheService.getScriptCache(),key='satoriapi:'+identity.nonce;
   need(!cache.get(key),'REPLAYED','Lệnh đã sử dụng');
   if(identity.action==='orders.create.test'||identity.action==='orders.list.test'){
    var t=testLedger(identity.action,identity.payload);cache.put(key,'1',600);
    return json({ok:true,action:identity.action,revision:t.revision,data:t.data,backupCreated:false});
   }
   var s=state(),isWrite=identity.action==='orders.create'||identity.action==='orders.create.ai'||identity.action==='pricing.approve'||identity.action==='orders.update'||identity.action==='orders.restore'||identity.action==='orders.delete'||identity.action==='payments.markCustomerPaid';
   var result=isWrite?write(s,identity.action,identity.payload):{revision:s.revision,data:read(s,identity.action,identity.payload)};
   cache.put(key,'1',600);
   return json({ok:true,action:identity.action,revision:result.revision,data:result.data,backupCreated:!!result.backupCreated});
  }finally{lock.releaseLock()}
 }catch(err){return json({ok:false,error:{code:err.code||'ERROR',message:err.code?err.message:'Không xử lý được; kiểm tra nhật ký hệ thống'}})}
}
function executeVerified(action,payload,nonce) {
 need(Object.prototype.hasOwnProperty.call(SCOPES,action),'INVALID_ACTION','Lệnh không hỗ trợ');
 need(typeof nonce==='string'&&/^[A-Za-z0-9_-]{12,100}$/.test(nonce),
   'INVALID_REQUEST','Thiếu mã yêu cầu');
 var p=payload||{};
 need(p&&typeof p==='object'&&!Array.isArray(p),'INVALID_REQUEST','Payload không hợp lệ');
 var lock=LockService.getScriptLock();lock.waitLock(30000);
 try {
  var cache=CacheService.getScriptCache(),key='satorimobile:'+nonce;
  need(!cache.get(key),'REPLAYED','Không gửi lặp thao tác');
  if(action==='orders.create.test'||action==='orders.list.test'){
   var t=testLedger(action,p);cache.put(key,'1',600);
   return {ok:true,action:action,revision:t.revision,data:t.data,backupCreated:false};
  }
  var s=state(),writeAction=['orders.create','orders.update','orders.delete',
   'orders.restore','payments.markCustomerPaid'].includes(action);
  var result=writeAction?write(s,action,p):{revision:s.revision,data:read(s,action,p)};
  cache.put(key,'1',600);
  return {ok:true,action:action,revision:result.revision,data:result.data,
    backupCreated:!!result.backupCreated};
 }finally{lock.releaseLock()}
}
return {handle:handle,executeVerified:executeVerified};
})();
function doPost(e){return e&&e.parameter&&e.parameter.route==='android'?SatoriMobileApi.handle(e):SatoriBotApi.handle(e)}

