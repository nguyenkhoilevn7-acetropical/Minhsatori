// Fake invoices only. No real accounting, Drive writes, or Production mutations.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(root,'accounting-core.js'),'utf8');
const server=fs.readFileSync(path.join(root,'api/AccountingCore.gs'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const from=html.indexOf('function getOrderGoodsTotal(o) {');
const to=html.indexOf('function syncPaymentStatusStyle(',from);
assert.ok(from>=0&&to>from,'Profit helpers must remain available');
const ctx={aiPercent:n=>Number.isFinite(Number(n))?Number(n):null,
 getSystemDefaultCostDiscount:()=>45};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(core,ctx);
vm.runInContext(html.slice(from,to),ctx);
const C=ctx.SatoriAccountingCore;
const ctv={id:'ctv-nguyet',name:'Hà Minh Nguyệt',phone:'0988888888',active:true,discountPercent:35};
const invoice=(overrides={})=>({
 id:1793526598728,invoiceNo:5966,date:'01/11/2026',
 name:'Hà Minh Nguyệt',phone:'919989887',status:'Chưa thanh toán',
 total:2879993,vatAmount:213333,shippingAmount:0,
 items:[
  {qty:3,unitPrice:266666,listPrice:333333},
  {qty:7,unitPrice:266666,listPrice:333333}
 ],...overrides
});
const net=(all,partners,index=0)=>{
 ctx.orders=all;
 ctx.window.Acct={model:()=>C.calculate(ctx.orders,partners)};
 return ctx.getOrderNetProfit(all[index]);
};

test('bill 5966: exclude VAT and deduct 35%-20% CTV commission once',()=>{
 const o=invoice(),row=C.calculate([o],[ctv]).rows[0];
 assert.equal(C.goods(o),2666660);
 assert.equal(C.total(o),2879993);
 assert.equal(row.partnerId,ctv.id,'unique registered CTV identity should be resolved');
 assert.equal(row.profit,499995,'commission is on merchandise, not VAT');
 assert.equal(ctx.getOrderProfit(o),833328,'gross calculation uses 45% company cost');
 assert.equal(net([o],[ctv]),333333,'owner margin after CTV');
});
test('regular customers do not inherit CTV discount',()=>{
 const o=invoice({name:'Khách thường',phone:'0900000000'});
 assert.equal(net([o],[ctv]),833328);
});
test('registered CTV name resolves despite delivery phone; ambiguous names fail closed',()=>{
 const o=invoice({phone:'0900000011'});
 assert.equal(C.calculate([o],[ctv]).rows[0].partnerId,ctv.id);
 assert.equal(net([o],[ctv]),333333);
 assert.equal(C.calculate([invoice()],[ctv,{...ctv,id:'ctv-duplicate'}]).rows[0].partnerId,'');
 // Ordinary customer with non-CTV name is never assigned by matching a discount.
 assert.equal(net([invoice({name:'Ordinary Customer',phone:'0900000011'})],[ctv]),833328);
});
test('CTV at its own 35% unit price has zero commission despite rounding',()=>{
 const o=invoice({invoiceNo:5917,vatAmount:0,shippingAmount:104000,
  total:1403996,items:[{qty:6,unitPrice:216666,listPrice:333333,discountPercent:35}]});
 const row=C.calculate([o],[ctv]).rows[0];
 assert.equal(row.profit,0);
 assert.equal(net([o],[ctv]),199997);
});
test('explicit collaborator assignment works for third-party recipient',()=>{
 const o=invoice({name:'Khách của Nguyệt',phone:'0900000011',collaboratorId:ctv.id,collaboratorDiscountPercent:35});
 assert.equal(net([o],[ctv]),333333);
});
test('cancelled, excluded and internal CTV mirror invoices earn zero',()=>{
 for(const status of ['Không Tính','Đã hủy']){
  assert.equal(net([invoice({status})],[ctv]),0);
 }
 assert.equal(net([invoice({pairRole:'collaborator'})],[ctv]),0);
});
test('website does not subtract commission twice in filtered sums',()=>{
 assert.match(html,/const subProfit =[^\n]*getOrderNetProfit\(o, financialModel\.rows\.find/);
 assert.match(html,/globalTotalProfit \+= getOrderNetProfit\(o,row\)/);
 assert.match(html,/const profitValArchive = getOrderNetProfit\(o\)/);
 assert.match(html,/const previewCTV=SatoriAccountingCore\.calculate/);
 assert.match(html,/costTotal - commission/);
});
test('server-side and web collaborator accounting rules stay byte-identical',()=>{
 assert.equal(core.trimEnd(),server.trimEnd());
});
test('owner covers 8% of list price when neither VAT nor shipping is charged',()=>{
 const o=invoice({name:'Lan Hồ',invoiceNo:5974,vatAmount:0,shippingAmount:0,
  total:2991188,items:[{qty:1,listPrice:3519045,unitPrice:2991188}]});
 assert.equal(C.ownerBorneCharge(o),281524);
 assert.equal(net([o],[]),ctx.getOrderProfit(o)-281524);
 assert.equal(o.total,2991188,'buyer invoice total must not change');
});
test('customer-funded VAT/ship, VAT exemption, explicit policy overrides avoid double deduction',()=>{
 const o=invoice({name:'Lan Hồ',vatAmount:0,shippingAmount:0,
   items:[{qty:1,listPrice:100000,unitPrice:85000}]});
 assert.equal(C.ownerBorneCharge(o),8000);
 assert.equal(C.ownerBorneCharge({...o,vatAmount:6800}),0);
 assert.equal(C.ownerBorneCharge({...o,shippingAmount:6800}),0);
 assert.equal(C.ownerBorneCharge({...o,vatExempt:true}),0);
 assert.equal(C.ownerBorneCharge({...o,ownerBorneVat:false}),0);
 assert.equal(C.ownerBorneCharge({...o,ownerBorneVatAmount:3000}),3000);
 assert.equal(C.ownerBorneCharge({...o,ownerBorneVatPercent:5}),5000);
 assert.equal(C.ownerBorneCharge({...o,status:'Đã hủy'}),0);
});
test('owner-covered VAT and CTV commission are each deducted exactly once',()=>{
 const o=invoice({vatAmount:0,shippingAmount:0});
 const commission=C.calculate([o],[ctv]).rows[0].profit;
 const expected=ctx.getOrderProfit(o)-commission-C.ownerBorneCharge(o);
 assert.equal(net([o],[ctv]),expected);
});
