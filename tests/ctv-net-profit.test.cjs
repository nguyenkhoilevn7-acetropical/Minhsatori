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
const ctv={id:'ctv-nguyet',name:'Hà Minh Nguyệt',phone:'0919989887',active:true,discountPercent:35};
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
test('conflicting phone or ambiguous CTV name never auto-matches',()=>{
 const o=invoice({phone:'0900000011'});
 assert.equal(C.calculate([o],[ctv]).rows[0].partnerId,'');
 assert.equal(net([o],[ctv]),833328);
 assert.equal(C.calculate([invoice()],[ctv,{...ctv,id:'ctv-duplicate'}]).rows[0].partnerId,'');
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