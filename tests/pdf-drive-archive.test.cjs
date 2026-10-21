// Offline fake invoice only; no production data, no network.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const browser=fs.readFileSync(__dirname+'/../pdf-drive-archive.js','utf8');
const gas=fs.readFileSync(__dirname+'/../api/InvoicePdfArchive.gs','utf8');
new vm.Script(browser,{filename:'pdf-drive-archive.js'});
new vm.Script(gas,{filename:'InvoicePdfArchive.gs'});
assert(html.includes('<script src="pdf-drive-archive.js?v=1"></script>'));
assert(html.includes('window.satoriArchiveSavedInvoicePdf(lastSavedPdfOrder)'));
assert(browser.includes('prepareInvoicePdf(o)'), 'reuse website PDF');
assert(browser.includes('window.__SATORI_DRIVE_READY__'), 'wait for Drive sync');
assert(!browser.includes('fetch('), 'never use public PDF uploads');
assert(gas.includes('requireOwner_()'), 'owner authorization required');
const invoice={id:11,invoiceNo:9001,date:'01/01/2026',name:'Demo Customer',
phone:'0000000000',location:'Test Location',
items:[{product:'Test Bottled Water',qty:2,unit:'Case',unitPrice:10000,listPrice:15000}],
total:21600,vat:'yes',vatAmount:1600,shippingAmount:0,status:'Unpaid'};
const m=html.match(/function invoicePdfKey\(o\) \{[\s\S]*?\n        \}/);
assert(m,'website version key missing');
const website={};vm.createContext(website);vm.runInContext(m[0],website);
const versionKey=website.invoicePdfKey(invoice)+'\nSATORI_PDF_VIETQR_20261021';
const pdf=Buffer.from('%PDF-1.4\n'+'.'.repeat(150)+'\n%%EOF');
const digest=crypto.createHash('sha256').update(pdf).digest('hex');
const stored=new Map();
const folder={getFilesByName:n=>({hasNext:()=>stored.has(n),next:()=>stored.get(n)}),
createFile:blob=>{const f={getId:()=>String(stored.size+1),getSize:()=>blob.bytes.length,
setDescription:s=>{f.description=s;}};stored.set(blob.name,f);return f;}};
const signed=x=>x>127?x-256:x;
const ctx={
requireOwner_(){},
readState_(){return {values:{satori_orders_v15:JSON.stringify([invoice])}};},
PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='SATORI_PDF_ARCHIVE_FOLDER_ID'?'mock-folder':null})},
DriveApp:{getFolderById:id=>{assert.equal(id,'mock-folder');return folder;}},
LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},
computeDigest:(_alg,b)=>Array.from(crypto.createHash('sha256').update(Buffer.from(b.map(x=>x&255))).digest(),signed),
base64Decode:s=>Array.from(Buffer.from(s,'base64'),signed),
newBlob:(b,t,n)=>({bytes:Buffer.from(typeof b==='string'?b:b.map(x=>x&255)),type:t,name:n})}
};
vm.createContext(ctx);vm.runInContext(gas,ctx);
const input={id:'11',invoiceNo:9001,total:21600,versionKey,pdfSha256:digest,pdfBase64:pdf.toString('base64')};
assert.equal(ctx.satoriSaveInvoicePdf(input).duplicate,false);
assert.equal(stored.size,1);
assert.equal(ctx.satoriSaveInvoicePdf(input).duplicate,true);
assert.equal(stored.size,1);
assert.throws(()=>ctx.satoriSaveInvoicePdf({...input,total:999}),/Hóa đơn đã thay đổi/);
assert.throws(()=>ctx.satoriSaveInvoicePdf({...input,pdfSha256:'0'.repeat(64)}),/SHA-256/);
invoice.status='Paid';
assert.throws(()=>ctx.satoriSaveInvoicePdf(input),/Hóa đơn đã thay đổi/);
console.log('PASS original PDF archive: owner-only, current order, sha256, idempotent, no real data');
