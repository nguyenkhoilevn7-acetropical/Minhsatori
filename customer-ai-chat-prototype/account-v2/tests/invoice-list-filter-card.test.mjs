import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {invoiceOrderFilters} from '../invoice-order-filters.mjs';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const input=q=>invoiceOrderFilters(new URLSearchParams(q));

test('Vietnamese local invoice date range uses exclusive next-day bound',()=>{
 assert.deepEqual(input('from=2026-10-01&to=2026-10-30&customer=H%C3%A0%20Minh%20Nguy%E1%BB%87t'),{
  from:'2026-10-01',to:'2026-10-30',toExclusive:'2026-10-31',customer:'Hà Minh Nguyệt'
 });
 assert.deepEqual(input(''),{from:null,to:null,toExclusive:null,customer:null});
 assert.deepEqual(input('from=2026-10-30&to=2026-10-30'),{
  from:'2026-10-30',to:'2026-10-30',toExclusive:'2026-10-31',customer:null
 });
});

test('rejects invalid, ambiguous and excessive query inputs',()=>{
 for(const q of [
  'from=2026-02-30','to=2026-13-01','from=1999-01-01',
  'from=2026-10-31&to=2026-10-01',
  'from=2026-10-01&from=2026-10-02',
  'to=2026-10-03&to=2026-10-04',
  'customer=abc&customer=def',
  'customer='+encodeURIComponent('x'.repeat(110)),
  'customer=%0AUSER'
 ]){
  assert.throws(()=>input(q),{code:'INVOICE_FILTER_INVALID'},q);
 }
});

test('SQL search stays account-scoped and uses Asia/Ho_Chi_Minh day boundaries',()=>{
 const start=router.indexOf("if(pathname==='/api/v2/orders'&&req.method==='GET')");
 const end=router.indexOf("if(pathname==='/api/v2/admin/catalogue/readiness'",start);
 const route=router.slice(start,end);
 assert.match(route,/invoiceOrderFilters\(/);
 assert.match(route,/WHERE r\.account_id=\$1 AND q\.account_id=\$1/);
 assert.match(route,/ORDER BY q\.created_at DESC LIMIT 100/);
 assert.match(route,/Asia\/Ho_Chi_Minh/);
 assert.match(route,/recipientName/);
 assert.match(route,/filters\.toExclusive/);
 assert.match(route,/canonicalReceiptForAccountOrder\(x\)/);
 assert.doesNotMatch(route,/INSERT INTO|UPDATE satori|DELETE FROM|public invoice/i);
});

test('mobile invoice cards, accessible filters and separate receipt view',()=>{
 for(const id of ['invoiceFilters','invoiceCustomerSearch','invoiceFromDate','invoiceToDate',
  'invoiceApplyFilter','invoiceClearFilter','invoiceResultCount','orderRows','invoiceDetailView']){
  assert.match(html,new RegExp('id="'+id+'"'),id);
 }
 assert.match(html,/class="invoice-card-list"/);
 assert.match(html,/\.invoice-order-card\{/);
 assert.match(html,/\.invoice-order-total\{[^}]*#bd253b/);
 assert.match(inline,/function invoiceCard\(order/);
 assert.match(inline,/function activeInvoiceFilters\(/);
 assert.match(inline,/showCommittedReceipt\(order\)/);
 assert.match(inline,/invoiceListEpoch/);
 assert.match(inline,/invoiceLegacyDate\(inv\.date\)/);
 assert.doesNotThrow(()=>new vm.Script(inline));
 const receipt=inline.split('function showCommittedReceipt(order){')[1]?.split('async function loadOrders(){')[0]||'';
 assert.doesNotMatch(receipt,/\$\('messages'\)\.append\(/);
});
