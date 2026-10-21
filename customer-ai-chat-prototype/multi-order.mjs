/* Read the WHOLE Vietnamese shopping message before changing one shared TEST cart.
 * Every matched item must be catalogue-backed. No hallucinated pricing or identity edits.
 */
import {resolveProduct,productFor,fold} from './catalogue.mjs';

const WORDS={mot:1,hai:2,ba:3,bon:4,tu:4,nam:5,lam:5,sau:6,bay:7,tam:8,chin:9,muoi:10};
const COUNT=String.raw`(?:\d{1,3}|muoi\s+(?:mot|hai|ba|bon|nam|lam|sau|bay|tam|chin)|(?:hai|ba|bon)\s+muoi(?:\s+(?:mot|hai|ba|bon|nam|lam|sau|bay|tam|chin))?|mot|hai|ba|bon|tu|nam|lam|sau|bay|tam|chin|muoi)`;
const UNIT=String.raw`(?:thung|thg|binh|loc|chai|lon|ly)`;
const PRODUCT_START=String.raw`(?:nuoc\b|suoi\b|satori\b|hikari\b|juice\b|ep\b|oi\b|mang\b|man\b|me\b|premium\b|5\s*l\b|19\s*l\b|20\s*l\b|(?:350|500|1500)\s*ml\b|tp[- ]?\d{5}\b)`;
// Anchors require a plausible PRODUCT after a number, not a delivery hour or a price.
// The optional unit is captured separately to prevent turning loose bottles into cartons.
const ANCHORS=new RegExp('(^|[^a-z0-9-])('+COUNT+')\\s*(?:('+UNIT+')\\s+)?(?='+PRODUCT_START+')','giu');
function countOf(raw){
 if(/^\d+$/.test(raw))return Number(raw);
 const words=raw.split(/\s+/);
 if(words[0]==='muoi')return words[1]?10+(WORDS[words[1]]||0):10;
 if(words[1]==='muoi')return WORDS[words[0]]*10+(WORDS[words[2]]||0);
 return WORDS[words[0]]||0;
}
function cleanDescription(text){
 return text.replace(/^\s*(?:(?:va|voi|them|cong|cung|cho|lay|mua|dat)\s+|[,;.!?\s])+/g,'')
  .replace(/(?:[,;.!?\s]|\bva\b|\bthem\b)+$/g,'')
  .replace(/^\s*(?:nuoc ep\s+)?(?=oi hong|mang cau|man cau|me\b)/,'')
  .trim();
}
function withoutDelivery(text){
 return text.split(/(?:[,;]?\s*)(?=(?:giao|ship)\s+(?:sau|luc|vao|truoc|tam|khoang|tu|buoi)\b|(?:nho|luu y|ghi chu|goi truoc|de o)\b)/)[0];
}
function resolution(text,profile){
 const term=cleanDescription(text);
 if(!term||term.length>160)return null;
 // Brand-specific food shorthand only in QUANTITY+PRODUCT order context.
 const canonical=/^(?:oi hong|oi|mang cau|man cau|me)(?:\s+(?:satori|juice))?$/.test(term)
  ? 'nuoc ep '+term.replace(/\s+(?:satori|juice)$/,'') : term;
 const water=/^(?:(?:nuoc|suoi|nuoc suoi|satori|nuoc tinh khiet)\s+)+(350|500|1500)$/.test(canonical);
 const expanded=water?canonical+'ml':canonical;
 const match=resolveProduct(expanded,profile);
 if(match.ambiguous||!match.sku)return null;
 return productFor(match.sku)||null;
}
function needsMore(description,resolved){
 return {needMoreDetails:true,reason:'ITEM_CLARIFICATION',
 message:'Em đã nhận '+resolved.length+' loại rõ quy cách. Riêng "'+description.slice(0,70)+
 '" em chưa xác định chính xác sản phẩm hoặc đơn vị. Anh/chị nói rõ tên, dung tích và số lượng món này nhé; em chưa tạo bill.'};
}
export function parseMultiOrder(message,profile={}){
 const text=fold(message);
 const matches=[...text.matchAll(ANCHORS)].map(m=>({
  start:m.index+m[1].length,end:m.index+m[0].length,quantity:countOf(m[2]),
  unit:m[3]||null,rawQuantity:m[2]
 })).filter(m=>!(
  /^(?:350|500|1500)$/.test(m.rawQuantity)&&!m.unit&&
  /\b(?:nuoc|suoi|satori|hikari)\s*$/.test(text.slice(Math.max(0,m.start-25),m.start))
 ));
 // Catch ALL explicit quantity+unit phrases, including unrecognized products.
 // Otherwise "10 Satori 500ml, 3 trà sữa" could silently create only a partial order.
 const broad=[...text.matchAll(/(?:^|[^a-z0-9-])(\d{1,3}|muoi|mot|hai|ba|bon|nam)\s*(?:thung|thg|binh|loc|chai|lon|ly)\s+(?=[a-z])/g)];
 if(matches.length<2){
  if(matches.length&&broad.length>matches.length)
   return needsMore('món chưa có trong danh mục / chưa rõ quy cách',[]);
  return null;
 }
 if(matches.length>6)return {needMoreDetails:true,reason:'TOO_MANY_ITEMS',
  message:'Một đơn thử hỗ trợ tối đa 6 dòng sản phẩm. Anh/chị vui lòng chia thành các đơn nhỏ hơn.'};
 const items=[];
 for(let i=0;i<matches.length;i++){
  const m=matches[i],raw=text.slice(m.end,matches[i+1]?.start??text.length);
  const description=cleanDescription(withoutDelivery(raw));
  if(!Number.isSafeInteger(m.quantity)||m.quantity<1||m.quantity>500)return {
   needMoreDetails:true,reason:'INVALID_QUANTITY',
   message:'Số lượng của "'+description.slice(0,60)+'" cần từ 1 đến 500.'};
  // Don't accidentally drop an unsupported line placed between two recognized lines.
  if(/(?:[,;]|\bva\b|\bvoi\b)\s*(?:\d{1,3}|mot|hai|ba|bon|nam|muoi)\s+(?:thung|chai|binh|loc|lon|ly)?\s*[a-z]/.test(description))
   return needsMore(description,items);
  const product=resolution(description,profile);
  if(!product)return needsMore(description||'món chưa rõ',items);
  const given=m.unit==='thg'?'thung':m.unit;
  if(given&&given!==fold(product.unit))return needsMore(description+' ('+given+')',items);
  // An omitted unit is safe only when the SKU is locally unambiguous.
  items.push({sku:product.code,qty:m.quantity});
 }
 const merged=[];
 for(const it of items){
  const old=merged.find(x=>x.sku===it.sku);
  if(old)old.qty+=it.qty;else merged.push({...it});
 }
 if(merged.length>6||merged.some(x=>x.qty>500)||merged.reduce((n,x)=>n+x.qty,0)>500)
  return {needMoreDetails:true,reason:'CART_LIMIT',
   message:'Tổng số lượng tối đa là 500 đơn vị, tối đa 6 loại trong một đơn TEST.'};
 return {items:merged,source:'rules-complete-message'};
}
