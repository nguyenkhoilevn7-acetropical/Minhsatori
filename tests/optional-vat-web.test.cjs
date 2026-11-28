const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
function harness(){
 const elements={vatOption:{value:'yes'},perLineVat:{checked:false}};
 const ctx={document:{getElementById:id=>elements[id]},getOrderGoodsTotal:o=>(o.items||[]).reduce((s,i)=>s+i.qty*i.unitPrice,0),currentItems:[]};
 vm.createContext(ctx);
 vm.runInContext(html.slice(html.indexOf('function currentDefaultVatRate()'),html.indexOf('// Render entire form items')),ctx);
 return {ctx,elements};
}
test('invoice VAT keeps one aggregate rounding and does not add item tax fields',()=>{
 const {ctx}=harness(); const items=[{qty:1,unitPrice:7},{qty:1,unitPrice:7}];ctx.currentItems=items;
 assert.equal(ctx.formVatAmount(14),1);assert.equal(items.some(i=>'vatRate' in i),false);
 assert.equal(ctx.invoiceVatAmount({vatMode:'invoice',vatAmount:1,items:[{qty:1,unitPrice:7,vatRate:8},{qty:1,unitPrice:7,vatRate:8}]}),1);
});
test('per-line explicit exemption persists, and half-up rounds exactly',()=>{
 const {ctx,elements}=harness();elements.perLineVat.checked=true;
 ctx.currentItems=[{qty:1,unitPrice:5,vatRate:10},{qty:1,unitPrice:5000,vatRate:8,vatExempt:true}];
 assert.equal(ctx.formVatAmount(5005),1); assert.equal(ctx.currentItems[1].vatExempt,true);
 assert.equal(ctx.lineVatAmount({qty:1,unitPrice:100,vatRate:14.5}),15);
});
test('reload preserves odd legacy aggregate without manufacturing line rates',()=>{
 const {ctx}=harness(); const order={vatAmount:3,vat:'yes',items:[{qty:1,unitPrice:14}]};
 ctx.loadVatState(order);ctx.currentItems=structuredClone(order.items);
 assert.equal(ctx.formVatAmount(14),3);assert.deepEqual(ctx.currentItems,order.items);
});
test('stored per-line VAT is displayed from canonical snapshot',()=>{
 const {ctx}=harness();assert.equal(ctx.invoiceVatAmount({vatMode:'per_line',vatAmount:1,items:[{qty:1,unitPrice:14,vatRate:8,vatAmount:1}]}),1);
});
test('website profit deducts owner VAT once before the separate CTV commission',()=>{
 const core={};vm.createContext(core);vm.runInContext(fs.readFileSync('accounting-core.js','utf8'),core);
 const ctx={SatoriAccountingCore:core.SatoriAccountingCore,aiPercent:x=>x??null,getSystemDefaultCostDiscount:()=>45};
 vm.createContext(ctx);
 const a=html.indexOf('function getOrderGoodsTotal('),b=html.indexOf('function syncPaymentStatusStyle(',a);
 vm.runInContext(html.slice(a,b),ctx);
 const o={items:[{qty:1,unitPrice:100000,listPrice:140000}],costDiscountPercent:45,ownerBorneVatAmount:5000,vatAmount:0,shippingAmount:0};
 assert.equal(ctx.getOrderProfit(o),18000); // 100000 - 77000 - 5000; CTV 9000 is deducted by accounting.js.
 assert.equal(ctx.getOrderProfit({...o,ownerBorneVatAmount:undefined,vatAmount:8000}),23000);
 assert.equal(ctx.getOrderProfit({...o,ownerBorneVatAmount:undefined}),11800);
});
