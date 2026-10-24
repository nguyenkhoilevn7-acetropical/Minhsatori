/* The original Gemini sandbox order-edit semantics, shared with Production.
 * No customer identity, price, link or invoice is decided here.
 */
import {fold} from './catalogue.mjs';
export function chatBasketChanges(message,items){
 const phrase=fold(message);
 const isTopUp=/^(?:(?:cho|lay)\s+(?:(?:em|anh|chi|toi|minh)\s+)?)?(?:them|bo sung|cong them)\b/.test(phrase);
 if(isTopUp)return items.map(x=>({action:'add',code:x.sku,qty:x.qty}));
 if(items.length>1||/\b(?:don moi|dat lai tu dau|lam don moi)\b/.test(phrase))
  return [{action:'replace',items:items.map(x=>({code:x.sku,qty:x.qty}))}];
 return items.map(x=>({action:'set',code:x.sku,qty:x.qty}));
}
export function applyCartChanges(current,changes,validCodes){
 if(!Array.isArray(current)||!Array.isArray(changes)||changes.length>6)throw Error('CART_CHANGES_INVALID');
 const map=new Map();
 const verify=(code,qty)=>typeof code==='string'&&validCodes.has(code)&&
  Number.isSafeInteger(qty)&&qty>=1&&qty<=500;
 for(const item of current){
  if(!verify(item?.code,item?.qty)||map.has(item.code))throw Error('CART_CURRENT_INVALID');
  map.set(item.code,item.qty);
 }
 for(const op of changes){
  if(!['add','set','subtract','remove','replace'].includes(op?.action))throw Error('CART_ACTION_INVALID');
  if(op.action==='replace'){
   if(!Array.isArray(op.items)||op.items.length>6)throw Error('CART_REPLACE_INVALID');
   map.clear();
   for(const item of op.items){
    if(!verify(item?.code,item?.qty)||map.has(item.code))throw Error('CART_REPLACE_INVALID');
    map.set(item.code,item.qty);
   }
   continue;
  }
  if(op.action==='remove'){
   if(!validCodes.has(op.code))throw Error('CART_ITEM_INVALID');
   map.delete(op.code);continue;
  }
  if(!verify(op.code,op.qty))throw Error('CART_ITEM_INVALID');
  const now=map.get(op.code)||0;
  const next=op.action==='add'?now+op.qty:op.action==='subtract'?now-op.qty:op.qty;
  if(next<=0)map.delete(op.code);else map.set(op.code,next);
 }
 if(map.size>6||[...map.values()].some(x=>x>500)||[...map.values()].reduce((a,b)=>a+b,0)>500)
  throw Error('CART_LIMIT');
 return [...map].map(([code,qty])=>({code,qty}));
}
