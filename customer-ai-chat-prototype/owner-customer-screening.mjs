/**
 * Owner-only, memory-only monthly customer screening.
 * Uses a single signed, authenticated orders.list month result.
 * No bulk export, persistent customer copies, Gemini prompts or link issuance.
 */
import {contactPhone} from './contact-phone.mjs';
const txt=(value,max=200)=>String(value??'').trim().slice(0,max);
const phoneOf=contactPhone;
const pct=value=>{
 if(value===null||value===undefined||value==='')return null;
 const raw=typeof value==='string'?value.trim().replace(',','.'):value;
 if(typeof raw!=='number'&&!/^\d+(?:\.\d{1,2})?$/.test(raw))return null;
 const n=Number(raw);return Number.isFinite(n)&&n>=0&&n<=70?n:null;
};
function observedPct(order){
 // Production BotApi.visible() omits top-level discount fields but returns
 // items unchanged. A consistent explicit line-item percentage is evidence.
 const pricing=order.pricing&&typeof order.pricing==='object'?order.pricing:{};
 const top=[order.discountPercent,order.discountPct,order.customerDiscountPercent,order.discountPercentage,pricing.discountPercent,pricing.discountPct]
  .filter(v=>v!==null&&v!==undefined&&v!=='').map(pct);
 if(typeof order.discount==='string'&&order.discount.includes('%'))
  top.push(pct(order.discount.replace('%','')));
 else if(['percent','percentage','pct','%'].includes(txt(order.discountUnit||order.discountType).toLowerCase()))
  top.push(pct(order.discount));
 // An explicitly supplied but malformed percentage must not be ignored.
 if(top.some(v=>v===null)||new Set(top).size>1)return null;
 const items=Array.isArray(order.items)?order.items:[];
 const lineRates=items.map(item=>{
  if(!item||typeof item!=='object')return null;
  const fields=[item.discountPercent,item.discountPct,item.discountPercentage];
  const supplied=fields.filter(v=>v!==undefined&&v!==null&&v!=='');
  if(!supplied.length)return null;
  const values=supplied.map(pct);
  return values.some(v=>v===null)||new Set(values).size>1?null:values[0];
 });
 // Every item on a bill must explicitly agree: never average mixed discounts.
 if(lineRates.length){
  if(lineRates.some(v=>v===null)||new Set(lineRates).size>1)return null;
  if(top.length&&top[0]!==lineRates[0])return null;
  return lineRates[0];
 }
 return top.length?top[0]:null; // Bare monetary discount is not a rate.
}
export function screenMonthlyCustomers(orders,{truncated=false}={}){
 const groups=new Map();
 for(const [index,o] of (Array.isArray(orders)?orders:[]).entries()){
  if(!o||typeof o!=='object')continue;
  const phone=phoneOf(o.phone||o.customerPhone);
  const key=phone.length>=9&&phone.length<=11?'phone:'+phone:'unverified:'+index;
  if(!groups.has(key))groups.set(key,{key,phone:key.startsWith('phone:')?phone:'',names:new Set(),addresses:new Set(),invoices:new Set(),rates:new Set(),missingRates:0,count:0,total:0,lastDate:''});
  const group=groups.get(key),name=txt(o.name||o.customerName,120),address=txt(o.location||o.address,300);
  if(name)group.names.add(name);
  if(address)group.addresses.add(address);
  const no=txt(o.invoiceNo??o.number??o.ref,40);if(no)group.invoices.add(no);
  const total=Number(o.total);if(Number.isFinite(total)&&total>0)group.total+=total;
  const date=txt(o.date||o.createdAt,32);if(date>group.lastDate)group.lastDate=date;
  const rate=observedPct(o);if(rate===null)group.missingRates++;else group.rates.add(rate);
  group.count++;
 }
 return [...groups.values()].map(g=>{
  const names=[...g.names],addresses=[...g.addresses],rates=[...g.rates].sort((a,b)=>a-b);
  return {key:g.key,name:names[0]||'Chưa rõ tên',phone:g.phone,names,addresses,
   count:g.count,total:g.total,lastDate:g.lastDate,invoiceNos:[...g.invoices].slice(0,12),
   suggestedDiscount:rates.length===1&&g.missingRates===0?rates[0]:null,
   observedDiscounts:rates,missingRates:g.missingRates,discountConflict:rates.length>1,
   identityConflict:!g.phone||names.length>1||addresses.length===0,
   recurring:g.count>=2,complete:!truncated};
 }).sort((a,b)=>Number(b.recurring)-Number(a.recurring)||b.count-a.count||a.name.localeCompare(b.name,'vi'));
}
