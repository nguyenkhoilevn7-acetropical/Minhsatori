/* Recognise delivery instructions separately from product/price/identity.
 * All clear instructions are still CUSTOMER REQUESTS, not store promises.
 * This module is used even when the optional Gemini API is unavailable.
 */
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().replace(/\s+/g,' ').trim();
const VN_OFFSET_MS=7*60*60*1000;
function vietnamTime(date){
 const shifted=new Date(date.getTime()+VN_OFFSET_MS);
 return shifted.toISOString().slice(11,16)+' ngày '+shifted.toISOString().slice(8,10)+'/'+shifted.toISOString().slice(5,7)+'/'+shifted.toISOString().slice(0,4);
}
function tailOfDelivery(message){
 const str=String(message||'').trim();
 // Keep the customer's original spelling and diacritics.
 const found=str.match(/(?:\b(?:giao(?:\s+hàng)?|ship)\s+(?:sau|lúc|luc|vào|vao|trước|truoc|tầm|tam|khoảng|khoang|từ|tu|buổi|buoi|sớm|som|nhanh|gấp|gap|ngay)\b|\b(?:ghi chú|ghi chu|lưu ý|luu y|nhớ|nho|gọi trước|goi truoc|để ở|de o|để trước|de truoc|đừng bấm|dung bam|không bấm|khong bam)\b|\b(?:cần|can|muốn|muon|mong|nhờ|nho)\s+(?:được\s+|duoc\s+)?(?:giao|nhận|nhan)(?:\s+hàng|\s+hang)?\s+(?:sớm|som|nhanh|gấp|gap|ngay)\b)[^]{0,280}$/iu);
 return (found?.[0]||'').replace(/^[,;\s]+|[,;\s]+$/g,'').slice(0,300);
}
export function extractDeliveryIntent(message,now=new Date()){
 const n=norm(message),tail=tailOfDelivery(message);
 if(!tail)return {deliveryNote:'',requestedDeliveryAt:null,clarification:null,source:'rules'};
 const relative=n.match(/\b(?:giao(?: hang)?|ship)\s+(?:sau|trong)\s+(\d{1,2})\s*(?:gio|tieng)(?:\s+dong ho)?\s+nua\b/);
 if(relative){
  const h=Number(relative[1]);
  if(h<1||h>24)return {deliveryNote:'',requestedDeliveryAt:null,clarification:'Anh/chị muốn giao sau bao lâu? Vui lòng ghi rõ từ 1 đến 24 giờ.',source:'rules'};
  const when=new Date(now.getTime()+h*3600000);
  return {deliveryNote:'Khách yêu cầu giao sau '+h+' giờ nữa (không sớm hơn '+vietnamTime(when)+', giờ Việt Nam).'+extraNote(tail),requestedDeliveryAt:when.toISOString(),clarification:null,source:'rules'};
 }
 const clock=n.match(/\b(?:giao(?: hang)?|ship)\s+(?:sau|luc|vao|truoc|tam|khoang|tu)\s+(\d{1,2})(?:\s*(?:gio|h)(?:\s*(\d{1,2})(?:\s*phut)?)?|:(\d{1,2}))?\s*(sang|trua|chieu|toi|dem)?\b/);
 if(clock){
  let hour=Number(clock[1]);const minute=Number(clock[2]??clock[3]??0);const period=clock[4];
  if(hour>23||minute>59)return {deliveryNote:'',requestedDeliveryAt:null,clarification:'Giờ giao chưa hợp lệ. Anh/chị vui lòng ghi rõ, ví dụ 14:00 hoặc 2 giờ chiều.',source:'rules'};
  if(!period&&hour<=12)return {deliveryNote:'',requestedDeliveryAt:null,clarification:'Anh/chị muốn giao sau '+hour+' giờ chiều (giờ cố định) hay sau '+hour+' tiếng nữa tính từ bây giờ?',source:'rules'};
  if(period==='dem'&&hour===12)hour=0;
  else if(period==='chieu'||period==='toi'||period==='dem'){if(hour<12)hour+=12}
  if(period==='trua'&&hour<11)hour+=12;
  if(period==='sang'&&hour===12)hour=0;
  if(hour>23)return {deliveryNote:'',requestedDeliveryAt:null,clarification:'Anh/chị vui lòng ghi rõ giờ giao từ 00:00 đến 23:59.',source:'rules'};
  const label=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
  const relation=/(?:giao|ship)\s+truoc/.test(n)?'trước':/(?:giao|ship)\s+(?:luc|vao|tam|khoang)/.test(n)?'vào khoảng':'sau';
  return {deliveryNote:'Khách yêu cầu giao '+relation+' '+label+( /\b(?:ngay mai|mai)\b/.test(n)?' ngày mai':/\b(?:hom nay)\b/.test(n)?' hôm nay':'')+' (giờ Việt Nam; cửa hàng xác nhận).'+extraNote(tail),requestedDeliveryAt:null,clarification:null,source:'rules'};
 }
 return {deliveryNote:tail,requestedDeliveryAt:null,clarification:null,source:'rules'};
}
function extraNote(tail){
 const m=tail.match(/(?:,|;|\s+(?:và|va)\s+)(?=\s*(?:nhớ|nho|gọi|goi|để|de|không|khong))([\s\S]*)$/iu);
 return m?' Lưu ý thêm: '+m[1].trim():'';
}
