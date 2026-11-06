import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
function section(begin,end){
 const a=script.indexOf(begin),b=script.indexOf(end,a+begin.length);
 assert.ok(a>=0&&b>a,'Missing UI section '+begin);
 return script.slice(a,b);
}
test('address text and phone have identical weight and size',()=>{
 assert.match(html,/\.agent-address-choice \.address-subtitle,\s*\.agent-address-choice \.address-phone\s*\{[^}]*font-size:15px;line-height:1\.5;font-weight:500/);
 assert.match(html,/\.delivery-dialog #agentAddressChoices \.agent-address-choice \.address-subtitle,\s*\.delivery-dialog #agentAddressChoices \.agent-address-choice \.address-phone\s*\{[^}]*font-weight:550/);
 assert.doesNotMatch(html,/\.delivery-dialog #agentAddressChoices \.agent-address-choice \.address-phone\s*\{\s*font-weight:700/);
});
test('catalogue directly supports numeric input and +/- before adding',()=>{
 const src=section('function catalogueQuantity(code){','/**\n * Prices in this screen');
 assert.match(script,/const catalogueQtyDraft=new Map\(\)/);
 assert.match(src,/input\.type='text';input\.inputMode='numeric'/);
 assert.match(src,/minus\.onclick=\(\)=>assign/);
 assert.match(src,/plus\.onclick=\(\)=>assign/);
 assert.match(src,/const button=node\('button','\+ Thêm','btn product-add'\)/);
 assert.match(src,/await saveCart\(mergeCartItems\(cart,\[\{code:p\.code,qty\}\]\)\)/);
 assert.match(src,/catalogueQtyDraft\.set\(p\.code,1\)/);
 assert.match(html,/\.catalogue-product-actions\{/);
 assert.doesNotThrow(()=>new vm.Script(script));
});
test('cart maintains row node identity and scroll while updating',()=>{
 const src=section('function renderCart(fetchPrices=true){',"$('clearCart').onclick=async()=>{");
 assert.match(src,/const existing=new Map/);
 assert.match(src,/dataset\.code=item\.code/);
 assert.match(src,/if\(rows\.length!==current\.length\|\|rows\.some/);
 assert.match(src,/viewport\.scrollTop=previousScroll/);
 assert.match(src,/if\(document\.activeElement!==input\)/);
 assert.match(html,/#cartView\{overflow-anchor:none\}/);
 const save=section('async function saveCart(lines){','function foldProductSearch(text){');
 assert.doesNotMatch(save,/renderBadge\(\);renderProducts\(\);renderCart\(\);\s*\}finally/);
});
test('rapid presses are serialized, including a removal to zero',async()=>{
 const funcs=section('function queueCartQuantity(code,value,absolute=false){',"$('clearCart').onclick=async()=>{");
 const setup=[
  "let cart=[{code:'WATER',qty:1}],busy=false,profileLoading=false,savingCart=false;",
  "let quantityFlushActive=false;",
  "const pendingCartQuantities=new Map(),actions=[],notifications=[];",
  "const $=(id)=>id==='profile'?{value:'account-1'}:null;",
  "const selectedDeliveryAddress=()=>({id:'address-1'});",
  "const toast=msg=>notifications.push(msg);",
  "const renderBadge=()=>{};",
  "const renderCart=()=>{};",
  "const updateDeliveryGate=()=>{};",
  "const requireDeliverySelection=()=>false;",
  "async function saveCart(lines){actions.push(lines.map(item=>({...item})));",
  "await Promise.resolve();await Promise.resolve();cart=lines.map(item=>({...item}));}"
 ].join('\n');
 const ctx=vm.createContext({});
 vm.runInContext(setup+funcs,ctx);
 vm.runInContext("queueCartQuantity('WATER',1);queueCartQuantity('WATER',1);queueCartQuantity('WATER',1)",ctx);
 for(let i=0;i<25;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(cart)',ctx)),[{code:'WATER',qty:4}]);
 assert.equal(vm.runInContext('quantityFlushActive',ctx),false);
 assert.equal(vm.runInContext('pendingCartQuantities.size',ctx),0);
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(actions.map(x=>x[0].qty))',ctx)),[2,4]);
 assert.equal(vm.runInContext('notifications.length',ctx),0);
 vm.runInContext("queueCartQuantity('WATER',0,true)",ctx);
 for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(cart)',ctx)),[]);
});
test('quantity cap is respected even during rapid interactions',()=>{
 const funcs=section('function queueCartQuantity(code,value,absolute=false){',"$('clearCart').onclick=async()=>{");
 const setup=[
  "let cart=[{code:'WATER',qty:500}],busy=false,profileLoading=false,savingCart=false;",
  "let quantityFlushActive=false;",
  "const pendingCartQuantities=new Map(),messages=[];",
  "const $=id=>({value:'account'});",
  "const selectedDeliveryAddress=()=>({id:'delivery'});",
  "const toast=msg=>messages.push(msg);",
  "const renderBadge=()=>{},renderCart=()=>{},updateDeliveryGate=()=>{};",
  "async function saveCart(lines){cart=lines}"
 ].join('\n');
 const ctx=vm.createContext({});
 vm.runInContext(setup+funcs,ctx);
 vm.runInContext("queueCartQuantity('WATER',1)",ctx);
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(cart)',ctx)),[{code:'WATER',qty:500}]);
 assert.equal(vm.runInContext('pendingCartQuantities.size',ctx),0);
 assert.match(vm.runInContext('messages[0]',ctx),/0 đến 500/);
});
