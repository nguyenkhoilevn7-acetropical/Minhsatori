import test from 'node:test';
import assert from 'node:assert/strict';
import {answerGeminiProductQuestion,validatedPublicGeminiReply} from '../gemini-product-assistant.mjs';

test('Gemini product replies reject invented commercial facts before reaching chat',()=>{
 const invalid=[
  'Satori 500ml giá 90.000đ mỗi thùng.',
  'Giảm 15% hôm nay.',
  'Sản phẩm này chỉ 90k.',
  'Miễn phí giao hàng toàn quốc.',
  'Giao hàng trong 2 giờ.',
  'Đặt qua https://example.invalid và trả tiền.',
  'Liên hệ số 0901234567 để mua.'
 ];
 for(const message of invalid){
  assert.equal(validatedPublicGeminiReply(message),null,message);
 }
 assert.equal(validatedPublicGeminiReply(''),null);
 assert.equal(validatedPublicGeminiReply('x'.repeat(651)),null);
 assert.equal(validatedPublicGeminiReply(
  'Satori 500ml có trong danh mục. Vui lòng chọn điểm giao và mở giỏ để xem giá.'),
  'Satori 500ml có trong danh mục. Vui lòng chọn điểm giao và mở giỏ để xem giá.');
});

test('Gemini product endpoint fails closed on fictional prices and keeps API key server side',async()=>{
 const priorFetch=globalThis.fetch;
 const previousKey=process.env.GEMINI_API_KEY;
 const previousTier=process.env.GEMINI_FREE_TIER_ONLY;
 let reply='Satori 500ml có giá 90.000 VND mỗi thùng.';
 const requests=[];
 try{
  process.env.GEMINI_API_KEY='test_only_fake_key_not_usable_123456';
  process.env.GEMINI_FREE_TIER_ONLY='true';
  globalThis.fetch=async(url,options)=>{
   requests.push({url,options});
   return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:reply}]}}]})};
  };
  const catalogue=[{code:'TP-00003',name:'Satori 500ml',unit:'thùng',active:true}];
  const rejected=await answerGeminiProductQuestion('Satori 500ml giá bao nhiêu?',catalogue);
  assert.equal(rejected,null);
  reply='Satori 500ml có trong danh mục. Chọn điểm giao và mở giỏ để xem báo giá.';
  const accepted=await answerGeminiProductQuestion('Satori 500ml có không?',catalogue);
  assert.equal(accepted?.provider,'gemini');
  assert.equal(accepted?.message,reply);
  assert.equal(requests.length,2);
  for(const {url,options} of requests){
   assert.match(url,/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//);
   assert.equal(options.headers['x-goog-api-key'],process.env.GEMINI_API_KEY);
   assert.equal(options.method,'POST');
   const body=JSON.parse(options.body);
   assert.ok(!JSON.stringify(body).includes(process.env.GEMINI_API_KEY));
  }
 }finally{
  globalThis.fetch=priorFetch;
  if(previousKey===undefined)delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY=previousKey;
  if(previousTier===undefined)delete process.env.GEMINI_FREE_TIER_ONLY;
  else process.env.GEMINI_FREE_TIER_ONLY=previousTier;
 }
});
