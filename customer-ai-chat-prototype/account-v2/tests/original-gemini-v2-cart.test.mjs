import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {proposeV2GeminiCart} from '../original-gemini-cart-adapter.mjs';

const codes=new Set(['TP-00001','TP-00003','TP-00058']);
const row=(code,qty)=>({code,qty});
const s500=row('TP-00003',2),s350=row('TP-00001',4);
test('old Gemini set intent corrects a number instead of silently adding twice',()=>{
 const before=[s500,s350];
 const next=proposeV2GeminiCart('Cho tôi 3 thùng Satori 500ml',
  before,[row('TP-00003',3)],codes);
 assert.deepEqual(next,[s350,row('TP-00003',3)]);
 assert.deepEqual(before,[s500,s350]);
});
test('old Gemini them/add intent adds only the addressed SKU',()=>{
 const next=proposeV2GeminiCart('Thêm 3 thùng Satori 500ml',
  [s500,s350],[row('TP-00003',3)],codes);
 assert.deepEqual(next,[s350,row('TP-00003',5)]);
});
test('old Gemini explicit new order replaces cart after verified parsing',()=>{
 const next=proposeV2GeminiCart('Đơn mới: 2 thùng Satori 500ml',
  [s350],[s500],codes);
 assert.deepEqual(next,[s500]);
});
test('old Gemini multi-product instruction replaces the previous draft atomically',()=>{
 const next=proposeV2GeminiCart('2 thùng Satori 500ml và 3 thùng 350ml',
  [row('TP-00058',1)],[s500,row('TP-00001',3)],codes);
 assert.deepEqual(next,[row('TP-00001',3),s500]);
});
test('no active V2 SKU, invalid quantities, or unverified existing cart can be used',()=>{
 assert.throws(()=>proposeV2GeminiCart('Thêm 2 thùng',
  [s500],[row('TP-99999',2)],codes),/V2_GEMINI_CART_UNVERIFIED/);
 assert.throws(()=>proposeV2GeminiCart('Cho 10 thùng',
  [row('TP-99999',2)],[s500],codes),/V2_GEMINI_CART_UNVERIFIED/);
 assert.throws(()=>proposeV2GeminiCart('Thêm 3 thùng',
  [row('TP-00003',499)],[row('TP-00003',3)],codes),/V2_GEMINI_CART_UNVERIFIED/);
});
test('V2 is the only source of cart state and authorization, no old invoice/secret transport',()=>{
 const server=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../app.html',import.meta.url),'utf8');
 const adapter=readFileSync(new URL('../original-gemini-cart-adapter.mjs',import.meta.url),'utf8');
 assert.match(adapter,/import \{chatBasketChanges\} from '\.\.\/cart-semantics\.mjs'/);
 assert.doesNotMatch(adapter,/fetch\(|ScriptApp|SATORI_BOT_SECRET|process\.env/);
 assert.match(server,/WHERE account_id=\$1 AND profile_id=\$2/);
 assert.match(server,/proposeV2GeminiCart\(input.message,current,result.suggestedItems,activeCodes\)/);
 assert.match(ui,/result\.baseCartRevision!==cartRev/);
 assert.match(ui,/await saveCart\(merged\)/);
 assert.match(server,/REAL_CHECKOUT_GATE_NOT_VERIFIED/);
 assert.doesNotMatch(ui,/GEMINI_API_KEY|x-goog-api-key/);
});
