import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const source=script.match(/function quantityOnlyMessage\(message\)\{[\s\S]*?\n\}/)?.[0];
test('quantity-only parser accepts exact water cartons without guessing a product',()=>{
 assert.ok(source);
 const fn=new Function(source+'\nreturn quantityOnlyMessage;')();
 for(const text of ['10 thùng','10 thg','10T','cho anh 10 thùng','anh lấy 10 thùng','đổi thành 10 thùng','sửa thành 10 thùng','tăng lên 10 thùng','1 thùng','500 thùng']){
  assert.equal(fn(text),text.startsWith('1 thùng')?1:text.startsWith('500')?500:10,text);
 }
 for(const text of ['10 thùng nước suối 500ml','10 thùng và 5 thùng','0 thùng','501 thùng','10 chai','giao 10 thùng đến địa chỉ khác','thêm 10 thùng']){
  assert.equal(fn(text),null,text);
 }
});
test('single active cart line is replaced at the exact amount, never incremented',()=>{
 assert.match(script,/if\(amount!==null&&cart\.length===1\)\{/);
 assert.match(script,/const revised=\[\{code:cart\[0\]\.code,qty:amount\}\]/);
 assert.match(script,/await saveCart\(revised\)/);
 assert.match(script,/await addChatOrderReceipt\(revised\)/);
 assert.match(script,/if\(amount!==null&&cart\.length>1\)\{/);
 assert.match(script,/Giỏ có nhiều mặt hàng/);
 assert.match(script,/const result=await call\('\/api\/v2\/interpret'/);
 assert.doesNotThrow(()=>new vm.Script(script));
});
