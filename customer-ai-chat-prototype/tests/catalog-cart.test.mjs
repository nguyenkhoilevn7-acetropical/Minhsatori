/* Isolated real HTTP integration: one basket, multiple catalogue SKUs, one invoice. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data=mkdtempSync(path.join(tmpdir(),'minh-satori-cart-'));
const port=29000+Math.floor(Math.random()*1000),base='http://127.0.0.1:'+port;
const proc=spawn(process.execPath,[path.join(root,'server.mjs')],{
 env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',
 DEMO_DATA_DIR:data,GEMINI_API_KEY:'',GEMINI_FREE_TIER_ONLY:'false'},
 stdio:['ignore','pipe','pipe']});
let serverOutput='';proc.stderr.on('data',b=>serverOutput+=String(b));proc.stdout.on('data',b=>serverOutput+=String(b));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=async url=>{const r=await fetch(base+url);return {status:r.status,body:await r.json()}};
const post=async(url,obj)=>{const r=await fetch(base+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(obj)});return {status:r.status,body:await r.json()}};
let checks=0;const check=(condition,label)=>{assert.ok(condition,label);checks++};
try{
 let live=false;
 for(let i=0;i<100;i++){try{const health=await get('/health');if(health.body.ok){live=true;break}}catch{}await sleep(60)}
 check(live,'isolated sandbox server starts');
 const cat=await get('/api/catalogue?token=demo-a');
 check(cat.status===200&&cat.body.products.length===20,'all 20 catalogue items available');
 const select=(code,qty)=>{const p=cat.body.products.find(x=>x.code===code);assert.ok(p);return {code,qty,name:p.name,unit:p.unit}};
 const cartMessage=items=>'Cho tôi đặt một đơn gồm:\n'+items.map(x=>'- '+x.qty+' '+x.unit+' '+x.name+' (Mã '+x.code+')').join('\n');
 const requestCart=async(items,overrides={})=>post('/api/message',{token:'demo-a',message:cartMessage(items),cartItems:items.map(({code,qty})=>({code,qty})),...overrides});
 const cart3=[select('TP-00003',2),select('TP-00081',5),select('TP-00056',3)];
 const three=await requestCart(cart3);
 check(three.status===200&&three.body.quote?.items?.length===3&&three.body.parserSource==='catalogue-cart','3 selected products quote as one order');
 check(three.body.quote.items.every((it,i)=>it.code===cart3[i].code&&it.qty===cart3[i].qty),'each SKU and quantity is preserved in quote');
 const subtotal=three.body.quote.items.reduce((sum,item)=>sum+item.qty*item.unitPrice,0);
 check(three.body.quote.total===subtotal+Math.round(subtotal*.08),'discount and shipping calculated once on entire basket');
 const confirmed=await post('/api/confirm',{token:'demo-a',quoteId:three.body.quote.quoteId,requestId:'cart-confirm-three-1'});
 check(confirmed.status===200&&confirmed.body.order?.items?.length===3,'three lines persist within one TEST invoice');
 const pdf=await fetch(base+'/api/invoice/'+confirmed.body.order.ref+'?token=demo-a');
 check(pdf.status===200&&(await pdf.arrayBuffer()).byteLength>30000,'3-line invoice PDF generated');
 check(pdf.headers.get('content-disposition')?.startsWith('attachment;'),'default PDF keeps download behavior');
 const preview=await fetch(base+'/api/invoice/'+confirmed.body.order.ref+'?token=demo-a&view=1');
 check(preview.status===200&&preview.headers.get('content-type')==='application/pdf'&&
  preview.headers.get('content-disposition')?.startsWith('inline;')&&
  (await preview.arrayBuffer()).byteLength>30000,'authenticated inline PDF preview displays all 3 products');
 const forbiddenPreview=await fetch(base+'/api/invoice/'+confirmed.body.order.ref+'?token=demo-b&view=1');
 check(forbiddenPreview.status===404,'other customer cannot preview an invoice PDF');
 const single=await requestCart([select('TP-00003',4)]);
 check(single.status===200&&single.body.quote?.qty===4&&single.body.quote?.code==='TP-00003','single-product basket remains supported');
 const cart6=[select('TP-00003',1),select('TP-00081',2),select('TP-00056',3),
  select('TP-00051',1),select('TP-00137',2),select('TP-00140',4)];
 check(cartMessage(cart6).length<=500,'six fully labelled products fit single chat message');
 const six=await requestCart(cart6);
 check(six.status===200&&six.body.quote?.items?.length===6,'six distinct catalogue products priced together');
 check(six.body.quote.items[5].unit==='Lốc','mixed product units survive the basket selection');
 const sixConfirm=await post('/api/confirm',{token:'demo-a',quoteId:six.body.quote.quoteId,requestId:'cart-confirm-six-2026'});
 check(sixConfirm.status===200&&sixConfirm.body.order.items.length===6,'six products persist as one invoice');
 const pdf6=await fetch(base+'/api/invoice/'+sixConfirm.body.order.ref+'?token=demo-a');
 check(pdf6.status===200&&(await pdf6.arrayBuffer()).byteLength>30000,'six-line PDF generated with no dropped products');
 const hist=await get('/api/history?token=demo-a');
 check(hist.status===200&&hist.body.orders.filter(x=>[confirmed.body.order.ref,sixConfirm.body.order.ref].includes(x.ref)).length===2,'history contains one bill per basket, not a bill per product');
 const dup=await requestCart([select('TP-00003',2),select('TP-00003',1)]);
 check(dup.status===400&&dup.body.error==='INVALID_CART','duplicate SKU refused at server');
 const altered=await requestCart([select('TP-00003',2)],{message:'Cho tôi một loại khác'});
 check(altered.status===400&&altered.body.error==='CART_MESSAGE_MISMATCH','edited description never silently swaps SKU');
 const seven=await requestCart([...cart6,select('TP-00001',1)]);
 check(seven.status===400&&seven.body.error==='CART_ITEM_LIMIT','over 6 lines rejected');
 const over=await requestCart([select('TP-00003',300),select('TP-00081',250)]);
 check(over.status===400&&over.body.error==='CART_QUANTITY_LIMIT','basket total over 500 rejected');
 const fake=await post('/api/message',{token:'demo-a',message:'Cho tôi đặt một đơn gồm:\n- 1 Thùng sản phẩm sai mã (Mã TP-99999)',cartItems:[{code:'TP-99999',qty:1}]});
 check(fake.status===400&&fake.body.error==='INVALID_CART','unknown SKU refused');
 const other=await post('/api/message',{token:'bad-link',message:cartMessage(cart3),cartItems:cart3.map(x=>({code:x.code,qty:x.qty}))});
 check(other.status===403,'unknown customer token denied');
 const crossPDF=await fetch(base+'/api/invoice/'+sixConfirm.body.order.ref+'?token=demo-b');
 check(crossPDF.status===404,'other customer cannot download multi-item PDF');
 console.log('PASS '+checks+'/'+checks+' isolated multi-product basket, pricing and PDF checks');
}catch(err){console.error('FAIL: '+err.message+'\nSERVER: '+serverOutput);process.exitCode=1}
finally{proc.kill();rmSync(data,{recursive:true,force:true})}
