import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
assert.ok(inline);

function isolatedFunction(start,end,name,globals={}){
 const begin=inline.indexOf(start),stop=inline.indexOf(end,begin);
 assert.ok(begin>=0&&stop>begin,name+' exists');
 const context=vm.createContext({...globals});
 vm.runInContext(inline.slice(begin,stop),context,{timeout:500});
 assert.equal(typeof context[name],'function');
 return context[name];
}
const sample=[
 {code:'TP-00001',name:'350ml (MẪU)'},
 {code:'TP-00003',name:'500ml (MẪU)'},
 {code:'TP-00136',name:'5 lít (MẪU)'}
];
const merge=isolatedFunction('function mergeCartItems(','\nasync function saveCart(','mergeCartItems',{products:sample});
const interpret=isolatedFunction('function demoInterpretMessage(','\nfunction demoCall(','demoInterpretMessage',{demoState:{products:sample}});
const asJson=x=>JSON.parse(JSON.stringify(x));

test('iMessage-style customer blue/white and Gemini gray/black are readable and distinct',()=>{
 assert.match(html,/--iosOutgoing:#007aff/);
 assert.match(html,/--iosIncoming:#e9e9eb/);
 assert.match(html,/--iosIncomingInk:#1c1c1e/);
 assert.match(html,/\.bubble\.me\{[^}]*align-self:flex-end;color:#fff;background:var\(--iosOutgoing\)/);
 assert.match(html,/\.bubble\.ai\{[^}]*align-self:flex-start;color:var\(--iosIncomingInk\);background:var\(--iosIncoming\)/);
 assert.match(html,/#message\{color:var\(--chatBlue\)/);
 assert.match(html,/\.pick\{[^}]*color:var\(--iosIncomingInk\);background:var\(--iosIncoming\)/);
});
test('one conversation can parse two separate fake items',()=>{
 assert.deepEqual(asJson(interpret('2 thùng 500ml và 3 thùng 350ml')),
  [{code:'TP-00003',qty:2},{code:'TP-00001',qty:3}]);
});
test('multi-line fake messages sum same SKU before one cart update',()=>{
 assert.deepEqual(asJson(interpret('2 thùng 500ml, 4 thùng 500ml')),
  [{code:'TP-00003',qty:6}]);
});
test('5 lít is not mistakenly parsed as five cans without quantity',()=>{
 assert.deepEqual(asJson(interpret('Cho một can 5 lít')), [{code:'TP-00136',qty:1}]);
});
test('shared cart aggregates repeat products over messages without separate bills',()=>{
 assert.deepEqual(asJson(merge([{code:'TP-00003',qty:2}],
  [{code:'TP-00003',qty:3},{code:'TP-00001',qty:4}])),
  [{code:'TP-00003',qty:5},{code:'TP-00001',qty:4}]);
});
test('rejects unexpected SKU, invalid and excessive quantity without mutation',()=>{
 const prior=[{code:'TP-00003',qty:4}];
 assert.throws(()=>merge(prior,[{code:'X',qty:1}]),/danh mục/);
 assert.throws(()=>merge(prior,[{code:'TP-00001',qty:0}]),/Số lượng/);
 assert.throws(()=>merge(prior,[{code:'TP-00003',qty:497}]),/tối đa 500/);
 assert.throws(()=>merge([{code:'TP-00003',qty:300}],[{code:'TP-00001',qty:201}]),/tối đa 500/);
 assert.deepEqual(prior,[{code:'TP-00003',qty:4}]);
});
test('in-chat inputs, status, compact controls and retry guard are present',()=>{
 assert.match(html,/id="chatStatus"[^>]+aria-live="polite"/);
 assert.match(html,/id="chatCartShortcut"/);
 assert.match(html,/id="quickProducts"/);
 assert.match(html,/id="quickCart"/);
 assert.match(html,/id="quickAddress"/);
 assert.match(html,/qty\.setAttribute\('aria-label'/);
 assert.match(html,/if\(add\.disabled\)return/);
 assert.match(html,/const merged=mergeCartItems\(cart,selected\)/);
 assert.match(html,/await saveCart\(merged\)/);
 assert.match(html,/reply\.classList\.add\('error'\)/);
 assert.match(html,/!e\.shiftKey&&!e\.isComposing/);
 assert.match(html,/id="confirm"[^>]+disabled/);
});
test('catalogue search is accent insensitive and includes code matches',()=>{
 const fold=isolatedFunction('function foldProductSearch(','\n$(\'catalogueSearch\').oninput=','foldProductSearch');
 assert.equal(fold(' Trà Mãng Cầu '),'tra mang cau');
 assert.equal(fold('SẢN PHẨM 500ml'),'san pham 500ml');
 assert.equal(fold('Địa chỉ'),'dia chi');
 assert.match(html,/id="catalogueSearch" type="search"/);
 assert.match(html,/Không tìm thấy sản phẩm phù hợp/);
});
test('clearing the cart requires user confirmation, saves one empty cart and never deletes an invoice',()=>{
 assert.match(html,/id="clearCart"[^>]+disabled/);
 assert.match(html,/if\(!confirm\('Xóa tất cả sản phẩm khỏi giỏ V2/);
 assert.match(html,/await saveCart\(\[\]\)/);
 assert.match(html,/\$\('clearCart'\)\.disabled=cart\.length===0/);
});
test('empty quantity entry does not silently remove a product',()=>{
 assert.match(html,/input\.value=item\.qty;toast\('Hãy nhập số nguyên từ 0 đến 500/);
 assert.match(html,/Nhập 0 để xóa sản phẩm/);
});
test('inline script remains syntactically valid',()=>{
 assert.doesNotThrow(()=>new vm.Script(inline));
});
