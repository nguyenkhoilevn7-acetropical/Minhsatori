'use strict';
const {createHash, timingSafeEqual} = require('node:crypto');

const text = v => String(v ?? '').trim();
const fold = v => text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/\s+/g,' ');
const phone = v => text(v).replace(/\D/g,'');
const paid = o => o.status === 'Đã thanh toán' || Boolean(o.customerPaidAt);
const active = o => !['Đã hủy','Không Tính'].includes(o.status);
const hash = data => createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');
function dateISO(v) {
  const s=text(v); if(!s) return null;
  let y,m,d,match;
  if((match=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) [,y,m,d]=match;
  else if((match=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [,d,m,y]=match;
  else return null;
  const dt=new Date(Date.UTC(+y,+m-1,+d));
  return dt.getUTCFullYear()===+y && dt.getUTCMonth()===+m-1 && dt.getUTCDate()===+d
    ? [y,String(+m).padStart(2,'0'),String(+d).padStart(2,'0')].join('-') : null;
}
function error(code, message, status=400) {
  const e=new Error(message); e.status=status;e.code=code;return e;
}
function money(v,k) {
  const n=Number(v);
  if(v===null || v==='' || !Number.isFinite(n) || n<0 || n>1e12) throw error('INVALID_AMOUNT',k+' phải là số hợp lệ, không âm');
  return n;
}
function validateOrder(value, {legacy=false}={}) {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw error('INVALID_ORDER','Hóa đơn không hợp lệ');
  if(legacy) return structuredClone(value);
  const o=structuredClone(value);
  if(!text(o.name) || text(o.name).length>300) throw error('CUSTOMER_REQUIRED','Cần tên khách hàng (tối đa 300 ký tự)');
  if(!dateISO(o.date)) throw error('DATE_REQUIRED','Ngày phải là YYYY-MM-DD hoặc DD/MM/YYYY');
  for (const k of ['phone','location','product']) if(text(o[k]).length>1200) throw error('FIELD_TOO_LONG', k+' quá dài');
  if(!Array.isArray(o.items) || o.items.length===0 || o.items.length>100) throw error('ITEMS_REQUIRED','Cần danh sách sản phẩm');
  o.items=o.items.map((it,i)=>{
    if(!it || typeof it!=='object' || Array.isArray(it)) throw error('INVALID_ITEM','Sản phẩm '+(i+1)+' không hợp lệ');
    if(!text(it.product || it.name || it.code)) throw error('ITEM_NAME_REQUIRED','Thiếu tên/mã sản phẩm '+(i+1));
    const qty=Number(it.qty), price=money(it.unitPrice,'Đơn giá');
    if(!Number.isFinite(qty)||qty<=0||qty>1e6) throw error('INVALID_QTY','Số lượng sản phẩm '+(i+1)+' phải > 0');
    return {...it,qty,unitPrice:price};
  });
  const goods=o.items.reduce((s,it)=>s+it.qty*it.unitPrice,0);
  const extra=money(o.shippingAmount ?? 0,'Phí giao hàng')+money(o.vatAmount ?? 0,'VAT');
  if(o.total===undefined) o.total=Math.round((goods+extra)*100)/100;
  else {
    o.total=money(o.total,'Tổng tiền');
    if(Math.abs(o.total-(goods+extra))>1) throw error('TOTAL_MISMATCH','Tổng tiền khác số tiền sản phẩm + VAT + ship; cần kiểm tra trước khi lưu');
  }
  o.name=text(o.name);o.phone=text(o.phone);o.location=text(o.location);
  o.status=o.status || 'Chưa thanh toán';
  if(!['Chưa thanh toán','Đã thanh toán','Đã TT Satori','Đã hủy','Không Tính'].includes(o.status)) throw error('INVALID_STATUS','Trạng thái không hợp lệ');
  if(JSON.stringify(o).length>250000) throw error('ORDER_TOO_LARGE','Hóa đơn vượt giới hạn, hãy dùng liên kết Drive cho ảnh');
  return o;
}
function orderFields(o) {
  return {orderDate:dateISO(o.date),customerSearch:fold(o.name),phoneSearch:phone(o.phone),
    invoiceNo:Number.isSafeInteger(Number(o.invoiceNo))?Number(o.invoiceNo):null, total:Number(o.total)||0, status:text(o.status)};
}
function authorize(header, configuredKeys) {
  const matched=/^Bearer ([A-Za-z0-9_\-\.]{32,256})$/.exec(header||'');
  if(!matched) throw error('UNAUTHORIZED','Cần Bearer token',401);
  const digest=Buffer.from(hash(matched[1]),'hex');
  // Compare every key in constant time; no plain API keys are stored in configuration.
  let key=null;
  for (const candidate of configuredKeys) {
    if(!/^[a-f0-9]{64}$/i.test(candidate.sha256||'')) continue;
    if(timingSafeEqual(digest,Buffer.from(candidate.sha256,'hex'))) key=candidate;
  }
  if(!key) throw error('UNAUTHORIZED','API key không hợp lệ',401);
  return key;
}
function safeCSV(v) {
  let s=text(v).replace(/\r?\n/g,' ');
  if(/^[\s]*[=+\-@]/.test(s)) s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
function previewLegacy(payload) {
  if(!payload || typeof payload!=='object') throw error('INVALID_IMPORT','Thiếu dữ liệu nhập');
  const snapshot=payload.snapshot;
  const list = Array.isArray(snapshot?.orders) ? snapshot.orders : (() => {
    try {return JSON.parse(snapshot?.values?.satori_orders_v15||'null');}
    catch{throw error('INVALID_IMPORT','Không đọc được satori_orders_v15');}
  })();
  if(!Array.isArray(list) || !list.length) throw error('EMPTY_IMPORT','Không chấp nhận dữ liệu hóa đơn trống');
  if(list.length>100000) throw error('IMPORT_TOO_LARGE','Vượt số lượng hóa đơn cho phép');
  const ids=new Set();let invalid=0;
  for(let i=0;i<list.length;i++){
    const row=list[i];if(!row||typeof row!=='object'||Array.isArray(row)) throw error('INVALID_IMPORT','Dòng '+i+' không hợp lệ');
    if(!Object.hasOwn(row,'id') || row.id===null || !String(row.id).trim()) throw error('MISSING_ID','Hóa đơn '+i+' thiếu id; không tự ghép');
    const id=String(row.id);
    if(ids.has(id)) throw error('DUPLICATE_ID','Có id trùng nhau: '+id);
    ids.add(id);
    if(!dateISO(row.date)) invalid++;
  }
  const checksum=hash(snapshot);
  return {snapshot,orders:list,checksum,count:list.length,invalidDates:invalid};
}
module.exports={fold,phone,paid,active,hash,dateISO,error,validateOrder,orderFields,authorize,safeCSV,previewLegacy};
