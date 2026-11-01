/**
 * Exact one-invoice readback using the EXISTING deployed orders.list Bot scope.
 * V2 account authorization (both request and quote) happens BEFORE this call.
 * Never use fuzzy search results as invoice identity; match number AND immutable
 * ledger ID and reject ambiguity. No new Apps Script action or deployment needed.
 */
import {readMinhSatori} from '../satori-readonly.mjs';
const refuse=(code)=>{const e=new Error(code);e.code=code;throw e};
const amount=(v)=>Number.isSafeInteger(Number(v))&&Number(v)>=0&&Number(v)<=100_000_000_000;
export async function exactCurrentInvoiceFromOrdersList({invoiceNo,ledgerId},{reader=readMinhSatori}={}){
 if(!Number.isSafeInteger(invoiceNo)||invoiceNo<1||
    !/^[A-Za-z0-9_-]{1,80}$/.test(String(ledgerId||'')))
  refuse('V2_PDF_LEDGER_REF_INVALID');
 const r=await reader('orders.list',{query:String(invoiceNo),limit:100});
 const data=r?.data;
 if(!Number.isSafeInteger(r?.revision)||!data||!Array.isArray(data.orders)||
    !Number.isSafeInteger(data.totalMatches)||data.totalMatches<0||
    data.totalMatches>100||data.orders.length>100)
  refuse('V2_PDF_LEDGER_READ_INCOMPLETE');
 const exact=data.orders.filter(x=>Number(x?.invoiceNo)===invoiceNo&&
  String(x?.id)===String(ledgerId));
 if(exact.length!==1)refuse('V2_PDF_LEDGER_NOT_FOUND');
 const x=exact[0];
 if(!Array.isArray(x.items)||x.items.length<1||x.items.length>40||
    !amount(x.total)||!amount(x.shippingAmount??0)||!amount(x.vatAmount??0))
  refuse('V2_PDF_LEDGER_INVALID');
 const items=x.items.map(line=>{
  if(!line||!Number.isSafeInteger(Number(line.qty))||Number(line.qty)<1||
     !amount(line.unitPrice)||!amount(line.listPrice))
   refuse('V2_PDF_LEDGER_INVALID');
  const qty=Number(line.qty),unitPrice=Number(line.unitPrice);
  return {name:String(line.product||line.name||'').slice(0,200),
   code:String(line.code||'').slice(0,40),unit:String(line.unit||'Thùng').slice(0,30),
   qty,unitPrice,listPrice:Number(line.listPrice),lineTotal:qty*unitPrice};
 });
 const goods=items.reduce((n,l)=>n+l.lineTotal,0);
 const shipping=Number(x.shippingAmount??0),vat=Number(x.vatAmount??0);
 const total=Number(x.total);
 if(!amount(goods)||goods+shipping+vat!==total)
  refuse('V2_PDF_LEDGER_TOTAL_CONFLICT');
 return Object.freeze({
  revision:r.revision,
  current:{id:String(x.id),invoiceNo,status:String(x.status||'Chưa thanh toán'),
   excluded:['Đã hủy','Không Tính'].includes(x.status),
   totalVnd:total,goodsVnd:goods,shippingVnd:shipping,vatVnd:vat,
   date:String(x.date||''),updatedAt:x.updatedAt||null,
   delivery:{recipientName:String(x.name||''),recipientPhone:String(x.phone||''),
    address:String(x.location||'')},
   deliveryNote:String(x.deliveryNote||''),items}
 });
}

/**
 * First-class V2 readback by the same immutable request ID used for actual
 * checkout. A valid signed COMMITTED response gives the CURRENT source
 * invoice even if the old V2 journal stored a stale/different ledger ID.
 * This is stronger than a name/phone/invoice-number search, and cannot
 * retrieve another account's invoice because the caller retrieves the
 * requestId from an account-scoped, committed PostgreSQL row.
 */
export async function exactCurrentInvoiceFromRequestId({
 invoiceNo,ledgerId,requestId
},{reader=readMinhSatori}={}){
 if(!Number.isSafeInteger(invoiceNo)||invoiceNo<=0||
    !/^[A-Za-z0-9_-]{1,80}$/.test(String(ledgerId??''))||
    !/^[A-Za-z0-9_-]{8,100}$/.test(String(requestId??'')))
   refuse('V2_PDF_LEDGER_REF_INVALID');
 const response=await reader('orders.findByRequestId',{requestId});
 if(!Number.isSafeInteger(response?.revision)||!response?.data||
    typeof response.data!=='object')refuse('V2_PDF_LEDGER_READ_INCOMPLETE');
 const data=response.data;
 if(data.found===true){
  // A deleted canonical invoice is still the customer's same original order.
  // Offer only an explicitly cancelled, non-payable archival copy: NEVER
  // silently turn the deleted invoice into a new payable invoice.
  if(data.state!=='COMMITTED'&&data.state!=='DELETED')
   refuse('V2_PDF_LEDGER_NOT_ACTIVE');
  if(!data.order||Number(data.order.invoiceNo)!==invoiceNo||
     !/^[A-Za-z0-9_-]{1,80}$/.test(String(data.order.id??'')))
   refuse('V2_PDF_LEDGER_ID_CONFLICT');
  const latest=await exactCurrentInvoiceFromOrdersList({
   invoiceNo,ledgerId:String(data.order.id)
  },{reader:async()=>({
    revision:response.revision,
    data:{totalMatches:1,orders:[data.order]}
  })});
  if(data.state==='DELETED'){
   return Object.freeze({
    revision:latest.revision,
    archived:true,
    current:Object.freeze({...latest.current,status:'Đã hủy',
     excluded:true,customerPaid:false})
   });
  }
  return Object.freeze({...latest,archived:false});
 }
 if(data.found!==false||data.state!=='NOT_FOUND')
  refuse('V2_PDF_LEDGER_READ_INCOMPLETE');
 // Older committed records may have been created before the request-id
 // index was introduced; keep the strict exact-ID fallback for those.
 return exactCurrentInvoiceFromOrdersList({invoiceNo,ledgerId},{reader});
}
