// Offline synthetic invoices only. Actual JS/GAS modules; no live services.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
const json=x=>JSON.parse(JSON.stringify(x));
const suffix='\nSATORI_PDF_VIETQR_20261021';
const legacyKey=o=>JSON.stringify([o.invoiceNo,o.date,o.name,o.phone,o.location,o.deliveryNote,
 o.taxCode,o.status,o.items,o.product,o.qty,o.listPrice,o.unitPrice,o.vat,o.vatAmount,o.shippingAmount]);
const version=o=>{
 const fields=JSON.parse(legacyKey(o));
 if(o.vatMode==='per_line')fields.push(o.vatMode,o.vatRate??null);
 return JSON.stringify(fields)+suffix;
};
const invoice=()=>({id:Date.now(),invoiceNo:90001,date:'11/11/2026',name:'FAKE Customer',phone:'000',
 location:'FAKE address',status:'Chưa thanh toán',vat:'yes',vatAmount:8000,shippingAmount:2000,
 total:110000,collaboratorId:'fake-ctv',collaboratorDiscountPercent:35,costDiscountPercent:45,
 items:[{product:'FAKE Water',qty:1,unitPrice:100000,listPrice:140000}]});
function archiveHarness(order){
 const stored=new Map(),pdf=Buffer.from('%PDF-1.4\n'+'FAKE'.repeat(50));
 const signed=b=>Array.from(b,x=>x>127?x-256:x);
 const ctx={requireOwner_(){},readState_:()=>({revision:1,values:{satori_orders_v15:JSON.stringify([order])}}),
 PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'FAKE_FOLDER'})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 DriveApp:{getFolderById:()=>({getFilesByName:name=>({hasNext:()=>stored.has(name),next:()=>stored.get(name)}),
 createFile:blob=>{const file={getId:()=>String(stored.size),getSize:()=>blob.bytes.length,setDescription(){}};
 stored.set(blob.name,file);return file;}})},
 Utilities:{DigestAlgorithm:{SHA_256:'sha256'},
 computeDigest:(_,bytes)=>signed(crypto.createHash('sha256').update(Buffer.from(bytes.map(x=>x&255))).digest()),
 base64Decode:s=>signed(Buffer.from(s,'base64')),
 newBlob:(data,type,name)=>{const bytes=typeof data==='string'?Buffer.from(data):Buffer.from(data.map(x=>x&255));
 return {bytes,name,getBytes:()=>signed(bytes)}}}};
 vm.createContext(ctx);vm.runInContext(read('api/InvoicePdfArchive.gs'),ctx);
 const input=()=>({id:String(order.id),invoiceNo:order.invoiceNo,total:order.total,versionKey:version(order),
 pdfBase64:pdf.toString('base64'),pdfSha256:crypto.createHash('sha256').update(pdf).digest('hex')});
 const jobs=()=>json(ctx.SatoriInvoicePdfArchive.pending(ctx.readState_(),{}).jobs);
 return {ctx,input,jobs,stored};
}
test('archive preserves historical key and projection bytes for invoices without new tax fields',()=>{
 const o=invoice(),h=archiveHarness(o),job=h.jobs()[0];
 assert.equal(job.versionKey,legacyKey(o)+suffix);
 assert.equal(job.versionKey,version(o));
 assert.ok(!('vatMode' in job.order));assert.ok(!('vatRate' in job.order));
 assert.ok(!('collaboratorId' in job.order));assert.ok(!('costDiscountPercent' in job.order));
 assert.equal(h.ctx.satoriSaveInvoicePdf(h.input()).duplicate,false);
 assert.equal(h.ctx.satoriSaveInvoicePdf(h.input()).duplicate,true);
 assert.equal(h.stored.size,1);assert.equal(h.jobs().length,0);
 // Invoice-mode metadata does not invalidate an old PDF/cache entry.
 o.vatMode='invoice';o.vatRate=8;
 assert.equal(h.jobs().length,0);
});
test('archive and website fingerprint agree in legacy and explicit per-line modes',()=>{
 const source=read('index.html').match(/function invoicePdfKey\(o\) \{[\s\S]*?\n        \}/)?.[0];
 assert.ok(source);const c={};vm.createContext(c);vm.runInContext(source,c);
 for(const o of [invoice(),{...invoice(),vatMode:'invoice',vatRate:8},{...invoice(),vatMode:'per_line',vatRate:8}])
  assert.equal(c.invoicePdfKey(o)+suffix,archiveHarness(o).jobs()[0].versionKey);
});
test('per-line archive binds header mode/rate and line exemption/rate snapshots; rejects stale PDF',()=>{
 const o={...invoice(),vatMode:'per_line',vatRate:8};
 Object.assign(o.items[0],{vatRate:8,vatExempt:false,vatAmount:8000});
 const h=archiveHarness(o),job=h.jobs()[0],request=h.input(),original=json(o);
 assert.equal(job.versionKey,version(o));assert.equal(job.order.vatMode,'per_line');
 assert.equal(job.order.vatRate,8);assert.equal(job.order.items[0].vatExempt,false);
 assert.equal(h.ctx.satoriSaveInvoicePdf(request).duplicate,false);
 for(const mutate of [()=>o.vatRate=10,()=>o.items[0].vatExempt=true,()=>o.items[0].vatRate=10,()=>o.vatMode='invoice']){
  Object.assign(o,json(original));mutate();assert.throws(()=>h.ctx.satoriSaveInvoicePdf(request),/Hóa đơn đã thay đổi/);
 }
});
for(const file of ['accounting-core.js','api/AccountingCore.gs']){
 test(file+': both modes retain total once, goods-only CTV commission and independent customer debt',()=>{
  const ctx={};vm.createContext(ctx);vm.runInContext(read(file),ctx);
  vm.runInContext(read('customer-debt.js'),ctx);
  const C=ctx.SatoriAccountingCore,D=ctx.SatoriCustomerDebt;
  const legacy=invoice(),line={...json(legacy),vatMode:'per_line',vatRate:8,
   items:[{...legacy.items[0],vatRate:8,vatExempt:false,vatAmount:8000}]};
  for(const o of [legacy,line]){
   const original=JSON.stringify(o),r=C.calculate([o],[{id:'fake-ctv',discountPercent:35}]).rows[0];
   assert.equal(C.goods(o),100000);assert.equal(C.total(o),110000);
   assert.equal(C.total({...o,total:undefined}),110000,'fallback adds stored aggregate VAT once');
   assert.equal(r.base,91000);assert.equal(r.profit,9000);assert.equal(r.due,9000);
   assert.equal(C.calculate([{...o,collaboratorPaid:4000}],[]).rows[0].due,5000);
   const debt=D.prepare({orders:[o]});assert.equal(debt.total,110000);assert.equal(debt.due,110000);
   assert.equal(D.prepare({orders:[{...o,status:'Đã TT Satori'}]}).due,110000);
   assert.equal(D.prepare({orders:[{...o,customerPaidAt:'2026-11-11T00:00:00Z'}]}).due,0);
   assert.equal(D.prepare({orders:[{...o,status:'Đã hủy'}]}).due,0);
   assert.equal(JSON.stringify(o),original,'accounting must not synthesize or mutate tax fields');
  }
 });
}
test('website/GAS accounting implementations return identical commission/payment/receivable results',()=>{
 const load=file=>{const c={};vm.createContext(c);vm.runInContext(read(file),c);return c.SatoriAccountingCore};
 const a=load('accounting-core.js'),b=load('api/AccountingCore.gs');
 for(const vatMode of [undefined,'invoice','per_line']){
  const o={...invoice(),vatMode},partners=[{id:'fake-ctv',discountPercent:35}];
  if(vatMode==='per_line')Object.assign(o.items[0],{vatRate:8,vatExempt:false,vatAmount:8000});
  assert.deepEqual(json(a.calculate([o],partners)),json(b.calculate([o],partners)));
 }
});
for(const file of ['accounting-core.js','api/AccountingCore.gs']){
 test(file+': owner-borne VAT matches Android precedence, exact half-up and charged-tax exclusions',()=>{
  const c={};vm.createContext(c);vm.runInContext(read(file),c);const C=c.SatoriAccountingCore;
  const o=invoice();
  assert.equal(typeof C.ownerBorneCharge,'function');
  assert.equal(C.ownerBorneCharge({...o,vatAmount:0,shippingAmount:0}),11200);
  assert.equal(C.ownerBorneCharge(o),0,'customer-charged tax/shipping excludes implicit owner VAT');
  assert.equal(C.ownerBorneCharge({...o,vatAmount:0,shippingAmount:2000}),0);
  assert.equal(C.ownerBorneCharge({...o,vatAmount:0,shippingAmount:0,ownerBorneVat:false}),0);
  assert.equal(C.ownerBorneCharge({...o,vatAmount:0,shippingAmount:0,vatExempt:true}),0);
  assert.equal(C.ownerBorneCharge({...o,ownerBorneVatAmount:5000,ownerBorneVatPercent:10,ownerBorneVat:false,vatExempt:true}),5000);
  assert.equal(C.ownerBorneCharge({...o,ownerBorneVatAmount:-1}),0);
  assert.equal(C.ownerBorneCharge({...o,ownerBorneVatPercent:10}),14000,'explicit override wins over charged customer VAT');
  assert.equal(C.ownerBorneCharge({...o,ownerBorneVatPercent:-5}),0);
  assert.equal(C.ownerBorneCharge({...o,ownerBorneVatPercent:10},5),1,'VND half-up');
  assert.equal(C.ownerBorneCharge({...o,ownerBorneVatPercent:8.03},10000),803);
  assert.equal(C.ownerBorneCharge({...o,ownerBorneVatPercent:0.00001},5000000),1);
  for(const fields of [{ownerBorneVatAmount:NaN},{ownerBorneVatAmount:1.5},{ownerBorneVatAmount:Infinity},
   {ownerBorneVatPercent:NaN},{ownerBorneVatPercent:Infinity}])assert.equal(C.ownerBorneCharge({...o,...fields}),null);
  for(const vatMode of ['invoice','per_line']){
   const order={...o,vatMode,ownerBorneVatAmount:5000};
   const commission=C.calculate([order],[]).rows[0].profit;
   const cost=Math.round(C.listed(order)*(1-order.costDiscountPercent/100));
   assert.equal(C.goods(order)-cost-C.ownerBorneCharge(order)-commission,9000);
   assert.equal(C.total(order),110000,'expense does not affect invoice total or debt');
  }
 });
}
