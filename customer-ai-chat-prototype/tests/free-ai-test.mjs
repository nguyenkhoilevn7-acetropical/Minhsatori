/* Mock Gemini REST API: tests never call Google, use real credentials, or charge money. */
import assert from 'node:assert/strict';
import {parseOrder,parseRules,geminiConfigured} from '../free-parser.mjs';
const profile={id:'FAKE',name:'Fake customer',phone:'000 000 0001',favourite:'S5L',lastQty:10,uniqueFavourite:true};
process.env.GEMINI_API_KEY='GEMINI_MOCK_SECRET_NOT_REAL';
process.env.GEMINI_FREE_TIER_ONLY='true';
process.env.GEMINI_DAILY_CALL_LIMIT='3';
let calls=0,checks=0;const check=(bool,label)=>{assert.ok(bool,label);checks++};
const original=globalThis.fetch,phrase='Cho tôi 1 tá thùng Satori 5L';
check(geminiConfigured(),'Gemini enabled only for explicit free-tier project');
check(parseRules(phrase,profile).needMoreDetails,'unusual quantity requires AI');
globalThis.fetch=async(url,options)=>{
 calls++;
 check(String(url).includes('/v1beta/models/gemini-3.5-flash-lite:generateContent'),'correct Gemini endpoint');
 check(options.headers['x-goog-api-key']==='GEMINI_MOCK_SECRET_NOT_REAL','server-only key header');
 const body=JSON.parse(options.body);
 check(body.generationConfig.responseMimeType==='application/json','JSON response requested');
 return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"intent":"order","sku":"S5L","qty":12,"use_last_order":false,"address_change":false,"receiver_or_phone_change":false}'}]}}]})};
};
try{
 let p=await parseOrder(phrase,profile);
 check(p.qty===12&&p.sku==='S5L'&&p.source==='gemini','AI interprets explicit dozen');
 check(calls===1,'model called only for harder message');
 p=await parseOrder('Cho 10 thùng Satori 5L',profile);
 check(p.source==='rules'&&calls===1,'simple orders avoid Gemini');
 globalThis.fetch=async()=>{calls++;return {ok:false,status:429}};
 p=await parseOrder(phrase,profile);
 check(p.needMoreDetails&&p.qty===0,'429 falls back and asks customer');
 check(calls===2,'called twice');
 p=await parseOrder(phrase,profile);
 check(p.needMoreDetails&&calls===3,'third attempt returns fallback');
 p=await parseOrder(phrase,profile);
 check(p.needMoreDetails&&calls===3,'daily cap prevents fourth request');
 process.env.GEMINI_FREE_TIER_ONLY='false';
 p=await parseOrder(phrase,profile);
 check(!geminiConfigured()&&p.needMoreDetails&&calls===3,'disable Gemini without verified free-tier project');
 console.log('PASS '+checks+'/'+checks+' mock Gemini Free Tier parsing, quota and rules fallback; 0 actual API requests');
}finally{globalThis.fetch=original}
