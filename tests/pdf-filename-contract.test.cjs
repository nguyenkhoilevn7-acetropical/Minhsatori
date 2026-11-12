const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const index=fs.readFileSync(__dirname+'/../index.html','utf8');
const first=index.indexOf('function formatInvoicePdfOrderDate(value) {');
const last=index.indexOf('function getCurrentInvoiceData()',first);
assert(first>=0&&last>first);
const funcs=vm.runInNewContext(index.slice(first,last)+'\n({make:getInvoicePdfFilename})');
const sample={invoiceNo:5988,name:'Traky Sài Gòn',date:'12/11/2026',id:'bec82256-b25c-424a-8888-test'};
assert.equal(funcs.make(sample),'5988 - Traky Sài Gòn - 2026-11-12.pdf');
assert.equal(funcs.make({...sample,date:'2026-11-12'}),'5988 - Traky Sài Gòn - 2026-11-12.pdf');
assert.equal(funcs.make({...sample,name:'Cô/Lan: Thủ Đức'}),'5988 - Cô Lan Thủ Đức - 2026-11-12.pdf');
for(const bad of [{...sample,date:'31/02/2026'},{...sample,date:''},{...sample,name:''},{...sample,invoiceNo:0}])
  assert.throws(()=>funcs.make(bad));
assert(!funcs.make(sample).includes('bec82256'));

const share=fs.readFileSync(__dirname+'/../share.html','utf8');
const a=share.indexOf('const safeName=value=>{');
const b=share.indexOf('function ready()',a);
assert(a>=0&&b>a);
const safe=vm.runInNewContext(share.slice(a,b)+'\nsafeName');
assert.equal(safe(funcs.make(sample)),funcs.make(sample));
assert.throws(()=>safe('bec82256-b25c-424a...MinhSatori_HD_5988.pdf'));
assert.match(index,/new File\(\[bytes\],pdfShareFilename\(result\.fileName\)/);
assert.match(index,/a\.download=result\.fileName/);
console.log('PASS canonical invoice filename, Vietnamese recipient, original date and Web Share guard');
