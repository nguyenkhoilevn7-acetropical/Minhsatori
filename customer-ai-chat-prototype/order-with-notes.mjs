/**
 * Understand ONE whole Vietnamese customer message: products + "Lưu ý" +
 * delivery time. This is deliberately stricter than the generative model:
 * Gemini can suggest a clarification but never invent an unmentioned SKU.
 */
import {fold,resolveProduct,productFor} from './catalogue.mjs';
import {parseOneClause} from './multi-order.mjs';
import {extractDeliveryIntent} from './delivery-intent.mjs';

const noteStart=/(?:^|[\s,.;])((?:lưu\s*ý|luu\s*y|ghi\s*chú|ghi\s*chu|nhớ|nho|gọi\s+trước|goi\s+truoc|giao\s+(?:sau|lúc|luc|vào|vao|trước|truoc|tầm|tam|khoảng|khoang))(?=\s|$|[.,;]))/iu;

/* Everyday Vietnamese delivery notes do not require the words "lưu ý".
 * Preserve spoken instructions, never invent a guaranteed delivery time.
 * Accent folding below maintains the original character offsets.
 */
const naturalNote=/\b(?:giao(?:\s+hang)?|ship)\s+(?:(?:giup|cho)\s+(?:anh|chi|em|minh|toi)\s+)?(?:som|nhanh|gap|ngay)\b|\b(?:can|muon|mong|nho)\s+(?:duoc\s+)?(?:giao|nhan)(?:\s+hang)?\s+(?:som|nhanh|gap|ngay)\b|\b(?:de|dat)\s+(?:o|truoc)\s+(?:cua|cong|bao ve|le tan)\b|\b(?:dung|khong)\s+(?:bam\s+chuong|goi\s+dien)\b/u;
const customerQuestionOnly=/^(?:ben\s+(?:em|minh)\s+)?(?:co\s+)?(?:giao|ship)\s+(?:som|nhanh|gap)\s+(?:khong|ko|duoc\s+khong)\s*[?.!]*$/u;
function foldedWithOffsets(v){return String(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d')}

export function splitOrderAndNote(message){
 const raw=String(message||'').trim();
 const match=noteStart.exec(raw);
 if(!match){
  const folded=foldedWithOffsets(raw);
  if(customerQuestionOnly.test(folded.trim()))return {orderText:raw,noteText:''};
  const natural=naturalNote.exec(folded);
  if(!natural)return {orderText:raw,noteText:''};
  const before=raw.slice(0,natural.index).trim();
  // Polite requests such as "Anh muốn giao sớm" have no ordered SKU.
  if(!/\b\d{1,3}\s*(?:thung|thg|binh|loc|chai|lon|suoi|nuoc|oi|mang|me|satori|hikari|ml)\b/i.test(foldedWithOffsets(before)))
   return {orderText:'',noteText:raw};
  return {orderText:before.replace(/[\s,.;]+$/,'').trim(),noteText:raw.slice(natural.index).trim()};
 }
 const start=match.index+match[0].indexOf(match[1]);
 return {orderText:raw.slice(0,start).replace(/[\s,.;]+$/,'').trim(),
  noteText:raw.slice(start).trim()};
}
const numbers={mot:1,hai:2,ba:3,bon:4,tu:4,nam:5,lam:5,sau:6,bay:7,tam:8,chin:9,muoi:10};
function qtyOf(input){
 const s=fold(input);
 if(/^\d{1,3}$/.test(s))return +s;
 if(s==='muoi')return 10;
 if(/^muoi /.test(s))return 10+(numbers[s.split(' ')[1]]||0);
 return numbers[s]||0;
}
const quantity='(?:\\d{1,3}|muoi(?:\\s+(?:mot|hai|ba|bon|nam|lam|sau|bay|tam|chin))?|mot|hai|ba|bon|tu|nam|lam|sau|bay|tam|chin)';
const segmentRe=new RegExp('^('+quantity+')(?:\\s+(thung|thg|binh|loc|chai|lon|ly))?\\s+(.+)$','u');
const prefix=/^(?:(?:cho|lay|dat|mua|can|them|order)\s+(?:(?:toi|anh|chi|em|minh)\s+)?|(?:anh|chi|em|minh|toi)\s+(?:lay|dat|mua|cho|can)\s+)+/;
export function parseCustomerMessage(message,profile={}){
 const {orderText,noteText}=splitOrderAndNote(message);
 const delivery=noteText?extractDeliveryIntent(noteText):null;
 if(!orderText)return noteText?{kind:'note-only',delivery,noteText}:null;
 // A single product with no note is still owned by the existing order pipeline.
 if(!noteText&&!/[,;\n]|\s+va\s+/u.test(fold(orderText)))return null;
 const clauses=fold(orderText).split(/\s*[,;\n]\s*|\s+va\s+/u).map(s=>s.trim()).filter(Boolean);
 if(clauses.length===0||clauses.length>6)return {kind:'invalid',message:'Một đơn có tối đa 6 loại sản phẩm.'};
 const items=[];let water=null;
 for(const text of clauses){
  const cleaned=text.replace(prefix,'').trim();
  const match=cleaned.match(segmentRe);
  if(!match)return {kind:'invalid',message:'Em chưa xác định được số lượng và tên của tất cả món. Anh/chị vui lòng ghi lại món chưa rõ; giỏ chưa thay đổi.'};
  const count=qtyOf(match[1]),unit=match[2]==='thg'?'thung':match[2]||null;
  const name=match[3].trim();
  if(!Number.isSafeInteger(count)||count<1||count>500)return {kind:'invalid',message:'Số lượng phải từ 1 đến 500.'};
  const generic=name.match(/^(?:(?:nuoc\s+)?suoi)(?:\s+(satori|hikari))?(?:\s+(350|500|1500)(?:\s*ml)?)?$/u);
  if(generic){
   if(unit&&unit!=='thung')return {kind:'invalid',message:'Nước suối đang chọn đơn vị khác thùng. Xin ghi rõ đúng quy cách, em chưa cộng hàng.'};
   const brand=generic[1]||'satori',size=generic[2]?Number(generic[2]):null;
   if(!brand||!size){
    if(water)return {kind:'invalid',message:'Có hai loại nước suối chưa rõ. Vui lòng nói rõ từng loại để tránh nhầm.'};
    water={qty:count,brand,size,unit:'thung'};
    continue;
   }
   const resolved=resolveProduct(brand+' '+size+'ml'),product=productFor(resolved.sku);
   if(resolved.ambiguous||!product||fold(product.unit)!=='thung'||
      !new RegExp(size+'\\s*ml','i').test(product.name))
    return {kind:'invalid',message:'Không tìm thấy đúng loại '+brand+' '+size+'ml trong danh mục. Em chưa thêm hàng.'};
   items.push({sku:product.code,qty:count});
   continue;
  }
  const parsed=parseOneClause(cleaned,profile);
  if(!parsed)return {kind:'invalid',message:'Em chưa xác định được "'+name.slice(0,65)+'" trong bảng sản phẩm. Các món chưa được thêm vào giỏ.'};
  items.push(parsed);
 }
 const grouped=[];
 for(const item of items){const same=grouped.find(x=>x.sku===item.sku);if(same)same.qty+=item.qty;else grouped.push({...item})}
 if(grouped.length+(water?1:0)>6||grouped.reduce((sum,x)=>sum+x.qty,water?.qty||0)>500)
  return {kind:'invalid',message:'Giỏ vượt giới hạn 6 sản phẩm hoặc tổng 500 đơn vị.'};
 return {kind:'order',items:grouped,water,delivery,noteText};
}
export function waterAnswer(message){
 const s=fold(message).replace(/[.!?]+$/,'').trim();
 if(!/^(?:(?:nuoc\s+)?suoi\s+)?(?:(?:satori|hikari)(?:\s+(?:350|500|1500)(?:\s*ml)?)?|(?:350|500|1500)(?:\s*ml)?)$/.test(s))return null;
 const brand=s.match(/\b(satori|hikari)\b/)?.[1]||'satori';
 const size=Number(s.match(/\b(350|500|1500)(?:\s*ml)?\b/)?.[1])||null;
 return {brand,size};
}
export function finishWater(pending,answer){
 if(!pending?.water||!answer)return null;
 const water={...pending.water,brand:answer.brand||pending.water.brand||'satori',size:answer.size||pending.water.size};
 if(!water.brand||!water.size)return {...pending,kind:'clarify',water};
 const found=resolveProduct(water.brand+' '+water.size+'ml'),product=productFor(found.sku);
 if(found.ambiguous||!product||fold(product.unit)!=='thung'||!new RegExp(water.size+'\\s*ml','i').test(product.name))
  return {kind:'invalid',message:'Không có đúng quy cách '+water.brand+' '+water.size+'ml để bán theo thùng. Chưa thêm món nào.'};
 const items=pending.items.map(x=>({...x}));
 const row=items.find(x=>x.sku===product.code);
 if(row)row.qty+=water.qty;else items.push({sku:product.code,qty:water.qty});
 if(items.length>6||items.some(x=>x.qty>500)||items.reduce((n,x)=>n+x.qty,0)>500)
  return {kind:'invalid',message:'Tổng số lượng vượt giới hạn đơn.'};
 return {kind:'order',items,water:null,delivery:pending.delivery,noteText:pending.noteText};
}
export function deliveryAnswer(note,reply){
 const n=fold(reply).trim();
 if(!/^(?:(?:giao|sau|luc|vao)\s+)*(?:2\s*(?:h|gio)\s+chieu|14\s*(?:h|:00)?|hai\s+gio\s+chieu|2\s+tieng\s+nua)$/.test(n))return null;
 const suffix=/tieng\s+nua$/.test(n)?'giao sau 2 tiếng nữa':'giao sau 2 giờ chiều';
 return extractDeliveryIntent(suffix);
}
