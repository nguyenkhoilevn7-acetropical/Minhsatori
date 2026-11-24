import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const header=html.match(/<header>([\s\S]*?)<\/header>/)?.[1]||'';
const cart=html.match(/<section id="cartView"[\s\S]*?<\/section>/)?.[0]||'';

test('one composer action animates cart -> send when text is focused',()=>{
 assert.doesNotMatch(header,/id="cartBadge"/);
 assert.doesNotMatch(html,/id="cartBadge"/);
 assert.equal((html.match(/id="cartCount"/g)||[]).length,1);
 assert.match(html,/id="send" type="button" class="send composer-action"/);
 assert.match(html,/class="action-cart"/);
 assert.match(html,/class="action-send"/);
 assert.match(html,/class="composer-cart-count"/);
 assert.match(html,/\.composer-action\.is-send \.action-cart\{opacity:0/);
 assert.match(html,/\.composer-action\.is-send \.action-send\{opacity:1/);
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(script,/function updateComposerAction\(\)/);
 assert.match(script,/document\.activeElement===\$\('message'\)/);
 assert.match(script,/\$\('message'\)\.addEventListener\('focus',updateComposerAction\)/);
 assert.match(script,/if\(!\$\('send'\)\.classList\.contains\('is-send'\)\)\{view\('cart'\);return\}/);
 assert.doesNotThrow(()=>new vm.Script(script));
});
test('cart shows icon-only trash and a single Submit order control',()=>{
 assert.match(cart,/id="clearCart"[^>]*aria-label="Xóa tất cả sản phẩm khỏi giỏ"/);
 assert.match(cart,/id="cartChangeAddress"[^>]*aria-label="Thay đổi địa chỉ giao"/);
 assert.match(cart,/id="quote"[^>]*hidden/);
 assert.match(cart,/id="confirm"[^>]*hidden disabled/);
 assert.match(cart,/id="submitTestOrder"[^>]*>Submit order<\/button>/);
 assert.doesNotMatch(cart,/Kiểm tra báo giá<\/button>/);
 assert.match(script,/await call\('\/api\/v2\/quote'/);
 assert.match(script,/await call\('\/api\/v2\/confirm'/);
 assert.match(script,/if\(live&&result\.state!=='COMMITTED'\)/);
 assert.match(script,/requestId:lastTestRequestId,confirmedTest:true/);
 assert.match(script,/q\.totalVnd!==priceShown\.totalVnd/);
 assert.match(script,/if\(!PREVIEW&&!realTestEnabled&&!realCheckoutEnabled\)/);
 assert.match(script,/lastSubmittedCartKey=key/);
});
test('owner CRM stays out of customer web even when an admin signs in',()=>{
 assert.match(html,/#ownerPanel,#ownerOriginalInvoices\{display:none!important\}/);
 assert.match(script,/\$\('ownerPanel'\)\.hidden=true/);
 assert.match(script,/\$\('ownerOriginalInvoices'\)\.hidden=true/);
 assert.doesNotMatch(script,/if\(me\.account\.isAdmin\)loadOwner\(\)/);
 assert.doesNotMatch(script,/openAdmin\?'account':'chat'/);
});
