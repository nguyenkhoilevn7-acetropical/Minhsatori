import test from 'node:test';import assert from 'node:assert/strict';
import {inferV2Order,validateGeminiProposal} from '../gemini-order.mjs';
const catalogue=[{code:'TP-00003',name:'Satori 500ml',unit:'Thùng',listPrice:100000,internalCost:65000}];
const proposal={intent:'order',needsClarification:false,items:[{code:'TP-00003',qty:10}]};
test('Gemini proposal validates SKU/quantity and rejects money or unauthorized fields',()=>{
 assert.deepEqual(validateGeminiProposal(proposal,catalogue),proposal.items);
 for(const item of [{code:'TP-99999',qty:10},{code:'TP-00003',qty:501},{code:'TP-00003',qty:10,price:1}])
  assert.equal(validateGeminiProposal({...proposal,items:[item]},catalogue),null);
});
test('transport fixture exercises actual request format and sends no catalogue prices or internal cost',async()=>{
 let called=false;
 const result=await inferV2Order({message:'10 thùng suối Satori 500ml',catalogue,configured:true,key:'fake-test-only',consume:async()=>true,
  fetcher:async(url,req)=>{called=true;assert.match(url,/generativelanguage.googleapis.com/);
   assert.doesNotMatch(req.body,/listPrice|internalCost|65000|100000/);
   return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(proposal)}]}}]}));}});
 assert.equal(called,true);assert.equal(result.provider,'gemini');assert.equal(result.suggestedItems[0].qty,10);
});
test('unconfigured, quota exhausted and PII messages do not call provider',async()=>{
 const base={message:'10 thùng suối 500ml',catalogue,configured:true,key:'fake',consume:async()=>true,
  fetcher:async()=>{throw Error('must not call')}};
 assert.equal((await inferV2Order({...base,configured:false})).reason,'GEMINI_NOT_CONFIGURED');
 assert.equal((await inferV2Order({...base,consume:async()=>false})).reason,'GEMINI_DAILY_BUDGET_EXHAUSTED');
 assert.equal((await inferV2Order({...base,message:'giao đến 123 đường ABC, sdt 0901234567'})).reason,'PRIVATE_DELIVERY_DATA_STAYS_LOCAL');
});
test('provider failure never claims verified Gemini result',async()=>{
 const r=await inferV2Order({message:'10 thùng suối 500ml',catalogue,configured:true,consume:async()=>true,
  fetcher:async()=>new Response('{}',{status:429})});
 assert.equal(r.ok,false);assert.equal(r.provider,undefined);
});
