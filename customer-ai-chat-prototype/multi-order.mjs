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
// A structured model may segment a long sentence, but only this catalogue-backed
// local validator may resolve each *verbatim* fragment into a billable line.
export function parseOneClause(message,profile={}){
 const n=fold(message),matches=[...n.matchAll(ANCHORS)];
 if(matches.length!==1)return null;
 const m=matches[0],quantity=countOf(m[2]),spoken=m[3]==='thg'?'thung':m[3];
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>500)return null;
 const description=cleanDescription(withoutDelivery(n.slice(m.index+m[0].length)));
 const product=resolution(description,profile);
 if(!product||(spoken&&spoken!==fold(product.unit)))return null;
 return {sku:product.code,qty:quantity};
}

/**
 * An order can contain valid catalogue items and one water shorthand with no
 * brand/size: "10 thùng suối, 2 thùng mãng cầu, 3 ổi".
 * Keep ALL known items in a pending, uncommitted request; do not mutate the
 * cart until the customer selects a real water SKU. "3 ổi" means three
 * catalogue cartons, never three loose cans.
 */
export function parseWaterClarificationBasket(message,profile={}){
 const text=fold(message);
 const chunks=text.split(/\s*[,;\n]\s*|\s+va\s+/u).map(x=>x.trim()).filter(Boolean);
 if(chunks.length>6||!chunks.length)return null;
 // A single vague 'nước' may resolve from an established confirmed favourite;
 // a spoken 'suối' without brand must never be guessed from favourites.
 if(chunks.length===1&&!/\bsuoi\b/.test(text))return null;
 const items=[];let missing=null;
 for(const chunk of chunks){
  const simplified=chunk.replace(/^(?:(?:cho|lay|dat|mua|them|can)\s+(?:(?:toi|anh|chi|em|minh)\s+)?|(?:anh|chi|em|minh|toi)\s+(?:lay|dat|mua|cho|can)\s+)/,'');
  const m=simplified.match(/^(\d{1,3})\s*(?:(thung|thg|binh|loc|chai|lon|ly)\s+)?(.+?)\s*[.!?]*$/u);
  if(!m)return null;
  const qty=Number(m[1]),unit=m[2]==='thg'?'thung':(m[2]||null),name=m[3].trim();
  if(!Number.isSafeInteger(qty)||qty<1||qty>500)return null;
  const water=name.match(/^(?:(?:nuoc\s+)?suoi|nuoc\s+tinh\s+khiet|nuoc)(?:\s+(350|500|1500)(?:\s*ml)?)?$/u);
  // Preserve legacy explicit "nước 500ml" Satori shorthand; only bare
  // "suối" and unsized "nước" require clarification here.
  if(water&&(/\bsuoi\b/.test(name)||!water[1])){
   if(unit&&unit!=='thung')return null; // Do not reinterpret bottles or litres as cartons.
   if(!unit&&!water[1])return null; // Bare "10 suối" has no safe packaging unit.
   if(missing)return null; // Multiple ambiguous waters must be specified individually.
   missing={qty,unit:'thung',size:water[1]?Number(water[1]):null};
   continue;
  }
  const parsed=parseOneClause(simplified,profile);
  if(!parsed)return null; // Unknown line: never create a partial order.
  items.push(parsed);
 }
 if(!missing)return null;
 const total=missing.qty+items.reduce((n,x)=>n+x.qty,0);
 if(total>500)return {needMoreDetails:true,reason:'CART_LIMIT',
  message:'Đơn tối đa 500 đơn vị. Anh/chị vui lòng điều chỉnh số lượng.'};
 return {needMoreDetails:true,reason:'WATER_REQUIRES_BRAND_OR_SIZE',
  pending:{items,water:missing},source:'clarify-water-with-full-basket'};
}

/**
 * Catalogue-backed colloquial order parsing. Customers can omit the package
 * word only for a UNIQUE SKU. Ambiguous 5-litre water remains an unresolved
 * line; the rest of the request is kept without touching the basket.
 * Examples: "ba me", "3 me, 2 oi", "them 3 me, suoi 5 lit".
 */
export function parseColloquialBasket(message,profile={}){
 const raw=fold(message).replace(/\b(5)\s*(?:lit|l|liter)\b/g,'$1l');
 const chunks=raw.split(/\s*[,;\n]\s*|\s+(?:va|voi)\s+/u).map(x=>x.trim()).filter(Boolean);
 if(!chunks.length||chunks.length>6)return null;
 const grouped=chunks.length>1;
 if(!grouped&&!/\b(?:suoi|nuoc|5l)\b/.test(raw))return null;
 const recognized=[],unresolved=[];
 const prefix=new RegExp('^\\s*(?:cho\\s+(?:(?:toi|anh|chi|em)\\s+)?|(?:anh|chi|em|minh)\\s+(?:lay|mua|dat|cho)\\s+|them\\s+|bo\\s+sung\\s+|lay\\s+|mua\\s+|dat\\s+|can\\s+)*','u');
 const numeric=new RegExp('^('+COUNT+')(?:\\s+('+UNIT+'))?\\s+(.+)
 const n=fold(message).replace(/[.!?]+$/,'').trim();
 if(!/^(?:satori|hikari|350|500|1500|ml|\s)+$/.test(n))return null;
 const brands=[...n.matchAll(/\b(satori|hikari)\b/g)].map(m=>m[1]);
 const sizes=[...n.matchAll(/\b(350|500|1500)(?:\s*ml)?\b/g)].map(m=>Number(m[1]));
 if(new Set(brands).size>1||new Set(sizes).size>1||(!brands.length&&!sizes.length))return null;
 return {brand:brands[0]||null,size:sizes[0]||null};
}

export function looksCompoundOrder(message){
 const n=fold(message);
 const obvious=/\b(?:va|voi|cung|them)\b/.test(n)||/[,;\n]/.test(n);
 if(!obvious)return false;
 // Mixed natural ordering like "10 ổi hồng, me thì 3 thùng" must not
 // degrade into an apparently complete one-product invoice.
 return /(?:\b(?:oi hong|mang cau|man cau|me|satori|hikari|juice|nuoc|premium)\b.{0,25}\b(?:\d{1,3}|mot|hai|ba|muoi)\s*(?:thung|thg|binh|loc|chai)\b)/.test(n)||
 /(?:\b\d{1,3}\s*(?:thung|thg|binh|loc|chai)\b.*\b\d{1,3}\s*(?:thung|thg|binh|loc|chai)\b)/.test(n);
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
,'u');
 for(const rawClause of chunks){
  const clause=rawClause.replace(prefix,'').trim();
  const match=clause.match(numeric);
  const qty=match?countOf(match[1]):null,unit=match?.[2]==='thg'?'thung':match?.[2]||null;
  const name=match?match[3].trim():clause;
  // Only recognise 5L as a water size, never as the number of cartons.
  const isWater5=/^(?:(?:(?:nuoc\s+)?suoi|nuoc\s+tinh\s+khiet|nuoc|satori)\s+)?5\s*l(?:\s+(?:co|khong|ko|k)\s+voi)?$|^(?:(?:nuoc\s+)?suoi|nuoc|satori)\s+5\s*l(?:\s+(?:co|khong|ko|k)\s+voi)?$/u.test(name);
  if(isWater5){
   if(qty!==null&&(!Number.isSafeInteger(qty)||qty<1||qty>500))
    return {needMoreDetails:true,reason:'INVALID_QUANTITY',message:'Số lượng cần từ 1 đến 500.'};
   const spout=/\b(?:khong|ko|k)\s+voi\b/.test(name)?'without':
    /\bco\s+voi\b/.test(name)?'with':null;
   // If the customer specified "bình", respect that SKU; if unspecified,
   // ask which package (carton or bottle) instead of silently guessing.
   if(unit&&!['thung','binh'].includes(unit))return {needMoreDetails:true,reason:'UNIT_UNSUPPORTED',
    message:'Nước 5 lít có quy cách thùng hoặc bình, không tự đổi từ chai/lốc sang thùng.'};
   if(qty&&spout&&unit){
    const sku=spout==='with'?(unit==='binh'?'TP-00142':'TP-00136'):
     (unit==='binh'?'TP-00143':'TP-00135');
    recognized.push({sku,qty});
   }else unresolved.push({kind:'FIVE_LITRE',qty,unit,spout,label:'nước suối Satori 5 lít'});
   continue;
  }
  if(!match){
   // A recognized named product without quantity must be clarified.
   const known=resolution(name,profile);
   if(known)unresolved.push({kind:'MISSING_QUANTITY',sku:known.code,label:known.name,qty:null});
   else return null;
   continue;
  }
  if(!Number.isSafeInteger(qty)||qty<1||qty>500)return {needMoreDetails:true,reason:'INVALID_QUANTITY',
   message:'Số lượng cần từ 1 đến 500.'};
  const parsed=parseOneClause(clause,profile);
  if(!parsed)return null; // fail closed for unsupported/mixed units or unknown products
  recognized.push(parsed);
 }
 if(!grouped&&!unresolved.length)return null; // existing single-item rules continue
 if(unresolved.length>1)return {needMoreDetails:true,reason:'MULTIPLE_UNKNOWN',
  message:'Em đã nhận ra các sản phẩm nhưng có hơn một món chưa rõ số lượng/quy cách. Anh/chị vui lòng gửi rõ từng món; giỏ chưa thay đổi.'};
 if(unresolved.length===1){
  const merged=[];
  for(const item of recognized){const old=merged.find(x=>x.sku===item.sku);if(old)old.qty+=item.qty;else merged.push({...item})}
  if(merged.reduce((n,x)=>n+x.qty,0)>500)return {needMoreDetails:true,reason:'CART_LIMIT',
   message:'Tổng số lượng tối đa 500.'};
  return {needMoreDetails:true,reason:'COLLOQUIAL_CLARIFICATION',
   pending:{items:merged,missing:unresolved[0]},source:'catalogue-colloquial'};
 }
 const merged=[];
 for(const it of recognized){const old=merged.find(x=>x.sku===it.sku);if(old)old.qty+=it.qty;else merged.push({...it})}
 if(merged.length>6||merged.some(x=>x.qty>500)||merged.reduce((n,x)=>n+x.qty,0)>500)
  return {needMoreDetails:true,reason:'CART_LIMIT',message:'Giỏ tối đa 6 loại, 500 đơn vị.'};
 return {items:merged,source:'catalogue-colloquial'};
}

export function waterClarificationAnswer(message){
 const n=fold(message).replace(/[.!?]+$/,'').trim();
 if(!/^(?:satori|hikari|350|500|1500|ml|\s)+$/.test(n))return null;
 const brands=[...n.matchAll(/\b(satori|hikari)\b/g)].map(m=>m[1]);
 const sizes=[...n.matchAll(/\b(350|500|1500)(?:\s*ml)?\b/g)].map(m=>Number(m[1]));
 if(new Set(brands).size>1||new Set(sizes).size>1||(!brands.length&&!sizes.length))return null;
 return {brand:brands[0]||null,size:sizes[0]||null};
}

export function looksCompoundOrder(message){
 const n=fold(message);
 const obvious=/\b(?:va|voi|cung|them)\b/.test(n)||/[,;\n]/.test(n);
 if(!obvious)return false;
 // Mixed natural ordering like "10 ổi hồng, me thì 3 thùng" must not
 // degrade into an apparently complete one-product invoice.
 return /(?:\b(?:oi hong|mang cau|man cau|me|satori|hikari|juice|nuoc|premium)\b.{0,25}\b(?:\d{1,3}|mot|hai|ba|muoi)\s*(?:thung|thg|binh|loc|chai)\b)/.test(n)||
 /(?:\b\d{1,3}\s*(?:thung|thg|binh|loc|chai)\b.*\b\d{1,3}\s*(?:thung|thg|binh|loc|chai)\b)/.test(n);
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
