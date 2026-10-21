/** Delivery-note amendment intent for an already confirmed TEST order.
 * No pricing, product, identity or payment fields can be mutated by this module.
 */
import {extractDeliveryIntent} from './delivery-intent.mjs';
export const normAmend=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d').replace(/\s+/g,' ').trim();
const vnWords={mot:1,hai:2,ba:3,bon:4,tu:4,nam:5,sau:6,bay:7,tam:8,chin:9,muoi:10};
function numericVietnameseHours(s){
 return String(s||'').replace(/\b(một|hai|ba|bốn|tư|năm|sáu|bảy|tám|chín|mười)\s+(giờ|tiếng)(?![\p{L}\p{N}])/giu,(all,word,unit)=> {
  const n=vnWords[normAmend(word)];return n?String(n)+' '+unit:all;
 });
}
export const isConfirmAmend=s=>/^(?:dung(?: roi)?|dong y|xac nhan(?: sua(?: don| hoa don)?)?|ok(?:ay)?|chinh xac|phai(?: roi)?|co|vang(?: a)?|da dung|ok em|yes)$/i.test(normAmend(s));
export const isCancelAmend=s=>/^(?:khong|khong sua(?: nua)?|huy(?: sua)?|thoi|giu nguyen|no)$/i.test(normAmend(s));
export function isAmendmentIntent(message){
 const n=normAmend(message);
 if(!n||n.length>500)return false;
 // A new product order that mentions delivery details must remain a new order.
 if(/\b(?:cho|dat|mua|order)\s+(?:toi|anh|chi|em)?\s*\d+\s*(?:thung|chai|loc|kien)/.test(n))return false;
 const instruction=/(?:\b(?:giao|ship)\s+(?:sau|truoc|luc|vao|tam|khoang|tu|trong)\b|\b(?:nho|goi truoc|de o|khong bam chuong|ghi chu|luu y)\b)/.test(n);
 const change=/(?:sua|doi|cap nhat|bo sung|them|chinh|sau khi dat|don vua|don moi|hoa don vua|hoa don moi)/.test(n);
 return instruction&&(change||/^(?:giao|ship|nho|goi truoc|ghi chu|luu y|de o|khong bam)/.test(n));
}
export function parseAmendment(message,now=new Date()){
 const normalizedWords=numericVietnameseHours(message);
 const n=normAmend(normalizedWords);
 if(!isAmendmentIntent(normalizedWords))return null;
 if(/(?:\b(?:gia|tien|ck|chiet khau|vat|thanh toan|so luong|them \d+ thung|doi san pham|huy don)\b)/.test(n))
  return {unsupported:true,clarification:'Sửa tiền, sản phẩm, VAT hoặc hủy hóa đơn cần cửa hàng kiểm tra riêng. AI chỉ hỗ trợ thêm hoặc sửa ghi chú giao hàng trên đơn TEST.'};
 const extracted=extractDeliveryIntent(normalizedWords,now);
 if(extracted.clarification)return {clarification:extracted.clarification};
 let note=extracted.deliveryNote;
 if(!note)return {clarification:'Bạn muốn bổ sung lưu ý giao hàng nào cho hóa đơn vừa đặt?'};
 // Never silently treat a time request as a confirmed delivery appointment.
 note=note.trim().replace(/\s+/g,' ');
 if(note.length>300)return {unsupported:true,clarification:'Lưu ý giao hàng không được dài quá 300 ký tự.'};
 return {note};
}
/**
 * Split on actual note separators, never the semicolon within a parenthesized
 * delivery time such as "(giờ Việt Nam; cửa hàng xác nhận)".
 */
function noteSegments(value){
 const chunks=[];let depth=0,buffer='';
 for(const ch of value){
  if(ch==='(')depth++;
  if(ch===')')depth=Math.max(0,depth-1);
  if(ch===';'&&depth===0){
   if(buffer.trim())chunks.push(buffer.trim());
   buffer='';
  }else buffer+=ch;
 }
 if(buffer.trim())chunks.push(buffer.trim());
 return chunks;
}
function isDeliverySchedule(segment){
 const n=normAmend(segment);
 // The original legacy customer note "Giao sau 2h" is a time request too.
 // Do not erase instructions like "gọi trước khi giao" or "giao ở cổng sau".
 return /^(?:khach yeu cau\s+)?(?:giao|ship)(?: hang)?\s+(?:(?:sau|truoc|luc|vao|tam|khoang|trong)\s+)(?:(?:\d{1,2}(?::\d{2})?|\d{1,2}h(?:\d{2})?|mot|hai|ba|bon|tu|nam|sau|bay|tam|chin|muoi)\b)/u.test(n);
}
export function appendDeliveryNote(original,addition){
 const old=String(original||'').trim(),fresh=String(addition||'').trim();
 if(!fresh||fresh.length>300)throw Error('INVALID_NOTE');
 const newer=noteSegments(fresh);
 const oldParts=noteSegments(old);
 // All superseded time specifications disappear, including shorthand "Giao sau
 // 2h", while unrelated customer requests remain intact, in original order.
 const freshSchedules=newer.some(isDeliverySchedule);
 const kept=freshSchedules?oldParts.filter(part=>!isDeliverySchedule(part)):oldParts;
 const combined=[...kept,...newer].filter((part,index,items)=>
  items.findIndex(x=>normAmend(x)===normAmend(part))===index).join('; ');
 if(combined.length>300)throw Error('NOTE_LIMIT');
 return combined;
}

export function latestEditableOrder(orders,profileId,now=Date.now()){
 const matches=[...orders.values()].filter(o=>o&&o.sandbox===true&&o.profileId===profileId&&!o.ownerTest)
  .sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));
 const o=matches[0];
 if(!o)return {reason:'NO_RECENT_ORDER'};
 const age=now-Date.parse(o.createdAt||'');
 if(!Number.isFinite(age)||age<0||age>24*3600_000)return {reason:'ORDER_TOO_OLD'};
 if(o.status!=='Chờ thanh toán')return {reason:'ORDER_LOCKED'};
 return {order:o};
}
