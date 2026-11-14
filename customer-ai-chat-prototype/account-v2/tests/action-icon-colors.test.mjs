import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';
function rule(selector){
 const start=css.indexOf(selector+'{');
 assert.ok(start>=0,'missing CSS rule: '+selector);
 return css.slice(start+selector.length+1).split('}',1)[0];
}
test('trash icon stays red while normal icon action buttons remain blue',()=>{
 assert.match(html,/id="clearCart" class="icon-button cart-clear"/);
 assert.match(rule('.icon-button'),/background:#edf4ff;color:#007aff/);
 assert.match(rule('.icon-button.cart-clear'),/background:#fff0ee;color:#ff3b30/);
 assert.match(rule('.cart-heading-actions .cart-clear,.cart-heading-actions .screen-close'),/color:#ff3b30/);
 assert.match(rule('.delivery-change'),/color:#007aff/);
});
test('all close X controls use destructive red consistently',()=>{
 assert.match(rule('.screen-close'),/background:#fff0ee;color:#ff3b30/);
 assert.match(rule('.delivery-dialog-close'),/background:#fff0ee;color:#ff3b30/);
 assert.match(html,/id="deliveryClose" class="delivery-dialog-close"/);
 for(const name of ['catalogue','cart','addresses','orders','account']){
  const start=html.indexOf('id="'+name+'View"');
  assert.ok(start>=0,name+' view missing');
  assert.match(html.slice(start,start+1000),/class="screen-close back-to-chat"/);
 }
 assert.match(rule('.header-icon'),/color:#007aff/);
});
test('red icon interactions preserve accessibility and reduced-motion option',()=>{
 assert.match(html,/id="clearCart"[^>]+aria-label="Xóa tất cả sản phẩm khỏi giỏ"/);
 assert.match(html,/id="deliveryClose"[^>]+aria-label="Đóng chọn địa chỉ"/);
 assert.match(html,/class="screen-close back-to-chat"[^>]+aria-label="Đóng/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
