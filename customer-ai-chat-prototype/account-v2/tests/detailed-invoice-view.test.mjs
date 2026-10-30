import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const receipt=inline.split('function showCommittedReceipt(order){')[1]?.split('async function loadOrders(){')[0]||'';

test('itemized invoice is a separate accessible V2 screen, not a Gemini chat card',()=>{
 assert.match(html,/id="invoiceDetailView" class="view hidden"/);
 assert.match(html,/id="invoiceDetailBack"/);
 assert.match(html,/id="invoiceDetailBody"/);
 assert.match(inline,/const views=\[[^\]]*'invoiceDetail'/);
 assert.match(receipt,/view\('invoiceDetail'\)/);
 assert.doesNotMatch(receipt,/field\(information,'Mã yêu cầu',order\.requestId\)/);
 assert.match(receipt,/field\(information,'Người nhận',order\.delivery\?\.recipientName\)/);
 assert.match(receipt,/\$\('invoiceDetailBody'\)/);
 assert.doesNotMatch(receipt,/\$\('messages'\)|chat-canonical-receipt|view\('chat'\)/);
 assert.match(inline,/Xem chi tiết hóa đơn/);
 assert.match(inline,/invoiceDetailBack'\)\.onclick=\(\)=>view\('orders'\)/);
 assert.doesNotThrow(()=>new vm.Script(inline));
});

test('only committed account-scoped invoices show detail, never invent PDF link',()=>{
 assert.match(receipt,/order\?\.verified!==true\|\|order\.state!=='COMMITTED'/);
 assert.match(receipt,/Number\.isSafeInteger\(receipt\.invoiceNo\)/);
 assert.match(receipt,/receipt\.currency!=='VND'/);
 assert.match(receipt,/AWAITING_VERIFIED_DRIVE_PDF/);
 assert.match(receipt,/Chưa có link tải chính thức/);
 assert.doesNotMatch(receipt,/window\.open|drive\.google\.com\/file|createObjectURL|\.pdf\s*=/);
});

test('saved quote breakdown and delivery are displayed without internal CTV margins',()=>{
 for(const field of ['line.name','line.code','line.qty','line.listPrice','line.discountBps',
  'line.unitPrice','line.lineTotal','order.goodsVnd','order.shippingVnd','order.vatVnd',
  'order.delivery','order.deliveryRequest','order.orderedAt'])
  assert.ok(receipt.includes(field),'missing invoice field: '+field);
 assert.match(receipt,/subtotal\+shipping\+vat!==receipt\.totalVnd/);
 assert.match(receipt,/báo giá V2 đã lưu/);
 assert.doesNotMatch(receipt,/internalUnitPrice|collaboratorMarginVnd|internalReference/);
 assert.match(router,/q\.payload->>\\'goodsVnd\\' AS "goodsVnd"/);
 assert.match(router,/q\.payload->>\\'shippingVnd\\' AS "shippingVnd"/);
 assert.match(router,/q\.payload->>\\'vatVnd\\' AS "vatVnd"/);
 assert.match(router,/const \{internalUnitPrice,internalReference,collaboratorMarginVnd,\.\.\.publicLine\}=line/);
 assert.match(router,/WHERE r\.account_id=\$1 AND q\.account_id=\$1/);
});
