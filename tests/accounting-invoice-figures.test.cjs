const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'accounting.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const core=fs.readFileSync(path.join(root,'accounting-core.js'),'utf8');
const bodyStart=source.indexOf('function invoiceBillAmount(o){');
const bodyEnd=source.indexOf('function renderOrderList(){',bodyStart);
assert.ok(bodyStart>=0&&bodyEnd>bodyStart,'Expected renderer helpers');
const ctx={};
vm.createContext(ctx);
vm.runInContext(core,ctx);
ctx.C=ctx.SatoriAccountingCore;
ctx.getOrderProfit=o=>{
 const lines=o.items?.length?o.items:[o];
 const goods=lines.reduce((s,it)=>s+it.qty*it.unitPrice,0);
 const list=lines.reduce((s,it)=>s+it.qty*it.listPrice,0);
 return Math.round(goods-Math.round(list*(1-(o.costDiscountPercent??25)/100)));
};
vm.runInContext(source.slice(bodyStart,bodyEnd),ctx);
const invoice=(overrides={})=>({
 id:1,invoiceNo:5953,name:'Demo customer',location:'Address',status:'Chưa thanh toán',
 total:423360,items:[{qty:6,unitPrice:70560,listPrice:98000}],...overrides
});
const row=(o,values={})=>({
 order:o,customerPaid:ctx.C.paid(o),satoriPaid:o.status==='Đã TT Satori',
 secondary:false,partnerId:'',partner:null,review:false,eligible:true,profit:0,due:0,...values
});

test('total bill comes from invoice record, NOT collaborator profit',()=>{
 const o=invoice(),r=row(o);
 const f=ctx.ledgerInvoiceFigures(r);
 assert.equal(f.bill,423360);
 assert.equal(f.customerDue,423360);
 assert.equal(f.ctvBasis,'unassigned');
 assert.notEqual(f.grossEstimate,0);
 assert.equal(ctx.invoiceBillAmount({...o,total:0}),0,'real zero invoice remains a real zero');
});
test('customer payment is independent of paid to Satori',()=>{
 const s=invoice({status:'Đã TT Satori',satoriPaidAt:'2026-10-28'});
 const pending=ctx.ledgerInvoiceFigures(row(s));
 assert.equal(pending.bill,423360);
 assert.equal(pending.customerDue,423360);
 const paid=invoice({status:'Đã TT Satori',customerPaidAt:'2026-10-28'});
 assert.equal(ctx.ledgerInvoiceFigures(row(paid)).customerDue,0);
});
test('excluded/cancelled/internal mirror bill cannot double-count debt or profit',()=>{
 for(const status of ['Đã hủy','Không Tính']){
  const f=ctx.ledgerInvoiceFigures(row(invoice({status})));
  assert.equal(f.included,false);
  assert.equal(f.customerDue,null);
  assert.equal(f.grossEstimate,null);
  assert.equal(f.ctvBasis,'excluded');
 }
 const low=ctx.ledgerInvoiceFigures(row(invoice(),{secondary:true}));
 assert.equal(low.included,false);
 assert.equal(low.customerDue,null);
 assert.equal(low.grossEstimate,null);
});
test('review or not linked CTV never displays a misleading 0 commission',()=>{
 const unassigned=ctx.ledgerInvoiceFigures(row(invoice()));
 assert.equal(unassigned.ctvBasis,'unassigned');
 const review=ctx.ledgerInvoiceFigures(row(invoice(),{review:true,partnerId:'ctv1'}));
 assert.equal(review.ctvBasis,'review');
 const missing=ctx.ledgerInvoiceFigures(row(invoice(),{partnerId:'ctv1'}));
 assert.equal(missing.ctvBasis,'missing');
 const ready=ctx.ledgerInvoiceFigures(row(invoice(),{partnerId:'ctv1',partner:{id:'ctv1'},eligible:true,profit:9000,due:8000}));
 assert.equal(ready.ctvBasis,'ready');
});
test('invalid or missing total is not falsely shown as zero',()=>{
 for(const value of ['not a number',-5]){
  assert.equal(ctx.invoiceBillAmount(invoice({total:value})),null);
 }
 const old=invoice({total:undefined});
 assert.equal(ctx.invoiceBillAmount(old),423360,'goods fallback for legacy invoices');
 const none=invoice({total:null,items:[],qty:null,unitPrice:null});
 assert.equal(ctx.invoiceBillAmount(none),null);
});
test('cost-free invoice must not invent exact gross margin',()=>{
 const f=ctx.ledgerInvoiceFigures(row(invoice({items:[{qty:5,unitPrice:50000}]})));
 assert.equal(f.grossEstimate,null);
});
test('search results show all eight key values and retain original receipt/CTV handlers',()=>{
 for(const title of ['Tổng bill','Còn thu khách','Lãi gộp ước tính','Lời CTV / Còn trả CTV',
  'Thanh toán khách / Satori','Chứng từ / Ghi trả']){
  assert.ok(source.includes(title),title);
 }
 for(const klass of ['acct-bill','acct-customer-due','acct-gross-estimate','acct-ctv-profit','acct-ctv-due']){
  assert.ok(source.includes(klass),klass);
 }
 for(const event of ['data-partner-order','data-receipt-order','data-settle-order']){
  assert.ok(source.includes(event),event);
 }
 assert.match(source,/partnerOptions\(r.partnerId\)/);
 assert.match(source,/C\.statusClass\(\{status:r\.satoriPaid/);
 assert.match(source,/if\(!\$\('acct-orders'\)\)return/);
});
test('mobile labels align exactly with 8 real table columns',()=>{
 for(let col=1;col<=8;col++){
  assert.ok(html.includes('#acct-orders .rc-table td:nth-child('+col+')::before'),'card field '+col);
 }
 assert.match(html,/#acct-orders \.rc-table td:nth-child\(8\)/);
 assert.match(html,/#acct-panel :is\(\.acct-money,/);
 assert.match(html,/container:accounting \/ inline-size/);
});
test('all accounting mutation and payment endpoints retain their exact source bodies',()=>{
 for(const [method,token] of [
  ['status',"function status(id,value){"],
  ['satoriSettlement',"function satoriSettlement(id,settled){"],
  ['settlement',"function settlement(id){"],
  ['patchOrder',"function patchOrder(id,patch){"],
  ['saveOrders',"function saveOrders(next){"],
  ['receiptForm',"function receiptForm(id){"],
 ])assert.ok(source.includes(token),'protected '+method);
 assert.match(source,/const previousRender=renderTable;renderTable=function/);
});
