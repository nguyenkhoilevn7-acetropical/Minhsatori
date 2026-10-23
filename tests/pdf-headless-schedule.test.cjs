// Strictly fake Apps Script environment; no network, live Drive, or real secrets.
const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../api/PdfHeadlessSchedule.gs','utf8');
const archive=fs.readFileSync(__dirname+'/../api/InvoicePdfArchive.gs','utf8');
new vm.Script(source);new vm.Script(archive);
const secret='ONLY_FAKE_SECRET_1234567890_1234567890_LONG';
const pdf=Buffer.from('%PDF-1.4\n'+'A'.repeat(200)+'\n%%EOF','utf8');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const sign=x=>crypto.createHmac('sha256',secret).update(x,'utf8').digest('hex');
const signed=x=>Array.from(x,b=>b>127?b-256:b);
let preflights=0,archives=[],requests=[],triggers=[];
const order={id:Date.now(),invoiceNo:9001,date:'23/10/2026',
  name:'FAKE CUSTOMER',phone:'000',location:'NO DELIVERY',
  items:[{product:'TEST 350ml',qty:1,unitPrice:0,listPrice:0}],total:0,
  shippingAmount:0,vatAmount:0,status:'Chưa thanh toán'};
const version=JSON.stringify([order.invoiceNo,order.date,order.name,order.phone,
  order.location,order.deliveryNote,order.taxCode,order.status,
  order.items,order.product,order.qty,order.listPrice,order.unitPrice,
  order.vat,order.vatAmount,order.shippingAmount])+'\nSATORI_PDF_VIETQR_20261021';
const pending={jobs:[{order,versionKey:version}]};
const cache=new Map();
const ctx={
  Date,JSON,Number,Math,String,Error,Array,console,
  requireOwner_(){preflights++},
  readState_(){return {revision:900,values:{satori_orders_v15:JSON.stringify([order])}}},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='SATORI_PDF_RENDER_SECRET'?secret:null})},
  SatoriInvoicePdfArchive:{pending:()=>pending,archive:x=>{archives.push(x);
    assert.equal(x.versionKey,version);
    assert.equal(x.invoiceNo,9001);
    assert.equal(x.pdfSha256,digest(pdf));
    return {fileId:'FAKE_GDRIVE_FILE',invoiceNo:9001}} },
  Utilities:{
    DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},
    getUuid:()=> '12345678-1234-1234-1234-123456789abc',
    computeDigest:(_,bytes)=>signed(crypto.createHash('sha256').update(Buffer.from(bytes.map(b=>b&255))).digest()),
    computeHmacSha256Signature:(message,key)=>signed(crypto.createHmac('sha256',key).update(message).digest()),
    base64Decode:x=>signed(Buffer.from(x,'base64')),
    newBlob:x=>({getBytes:()=>signed(Buffer.from(x,'utf8'))})
  },
  CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},
  UrlFetchApp:{fetch:(endpoint,args)=>{
    assert.equal(endpoint,'https://minh-satori-customer-ai-gemini.onrender.com/api/internal/original-pdf');
    const x=JSON.parse(args.payload);requests.push(x);
    const canonical=[x.ts,x.nonce,x.versionKey,digest(Buffer.from(JSON.stringify(x.order),'utf8'))].join('\n');
    assert.equal(x.signature,sign(canonical),'scheduler must sign order + version');
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({ok:true,
      versionKey:x.versionKey,invoiceNo:x.order.invoiceNo,pdfSha256:digest(pdf),
      pdfBase64:pdf.toString('base64')})};
  }},
  ScriptApp:{
    getProjectTriggers:()=>triggers,
    newTrigger:name=>({timeBased:()=>({everyMinutes:n=>({create:()=>triggers.push({
      getHandlerFunction:()=>name,period:n
    })})})})
  }
};
vm.createContext(ctx);vm.runInContext(source,ctx);
assert.equal(ctx.satoriPdfHeadlessInstall().installed,true);
assert.equal(triggers.length,1);
assert.equal(ctx.satoriPdfHeadlessInstall().alreadyInstalled,true);
assert.equal(triggers.length,1,'never install duplicate triggers');
const r=ctx.satoriPdfHeadlessTick();
assert.equal(r.archived,1);assert.equal(r.notArchived,0);
assert.equal(archives.length,1);assert.equal(requests.length,1);
assert.ok(preflights>=3);
console.log('PASS fake owner schedule + scoped signed Render request + verified original PDF Drive archive');
