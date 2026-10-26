import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const cart=html.match(/<section id="cartView"[\s\S]*?<\/section>/)?.[0]||'';

test('delivery summary has recipient and destination only, profile stays internal',()=>{
 assert.doesNotMatch(cart,/id="cartBuyerName"|id="cartBuyerPhone"|Người mua \/ hồ sơ/);
 assert.match(cart,/id="cartRecipientName"/);
 assert.match(cart,/id="cartRecipientPhone"/);
 assert.match(cart,/id="cartAddressLabel"/);
 assert.match(cart,/id="cartAddressText"/);
 assert.match(script,/const profile=me\?\.profiles\?\.find/);
 assert.doesNotMatch(script,/\$\('cartBuyerName'\)/);
});

test('initial delivery modal cannot be dismissed without an active address',()=>{
 assert.match(script,/function syncDeliveryDialogGate\(\)/);
 assert.match(script,/const required=!selectedDeliveryAddress\(\)/);
 assert.match(script,/\$\('deliveryClose'\)\.hidden=required/);
 assert.match(script,/if\(!forAddressManagement&&syncDeliveryDialogGate\(\)\)return false/);
 assert.match(script,/addEventListener\('cancel',event=>\{\s*if\(syncDeliveryDialogGate\(\)\)event\.preventDefault\(\)/);
 assert.match(script,/if\(e\.target===\$\('deliveryDialog'\)\)closeDeliveryDialog\(\)/);
 assert.match(script,/if\(name==='chat'&&!selectedDeliveryAddress\(\)\)requestAnimationFrame\(openDeliveryDialog\)/);
 assert.match(script,/closeDeliveryDialog\(true\);view\('addresses'\)/);
});

test('chat send blurs the text area without auto-raising mobile keyboard',()=>{
 assert.match(script,/input\.blur\(\); \/\/ Never reopen the mobile keyboard/);
 assert.match(script,/\}finally\{[\s\S]*?input\.blur\(\);\s*\}\s*\};\s*\$\('message'\)\.onkeydown/);
 assert.doesNotMatch(script,/input\.focus\(\)/);
 assert.match(script,/\$\('submitTestOrder'\)\.onclick=async\(\)=>\{\s*document\.activeElement\?\.blur\?\.\(\)/);
});

test('branded test confirmation cannot be confused with official issued invoice',()=>{
 assert.match(cart,/id="testInvoicePreview"[^>]+hidden/);
 assert.match(script,/function renderTestInvoice\(quote,result\)/);
 assert.match(script,/renderTestInvoice\(q,result\)/);
 assert.match(script,/logo\.cloneNode\(true\)/);
 assert.match(script,/PHIẾU XÁC NHẬN ĐƠN THỬ/);
 assert.match(script,/KHÔNG PHẢI HÓA ĐƠN CHÍNH THỨC/);
 assert.match(script,/quote\.items/);
 assert.match(script,/quote\.totalVnd/);
 assert.doesNotThrow(()=>new vm.Script(script));
});
