// Audit unchanged function source and legacy document/key behavior against
// the CURRENT production website. Optional per_line extensions must preserve
// every legacy definition field, callback, timestamp and version key.
const fs=require('fs'),assert=require('assert/strict'),cp=require('child_process'),vm=require('node:vm');
const website=cp.execFileSync('git',['show','origin/main:index.html'],{encoding:'utf8'});
const renderer=fs.readFileSync('customer-ai-chat-prototype/original-website-pdf.mjs','utf8');
const spans=[
 ['function getOrderGoodsTotal(o) {','function getOrderProfit'],
 ['function aiDisplayPercent(value) {','function aiEscape'],
 ['function moneyToVietnameseWords(amount) {','// HÀM TIỆN ÍCH DỮ LIỆU HÓA ĐƠN'],
 ['function invoicePaymentDetails(o) {','// Build a VietQR'],
 ['function invoiceVietQrPayload(o) {','function invoicePdfShareMessage'],
 ['function invoicePdfDefinition(o, qrImage=null, logoImage=null) {','async function invoiceQrImage'],
 ['function invoicePdfKey(o) {','function pdfShareFilename']
];
const originals=[];
for(let i=0;i<spans.length;i++){
 const [start,end]=spans[i];
 const a=website.indexOf(start),b=website.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Cannot find original function in production website: '+start);
 let exact=website.slice(a,b).trim();
 if(i===2){
  const j=exact.indexOf('        // =========================================================================');
  if(j>=0)exact=exact.slice(0,j);
  exact=exact.trim();
 }
 originals.push(exact);
 // These two functions intentionally extend per_line only; legacy behavior
 // remains guarded below against the current production website definition.
 if(i<5)assert.ok(renderer.includes(exact),'Headless PDF function differs from website: '+start);
}
function topLevelFunction(source,signature){
 const start=source.indexOf(signature);assert.ok(start>=0,'Missing '+signature);
 const rest=source.slice(start),next=rest.slice(signature.length).search(/\n(?:export )?(?:async )?function /);
 return next<0?rest:rest.slice(0,signature.length+next);
}
const timeStart=website.indexOf('function invoiceCreatedAtLabel(o) {');
const timeEnd=website.indexOf('function invoicePdfDefinition(',timeStart);
assert.ok(timeStart>=0&&timeEnd>timeStart,'Missing production creation timestamp helper');
const timestamp=website.slice(timeStart,timeEnd).trim();
assert.ok(renderer.includes(timestamp),'Headless creation timestamp helper differs from website');
const production={},headless={};vm.createContext(production);vm.createContext(headless);
vm.runInContext(originals.join('\n')+'\n'+timestamp,production);
const tax=fs.readFileSync('customer-ai-chat-prototype/invoice-line-vat.mjs','utf8').replace('export function ','function ');
vm.runInContext(tax+'\n'+spans.map(([start])=>topLevelFunction(renderer,start)).join('\n')+'\n'+timestamp,headless);
// Serialize callback implementations too: JSON alone would silently discard
// footer, layout, padding and border behavior from the compatibility check.
const serialize=x=>JSON.stringify(x,(_,value)=>typeof value==='function'?value.toString().replace(/\s+/g,' '):value);
const base={id:'FAKE_ONLY',invoiceNo:90001,date:'11/11/2026',name:'FAKE CUSTOMER',phone:'000',
 location:'FAKE ADDRESS',status:'Chưa thanh toán',items:[{product:'FAKE Water',unit:'Thùng',qty:2,listPrice:15000,unitPrice:10000}],
 vat:'yes',vatAmount:1600,shippingAmount:2000,total:23600};
const variants=[{}, {timestamp:1794355200000}, {timestamp:0}, {vatMode:'invoice',vatRate:8},
 {vat:'no',vatAmount:0,total:22000}, {items:[{product:'FAKE Water',qty:1,listPrice:0,unitPrice:0}],vat:'no',vatAmount:0,shippingAmount:0,total:0},
 {deliveryNote:'FAKE note\nSecond line',taxCode:'FAKE-123'}, {status:'Đã thanh toán'},
 {items:[...base.items,{product:'FAKE Deposit',unit:'Cái',qty:1,listPrice:5000,unitPrice:5000}],vatAmount:2000,total:29000},
 {items:undefined,product:'FAKE old row',qty:1,listPrice:14000,unitPrice:10000}];
for(const fields of variants){
 const invoice={...base,...fields};
 assert.equal(headless.invoicePdfKey(invoice),production.invoicePdfKey(invoice),'Legacy PDF key changed');
 for(const logo of [null,'data:image/jpeg;base64,FAKE']){
  const expected=production.invoicePdfDefinition(invoice,null,logo);
  const actual=headless.invoicePdfDefinition(invoice,null,logo);
  assert.equal(serialize(actual),serialize(expected),'Legacy PDF definition changed');
  assert.equal(serialize(actual.footer(1,2)),serialize(expected.footer(1,2)),'Legacy PDF footer changed');
 }
}
console.log('PASS exact unchanged production PDF source + 10 legacy key/document fixtures, layouts, timestamp, footer and logo parity');
