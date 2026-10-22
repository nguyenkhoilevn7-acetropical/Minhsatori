/**
 * Conservative, owner-only pricing evidence from real invoices.
 * There is no validated shipping/VAT field in the current Bot API visible()
 * contract. Never infer these values and never publish these as real prices.
 */
import {directoryKey} from './owner-customer-directory.mjs';
const finiteMoney=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))&&Number(x)>=0?Number(x):null;
function discountOfLine(item){
 if(!item||typeof item!=='object')return null;
 const list=finiteMoney(item.listPrice),sale=finiteMoney(item.unitPrice),amount=finiteMoney(item.discountAmount);
 if(list===null||list<=0||sale===null||sale>list||amount===null||Math.abs(list-sale-amount)>2)return null;
 const raw=100*(list-sale)/list;
 if(!Number.isFinite(raw)||raw<0||raw>70)return null;
 const whole=Math.round(raw),rate=Math.abs(raw-whole)<=0.15?whole:Math.round(raw*100)/100;
 return rate;
}
export function observedRealCustomerDiscounts(orders,name){
 const customerKey=directoryKey(name),observed=new Set(),invoiceNos=new Set();
 let checkedLines=0,unsupportedLines=0;
 for(const order of Array.isArray(orders)?orders:[]){
  if(directoryKey(order?.name||order?.customerName)!==customerKey)continue;
  const no=order?.invoiceNo;if(no!==undefined&&no!==null)invoiceNos.add(String(no));
  const items=Array.isArray(order?.items)?order.items:[];
  if(!items.length)unsupportedLines++;
  for(const line of items){
   const rate=discountOfLine(line);checkedLines++;
   if(rate===null)unsupportedLines++;
   else observed.add(rate);
  }
 }
 const rates=[...observed].sort((a,b)=>a-b);
 return {
  observedRates:rates,checkedInvoices:invoiceNos.size,checkedLines,unsupportedLines,
  suggestedDiscount:checkedLines>0&&unsupportedLines===0&&rates.length===1?rates[0]:null,
  shippingPercent:null,vatPercent:null,
  requiresOwnerReview:true
 };
}
