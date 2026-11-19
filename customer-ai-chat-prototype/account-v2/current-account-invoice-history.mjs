/**
 * Always display the CURRENT signed invoice after an Android edit, even when
 * the old canonical-customer-sync feature flag is off.
 *
 * Account and quote ownership MUST be established by router.mjs before these
 * rows enter this module. First use a revision-consistent exact batch. When an
 * older GAS deployment lacks orders.getExactBatch, use the existing signed
 * orders.findByRequestId / exact-ID adapter, never customer-name lookup.
 *
 * A failed readback must not show an old quote's amount as an issued invoice.
 * This module does not write invoices, amend customer bindings or create PDFs.
 */
import {readExactCurrentInvoices,currentCustomerOrder} from './canonical-history-read.mjs';
import {exactCurrentInvoiceFromRequestId} from './local-invoice-read.mjs';
import {canonicalInvoiceDocumentStatus} from './canonical-invoice-sync.mjs';

function unverified(row){
 return {...row,verified:false,receipt:null,items:[],
  totalVnd:null,goodsVnd:null,shippingVnd:null,vatVnd:null,
  syncStatus:'UNAVAILABLE',pdf:canonicalInvoiceDocumentStatus(row)};
}

export async function currentAccountInvoiceHistory(rows,{
 batchRead=readExactCurrentInvoices,
 requestRead=exactCurrentInvoiceFromRequestId,
 concurrency=4
}={}){
 if(!Array.isArray(rows)||rows.length>100)throw Error('ACCOUNT_HISTORY_ROWS_INVALID');
 const confirmed=rows.filter(r=>r.state==='COMMITTED');
 if(confirmed.length===0)return {orders:rows.map(r=>({...r,verified:false,receipt:null})),
  syncStatus:'NO_COMMITTED_ORDERS',unavailableCount:0,ledgerRevision:null};

 // One signed exact lookup for up to 100 committed invoices; ALL results must
 // agree on a single revision. No price cache, AI memory or quote fallback.
 try{
  const fresh=await batchRead(confirmed.map(x=>({
   invoiceNo:Number(x.invoiceNo),id:x.ledgerId
  })));
  if(!fresh||!Number.isSafeInteger(fresh.revision)||!(fresh.orders instanceof Map))
   throw Error('CANONICAL_READ_INVALID');
  const orders=rows.map(row=>{
   if(row.state!=='COMMITTED')return {...row,verified:false,receipt:null};
   const current=fresh.orders.get(Number(row.invoiceNo)+'|'+String(row.ledgerId));
   return currentCustomerOrder(row,current,fresh.revision);
  });
  return {orders,syncStatus:'CURRENT',ledgerRevision:fresh.revision,
   unavailableCount:0};
 }catch(_){
  // Use the independently signed immutable requestId, not a mutable person's
  // name/phone/address. An older V2 journal can have a stale ledgerId; the
  // verified original requestId determines its exact current source invoice.
 }

 const live=new Map();
 let next=0;
 const jobs=Array.from({length:Math.min(Math.max(1,concurrency),confirmed.length,4)},
  async()=> {
   while(next<confirmed.length){
    const row=confirmed[next++];
    try{
     const found=await requestRead({invoiceNo:Number(row.invoiceNo),
      ledgerId:String(row.ledgerId),requestId:String(row.requestId)});
     if(!Number.isSafeInteger(found?.revision)||!found?.current||
       Number(found.current.invoiceNo)!==Number(row.invoiceNo)||
       !/^[A-Za-z0-9_-]{1,80}$/.test(String(found.current.id)))
      throw Error('CANONICAL_FALLBACK_INVALID');
     // A cancelled invoice remains visible as historical 0đ, not a payable
     // quote. Keep the original order lines for auditing, never double-charge.
     const normalized=found.archived||found.current.excluded?{
      ...found.current,excluded:true,totalVnd:0,goodsVnd:0,
      vatVnd:0,shippingVnd:0
     }:found.current;
     const current=currentCustomerOrder({
      ...row,ledgerId:String(found.current.id)
     },normalized,found.revision);
     live.set(row.requestId,current);
    }catch{
     live.set(row.requestId,unverified(row));
    }
   }
  });
 await Promise.all(jobs);
 let unavailableCount=0;
 const orders=rows.map(row=>{
  if(row.state!=='COMMITTED')return {...row,verified:false,receipt:null};
  const result=live.get(row.requestId)||unverified(row);
  if(!result.verified)unavailableCount++;
  return result;
 });
 return {orders,syncStatus:unavailableCount===0?'EXACT_REQUEST_VERIFIED':
  unavailableCount===confirmed.length?'UNAVAILABLE':'PARTIAL',
  unavailableCount,ledgerRevision:null};
}
