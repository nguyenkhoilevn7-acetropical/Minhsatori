import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {tools,callTool} from '../lib/satori.mjs';
const env={SATORI_BOT_API_URL:'https://script.google.com/macros/s/TEST_ONLY/exec',SATORI_BOT_KEY_ID:'local-test',SATORI_BOT_SECRET:'local-test-012345678901234567890123',SATORI_ENABLE_WRITES:'true'};
const edit={expectedRevision:9,requestId:'edit-qty-test-1234',id:101,invoiceNo:200,expectedName:'Khách giả',expectedTotal:1102500,itemId:'row-1',qty:20,confirmed:true};
test('quantity edit only appears when writes enabled',()=>{
 assert(!tools({}).some(t=>t.name==='satori_update_order_quantity'));
 assert(tools(env).some(t=>t.name==='satori_update_order_quantity'));
 assert(tools({}).some(t=>t.name==='satori_invoice_pdf_source'));
});
test('quantity request signs correct UTF8 payload and never leaks secrets',async()=>{
 await callTool('satori_update_order_quantity',edit,env,async(url,req)=>{
  const b=JSON.parse(req.body);
  assert.equal(b.action,'orders.updateQty');
  assert.deepEqual(b.payload,edit);
  const sign=createHmac('sha256',env.SATORI_BOT_SECRET).update([b.keyId,b.timestamp,b.nonce,b.action,JSON.stringify(b.payload)].join('\n')).digest('hex');
  assert.equal(b.signature,sign);assert(!req.body.includes(env.SATORI_BOT_SECRET));
  return Response.json({ok:true,revision:10,data:{updated:true}});
 });
});
test('unconfirmed quantity mutation rejected before any HTTP call',async()=>{
 let n=0;
 for(const invalid of [{...edit,confirmed:false},{...edit,itemId:undefined},{...edit,qty:0},{...edit,expectedTotal:undefined}]){
  await assert.rejects(()=>callTool('satori_update_order_quantity',invalid,env,async()=>{n++}));
 }
 assert.equal(n,0);
});
test('source data is read-only, signed and references exact invoice',async()=>{
 await callTool('satori_invoice_pdf_source',{id:101,invoiceNo:200},env,async(url,req)=>{
  const b=JSON.parse(req.body);assert.equal(b.action,'orders.pdfSource');
  assert.deepEqual(b.payload,{id:101,invoiceNo:200});
  return Response.json({ok:true,revision:10,data:{order:{invoiceNo:200}}});
 });
});
