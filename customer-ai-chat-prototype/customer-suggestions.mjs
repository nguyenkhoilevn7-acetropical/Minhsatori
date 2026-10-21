/* Per-link TEST suggestions. Only the signed-in customer's confirmed sandbox order history is analyzed. */
import {productFor} from './catalogue.mjs';
const FALLBACK=['TP-00003','TP-00136','TP-00056','TP-00058','TP-00051'];
export function customerSuggestions(profile,orders,limit=3){
 if(!profile?.id)return [];
 const rows=new Map(),now=Date.now();
 for(const order of orders){
  if(!order||order.sandbox!==true||order.profileId!==profile.id||
    order.ownerTest===true||/(?:huy|cancel|delete|xoa)/i.test(String(order.status||'')))continue;
  const when=Date.parse(order.createdAt||'');
  if(!Number.isFinite(when)||when>now+86400_000)continue;
  const age=Math.max(0,(now-when)/86400_000);
  const recency=age<=30?1:age<=90?0.75:age<=180?0.5:0.25;
  const items=Array.isArray(order.items)&&order.items.length?order.items:[order];
  const distinct=new Set();
  for(const item of items){
   const product=productFor(item.code||item.sku);if(!product||distinct.has(product.code))continue;
   distinct.add(product.code);
   const old=rows.get(product.code)||{code:product.code,orders:0,qty:0,score:0};
   const qty=Number.isSafeInteger(item.qty)?Math.max(0,item.qty):0;
   old.orders+=1;old.qty+=qty;old.score+=recency*(10+Math.min(qty,40)*0.1);
   rows.set(product.code,old);
  }
 }
 const favorites=[...rows.values()].sort((a,b)=>b.score-a.score||b.orders-a.orders||b.qty-a.qty||a.code.localeCompare(b.code));
 const results=[],seen=new Set(),cap=Math.min(Math.max(Number(limit)||3,1),5);
 function add(code,reason,count=0){
  const p=productFor(code);if(!p||seen.has(p.code)||results.length>=cap)return;
  seen.add(p.code);results.push({code:p.code,name:p.name,unit:p.unit,reason,orderCount:count});
 }
 for(const item of favorites)add(item.code,'Mua thường xuyên',item.orders);
 if(profile.favourite)add(profile.favourite,'Sản phẩm yêu thích');
 for(const code of FALLBACK)add(code,'Gợi ý tham khảo');
 return results;
}
