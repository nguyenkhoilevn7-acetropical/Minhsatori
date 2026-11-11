// Real pdfmake bytes against immutable pre-#401 website; synthetic invoices only.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process'),crypto=require('node:crypto');
const old=cp.execFileSync('git',['show','d48a60a00f6556f71da1e337361adde987720e82:index.html'],{encoding:'utf8',maxBuffer:2e6});
const current=fs.readFileSync('index.html','utf8');
function fn(html,name,next){const a=html.indexOf('        function '+name+'(');let b=html.indexOf('        function '+next+'(',a);if(b<0)b=html.indexOf('        async function '+next+'(',a);assert(a>=0&&b>a,name);return html.slice(a,b);}
function context(html){const ctx={document:{getElementById:()=>({value:'yes'})},getOrderGoodsTotal:o=>o.items.reduce((s,i)=>s+i.qty*i.unitPrice,0),aiDisplayPercent:n=>Number(n).toFixed(2).replace(/0+$/,'').replace(/\.$/,''),moneyToVietnameseWords:n=>String(n)};vm.createContext(ctx);const start=html.indexOf('function currentDefaultVatRate()');const helpers=start<0?'':html.slice(start,html.indexOf('function hasInvalidLineVat()',start));vm.runInContext(helpers+fn(html,'invoicePaymentDetails','invoiceVietQrPayload')+fn(html,'invoiceVietQrPayload','invoicePdfShareMessage')+fn(html,'invoicePdfDefinition','invoiceQrImage'),ctx);return ctx;}
const oldCtx=context(old),newCtx=context(current);
const pdfMake=require(process.env.PDFMAKE_MODULE||'pdfmake/build/pdfmake');
const fonts=require(process.env.PDFMAKE_FONTS||'pdfmake/build/vfs_fonts');pdfMake.vfs=fonts.pdfMake?.vfs||fonts;
function bytes(ctx,order){const def=ctx.invoicePdfDefinition(order);def.info.creationDate=new Date('2026-11-11T00:00:00Z');def.info.modDate=new Date('2026-11-11T00:00:00Z');return new Promise(resolve=>pdfMake.createPdf(def).getBuffer(resolve));}
(async()=>{
 const order={id:'fixture',invoiceNo:90001,date:'11/11/2026',name:'Synthetic PDF Customer',phone:'0900000000',location:'123 Synthetic Street',status:'Chưa thanh toán',vat:'yes',vatAmount:1,shippingAmount:0,items:[{product:'Synthetic water',unit:'Thùng',qty:1,listPrice:7,unitPrice:7},{product:'Synthetic deposit',unit:'Thùng',qty:1,listPrice:7,unitPrice:7}]};
 for(const fixture of [order,{...order,vat:'no',vatAmount:0},{...order,deliveryNote:'Synthetic delivery note',shippingAmount:500}]){
  const before=await bytes(oldCtx,fixture),after=await bytes(newCtx,fixture);assert.deepEqual(after,before,'legacy PDF bytes differ');
  console.log('PASS legacy PDF bytes',after.length,crypto.createHash('sha256').update(after).digest('hex'));
 }
 const perLine={...order,vatMode:'per_line',vatAmount:1,items:[{...order.items[0],unitPrice:5,vatRate:10,vatAmount:1},{...order.items[1],vatExempt:true,vatRate:0,vatAmount:0}]};
 const text=JSON.stringify(newCtx.invoicePdfDefinition(perLine));assert(text.includes('VAT 10% · 1 đ'));assert(text.includes('VAT 0% · 0 đ'));
 assert(!JSON.stringify(newCtx.invoicePdfDefinition(order)).includes('VAT 8% ·'));
 const result=await bytes(newCtx,perLine);assert.equal(result.subarray(0,5).toString(),'%PDF-');console.log('PASS per_line real PDF',result.length);
})().catch(e=>{console.error(e);process.exitCode=1});
