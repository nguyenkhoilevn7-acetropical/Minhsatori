/**
 * Deterministic, catalogue-grounded answers to simple existence questions.
 * No fallback item, rate or active status may be invented from the static
 * reference catalogue: only the active V2 database can confirm availability.
 */
import {resolveProduct,productFor,fold} from '../catalogue.mjs';

export function recognisedCatalogueQuestion(message){
 const raw=String(message||'').trim();
 if(raw.length<6||raw.length>300)return null;
 const text=fold(raw);
 if(!(/[?？]/u.test(raw)||/\b(?:co|ban)\b.{0,120}\b(?:khong|chua)\b/.test(text)))
  return null;
 // Prices/policies are handled by the authenticated pricing backend, never FAQ.
 if(/\b(?:gia|bao nhieu tien|chiet khau|giam gia|phi ship|vat|dat|lay|mua|cho toi|them)\b/.test(text))
  return null;
 const match=resolveProduct(text);
 if(match.ambiguous||!match.sku)return null;
 const product=productFor(match.sku);
 if(!product)return null;
 return Object.freeze({code:product.code,name:product.name,unit:product.unit});
}
export function verifiedAvailabilityAnswer(question,activeProducts=[]){
 const match=activeProducts.find(x=>x.code===question.code&&x.active!==false);
 if(match){
  return 'Có '+match.name+' ('+match.unit+') trong danh mục Minh Satori V2. '+
   'Anh/chị có thể nhập số lượng để thêm vào giỏ.';
 }
 return 'Mã '+question.code+' ('+question.name+') có trong danh mục tham chiếu, '+
  'nhưng chưa được xác nhận đang hoạt động trong danh mục V2. '+
  'Giỏ hàng chưa thay đổi; Admin cần kiểm tra đồng bộ danh mục.';
}
export function missingV2CatalogueMessage(requested,activeProducts=[]){
 if(!activeProducts.length)
  return 'Danh mục V2 chưa có sản phẩm hoạt động. Giỏ hàng chưa thay đổi; '+
   'Admin cần kiểm tra đồng bộ danh mục chính thức trước khi nhận đơn.';
 const available=new Set(activeProducts.map(x=>x.code));
 const missing=requested.filter(x=>!available.has(x.code));
 if(!missing.length)return null;
 const labels=missing.slice(0,3).map(x=>{
  const ref=productFor(x.code);
  return x.code+(ref?' ('+ref.name+')':'');
 }).join(', ');
 return 'Chưa tìm thấy mã '+labels+' trong danh mục V2 đang hoạt động. '+
  'Giỏ hàng chưa thay đổi; Admin cần kiểm tra đồng bộ danh mục, không tự thay mã sản phẩm.';
}
