/* Conservative multi-line Vietnamese order extraction.
 * Use explicit quantities with recognised catalogue products.
 * No Gemini inference is trusted for pricing, customer identity or missing lines.
 */
import {resolveProduct,productFor,fold} from './catalogue.mjs';

const NUMBER_WORDS={mot:1,hai:2,ba:3,bon:4,tu:4,nam:5,lam:5,sau:6,bay:7,tam:8,chin:9,muoi:10};
const ITEM=/(?:^|[^\p{L}\p{N}])(\d{1,3}|muoi\s+(?:mot|hai|ba|bon|nam|lam|sau|bay|tam|chin)|hai\s+muoi|ba\s+muoi|mot|hai|ba|bon|tu|nam|lam|sau|bay|tam|chin|muoi)\s*(thung|thg|binh|loc|chai)(?=\s|$|[,;.!?])/giu;

function quantity(text){
 if(/^\d+$/.test(text))return Number(text);
 const bits=text.split(' ');
 if(bits[0]==='muoi'&&bits[1])return 10+NUMBER_WORDS[bits[1]];
 if(bits[1]==='muoi')return NUMBER_WORDS[bits[0]]*10;
 return NUMBER_WORDS[bits[0]]||0;
}
function detectUnitMismatch(sku,spokenUnit){
 const product=productFor(sku);
 if(!product)return true;
 const canonical=fold(product.unit);
 const given=spokenUnit==='thg'?'thung':spokenUnit;
 return given!==canonical;
}
function stripDeliveryTail(text){
 return text.split(/(?:[,;]|\s+va\s+|\s+)(?=(?:giao|ship)\s+(?:sau|luc|vao|truoc|tam|khoang|tu|buoi)\b|(?:nho|luu\s+y|ghi\s+chu|goi\s+truoc|de\s+o)\b)/)[0].trim();
}
export function parseMultiOrder(message,profile={}){
 const n=fold(message);
 const matched=[...n.matchAll(ITEM)];
 if(matched.length<2)return null;
 if(matched.length>6)return {needMoreDetails:true,reason:'TOO_MANY_ITEMS',message:'Một đơn thử hỗ trợ tối đa 6 dòng sản phẩm. Anh/chị vui lòng chia thành các đơn nhỏ hơn.'};
 const items=[];
 for(let i=0;i<matched.length;i++){
  const m=matched[i],start=m.index+m[0].length,end=i+1<matched.length?matched[i+1].index:n.length;
  const description=stripDeliveryTail(n.slice(start,end)).replace(/^\s*(?:va|voi|them|cung|,\s*|;\s*)+/,'').replace(/(?:\s+va\s+|[,;])\s*$/,'').trim();
  const qty=quantity(m[1]);
  if(!Number.isSafeInteger(qty)||qty<1||qty>500)return {needMoreDetails:true,reason:'INVALID_QUANTITY',message:'Số lượng chưa hợp lệ. Anh/chị vui lòng ghi từ 1 đến 500 cho từng loại.'};
  if(!description||description.length>150)return {needMoreDetails:true,reason:'MISSING_PRODUCT',message:'Anh/chị vui lòng ghi rõ tên hoặc quy cách ngay sau số lượng từng sản phẩm.'};
  const resolved=resolveProduct(description,profile),sku=resolved.sku;
  if(!sku||!productFor(sku))return {needMoreDetails:true,reason:'PRODUCT_AMBIGUOUS',message:'Em thấy nhiều sản phẩm nhưng một loại chưa rõ quy cách. Anh/chị vui lòng ghi đầy đủ từng loại (ví dụ: 10 thùng Satori 500ml và 5 thùng Hikari 500ml).'};
  if(detectUnitMismatch(sku,m[2]))return {needMoreDetails:true,reason:'UNIT_MISMATCH',message:'Đơn vị của một sản phẩm chưa khớp danh mục (thùng/bình/lốc/chai). Anh/chị vui lòng ghi rõ lại từng loại.'};
  items.push({sku,qty});
 }
 const totalQty=items.reduce((sum,x)=>sum+x.qty,0);
 if(totalQty>500)return {needMoreDetails:true,reason:'TOTAL_TOO_LARGE',message:'Tổng số lượng tối đa là 500 đơn vị cho mỗi đơn thử.'};
 const merged=[];
 for(const it of items){const earlier=merged.find(x=>productFor(x.sku).code===productFor(it.sku).code);if(earlier)earlier.qty+=it.qty;else merged.push({...it})}
 if(merged.length<2)return {needMoreDetails:true,reason:'SAME_PRODUCT',message:'Anh/chị đang ghi cùng sản phẩm nhiều lần. Vui lòng cho biết tổng số lượng của loại này.'};
 return {items:merged,source:'rules-multi'};
}
