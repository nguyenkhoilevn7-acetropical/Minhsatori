import test from 'node:test';
import assert from 'node:assert/strict';
import {grokToolList,handleGrokRpc} from '../grok-mcp.mjs';
const env={GROK_OWNER_WRITES_ENABLED:'1',GROK_PDF_DELIVERY_ENABLED:'0'};
test('delivery disabled hides and rejects cached Zalo queue tools without touching SQL',async()=>{
 const names=grokToolList(env).map(t=>t.name);
 assert.ok(names.includes('satori_invoice_pdf'));
 assert.ok(names.includes('satori_order_mark_paid_confirm'));
 for(const name of ['satori_pending_pdf_deliveries','satori_mark_pdf_delivered']){
  assert.ok(!names.includes(name));
  const result=await handleGrokRpc({query(){throw Error('MUST_NOT_QUERY')}},{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}},{env});
  assert.equal(result.error?.code,-32602);
 }
});
test('delivery disabled removes sending instructions while preserving Owner confirmation',async()=>{
 const result=await handleGrokRpc(null,{jsonrpc:'2.0',id:1,method:'initialize',params:{}},{env});
 assert.doesNotMatch(result.result.instructions,/zaloText|Zalo Desktop|mark_pdf_delivered/);
 assert.match(result.result.instructions,/chủ cửa hàng trả lời/);
});
