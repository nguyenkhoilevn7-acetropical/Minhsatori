// Fully synthetic, offline ledger reader and real pdfmake bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {invoiceLineVatSnapshot} from '../../invoice-line-vat.mjs';
import {renderOriginalWebsitePdf,canonicalPdfVersion} from '../../original-website-pdf.mjs';
import {exactCurrentInvoiceFromOrdersList} from '../local-invoice-read.mjs';
import {currentInvoiceForWebsitePdf,renderCurrentV2Pdf} from '../local-invoice-pdf.mjs';
const legacy=()=>({id:'fake-vat-legacy',invoiceNo:90001,date:'11/11/2026',name:'FAKE Customer',phone:'000',location:'FAKE Address',status:'Chưa thanh toán',vat:'yes',vatAmount:8000,shippingAmount:2000,total:110000,timestamp:1794355200000,items:[{product:'FAKE Water',unit:'Thùng',qty:1,listPrice:140000,unitPrice:100000}]});
const perLine=()=>({...legacy(),vatMode:'per_line',vatRate:8,vatAmount:8001,total:110016,
 items:[{product:'FAKE Water',unit:'Thùng',qty:1,listPrice:140000,unitPrice:100000,vatRate:8,vatExempt:false,vatAmount:8000},
 {product:'FAKE Deposit',unit:'Cái',qty:1,listPrice:10,unitPrice:10,vatExempt:true,vatRate:0,vatAmount:0},
 {product:'FAKE Half Dong',unit:'Cái',qty:1,listPrice:5,unitPrice:5,vatRate:10,vatExempt:false,vatAmount:1}]});
const ref={invoiceNo:90001,ledgerId:'fake-vat-legacy'};
const reader=order=>async()=>({revision:900,data:{totalMatches:1,orders:[order]}});
test('legacy REAL PDF bytes match golden extracted from c08c38a2 with fixed creation date',async()=>{
 const NativeDate=Date;
 globalThis.Date=class extends NativeDate {
  constructor(...args){super(...(args.length?args:['2026-11-11T00:00:00.000Z']))}
  static now(){return NativeDate.parse('2026-11-11T00:00:00.000Z')}
 };
 try{
  const pdf=await renderOriginalWebsitePdf(legacy());
  assert.equal(pdf.bytes.length,137125);
  assert.equal(pdf.sha256,'1b807fc0d20da90d0c009a257721ab29edc0895b87f0b3ed5a0508aa53f34a65');
  assert.equal(canonicalPdfVersion({...legacy(),vatMode:'invoice',vatRate:8}),pdf.versionKey);
 }finally{globalThis.Date=NativeDate}
});
test('signed canonical read -> V2 mapping preserves exempt/custom/half-up VAT without changing totals',async()=>{
 const raw=perLine(),unchanged=JSON.stringify(raw);
 const {current}=await exactCurrentInvoiceFromOrdersList(ref,{reader:reader(raw)});
 const doc=currentInvoiceForWebsitePdf(current,ref);
 assert.equal(current.vatMode,'per_line');assert.equal(current.vatRate,8);
 assert.deepEqual(doc.items.map(i=>[i.vatExempt,i.vatRate,i.vatAmount]),[[false,8,8000],[true,0,0],[false,10,1]]);
 assert.equal(doc.total,110016);assert.equal(doc.vatAmount,8001);
 assert.equal(doc.items.reduce((n,i)=>n+i.qty*i.unitPrice,0)+doc.shippingAmount+doc.vatAmount,doc.total);
 assert.equal(JSON.stringify(raw),unchanged);
 const pdf=await renderCurrentV2Pdf(current,ref);
 assert.equal(pdf.versionKey,canonicalPdfVersion(doc));assert.ok(pdf.bytes.length>4000);
 const dir=mkdtempSync(path.join(tmpdir(),'satori-fake-vat-pdf-'));
 try{
  const file=path.join(dir,'fake.pdf');writeFileSync(file,pdf.bytes);
  const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
  assert.match(text,/VAT 8% · 8\.000 đ/);assert.match(text,/VAT 0% · 0 đ/);
  assert.match(text,/VAT 10% · 1 đ/);assert.match(text,/Thuế VAT \(theo từng dòng\):\s+8\.001 đ/);
  assert.match(text,/TỔNG THANH TOÁN\s+110\.016 đ/);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('per-line header and tax snapshots affect version while legacy definition remains unannotated',async()=>{
 const o=perLine(),key=canonicalPdfVersion(o);
 assert.notEqual(canonicalPdfVersion({...o,vatRate:10}),key);
 assert.notEqual(canonicalPdfVersion({...o,vatMode:'invoice'}),key);
 assert.notEqual(canonicalPdfVersion({...o,items:o.items.map((i,n)=>n?i:{...i,vatExempt:true})}),key);
 assert.equal(invoiceLineVatSnapshot({...legacy(),vatRate:10}),null);
 const read=await exactCurrentInvoiceFromOrdersList(ref,{reader:reader(legacy())});
 assert.ok(!('vatMode' in read.current));assert.ok(!('vatRate' in read.current.items[0]));
});
test('bad line/aggregate VAT fails before PDF export and does not mutate ledger',async()=>{
 for(const change of [
  o=>o.items[0].vatAmount=1,o=>o.vatAmount=8000,o=>o.items[2].vatRate=10.001,
  o=>o.items[0].vatExempt='true',o=>{delete o.vatRate;delete o.items[0].vatRate}
 ]){
  const o=perLine();change(o);const original=JSON.stringify(o);
  await assert.rejects(exactCurrentInvoiceFromOrdersList(ref,{reader:reader(o)}),/PDF_(LINE_VAT|VAT)_/);
  assert.equal(JSON.stringify(o),original);
 }
});
test('header fallback is explicit and exemption overrides a stored rate',()=>{
 const o=perLine();delete o.items[0].vatRate;o.items[1].vatRate=10;
 const tax=invoiceLineVatSnapshot(o);
 assert.deepEqual(tax.lines.map(i=>i.vatAmount),[8000,0,1]);
 assert.equal(tax.lines[0].vatRate,8);assert.equal(tax.lines[1].vatRate,0);
});
