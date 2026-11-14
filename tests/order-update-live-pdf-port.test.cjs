const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {portFiles,functions}=require('../api/tools/port-order-edit-pdf-to-live.cjs');
const input=process.env.SATORI_TEST_PDF_BACKUP;
test('actual live PDF ports keep legacy keys and bind per-line VAT consistently',{skip:!input},()=>{
 const files=JSON.parse(fs.readFileSync(input,'utf8')).files,next=portFiles(files),keys=[];
 const legacy={id:103,invoiceNo:103,date:'19/10/2026',name:'Synthetic',phone:'0900000000',location:'Test street',items:[{product:'Water',qty:20,unitPrice:68518.5}],total:1480000,vat:'yes',vatAmount:109630,shippingAmount:0};
 const perLine={...legacy,vatMode:'per_line',vatRate:8};
 function key(source,name){const node=functions(source).find(n=>n.id.name===name);const c={suffix:'SATORI_PDF_VIETQR_20261021',TEMPLATE:'SATORI_PDF_VIETQR_20261021',template:'SATORI_PDF_VIETQR_20261021'};vm.createContext(c);vm.runInContext(source.slice(node.start,node.end),c);return o=>c[name](o);}
 for(const [name,source] of Object.entries(next)){
  const fn=name==='InvoicePdfCustomerRead.gs'?'originalVersion':'canonical',old=key(files[name],fn),updated=key(source,fn);
  assert.equal(updated(legacy),old(legacy),'historical PDF version key is unchanged: '+name);
  assert.notEqual(updated(perLine),old(perLine),'per-line mode is bound: '+name);
  assert.notEqual(updated({...perLine,vatRate:5.5}),updated(perLine),'fallback rate is bound: '+name);
  keys.push(updated(perLine));
 }
 assert.equal(new Set(keys).size,1,'archive, queue and readback use the same PDF version');
 const state={revision:5,values:{satori_orders_v15:JSON.stringify([{...perLine,updatedAt:new Date().toISOString(),apiUpdateRequestId:'synthetic-edit'},{...legacy,id:102,invoiceNo:102}])}};
 const ctx={PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'fake-folder'})},DriveApp:{getFolderById:()=>({getFilesByName:()=>({hasNext:()=>false})})},Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},computeDigest:(_,bytes)=>[...crypto.createHash('sha256').update(bytes).digest()],newBlob:s=>({getBytes:()=>Buffer.from(s)})}};
 vm.createContext(ctx);vm.runInContext(next['InvoicePdfPendingReadOnly.gs'],ctx);
 const result=ctx.SatoriPdfQueueRead.pending(state,{limit:4});
 assert.equal(result.jobs.length,1,'edited old invoice queued; untouched old invoice excluded');
 assert.equal(result.jobs[0].order.vatMode,'per_line');assert.equal(result.jobs[0].order.vatRate,8);
 assert.equal(result.jobs[0].versionKey,keys[0]);
 assert.throws(()=>portFiles(next),/Unknown historical PDF key/,'double porting fails closed');
});
