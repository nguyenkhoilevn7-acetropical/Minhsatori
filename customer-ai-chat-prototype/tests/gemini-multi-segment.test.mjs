/* Gemini multi-product segmentation remains catalogue-validated; mock API only. */
import assert from 'node:assert/strict';
import {parseComplexOrderWithGemini} from '../free-parser.mjs';
process.env.GEMINI_API_KEY='FAKE_MULTILINE_TEST_KEY_20261021_123456';
process.env.GEMINI_FREE_TIER_ONLY='true';
process.env.GEMINI_DAILY_CALL_LIMIT='30';
const original=globalThis.fetch;let checks=0,calls=0;
const ok=(test,why)=>{assert.ok(test,why);checks++};
let segments=['10 ổi hồng','3 thùng me'];
globalThis.fetch=async(url,opts)=>{
 calls++;
 const request=JSON.parse(opts.body),str=request.contents[0].parts[0].text;
 ok(!str.includes('0912345678'),'no phone leaves server');
 ok(request.generationConfig.responseMimeType==='application/json','structured response mandatory');
 return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({intent:'order',segments})}]}}]})};
};
try{
 let r=await parseComplexOrderWithGemini('Cho tôi 10 ổi hồng và 3 thùng me');
 ok(r?.items?.length===2&&r.items[0].sku==='TP-00058'&&r.items[1].sku==='TP-00055',
   'structured Gemini segments validated against real catalogue');
 segments=['10 ổi hồng','3 thùng trà sữa'];
 r=await parseComplexOrderWithGemini('Cho 10 ổi hồng và 3 thùng trà sữa');
 ok(r===null,'unsupported item rejected, never partially quoted');
 segments=['10 ổi hồng','3 thùng me'];
 r=await parseComplexOrderWithGemini('Cho 10 ổi hồng và 3 thùng Hikari 500ml');
 ok(r===null,'hallucinated segment not in customer message rejected');
 r=await parseComplexOrderWithGemini('Giao đến 123 Lê Lợi và cho 10 ổi hồng, 3 me');
 ok(r===null,'sensitive address stops provider call');
 ok(calls===3,'calls only on safe messages');
 console.log('PASS '+checks+'/'+checks+' privacy-preserving Gemini multi-SKU segmentation, evidence and catalogue guards');
}finally{globalThis.fetch=original}
