import test from 'node:test';import assert from 'node:assert/strict';
import {exactInvoice,publicInvoice,invoiceDetail} from '../invoice-history.mjs';
const binding={legacy_id:'exact',invoice_no:5901,verified_revision:5};
test('canonical detail requires both immutable ID and invoice number, not search/name match',async()=>{
 await assert.rejects(exactInvoice(binding,async()=>({revision:6,data:{orders:[{id:'other',invoiceNo:5901}]}})),/NOT_VERIFIED/);
 await assert.rejects(exactInvoice(binding,async()=>({revision:4,data:{orders:[{id:'exact',invoiceNo:5901}]}})),/REVISION_STALE/);
 assert.equal((await exactInvoice(binding,async()=>({revision:6,data:{orders:[{id:'exact',invoiceNo:5901}]}}))).revision,6);
});
test('retail detail allowlists fields; unknown payment amount is not fabricated as paid or debt',()=>{
 const q=publicInvoice({invoiceNo:5901,total:800000,status:'paid',internalUnitPrice:650000,commission:150000,
  pdfUrl:'https://attacker.invalid/',items:[{name:'water',qty:10,commission:150000}]},6);
 assert.equal(q.paidVnd,null);assert.equal(q.dueVnd,null);assert.equal(q.pdf.available,false);
 assert.doesNotMatch(JSON.stringify(q),/attacker|internalUnitPrice|commission/);
 assert.equal(publicInvoice({invoiceNo:5901,total:800000,paidAmount:300000},6).dueVnd,500000);
 assert.throws(()=>publicInvoice({total:800000,paidAmount:900000},6),/PAYMENT_INVALID/);
});
test('foreign invoice is rejected by SQL ownership before any ledger read',async()=>{
 let read=false;
 const pool={query:async(sql,args)=>{assert.match(sql,/id=\$1 AND account_id=\$2/);assert.equal(args[1],'actor');return {rows:[]}}};
 await assert.rejects(invoiceDetail(pool,{id:'actor'},'3741eecd-2acd-4a35-8383-510c360b78d9',async()=>{read=true}),/FORBIDDEN/);
 assert.equal(read,false);
});
