/** One pending TEST basket per customer link. No customer PII, prices or bearer tokens in responses. */
import {productFor,resolveProduct,fold} from './catalogue.mjs';
export const MAX_LINES=6, MAX_UNITS=500;
export function makeDraftStore(){
 const states=new Map();
 function get(token){
  let s=states.get(token);
  if(s && Date.now()-s.updatedAt<24*3600_000)return s;
  if(s)states.delete(token);
  return {revision:0,lines:new Map(),updatedAt:Date.now()};
 }
 function read(token){
  const s=get(token);
  return {revision:s.revision,items:[...s.lines].map(([code,qty])=>{
   const p=productFor(code);return {code,qty,name:p.name,unit:p.unit};
  })};
 }
 function mutate(token,changes,expectedRevision){
  const s=get(token);
  if(!Number.isSafeInteger(expectedRevision)||s.revision!==expectedRevision)throw Error('DRAFT_CONFLICT');
  if(!Array.isArray(changes)||changes.length<1||changes.length>MAX_LINES)throw Error('INVALID_CART');
  const next=new Map(s.lines);
  for(const change of changes){
   if(change.action==='clear'){next.clear();continue}
   const p=productFor(change.code);
   if(!p)throw Error('INVALID_CART');
   const code=p.code,old=next.get(code)||0;
   if(change.action==='remove'){next.delete(code);continue}
   if(!Number.isSafeInteger(change.qty)||change.qty<1||change.qty>MAX_UNITS)throw Error('INVALID_CART');
   const qty=change.action==='add'?old+change.qty:
     change.action==='set'?change.qty:
     change.action==='subtract'?old-change.qty:NaN;
   if(!Number.isSafeInteger(qty)||qty<0||qty>MAX_UNITS)throw Error('INVALID_CART');
   if(qty===0)next.delete(code);else next.set(code,qty);
  }
  if(next.size>MAX_LINES||[...next.values()].reduce((n,v)=>n+v,0)>MAX_UNITS)throw Error('CART_LIMIT');
  states.set(token,{revision:s.revision+1,lines:next,updatedAt:Date.now()});
  return read(token);
 }
 return {read,mutate};
}
export function contextualDraftEdit(message,profile,draft){
 const s=fold(message);
 // Only treat explicit changes as edits; a normal "cho 5 thùng" remains a new basket addition.
 const verb=/^(?:(?:cho|lay)\s+)?(them|cong them|bo sung|bot|giam|tru|bo|xoa|loai bo|doi|sua|chinh|cap nhat|cho con|con lai)\b/.exec(s);
 const extra=/^(?:cho |lay )?(\d{1,3})\s*(?:thung|binh|loc|chai)\s+nua\b/.exec(s);
 if(!verb&&!extra)return null;
 const v=verb?.[1]||'them', remove=/^(bo|xoa|loai bo)$/.test(v),
  subtract=/^(bot|giam|tru)$/.test(v), set=/^(doi|sua|chinh|cap nhat|cho con|con lai)$/.test(v);
 const selection=resolveProduct(message,profile);
 if(selection.ambiguous)return {clarification:'Bạn vui lòng nói rõ mặt hàng cần sửa trong giỏ.'};
 const chosen=selection.sku?productFor(selection.sku)?.code:null;
 const code=chosen||(draft.items.length===1?draft.items[0].code:null);
 if(!code)return {clarification:'Giỏ có nhiều mặt hàng. Bạn vui lòng nói rõ tên hoặc dung tích sản phẩm cần sửa.'};
 if(remove)return {changes:[{action:'remove',code}]};
 const time= s.match(/\b(?:thanh|con|lai)\s+(\d{1,3})(?:\s*(?:thung|binh|loc|chai))?\b/);
 // "thêm 3 ổi hồng" must change the current draft without an explicit "thùng".
 // Only explicitly named JUICE cartons may omit the carton unit.
 const implicitJuice=productFor(code)?.brand==='JUICE' &&
  !/\b(lon|chai|ly|binh|loc)\b/.test(s) ?
   s.match(/\b(\d{1,3})\s+(?:(?:nuoc ep|ep)\s+)?(?:oi hong|mang cau|man cau|me)\b/) : null;
 const amount=extra?Number(extra[1]):time?Number(time[1]):
  Number((s.match(/\b(\d{1,3})\s*(?:thung|binh|loc|chai|don vi)(?=\s|$)/)||[])[1]||implicitJuice?.[1]||0);
 if(!Number.isSafeInteger(amount)||amount<1||amount>MAX_UNITS)
  return {clarification:'Bạn muốn sửa bao nhiêu đơn vị? Ví dụ: thêm 2 thùng Satori 500ml.'};
 return {changes:[{action:set?'set':subtract?'subtract':'add',code,qty:amount}]};
}
