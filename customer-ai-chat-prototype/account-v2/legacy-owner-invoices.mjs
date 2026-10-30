/**
 * Owner-only, read-only original Minh Satori ledger adapter.
 * Never maps a V2 customer to a legacy invoice via mutable name/phone/address.
 * No writes, no PDF forgery, no cross-tenant exposure and no inferred payments.
 */
export function monthRange(month){
 if(typeof month!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))
  throw Error('INVALID_INVOICE_MONTH');
 const [year,mo]=month.split('-').map(Number);
 const last=new Date(Date.UTC(year,mo,0)).getUTCDate();
 return {from:month+'-01',to:month+'-'+String(last).padStart(2,'0')};
}
export function safeLegacyInvoiceIndex(response){
 const body=response?.data;
 const orders=Array.isArray(body?.orders)?body.orders:[];
 const totalMatches=Number.isSafeInteger(body?.totalMatches)&&body.totalMatches>=0?
  body.totalMatches:orders.length;
 const norm=value=>typeof value==='string'?value.trim().slice(0,240):'';
 return {
  source:'signed-original-satori-ledger',
  revision:Number.isSafeInteger(response?.revision)?response.revision:
   Number.isSafeInteger(body?.revision)?body.revision:null,
  totalMatches,
  truncated:totalMatches>orders.length,
  orders:orders.slice(0,100).map(o=>({
   invoiceNo:Number.isSafeInteger(Number(o.invoiceNo))&&Number(o.invoiceNo)>0?Number(o.invoiceNo):null,
   date:norm(o.date).slice(0,20),
   customer:norm(o.name).slice(0,120),
   location:norm(o.location),
   status:norm(o.status).slice(0,50),
   total:Number.isFinite(Number(o.total))&&Number(o.total)>=0?Number(o.total):null,
   pairRole:norm(o.pairRole).slice(0,35)
  })).filter(o=>o.invoiceNo!==null)
 };
}
