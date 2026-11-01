/**
 * Read-through of the ONE canonical Apps Script ledger into customer V2.
 * Never store a second invoice or give the customer a mutable price snapshot.
 * The V2 session + SQL account binding is verified BEFORE calling this module.
 */
import {readMinhSatori} from '../satori-readonly.mjs';
import {canonicalReceiptForAccountOrder} from './canonical-invoice-sync.mjs';
const validId=x=>/^[A-Za-z0-9_-]{1,80}$/.test(String(x??''));
const validNo=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
const amount=x=>Number.isSafeInteger(Number(x))&&Number(x)>=0&&Number(x)<=100_000_000_000;
const fail=code=>{const e=new Error(code);e.code=code;throw e};
const key=r=>Number(r.invoiceNo)+'|'+String(r.id);
export async function readExactCurrentInvoices(refs,{reader=readMinhSatori}={}){
 if(!Array.isArray(refs)||refs.length>100)fail('CANONICAL_REFS_INVALID');
 const unique=new Map();
 for(const r of refs){
  if(!r||!validNo(r.invoiceNo)||!validId(r.id))fail('CANONICAL_REFS_INVALID');
  unique.set(key(r),{invoiceNo:Number(r.invoiceNo),id:String(r.id)});
 }
 const exact=[...unique.values()],out=new Map();
 let revision=null;
 for(let i=0;i<exact.length;i+=20){
  const batch=exact.slice(i,i+20);
  const response=await reader('orders.getExactBatch',{refs:batch});
  const body=response?.data;
  if(!Number.isSafeInteger(response?.revision)||!Array.isArray(body?.orders)||
     body.orders.length!==batch.length||out.size+body.orders.length>100)
   fail('CANONICAL_READ_INVALID');
  if(revision!==null&&revision!==response.revision)fail('CANONICAL_REVISION_CHANGED');
  revision=response.revision;
  for(let j=0;j<batch.length;j++){
   const original=batch[j],current=body.orders[j];
   if(key(current)!==key(original))fail('CANONICAL_ID_MISMATCH');
   if(!current.missing){
    if(!amount(current.totalVnd)||!amount(current.goodsVnd)||
       !amount(current.shippingVnd)||!amount(current.vatVnd)||
       !Array.isArray(current.items)||current.items.length<1||
       current.items.length>40||!current.delivery||typeof current.status!=='string')
     fail('CANONICAL_DATA_INVALID');
   }
   out.set(key(original),current);
  }
 }
 return {revision,orders:out};
}
export function currentCustomerOrder(row,current,revision){
 if(row?.state!=='COMMITTED')return {...row,verified:false,receipt:null};
 if(!current||current.missing||key({invoiceNo:row.invoiceNo,id:row.ledgerId})!==key(current))
  fail('CANONICAL_INVOICE_NOT_FOUND');
 const excluded=current.excluded===true;
 const total=Number(current.totalVnd),goods=Number(current.goodsVnd),
  ship=Number(current.shippingVnd),vat=Number(current.vatVnd);
 if(![total,goods,ship,vat].every(amount)||
    (!excluded&&goods+ship+vat!==total)||
    (excluded&&(total!==0||goods!==0||ship!==0||vat!==0)))
  fail('CANONICAL_TOTAL_CONFLICT');
 const items=current.items.map(it=>{
  if(!it||typeof it!=='object'||!Number.isSafeInteger(it.qty)||
   it.qty<0||!amount(it.unitPrice)||!amount(it.lineTotal)||
   it.qty*it.unitPrice!==it.lineTotal)fail('CANONICAL_LINES_INVALID');
  return {name:String(it.name||'').slice(0,200),
   code:String(it.code||'').slice(0,40),unit:String(it.unit||'Thùng').slice(0,30),
   qty:it.qty,unitPrice:it.unitPrice,listPrice:it.listPrice,
   discountBps:Number.isFinite(it.discountPercent)?Math.round(it.discountPercent*100):0,
   lineTotal:it.lineTotal};
 });
 const latest={...row,state:'COMMITTED',invoiceStatus:current.status,
  excluded,customerPaid:current.customerPaid===true,
  totalVnd:total,goodsVnd:goods,shippingVnd:ship,vatVnd:vat,
  items,delivery:{...row.delivery,...current.delivery},
  deliveryRequest:{...row.deliveryRequest,deliveryNote:current.deliveryNote||''},
  ledgerRevision:revision,ledgerUpdatedAt:current.updatedAt||null,
  verified:true,syncStatus:'CURRENT'};
 const receipt=canonicalReceiptForAccountOrder(latest);
 if(!receipt)fail('CANONICAL_RECEIPT_INVALID');
 return {...latest,receipt:{...receipt,
  pdf:excluded?{status:'NOT_PAYABLE',shareable:false}:receipt.pdf}};
}
export function currentLinkedHistory(refs,readback){
 const orders=[],unavailable=[];
 for(const r of refs){
  const x=readback.orders.get(key({invoiceNo:r.invoiceNo,id:r.sourceId}));
  if(!x||x.missing){unavailable.push(r);continue}
  const excluded=x.excluded===true;
  orders.push({source:'legacy',invoiceNo:x.invoiceNo,sourceId:String(x.id),
   date:x.date,createdAt:null,updatedAt:x.updatedAt||null,
   name:x.delivery.recipientName,address:x.delivery.address,
   status:x.status,totalVnd:excluded?0:x.totalVnd,
   items:x.items.map(it=>({product:it.name,name:it.name,qty:it.qty,
    unit:it.unit,unitPrice:it.unitPrice,lineTotal:it.lineTotal})),
   customerPaid:x.customerPaid===true,readOnly:true,ledgerRevision:readback.revision});
 }
 return {orders:orders.sort((a,b)=>b.invoiceNo-a.invoiceNo),
  linkedCount:refs.length,unavailableCount:unavailable.length,
  syncStatus:'CURRENT',ledgerRevision:readback.revision};
}
