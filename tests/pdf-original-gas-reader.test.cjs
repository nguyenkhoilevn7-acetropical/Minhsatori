const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../api/InvoicePdfCustomerRead.gs'),'utf8');
const checksum=bytes=>crypto.createHash('sha256').update(Buffer.from(bytes)).digest();
const digest=bytes=>checksum(bytes).toString('hex');
const order={id:'satori-row-5955',invoiceNo:5955,date:'29/10/2026',
 name:'Khách thử',phone:'0900000000',location:'17 Mai Chí Thọ',
 deliveryNote:'',taxCode:'',status:'Chưa thanh toán',
 items:[{product:'Suối',qty:1,listPrice:1000,unitPrice:800}],
 product:'',qty:1,listPrice:1000,unitPrice:800,vat:'no',
 vatAmount:0,shippingAmount:0,total:800};
const version=o=>JSON.stringify([o.invoiceNo,o.date,o.name,o.phone,o.location,
 o.deliveryNote,o.taxCode,o.status,o.items,o.product,o.qty,o.listPrice,
 o.unitPrice,o.vat,o.vatAmount,o.shippingAmount])+'\nSATORI_PDF_VIETQR_20261021';
const bytes=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(128,68)]);
function run({rows=[order],current=rows,missing=false,duplicate=false}={}){
 const state={values:{satori_orders_v15:JSON.stringify(rows)}};
 const latest={values:{satori_orders_v15:JSON.stringify(current)}};
 const name='MinhSatori_HD'+order.invoiceNo+'_v'+digest(Buffer.from(version(order))).slice(0,16)+'.pdf';
 let asked='',folderReads=0;
 const file={getMimeType:()=> 'application/pdf',getSize:()=>bytes.length,
  getBlob:()=>({getBytes:()=>[...bytes]})};
 const ctx={
  Utilities:{
   DigestAlgorithm:{SHA_256:'SHA_256'},
   computeDigest:(_,items)=>[...checksum(items)],
   newBlob:val=>({getBytes:()=>[...Buffer.from(val)]}),
   base64Encode:parts=>Buffer.from(parts).toString('base64')},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'pdf-folder'})},
  DriveApp:{getFolderById:()=>({getFilesByName:n=>{
   folderReads++;asked=n;let count=missing?0:duplicate?2:1;
   return {hasNext:()=>count>0,next:()=>{count--;return file}};
  }})},
  readState_:()=>latest
 };
 vm.runInNewContext(source,ctx);
 const result=()=>ctx.SatoriCustomerPdfRead.read(state,{
  invoiceNo:5955,id:order.id,expectedTotal:800});
 return {result,name,asked:()=>asked,folderReads:()=>folderReads,ctx,state};
}
test('exact current template PDF bytes are returned only via signed caller',()=>{
 const x=run();const pdf=x.result();
 assert.equal(x.asked(),x.name);
 assert.equal(pdf.pdfBase64,bytes.toString('base64'));
 assert.equal(pdf.sha256,digest(bytes));
 assert.equal(pdf.versionHash,digest(Buffer.from(version(order))).slice(0,16));
 assert.equal(pdf.id,order.id);
});
test('missing and duplicate archives fail closed',()=>{
 assert.throws(()=>run({missing:true}).result(),/PDF_NOT_READY/);
 assert.throws(()=>run({duplicate:true}).result(),/PDF_ARCHIVE_MISSING/);
});
test('a concurrently edited canonical invoice makes archived PDF stale',()=>{
 const modified={...order,status:'Đã thanh toán'};
 assert.throws(()=>run({current:[modified]}).result(),/PDF_VERSION_STALE/);
});
test('wrong identity or total never touches Drive',()=>{
 const x=run();assert.throws(()=>x.ctx.SatoriCustomerPdfRead.read(x.state,{
  invoiceNo:5955,id:order.id,expectedTotal:801}),/PDF_NOT_READY/);
 assert.equal(x.folderReads(),0);
});
