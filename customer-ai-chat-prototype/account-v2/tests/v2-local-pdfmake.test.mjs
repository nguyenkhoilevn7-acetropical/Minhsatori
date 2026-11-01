import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {currentInvoiceForWebsitePdf,renderCurrentV2Pdf} from '../local-invoice-pdf.mjs';
import {exactCurrentInvoiceFromOrdersList,exactCurrentInvoiceFromRequestId} from '../local-invoice-read.mjs';
import {canonicalPdfVersion,PDF_TEMPLATE_VERSION} from '../../original-website-pdf.mjs';

const current={id:'1793512177336',invoiceNo:5965,date:'01/11/2026',
 status:'Chưa thanh toán',excluded:false,goodsVnd:784000,shippingVnd:0,
 vatVnd:62720,totalVnd:846720,deliveryNote:'Giao sau 2 giờ',
 delivery:{recipientName:'KHÁCH GIẢ LẬP',recipientPhone:'0000000000',
 address:'Địa chỉ FAKE không giao'},
 items:[{name:'Nước tinh khiết Satori 500ml',code:'TP-00003',
  unit:'Thùng',qty:10,unitPrice:78400,listPrice:98000,lineTotal:784000}]};
const ref={invoiceNo:5965,ledgerId:current.id};
const raw={id:Number(current.id),invoiceNo:5965,date:current.date,
 name:current.delivery.recipientName,phone:current.delivery.recipientPhone,
 location:current.delivery.address,deliveryNote:current.deliveryNote,
 status:current.status,total:current.totalVnd,vatAmount:current.vatVnd,
 shippingAmount:current.shippingVnd,items:current.items.map(x=>({
  product:x.name,code:x.code,unit:x.unit,qty:x.qty,
  unitPrice:x.unitPrice,listPrice:x.listPrice
 }))};
test('Read current exact invoice by immutable number AND ledger ID, not names',async()=>{
 let seen;
 const result=await exactCurrentInvoiceFromOrdersList(ref,{
  reader:async(action,payload)=>{
   seen={action,payload};
   return {revision:201,data:{totalMatches:1,orders:[raw]}};
  }
 });
 assert.equal(seen.action,'orders.list');
 assert.deepEqual(seen.payload,{query:'5965',limit:100});
 assert.equal(result.revision,201);
 assert.equal(result.current.items[0].unitPrice,78400);
 assert.equal(result.current.vatVnd,62720);
 assert.equal(result.current.totalVnd,846720);
 assert.equal(result.current.deliveryNote,'Giao sau 2 giờ');
});
test('Original website pdfmake renders a REAL V2 PDF with logo/VietQR from saved canonical amounts',async()=>{
 const pdf=await renderCurrentV2Pdf(current,ref);
 assert.equal(pdf.bytes.subarray(0,5).toString('ascii'),'%PDF-');
 assert.ok(pdf.bytes.length>4000);
 assert.equal(pdf.template,PDF_TEMPLATE_VERSION);
 assert.equal(pdf.versionKey,canonicalPdfVersion(currentInvoiceForWebsitePdf(current,ref)));
 assert.equal(pdf.sha256,crypto.createHash('sha256').update(pdf.bytes).digest('hex'));
 const rendered=pdf.bytes.toString('latin1');
 assert.match(rendered,/\/Type\s*\/Page/);
});
test('Owner edits change PDF canonical version and customer line amounts without second invoice',async()=>{
 const edited={...current,status:'Đã thanh toán',goodsVnd:1568000,vatVnd:125440,
 totalVnd:1693440,delivery:{...current.delivery,address:'Địa chỉ đã được sửa'},
 items:[{...current.items[0],qty:20,lineTotal:1568000}]};
 const a=currentInvoiceForWebsitePdf(current,ref),b=currentInvoiceForWebsitePdf(edited,ref);
 assert.notEqual(canonicalPdfVersion(a),canonicalPdfVersion(b));
 assert.equal(b.items[0].qty,20);
 assert.equal(b.total,1693440);
 assert.equal(b.status,'Đã thanh toán');
 assert.equal(b.location,'Địa chỉ đã được sửa');
 const pdf=await renderCurrentV2Pdf(edited,ref);
 assert.equal(pdf.bytes.subarray(0,5).toString('ascii'),'%PDF-');
});
test('Wrong customer/ledger identity, invalid money, canceled bills fail closed',async()=>{
 for(const v of [
  {...ref,ledgerId:'someone-else'},
  {...ref,invoiceNo:5964}
 ])assert.throws(()=>currentInvoiceForWebsitePdf(current,v),/V2_PDF_CURRENT_INVOICE_REQUIRED/);
 assert.throws(()=>currentInvoiceForWebsitePdf({...current,totalVnd:20},ref),/V2_PDF_TOTAL_CONFLICT/);
 for(const status of ['Đã hủy','Không Tính'])assert.throws(
  ()=>currentInvoiceForWebsitePdf({...current,status,excluded:true,totalVnd:0},ref),
  /V2_PDF_CURRENT_INVOICE_REQUIRED/
 );
 for(const fake of [
  {revision:201,data:{totalMatches:1,orders:[{...raw,id:123}]}},
  {revision:201,data:{totalMatches:110,orders:[raw]}},
  {revision:201,data:{totalMatches:2,orders:[raw,raw]}},
 ])await assert.rejects(exactCurrentInvoiceFromOrdersList(ref,{
  reader:async()=>fake
 }),/V2_PDF_LEDGER_(NOT_FOUND|READ_INCOMPLETE)/);
});
test('Customer PDF route requires V2 account-owned committed request and latest signed readback',()=>{
 const r=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const chunk=r.split('const pdfMatch=')[1].split("if(pathname==='/api/v2/orders'&&req.method==='GET')")[0];
 assert.match(chunk,/r\.account_id=\$2 AND q\.account_id=\$2/);
 assert.match(chunk,/r\.state='COMMITTED'/);
 assert.match(chunk,/exactCurrentInvoiceFromRequestId/);
 assert.match(chunk,/renderCurrentV2Pdf/);
 assert.match(chunk,/SATORI_V2_LOCAL_PDFMAKE_ENABLED/);
 assert.match(chunk,/cache-control':'private, no-store/);
 assert.doesNotMatch(chunk,/DriveApp|setSharing|orders\.create|payments\.mark/);
});

test('V2 confirmed PDF uses signed immutable requestId; ignores stale saved ledger ID',async()=>{
 const requestId='ccfc0399-1b84-4d80-8100-8b729610712b';
 let called;
 const x=await exactCurrentInvoiceFromRequestId({
  ...ref,ledgerId:'old-snapshot-source-id',requestId
 },{reader:async(action,payload)=>{
  called={action,payload};
  return {revision:202,data:{found:true,state:'COMMITTED',order:raw}};
 }});
 assert.deepEqual(called,{action:'orders.findByRequestId',payload:{requestId}});
 assert.equal(x.current.id,String(raw.id));
 assert.equal(x.current.invoiceNo,5965);
 assert.equal(x.current.totalVnd,846720);
 const pdf=await renderCurrentV2Pdf(x.current,{invoiceNo:5965,ledgerId:String(raw.id)});
 assert.equal(pdf.bytes.subarray(0,5).toString('ascii'),'%PDF-');
});
test('Deleted canonical invoice creates CANCELLED nonpayable archival copy; no new bill',async()=>{
 const requestId='ccfc0399-1b84-4d80-8100-8b729610712b';
 const reply=await exactCurrentInvoiceFromRequestId({...ref,requestId},{
  reader:async()=>({revision:202,data:{found:true,state:'DELETED',order:raw}})
 });
 assert.equal(reply.archived,true);
 assert.equal(reply.current.excluded,true);
 assert.equal(reply.current.status,'Đã hủy');
 assert.equal(reply.current.totalVnd,current.totalVnd); // historical only
 assert.throws(()=>currentInvoiceForWebsitePdf(reply.current,ref),
  /V2_PDF_CURRENT_INVOICE_REQUIRED/);
 const doc=currentInvoiceForWebsitePdf(reply.current,ref,{allowArchived:true});
 assert.equal(doc.status,'Đã hủy');
 const pdf=await renderCurrentV2Pdf(reply.current,ref,{allowArchived:true});
 assert.equal(pdf.cancelled,true);
 assert.equal(pdf.bytes.subarray(0,5).toString('ascii'),'%PDF-');
 assert.notEqual(pdf.versionKey,canonicalPdfVersion(currentInvoiceForWebsitePdf(current,ref)));
 const source=readFileSync(new URL('../../original-website-pdf.mjs',import.meta.url),'utf8');
 assert.match(source,/payment\.columns\[0\]\.stack=\[\{/);
 assert.match(source,/KHÔNG ĐƯỢC SỬ DỤNG ĐỂ THANH TOÁN/);
});
test('V2 PDF blocks deleted request, wrong original invoice and forged authorizations',async()=>{
 const requestId='ccfc0399-1b84-4d80-8100-8b729610712b';
 const input={...ref,requestId};
 for(const value of [
  {found:true,state:'COMMITTED',order:{...raw,invoiceNo:999}},
  {found:true,state:'COMMITTED',order:{...raw,id:'../bad'}},
  {found:true,state:'UNCERTAIN',order:raw}
 ])await assert.rejects(exactCurrentInvoiceFromRequestId(input,{
  reader:async()=>({revision:202,data:value})
 }),/V2_PDF_LEDGER_(NOT_ACTIVE|ID_CONFLICT)/);
});
test('V2 PDF falls back to original strict ledger list for pre-requestId older orders',async()=>{
 let calls=0;
 const x=await exactCurrentInvoiceFromRequestId({...ref,requestId:'a'.repeat(36)},{
  reader:async(action)=>{
   calls++;
   return action==='orders.findByRequestId'?
    {revision:202,data:{found:false,state:'NOT_FOUND'}}:
    {revision:202,data:{totalMatches:1,orders:[raw]}};
  }
 });
 assert.equal(calls,2);
 assert.equal(x.current.id,String(raw.id));
});
