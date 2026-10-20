/* Mocked Cloudflare transport — does not send network traffic or charge neurons. */
import assert from 'node:assert/strict';
import {parseOrder,parseRules} from '../free-parser.mjs';
const profile={id:'FAKE',name:'Fake customer',phone:'000 000 0001',favourite:'S5L',lastQty:10,uniqueFavourite:true};
process.env.CLOUDFLARE_ACCOUNT_ID='fakeaccount123';
process.env.CLOUDFLARE_API_TOKEN='MOCK_ONLY_NO_REAL_SECRET';
process.env.CF_DAILY_CALL_LIMIT='3';
let calls=0;
const orig=globalThis.fetch;
const msg='Cho tôi 1 tá thùng Satori 5L';
assert.equal(parseRules(msg,profile).needMoreDetails,true);
globalThis.fetch=async(url,options)=>{
 calls++;assert.match(String(url),/api\.cloudflare\.com\/client\/v4\/accounts\/fakeaccount123\/ai\/run\/@cf\/meta\/llama-3\.2-3b-instruct/);
 assert.match(options.headers.Authorization,/^Bearer MOCK_ONLY/);
 return {ok:true,json:async()=>({success:true,result:{response:'{"intent":"order","sku":"S5L","qty":12,"use_last_order":false,"address_change":false,"receiver_or_phone_change":false}'}})};
};
try{
 let p=await parseOrder(msg,profile);
 assert.equal(p.qty,12);assert.equal(p.sku,'S5L');assert.equal(p.source,'cloudflare');
 assert.equal(calls,1);
 p=await parseOrder('Cho 10 thùng Satori 5L',profile);
 assert.equal(p.source,'rules');assert.equal(calls,1); // no waste on simple phrases
 globalThis.fetch=async()=>{calls++;return {ok:false,status:429}};
 p=await parseOrder(msg,profile);
 assert.equal(p.needMoreDetails,true);assert.equal(p.qty,0);
 assert.equal(calls,2); // quota denial => safe local fallback
 p=await parseOrder(msg,profile);
 assert.equal(p.needMoreDetails,true);assert.equal(calls,3);
 p=await parseOrder(msg,profile);
 assert.equal(p.needMoreDetails,true);assert.equal(calls,3); // local daily cap blocks additional calls
 console.log('PASS 11/11 MOCK Cloudflare success, outage, local cap, rule-first and no external network');
}finally{globalThis.fetch=orig}
