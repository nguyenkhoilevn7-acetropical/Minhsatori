// Offline unit tests for Grok Phase B pricing and gating. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {priceOwnerOrder,draftSummary,vatBasisPoints,norm,GrokOrderError} from '../grok-orders.mjs';
import {grokToolList,GROK_TOOLS} from '../grok-mcp.mjs';

const base=(x={})=>({customer:{name:'Khách Giả',location:'01 Đường Giả'},items:[{product:'Nước Giả',qty:3,unitPrice:95000}],...x});
const code=(f)=>{try{f();return 'NO_ERROR'}catch(e){assert.ok(e instanceof GrokOrderError,String(e));return e.code}};

test('no VAT unless asked; shipping is never taxed',()=>{
 const {order,breakdown}=priceOwnerOrder(base({shippingAmount:30000}));
 assert.deepEqual([breakdown.goods,breakdown.vat,breakdown.total,breakdown.vatMode],[285000,0,315000,'none']);
 assert.equal(order.vatAmount,0);assert.equal(order.total,315000);assert.ok(!('vatRate' in order));
 assert.deepEqual(order.items[0],{code:'',product:'Nước Giả',unit:'Thùng',qty:3,unitPrice:95000,listPrice:95000});
});
test('order vatRate without line fields = historic invoice VAT on goods (no vatRate sent)',()=>{
 const {order,breakdown}=priceOwnerOrder(base({vatRate:8,shippingAmount:30000,
  items:[{product:'A Giả',qty:3,unitPrice:95000},{product:'B Giả',qty:2,unitPrice:62500}]}));
 assert.deepEqual([breakdown.goods,breakdown.vat,breakdown.total,breakdown.vatMode],[410000,32800,472800,'invoice']);
 assert.equal(order.vatAmount,32800);assert.ok(!('vatRate' in order));assert.ok(order.items.every(i=>!('vatAmount' in i)));
 assert.equal(priceOwnerOrder(base({vatRate:8,items:[{product:'Lẻ',qty:1,unitPrice:13}]})).order.vatAmount,1,'1.04 -> 1');
 assert.equal(priceOwnerOrder(base({vatRate:10,items:[{product:'Lẻ',qty:1,unitPrice:5}]})).order.vatAmount,1,'0.5 -> 1 half-up');
});
test('per-line VAT: exempt > line rate > order rate, half-up per line, summed once',()=>{
 const {order,breakdown}=priceOwnerOrder(base({vatRate:8,shippingAmount:2000,items:[
  {product:'Nước Giả',qty:1,unitPrice:100000},{product:'Cọc Vỏ',qty:1,unitPrice:10,vatExempt:true,vatRate:10},
  {product:'Lẻ 10%',qty:1,unitPrice:5,vatRate:10}]}));
 assert.deepEqual([breakdown.vat,breakdown.total,breakdown.vatMode],[8001,110016,'per_line']);
 assert.equal(order.vatRate,8);assert.equal(order.vatAmount,8001);
 assert.deepEqual(order.items.map(i=>[i.vatExempt,i.vatRate,i.vatAmount]),[[undefined,undefined,8000],[true,undefined,0],[undefined,10,1]]);
 assert.equal(code(()=>priceOwnerOrder(base({items:[{product:'Có',qty:1,unitPrice:1,vatRate:8},{product:'Không rõ',qty:1,unitPrice:1}]}))),'VAT_RATE_REQUIRED');
});
test('money and identity inputs fail closed',()=>{
 for(const [x,c] of [
  [{items:[{product:'A Giả',qty:1.5,unitPrice:1}]},'INVALID_ITEM'],[{items:[{product:'A Giả',qty:1,unitPrice:1.5}]},'INVALID_AMOUNT'],
  [{items:[{product:'A Giả',qty:1,unitPrice:-1}]},'INVALID_AMOUNT'],[{items:[]},'INVALID_ORDER'],
  [{items:[{product:'A',qty:1,unitPrice:1}]},'INVALID_ITEM'],[{vatRate:8.001},'INVALID_TAX_RATE'],[{vatRate:101},'INVALID_TAX_RATE'],
  [{shippingAmount:'30000'},'INVALID_AMOUNT'],[{customer:{name:'A'}},'INVALID_ORDER'],[{deliveryDate:'2026-02-30'},'INVALID_ORDER'],
  [{items:[{product:'A Giả',qty:1,unitPrice:1,vatExempt:'true'}]},'INVALID_TAX_RATE'],
  [{items:[{product:'A Giả',qty:100001,unitPrice:1}]},'INVALID_ITEM']])
  assert.equal(code(()=>priceOwnerOrder(base(x))),c,JSON.stringify(x));
 assert.equal(vatBasisPoints(8.25),825);assert.equal(norm(' Khách ĐẶNG Treky '),'khach dang traky');
});
test('summary states every amount the owner approves, and the code',()=>{
 const p=priceOwnerOrder(base({vatRate:8,shippingAmount:30000,deliveryDate:'2026-11-13'}));
 const s=draftSummary(p,'0420','KHÁCH MỚI');
 for(const re of [/ĐƠN NHÁP \(chưa ghi sổ\)/,/Nước Giả — 3 Thùng × 95\.000 đ = 285\.000 đ/,/VAT 8% trên tiền hàng: 22\.800 đ/,
  /Phí giao: 30\.000 đ/,/TỔNG: 337\.800 đ/,/Mã duyệt: 0420/,/Ngày giao: 2026-11-13/])assert.match(s,re);
});
test('order tools are listed only when GROK_OWNER_WRITES_ENABLED=1',()=>{
 assert.deepEqual(grokToolList({}),GROK_TOOLS);assert.deepEqual(grokToolList({GROK_OWNER_WRITES_ENABLED:'true'}),GROK_TOOLS);
 assert.deepEqual(grokToolList({GROK_OWNER_WRITES_ENABLED:'1'}).map(t=>t.name).slice(2),
  ['satori_find_customer','satori_order_draft','satori_order_confirm','satori_order_status']);
 assert.ok(!JSON.stringify(grokToolList({GROK_OWNER_WRITES_ENABLED:'1'})).match(/payment|delete|markPaid/i));
});
