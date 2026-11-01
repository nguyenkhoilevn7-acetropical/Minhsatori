import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {readExactCurrentInvoices,currentCustomerOrder,currentLinkedHistory}
 from '../canonical-history-read.mjs';

const raw={id:'original-5955',invoiceNo:5955,status:'Đã thanh toán',
 totalVnd:91000,goodsVnd:80000,shippingVnd:8000,vatVnd:3000,
 delivery:{recipientName:'Khách đã sửa tên',recipientPhone:'0900000000',address:'Địa chỉ mới'},
 deliveryNote:'Giao sau 2h',updatedAt:'2026-11-01T11:15:00Z',
 items:[{name:'Satori 350ml',code:'TP-00001',unit:'Thùng',
 qty:2,unitPrice:40000,listPrice:50000,discountPercent:20,lineTotal:80000}],
 customerPaid:true,excluded:false};
const original={id:'8fa0e083-7a63-4f16-8789-a08b3cff3071',requestId:'b6ab3f7c-2324-4821-8891-1d83d2c8d6ac',
 state:'COMMITTED',invoiceNo:5955,ledgerId:'original-5955',
 totalVnd:'100000',goodsVnd:'100000',shippingVnd:'0',vatVnd:'0',
 currency:'VND',items:[{name:'Bản cũ',qty:1,lineTotal:100000}],
 delivery:{recipientName:'Tên cũ',recipientPhone:'0911111111',address:'Địa chỉ cũ'},
 deliveryRequest:{deliveryNote:'Ghi chú cũ'}};

test('V2 customer receipt and history always use canonical edited bill, not quote snapshot',()=>{
 const latest=currentCustomerOrder(original,raw,195);
 assert.equal(latest.totalVnd,91000);
 assert.equal(latest.receipt.totalVnd,91000);
 assert.equal(latest.delivery.recipientName,'Khách đã sửa tên');
 assert.equal(latest.delivery.address,'Địa chỉ mới');
 assert.equal(latest.deliveryRequest.deliveryNote,'Giao sau 2h');
 assert.equal(latest.items[0].name,'Satori 350ml');
 assert.equal(latest.items[0].qty,2);
 assert.equal(latest.invoiceStatus,'Đã thanh toán');
 assert.equal(latest.customerPaid,true);
 assert.equal(latest.ledgerRevision,195);
 assert.equal(JSON.stringify(latest).includes('Tên cũ'),false);
 const legacy=currentLinkedHistory([{invoiceNo:5955,sourceId:raw.id}],{
  revision:195,orders:new Map([[raw.invoiceNo+'|'+raw.id,raw]])
 });
 assert.equal(legacy.orders[0].totalVnd,91000);
 assert.equal(legacy.orders[0].status,'Đã thanh toán');
 assert.equal(legacy.orders[0].items[0].product,'Satori 350ml');
});

test('Không Tính / Đã hủy render 0đ and cannot offer active official PDF',()=>{
 for(const status of ['Không Tính','Đã hủy']){
  const latest=currentCustomerOrder(original,{
   ...raw,status,excluded:true,customerPaid:false,totalVnd:0,
   goodsVnd:0,shippingVnd:0,vatVnd:0
  },196);
  assert.equal(latest.totalVnd,0);
  assert.equal(latest.receipt.totalVnd,0);
  assert.equal(latest.receipt.pdf.shareable,false);
  assert.equal(latest.receipt.pdf.status,'NOT_PAYABLE');
  assert.equal(latest.customerPaid,false);
 }
});

test('wrong invoice ID, stale total, missing current row always reject',()=>{
 assert.throws(()=>currentCustomerOrder(original,{...raw,id:'different'},196),/CANONICAL_INVOICE_NOT_FOUND/);
 assert.throws(()=>currentCustomerOrder(original,{...raw,totalVnd:1},196),/CANONICAL_TOTAL_CONFLICT/);
 assert.throws(()=>currentCustomerOrder(original,{...raw,missing:true},196),/CANONICAL_INVOICE_NOT_FOUND/);
});

test('signed batch fetch permits only exact refs and no mixed revisions',async()=>{
 const refs=Array.from({length:25},(_,n)=>({id:'id'+n,invoiceNo:1000+n}));
 let calls=0;
 const read=async(_action,{refs:list})=>{
  calls++;return {revision:calls===2?11:10,data:{orders:list.map(x=>({...x,missing:true}))}};
 };
 await assert.rejects(readExactCurrentInvoices(refs,{reader:read}),/CANONICAL_REVISION_CHANGED/);
 assert.equal(calls,2);
 await assert.rejects(readExactCurrentInvoices([{id:'abc',invoiceNo:1},{
  id:'wrong id',invoiceNo:2}],{reader:read}),/CANONICAL_REFS_INVALID/);
 const result=await readExactCurrentInvoices([{id:'abc',invoiceNo:11}],{
  reader:async()=>({revision:197,data:{orders:[{id:'abc',invoiceNo:11,missing:true}]}})
 });
 assert.equal(result.revision,197);
 assert.equal(result.orders.get('11|abc').missing,true);
});

test('backend resolves only owner-bound exact IDs before returning customer invoices',()=>{
 const source=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const account=source.split("if(pathname==='/api/v2/orders'&&req.method==='GET'){")[1]
  .split("if(pathname==='/api/v2/admin/catalogue/readiness'",1)[0];
 assert.match(account,/r\.account_id=\$1 AND q\.account_id=\$1/);
 assert.match(account,/readExactCurrentInvoices/);
 assert.match(account,/currentCustomerOrder/);
 const linked=source.split("if(pathname==='/api/v2/legacy/history'&&req.method==='GET'){")[1]
  .split('const pdfMatch=',1)[0];
 assert.match(linked,/event_type='LEGACY_INVOICE_ACCOUNT_BOUND'/);
 assert.match(linked,/account_id=\$1/);
 assert.doesNotMatch(linked,/customers.search|orders.list|order\.name\s*===/);
 const pdf=source.split('const pdfMatch=')[1].split("if(pathname==='/api/v2/orders'&&req.method==='GET'){")[0];
 assert.match(pdf,/readExactCurrentInvoices/);
 assert.match(pdf,/expectedTotal:Number\(latest.totalVnd\)/);
 assert.match(pdf,/!latest.excluded/);
 const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
 const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
 assert.match(inline,/ledgerRevision/);
 assert.match(inline,/invoiceStatus/);
 assert.match(inline,/visibilitychange/);
 assert.doesNotThrow(()=>new vm.Script(inline));
});
