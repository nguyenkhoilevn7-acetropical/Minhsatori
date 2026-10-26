/**
 * V2 adapter for the ORIGINAL Minh Satori Vietnamese ordering comprehension.
 * It reuses the existing catalogue-aware rules, colloquial parsing and
 * optional Gemini segmenter. Nothing is re-trained, and no customer identity,
 * historical invoice, pricing policy, or existing link is imported here.
 *
 * Never silently downgrade a multi-product request into just the first SKU.
 * The account-backed catalogue and server pricing remain authoritative.
 */
import {normalizeCart,isSku} from './domain.mjs';
import {identityChange,parseRules,parseOrder,parseComplexOrderWithGemini} from '../free-parser.mjs';
import {parseMultiOrder,parseColloquialBasket,parseWaterClarificationBasket,
  colloquialQuestion,parseOneClause,looksCompoundOrder} from '../multi-order.mjs';
import {productFor} from '../catalogue.mjs';

const aka=Object.freeze({S500:'TP-00003',S350:'TP-00001',S5L:'TP-00136'});
const clarification=(message)=>({needsClarification:true,
 message:message||'Vui lòng ghi rõ tên sản phẩm, quy cách và số lượng. Giỏ hàng chưa thay đổi.'});

export async function interpretLegacyOrder(message,profile={}, {allowGemini=true}={}){
 if(typeof message!=='string'||message.trim().length<2||message.length>500)
  return clarification('Tin nhắn cần từ 2 đến 500 ký tự.');
 const text=message.trim();
 if(identityChange(text,profile))
  return clarification('Vui lòng chọn địa chỉ đã lưu. Đổi thông tin nhận hàng cần xác minh riêng.');
 let parsed=parseMultiOrder(text,profile);
 if(parsed?.needMoreDetails)return clarification(parsed.message);
 if(!parsed){
  parsed=parseColloquialBasket(text,profile);
  if(parsed?.needMoreDetails)
   return clarification(parsed.message||(parsed.pending?.missing?
     colloquialQuestion(parsed.pending.missing):undefined));
 }
 if(!parsed){
  const partial=parseWaterClarificationBasket(text,profile);
  if(partial?.needMoreDetails)
   return clarification(partial.message||'Vui lòng xác nhận rõ loại nước, dung tích và số lượng; giỏ chưa thay đổi.');
 }
 if(!parsed&&looksCompoundOrder(text)){
  parsed=allowGemini?await parseComplexOrderWithGemini(text,profile):null;
  if(!parsed)return clarification(
   'Em chưa hiểu đầy đủ tất cả sản phẩm. Anh/chị vui lòng ghi rõ từng mặt hàng; giỏ chưa thay đổi.');
 }
 if(!parsed){
  const one=parseOneClause(text,profile);
  if(one)parsed={items:[one],source:'original-single-clause'};
  else{
   const result=allowGemini?await parseOrder(text,profile):parseRules(text,profile);
   if(result?.intent==='order'&&result.sku&&Number.isSafeInteger(result.qty)&&
      result.qty>0&&!result.needsHuman&&!result.needMoreDetails)
    parsed={items:[{sku:result.sku,qty:result.qty}],source:result.source||'original-parser'};
  }
 }
 if(!parsed?.items?.length)return clarification();
 if(parsed.needMoreDetails||!Array.isArray(parsed.items))
  return clarification(parsed.message);
 const lines=[];
 for(const line of parsed.items){
  const sku=aka[line?.sku]||line?.sku;
  if(!isSku(sku)||!productFor(sku)||!Number.isSafeInteger(line.qty)||line.qty<=0)
   return clarification('Mặt hàng chưa có mã hoặc quy cách hợp lệ trong danh mục Satori cũ.');
  lines.push({code:sku,qty:line.qty});
 }
 let suggestedItems;
 try{suggestedItems=normalizeCart(lines)}
 catch{return clarification('Số lượng hoặc số loại sản phẩm vượt giới hạn an toàn.')}
 return {
  suggestedItems,
  source:parsed.source||'original-minh-satori',
  message:'Đã hiểu yêu cầu theo cách xử lý Minh Satori cũ. Kiểm tra số lượng rồi thêm vào giỏ chung.'
 };
}
