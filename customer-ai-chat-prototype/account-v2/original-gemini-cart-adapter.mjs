/**
 * Bring the ORIGINAL Gemini chat basket intent into Account V2.
 *
 * The old parser alone cannot distinguish a top-up from changing a quantity.
 * Reuse its pure language-to-cart-operation mapping, but let V2 own account
 * scope, catalogue eligibility, CAS cart writes, limits and pricing.
 *
 * Pure calculation only: no database/Drive changes, no HMAC, no invoice writes.
 */
import {chatBasketChanges} from '../cart-semantics.mjs';
import {normalizeCart,isSku} from './domain.mjs';

const deny=()=>{throw Error('V2_GEMINI_CART_UNVERIFIED')};
function validated(lines,activeCodes,{allowEmpty=false}={}){
 if(!Array.isArray(lines)||(!allowEmpty&&!lines.length))deny();
 const normalized=lines.length?normalizeCart(lines):[];
 for(const line of normalized){
  if(!isSku(line.code)||!activeCodes.has(line.code))deny();
 }
 return normalized;
}
export function proposeV2GeminiCart(message,current,interpreted,activeCodes){
 if(typeof message!=='string'||message.trim().length<2||
    !(activeCodes instanceof Set))deny();
 const before=validated(current,activeCodes,{allowEmpty:true});
 const selected=validated(interpreted,activeCodes);
 const operations=chatBasketChanges(message,selected.map(x=>({sku:x.code,qty:x.qty})));
 if(!Array.isArray(operations)||!operations.length)deny();
 const next=new Map(before.map(x=>[x.code,x.qty]));
 for(const operation of operations){
  if(operation?.action==='replace'){
   const replacement=validated(operation.items,activeCodes);
   next.clear();
   for(const row of replacement)next.set(row.code,row.qty);
   continue;
  }
  if(operation?.action!=='set'&&operation?.action!=='add')deny();
  if(!isSku(operation.code)||!activeCodes.has(operation.code)||
     !Number.isSafeInteger(operation.qty)||operation.qty<1||operation.qty>500)deny();
  const qty=operation.action==='add'?(next.get(operation.code)||0)+operation.qty:operation.qty;
  if(qty>500)deny();
  next.set(operation.code,qty);
 }
 return normalizeCart([...next].map(([code,qty])=>({code,qty})));
}
