import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const js=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
const getMarkup=(name)=>html.match(new RegExp('<section id="'+name+'View"[\\s\\S]*?<\\/section>'))?.[0]||'';

test('cart displays pricing and recipient/address; buyer profile remains internal for policies',()=>{
 const cart=getMarkup('cart');
 for(const id of ['cartPriceSummary',
  'cartRecipientName','cartRecipientPhone','cartAddressLabel','cartAddressText',
  'cartChangeAddress','quote','cartLines']){
  assert.match(cart,new RegExp('id="'+id+'"'));
 }
 assert.match(cart,/<select id="profile" hidden aria-hidden="true" tabindex="-1"><\/select>/);
 assert.match(cart,/<select id="location" hidden aria-hidden="true" tabindex="-1"><\/select>/);
 assert.doesNotMatch(cart,/id="cartBuyerName"|id="cartBuyerPhone"|Người mua \/ hồ sơ/);
 assert.match(cart,/class="screen-close back-to-chat"/);
 assert.match(html,/document.querySelectorAll\('\.back-to-chat'\)\.forEach\(btn=>btn\.onclick=\(\)=>view\('chat'\)\)/);
 assert.match(html,/function changeCartDeliveryOnly\(\)/);
 assert.match(html,/\$\('quickAgentProfile'\)\.disabled=true/);
 assert.match(html,/\$\('quickAgentProfile'\)\.disabled=false/);
});

test('prices come from read-only canonical server quote calculations, not client discount guesses',()=>{
 const endpoint=router.match(/if\(pathname==='\/api\/v2\/cart-pricing'[\s\S]*?(?=if\(pathname==='\/api\/v2\/quote')/)?.[0]||'';
 assert.match(endpoint,/req\.method==='GET'/);
 assert.match(endpoint,/await pricedCart\(pool,actor/);
 assert.match(endpoint,/customerPricing\(priced\)/);
 const endpointCode=endpoint.split('\n').filter(line=>!line.trim().startsWith('//')).join('\n');
 assert.doesNotMatch(endpointCode,/INSERT|UPDATE|DELETE|BEGIN|COMMIT/);
 const implementation=router.match(/async function pricedCart\([\s\S]*?(?=function customerPricing)/)?.[0]||'';
 assert.match(implementation,/profileFor\(pool,actor,input\.profileId\)/);
 assert.match(implementation,/calculateQuote\(\{/);
 assert.doesNotMatch(implementation,/INSERT INTO|UPDATE satori_v2/);
 const publicShape=router.match(/function customerPricing\([\s\S]*?(?=async function quote)/)?.[0]||'';
 assert.match(publicShape,/collaboratorSettlement/);
 assert.match(publicShape,/internalUnitPrice/);
 assert.match(html,/function loadCartPricing\(\)/);
 assert.match(html,/\/api\/v2\/cart-pricing\?/);
 assert.match(html,/cartPricingEpoch/);
 assert.match(html,/function invalidateCartPricing\(\)/);
 assert.doesNotThrow(()=>new vm.Script(js));
});

test('demo unit discount uses same integer per-unit rounding and totals as backend',()=>{
 const start=js.indexOf('function demoCartPricing('),end=js.indexOf('\nfunction demoCall(',start);
 assert.ok(start>=0&&end>start);
 const profile='agency',address='addr';
 const demoState={
  carts:new Map([[profile,{lines:[{code:'TP-00003',qty:2}],revision:4}]]),
  profiles:[{id:profile,type:'agency',name:'Đại lý mẫu'}],
  addresses:[{id:address,profileId:profile,active:true,label:'Nhà A',
   recipientName:'Khách A',recipientPhone:'0900000000',address:'Đường Mẫu'}],
  products:[{code:'TP-00003',name:'500ml',unit:'thùng',listPrice:120000}],
  policies:[{id:'policy',enabled:true,profileId:profile,addressId:null,productCode:null,
   discountBps:1500,invoiceMode:'single',version:1}]
 };
 const context=vm.createContext({demoState});
 vm.runInContext(js.slice(start,end),context);
 const price=JSON.parse(JSON.stringify(context.demoCartPricing(profile,address)));
 assert.equal(price.items[0].listPrice,120000);
 assert.equal(price.items[0].discountBps,1500);
 assert.equal(price.items[0].unitPrice,102000);
 assert.equal(price.items[0].lineTotal,204000);
 assert.equal(price.goodsVnd,204000);
 assert.equal(price.shippingVnd,0);
 assert.equal(price.vatVnd,0);
 assert.equal(price.totalVnd,204000);
 assert.equal(price.cartRevision,4);
 const display=html.match(/function showCartPriceSummary\([\s\S]*?(?=async function loadCartPricing)/)?.[0]||'';
 for(const label of ['Tạm tính','Chiết khấu','Tiền hàng sau chiết khấu',
  'Phí giao hàng','VAT','Tổng khách phải trả'])assert.ok(display.includes(label),label);
});


test('cart destructive and close icons use the same iOS red style',()=>{
 const cart=getMarkup('cart');
 assert.match(cart,/id="clearCart" class="icon-button cart-clear"/);
 assert.match(cart,/class="screen-close back-to-chat"/);
 assert.match(html,/\.cart-heading-actions \.cart-clear,\.cart-heading-actions \.screen-close\{background:#fff0ee;color:#ff3b30;/);
 assert.match(html,/\.cart-heading-actions \.cart-clear:hover:not\(:disabled\),\.cart-heading-actions \.screen-close:hover\{background:#ffe0dc\}/);
});
