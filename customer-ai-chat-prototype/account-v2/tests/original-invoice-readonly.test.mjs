import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {monthRange,safeLegacyInvoiceIndex} from '../legacy-owner-invoices.mjs';

test('signed source only: validated single-calendar-month windows',()=>{
 assert.deepEqual(monthRange('2026-02'),{from:'2026-02-01',to:'2026-02-28'});
 assert.deepEqual(monthRange('2028-02'),{from:'2028-02-01',to:'2028-02-29'});
 assert.deepEqual(monthRange('2026-10'),{from:'2026-10-01',to:'2026-10-31'});
 for(const month of ['2026-00','2026-13','2026-1','2026-10&x=1','',null]){
  assert.throws(()=>monthRange(month),/INVALID_INVOICE_MONTH/);
 }
});
test('reads signed original invoice index without manufacturing PDF or writes',()=>{
 const data=safeLegacyInvoiceIndex({
  revision:164,
  data:{totalMatches:2,orders:[
   {invoiceNo:5936,date:'25/10/2026',name:'Khách A',location:'Quận 10',
    status:'Đã thanh toán',total:680240,phone:'0900000000',customerPaymentReceiptUrl:'https://sensitive',items:[{name:'a'}]},
   {invoiceNo:'5937',date:'26/10/2026',name:'CTV thử',pairRole:'collaborator',total:15000,status:'Chưa thanh toán'}
  ]}
 });
 assert.equal(data.source,'signed-original-satori-ledger');
 assert.equal(data.revision,164);
 assert.equal(data.orders[0].invoiceNo,5936);
 assert.equal(data.orders[0].total,680240);
 assert.equal(data.orders[1].pairRole,'collaborator');
 assert.equal(data.truncated,false);
 assert.doesNotMatch(JSON.stringify(data),/customerPaymentReceiptUrl|https:\/\/sensitive|0900000000|pdfData|items/);
});
test('owner routes are backend-authorized, never returned from customer invoices',()=>{
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const block=router.match(/if\(pathname==='\/api\/v2\/admin\/original-invoices'[\s\S]*?(?=if\(pathname==='\/api\/v2\/orders')/)?.[0]||'';
 assert.match(block,/owner\(actor\)/);
 assert.match(block,/readOnlyReady\(\)/);
 assert.match(block,/readMinhSatori\('orders.list'/);
 assert.doesNotMatch(block,/orders\.create|orders\.update|payments\.mark|writeMinhSatori/);
 const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
 assert.match(html,/id="ownerOriginalInvoices" hidden/);
 assert.match(html,/id="invoiceMasthead"/);
 assert.match(html,/#ownerPanel,#ownerOriginalInvoices\{display:none!important\}/);
 assert.match(html,/\$\('ownerPanel'\)\.hidden=true/);
 assert.match(html,/\$\('ownerOriginalInvoices'\)\.hidden=true/);
 assert.doesNotMatch(html,/if\(me\.account\.isAdmin\)loadOwner\(\)/);
 assert.doesNotMatch(html,/const openAdmin=me\.account\.isAdmin/);
 assert.match(html,/id="originalInvoiceMonth" type="month"/);
 const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
 assert.doesNotThrow(()=>new vm.Script(inline));
});
