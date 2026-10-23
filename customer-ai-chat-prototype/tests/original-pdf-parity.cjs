// Audit that the headless renderer contains the exact function bodies from
// the CURRENT production website. Fail CI rather than silently diverge.
const fs=require('fs'),assert=require('assert/strict'),cp=require('child_process');
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
 assert.ok(renderer.includes(exact),'Headless PDF function differs from website: '+start);
}
console.log('PASS exact 7 production website PDF function source bodies match headless renderer');
