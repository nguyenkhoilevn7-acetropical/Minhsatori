import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {currentAccountInvoiceHistory} from '../current-account-invoice-history.mjs';
import {currentLinkedHistory} from '../canonical-history-read.mjs';

const saved={
 id:'aeda3eab-23cc-4d9d-aea5-90bf1ffdad8f',
 requestId:'b6ab3f7c-2324-4821-8891-1d83d2c8d6ac',
 state:'COMMITTED',invoiceNo:6008,ledgerId:'ledger-6008',
 totalVnd:'250000',goodsVnd:'250000',shippingVnd:'0',vatVnd:'0',
 currency:'VND',items:[{name:'Bản báo giá cũ',qty:2,unitPrice:125000,lineTotal:250000}],
 delivery:{recipientName:'Hà Minh Nguyệt',recipientPhone:'0983000970',
  address:'Địa chỉ cũ'},deliveryRequest:{deliveryNote:'Bản cũ'}
};
const edited={
 id:'ledger-6008',invoiceNo:6008,status:'Chưa thanh toán',
 totalVnd:484799,goodsVnd:448888,shippingVnd:0,vatVnd:35911,
 date:'19/11/2026',updatedAt:'2026-11-19T09:44:51.762Z',
 delivery:{recipientName:'Hà Minh Nguyệt',
  recipientPhone:'0983000970',address:'LK 22-10 Trần Quý Kiên'},
 deliveryNote:'Đã sửa giao hàng',
 items:[{name:'Hikari 19L',code:'TP-00130',qty:8,unit:'Bình',
  unitPrice:31111,listPrice:38889,discountPercent:20,lineTotal:248888},
  {name:'Cọc Vỏ',code:'',qty:4,unit:'Thùng',unitPrice:50000,
   listPrice:50000,discountPercent:0,lineTotal:200000}],
 customerPaid:false,excluded:false
};

test('Account V2 after Android edit reads canonical qty, totals, delivery and revision',async()=>{
 const got=await currentAccountInvoiceHistory([saved],{
  batchRead:async refs=>{
   assert.deepEqual(refs,[{invoiceNo:6008,id:'ledger-6008'}]);
   return {revision:288,orders:new Map([['6008|ledger-6008',edited]])};
  },
  requestRead:async()=>{throw Error('fallback must not be called')}
 });
 assert.equal(got.syncStatus,'CURRENT');
 assert.equal(got.unavailableCount,0);
 assert.equal(got.orders[0].totalVnd,484799);
 assert.equal(got.orders[0].receipt.totalVnd,484799);
 assert.equal(got.orders[0].items[0].qty,8);
 assert.equal(got.orders[0].items[1].qty,4);
 assert.equal(got.orders[0].delivery.address,'LK 22-10 Trần Quý Kiên');
 assert.equal(got.orders[0].ledgerRevision,288);
 assert.equal(JSON.stringify(got.orders[0]).includes('Bản báo giá cũ'),false);
});

test('Older GAS no exact batch uses only original signed requestId; old ledger ID may change',async()=>{
 const got=await currentAccountInvoiceHistory([saved],{
  batchRead:async()=>{throw Error('INVALID_ACTION')},
  requestRead:async args=>{
   assert.equal(args.requestId,saved.requestId);
   assert.equal(args.invoiceNo,6008);
   return {revision:289,current:{...edited,id:'corrected-id-6008',
    totalVnd:484799,goodsVnd:448888}};
  }
 });
 assert.equal(got.syncStatus,'EXACT_REQUEST_VERIFIED');
 assert.equal(got.orders[0].verified,true);
 assert.equal(got.orders[0].ledgerId,'corrected-id-6008');
 assert.equal(got.orders[0].totalVnd,484799);
 assert.equal(got.orders[0].receipt.totalVnd,484799);
});

test('Signed read failure never falls back to the stale 250000đ quote or pretends total 0đ',async()=>{
 const got=await currentAccountInvoiceHistory([saved],{
  batchRead:async()=>{throw Error('OFFLINE')},
  requestRead:async()=>{throw Error('OFFLINE')}
 });
 assert.equal(got.syncStatus,'UNAVAILABLE');
 assert.equal(got.unavailableCount,1);
 const order=got.orders[0];
 assert.equal(order.verified,false);
 assert.equal(order.receipt,null);
 assert.equal(order.totalVnd,null);
 assert.equal(order.items.length,0);
 assert.equal(order.syncStatus,'UNAVAILABLE');
 assert.equal(order.pdf.shareable,false);
});

test('Cancelled source order renders zero payable and non-shareable PDF',async()=>{
 const got=await currentAccountInvoiceHistory([saved],{
  batchRead:async()=>{throw Error('ACTION_NOT_DEPLOYED')},
  requestRead:async()=>({revision:290,archived:true,
   current:{...edited,status:'Đã hủy',excluded:true,customerPaid:false}})
 });
 assert.equal(got.orders[0].receipt.totalVnd,0);
 assert.equal(got.orders[0].receipt.pdf.shareable,false);
 assert.equal(got.orders[0].receipt.pdf.status,'NOT_PAYABLE');
 assert.equal(got.orders[0].totalVnd,0);
});

test('Linked legacy invoices receive current phone, address, VAT, shipping and edited lines',()=>{
 const got=currentLinkedHistory([{invoiceNo:6008,sourceId:'ledger-6008'}],{
  revision:288,orders:new Map([['6008|ledger-6008',edited]])
 });
 assert.equal(got.orders.length,1);
 assert.equal(got.orders[0].totalVnd,484799);
 assert.equal(got.orders[0].phone,'0983000970');
 assert.equal(got.orders[0].address,'LK 22-10 Trần Quý Kiên');
 assert.equal(got.orders[0].vatVnd,35911);
 assert.equal(got.orders[0].items[0].qty,8);
 assert.equal(got.orders[0].deliveryNote,'Đã sửa giao hàng');
});

test('History endpoints still require account ownership and explicit source invoice binding',()=>{
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const history=router.split("if(pathname==='/api/v2/legacy/history'&&req.method==='GET'){")[1]
  .split('const pdfMatch=',1)[0];
 assert.match(history,/WHERE account_id=\$1 AND event_type='LEGACY_INVOICE_ACCOUNT_BOUND'/);
 assert.match(history,/d\.invoiceNo\+'\|'\+d\.sourceId/);
 assert.match(history,/readExactCurrentInvoices/);
 assert.doesNotMatch(history,/customers\.search|order\.name\s*===|customer\.phone\s*===/);
 const account=router.split("if(pathname==='/api/v2/orders'&&req.method==='GET'){")[1]
  .split("if(pathname==='/api/v2/admin/catalogue/readiness'",1)[0];
 assert.match(account,/r\.account_id=\$1 AND q\.account_id=\$1/);
 assert.match(account,/currentAccountInvoiceHistory\(data\.rows\)/);
 const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
 assert.match(html,/syncPending\?'Chưa xác minh'/);
 assert.match(html,/data\.unavailableCount/);
});
