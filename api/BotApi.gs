/**
 * Minh Satori bot integration — staging only.
 * Add to the SAME Google Apps Script project as readState_()/driveCommit().
 * The shared getScriptLock prevents lost updates between bots and website.
 * This GitHub branch is NOT deployed, and contains no credentials.
 */
var SatoriBotApi=(function(){
'use strict';
var ORDER_KEY='satori_orders_v15';
var SCOPES={'system.status':'orders:read','orders.list':'orders:read',
 'customers.list':'customers:read','customers.upsert':'customers:write',
 'debt.summary':'debt:read','customers.search':'customers:read','orders.create':'orders:write','orders.delete':'orders:delete',
 'trash.list':'orders:read','orders.restore':'orders:write',
 'payments.markCustomerPaid':'payments:write'};
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
function visible(o){return {id:o.id,invoiceNo:o.invoiceNo,date:o.date,name:o.name,phone:o.phone,location:o.location,items:o.items||[],product:o.product||'',qty:o.qty||0,total:o.total,status:o.status,customerPaidAt:o.customerPaidAt||null};}
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
function create(s,all,p){
 var req=String(p.requestId||'');need(/^[a-zA-Z0-9_-]{8,100}$/.test(req),'INVALID_REQUEST','Thiếu requestId hợp lệ');
 var old=all.find(function(o){return o.apiRequestId===req});if(old)return {modified:false,result:{order:visible(old),duplicate:true}};
 var bin=JSON.parse(s.values.satori_trash_bin_v15||'[]');
 need(!bin.some(function(t){return t.order&&t.order.apiRequestId===req}),'REUSED_REQUEST_ID','Đơn cũ đã chuyển vào thùng rác');
 version(s,p);
 var o=p.order;need(o&&typeof o==='object'&&String(o.name||'').trim().length>=2,'INVALID_ORDER','Thiếu tên khách');
 need(Array.isArray(o.items)&&o.items.length>0&&o.items.length<=50,'INVALID_ORDER','Danh sách sản phẩm không hợp lệ');
 var name=String(o.name).trim(),phone=String(o.phone||''),location=String(o.location||'');
 need(name.length<=150&&phone.length<=60&&location.length<=500,'INVALID_ORDER','Thông tin khách quá dài');
 checkProfile(all,o,p);
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
  goodsTotal:goods,shippingAmount:ship,vatAmount:vat,vat:vat?'yes':'no',total:total,status:'Chưa thanh toán',source:'bot_api'};
 all.unshift(next);return {modified:true,result:{order:visible(next),duplicate:false}};
}
function markPaid(s,all,p){
 version(s,p);need(Number.isSafeInteger(p.invoiceNo)&&p.invoiceNo>0,'INVALID_ORDER','Thiếu số hóa đơn');
 var match=all.filter(function(o){return Number(o.invoiceNo)===p.invoiceNo});
 need(match.length===1&&active(match[0]),'INVALID_ORDER','Hóa đơn không duy nhất hoặc đã hủy');
 var old=match[0];if(paid(old))return {modified:false,result:{order:visible(old),alreadyPaid:true}};
 need(p.confirmed===true,'CONFIRMATION_REQUIRED','Cần xác nhận thực nhận tiền');
 if(p.amount!==undefined)need(money(p.amount)===money(old.total),'TOTAL_MISMATCH','Tiền thanh toán không khớp');
 var updated=Object.assign({},old,{customerPaidAt:new Date().toISOString(),updatedAt:Date.now()});
 if(updated.status!=='Đã TT Satori')updated.status='Đã thanh toán';
 all[all.indexOf(old)]=updated;return {modified:true,result:{order:visible(updated),alreadyPaid:false}};
}
var CUSTOMER_PROFILES_KEY='satori_customer_profiles_v1';
function storedProfiles(s){
 var raw=JSON.parse(s.values[CUSTOMER_PROFILES_KEY]||'[]');
 need(Array.isArray(raw)&&raw.length<=2000,'CUSTOMER_DATA_INVALID','Hồ sơ khách hàng không hợp lệ');
 return raw;
}
function saveCustomer(s,p){
 version(s,p);
 need(p&&p.confirmed===true,'CONFIRMATION_REQUIRED','Cần quản trị xác nhận tạo khách');
 var x=p.customer||{},name=String(x.name||'').trim(),phone=String(x.phone||'').replace(/[^0-9+\-\s]/g,'').trim();
 var location=String(x.location||'').trim(),digits=phone.replace(/\D/g,'');
 need(name.length>=2&&name.length<=150&&location.length>=8&&location.length<=500&&
  digits.length>=9&&digits.length<=11&&phone.length<=30&&
  !/[\u0000-\u001f]/.test(name+location),'INVALID_CUSTOMER',
  'Phải nhập tên, điện thoại và địa chỉ hợp lệ');
 var existing=storedProfiles(s),identity=[norm(name),digits,norm(location)].join('|');
 need(!existing.some(function(o){return [norm(o.name),String(o.phone||'').replace(/\D/g,''),norm(o.location)].join('|')===identity}),
  'CUSTOMER_ALREADY_EXISTS','Người nhận này đã có trong danh bạ');
 var id='crm:'+Utilities.getUuid();
 var profile={id:id,name:name,phone:phone,location:location,createdAt:new Date().toISOString(),
  updatedAt:new Date().toISOString(),source:'minh-satori-drive-customer-profiles'};
 existing.push(profile);
 return {modified:true,extras:(function(){var x={};x[CUSTOMER_PROFILES_KEY]=JSON.stringify(existing);return x})(),
  result:{profile:profile,created:true}};
}
function read(s,action,p){
 var all=rows(s);
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
 if(action==='customers.list')return {revision:s.revision,profiles:storedProfiles(s)};
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
 var all=rows(s),result=action==='customers.upsert'?saveCustomer(s,p):
  action==='orders.create'?create(s,all,p):action==='orders.delete'?removeOrder(s,all,p):
  action==='orders.restore'?recoverOrder(s,all,p):markPaid(s,all,p);
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
   var s=state(),isWrite=identity.action==='customers.upsert'||identity.action==='orders.create'||identity.action==='orders.delete'||identity.action==='orders.restore'||identity.action==='payments.markCustomerPaid';
   var result=isWrite?write(s,identity.action,identity.payload):{revision:s.revision,data:read(s,identity.action,identity.payload)};
   cache.put(key,'1',600);
   return json({ok:true,action:identity.action,revision:result.revision,data:result.data,backupCreated:!!result.backupCreated});
  }finally{lock.releaseLock()}
 }catch(err){return json({ok:false,error:{code:err.code||'ERROR',message:err.code?err.message:'Không xử lý được; kiểm tra nhật ký hệ thống'}})}
}
return {handle:handle};
})();
function doPost(e){return SatoriBotApi.handle(e)}


