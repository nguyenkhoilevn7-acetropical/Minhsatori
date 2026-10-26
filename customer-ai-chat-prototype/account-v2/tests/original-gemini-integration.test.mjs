import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {interpretLegacyOrder} from '../legacy-interpret.mjs';
import {geminiConfigured,sanitizedGeminiOrder} from '../../free-parser.mjs';
import {productQuestionEligible,answerGeminiProductQuestion} from '../gemini-product-assistant.mjs';

test('V2 reuses original Minh Satori catalogue interpreter for quantified water order',async()=>{
 const result=await interpretLegacyOrder('10 thùng nước suối 500ml');
 assert.equal(result?.suggestedItems?.find(p=>p.code==='TP-00003')?.qty,10);
 assert.equal(result?.needsClarification,undefined);
 assert.ok(result.source);
});
test('Gemini uses original protected server-side keys, not a separate frontend SDK',()=>{
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
 assert.match(router,/import \{geminiConfigured\} from '\.\.\/free-parser\.mjs'/);
 assert.match(router,/import \{answerGeminiProductQuestion,productQuestionEligible\}/);
 assert.match(router,/geminiConfigured:geminiConfigured\(\)/);
 assert.match(router,/await interpretLegacyOrder\(input\.message\)/);
 assert.match(router,/await answerGeminiProductQuestion\(input\.message,r\.rows\)/);
 assert.doesNotMatch(html,/GEMINI_API_KEY|x-goog-api-key|generativelanguage\.googleapis\.com/);
});
test('only public, sanitized product questions can reach optional Gemini advice',async()=>{
 assert.ok(productQuestionEligible('Satori có nước 500ml không?'));
 assert.ok(productQuestionEligible('Giá Satori 350ml bao nhiêu?'));
 assert.equal(productQuestionEligible('Kể chuyện ngoài lề'),false);
 assert.equal(sanitizedGeminiOrder('Đổi số điện thoại 0901234567'), '');
 assert.equal(sanitizedGeminiOrder('Giao đến 752 Sư Vạn Hạnh, phường 12'), '');
 const configured=geminiConfigured();
 assert.equal(typeof configured,'boolean');
 if(!configured)assert.equal(await answerGeminiProductQuestion('Satori có nước 500ml không?',[]),null);
});
test('customer UI never pretends a preview bot is a real Gemini API',()=>{
 const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
 assert.match(html,/const PREVIEW=new URLSearchParams\(location\.search\)\.get\('preview'\)==='1'/);
 assert.match(html,/provider:'offline-demo'/);
 assert.match(html,/BẢN XEM THỬ/);
});
