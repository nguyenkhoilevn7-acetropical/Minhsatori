import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretLegacyOrder} from '../legacy-interpret.mjs';

test('isolated Vietnamese product keywords resolve only verified catalogue SKUs', async()=>{
 const examples=[
  ['3 hồng','TP-00058',3],
  ['4 thùng hông','TP-00058',4],
  ['2 thùng nước ép hồng','TP-00058',2],
  ['3 mãng','TP-00056',3],
  ['2 mc','TP-00056',2],
  ['10T nước 500','TP-00003',10],
  ['10t nc 500','TP-00003',10],
  ['5 nc 350','TP-00001',5]
 ];
 for(const [text,code,qty] of examples){
  const result=await interpretLegacyOrder(text);
  assert.equal(result?.needsClarification,undefined,text+': '+result?.message);
  assert.deepEqual(result.suggestedItems,[{code,qty}],text);
 }
});

test('keyword aliases preserve all multi-product lines in the same basket',async()=>{
 const result=await interpretLegacyOrder('3 hồng, 2 mc, 10t nước 500');
 assert.equal(result.needsClarification,undefined,result.message);
 assert.deepEqual(result.suggestedItems,[
  {code:'TP-00058',qty:3},
  {code:'TP-00056',qty:2},
  {code:'TP-00003',qty:10}
 ]);
});

test('bare water indicates product family but must not guess an exact SKU',async()=>{
 for(const text of ['10 nước','10 thùng nước','10 nc','10t nc','3 hồng, 2 nước']){
  const result=await interpretLegacyOrder(text);
  assert.equal(result.needsClarification,true,text);
  assert.match(result.message,/dung tích|dung tich/i,text);
  assert.equal(result.suggestedItems,undefined,text);
 }
});

test('unverified or wrong-unit orders never create a partial cart',async()=>{
 for(const text of ['Hồng','5 chai hồng','3 hồng, 2 trà sữa','2 nước ép hồng và 1 ly mãng cầu']){
  const result=await interpretLegacyOrder(text);
  assert.equal(result.needsClarification,true,text);
  assert.equal(result.suggestedItems,undefined,text);
 }
});
