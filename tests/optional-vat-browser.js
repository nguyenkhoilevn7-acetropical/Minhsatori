// Offline Chromium E2E: every request is intercepted; only fake local storage.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!=='http://vat.test')return route.abort();
   const file=path.resolve('.',url.pathname==='/'?'index.html':'.'+url.pathname);
   if(!file.startsWith(process.cwd()+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   const type=file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':'image/jpeg';
   return route.fulfill({contentType:type,body:fs.readFileSync(file)});
  });
  await page.goto('http://vat.test');
  await page.waitForFunction(()=>typeof calculateTotals==='function');
  await page.evaluate(()=>{scheduleInvoicePdfPreparation=()=>{};localStorage.clear();});
  const invoice={id:90001,invoiceNo:90001,date:'11/11/2026',name:'Synthetic VAT Customer',phone:'0900000000',location:'123 Synthetic Street',status:'Chưa thanh toán',vat:'yes',vatAmount:1,shippingAmount:0,shippingPercent:0,total:15,items:[{product:'Synthetic Water',qty:1,unit:'Thùng',listPrice:7,unitPrice:7,subtotal:7},{product:'Synthetic Deposit',qty:1,unit:'Thùng',listPrice:7,unitPrice:7,subtotal:7}]};
  await page.evaluate(order=>{orders=[order];editOrder(order.id);},invoice);
  assert.equal(await page.locator('#perLineVat').isChecked(),false);
  assert.equal(await page.locator('[id^="item_vat_"]').count(),0);
  assert.equal(await page.evaluate(()=>calculateTotals().vatAmount),1);
  assert.equal(await page.evaluate(()=>getCurrentInvoiceData().items.some(i=>'vatRate' in i)),false);
  // Exercise actual form control and handlers, then save to the existing ledger.
  await page.locator('#paymentOptionsPanel').evaluate(el=>el.open=true);
  await page.locator('#perLineVat').check();
  await page.locator('#item_vat_0').fill('10');
  await page.locator('#item_vat_1').fill('0');
  await page.evaluate(()=>handleSaveAndGenerate());
  let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem(STORAGE_KEY))[0]);
  assert.equal(saved.vatMode,'per_line');assert.equal(saved.items[1].vatExempt,true);assert.equal(saved.items[0].vatRate,10);assert.equal(saved.vatAmount,1);assert.equal(saved.total,15);
  await page.reload();await page.waitForFunction(()=>typeof calculateTotals==='function');
  await page.evaluate(()=>{scheduleInvoicePdfPreparation=()=>{};editOrder(90001);});
  assert.equal(await page.locator('#perLineVat').isChecked(),true);
  assert.equal(await page.locator('#item_vat_1').inputValue(),'0');
  assert.equal(await page.evaluate(()=>currentItems[1].vatExempt),true);
  const snapshot=await page.evaluate(()=>getCurrentInvoiceData());assert.equal(snapshot.vatAmount,1);assert.equal(snapshot.total,15);
  await page.locator('#paymentOptionsPanel').evaluate(el=>el.open=true);
  await page.locator('#perLineVat').uncheck();
  assert.equal(await page.evaluate(()=>formVatItems().some(i=>'vatRate' in i||'vatExempt' in i)),false);
  assert.equal(await page.evaluate(()=>calculateTotals().vatAmount),1);
  assert.deepEqual(errors,[],'unexpected browser errors');
  console.log('PASS Chromium E2E: legacy rounding, explicit toggle, exemption, canonical save/reload, per_line off');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
