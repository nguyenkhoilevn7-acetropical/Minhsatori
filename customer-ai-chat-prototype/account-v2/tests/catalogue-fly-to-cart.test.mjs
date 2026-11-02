import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const motion=script.match(/\/\* CART FLY FEEDBACK[\s\S]*?\/\* END CART FLY FEEDBACK \*\//)?.[0]||'';

test('catalogue flight goes to the existing bottom-cart icon AFTER server confirms save',()=>{
 const start=script.indexOf('function renderProducts(){');
 const handler=script.slice(script.indexOf('button.onclick=async()=>{',start),
   script.indexOf('actions.append(controls,button);',start));
 assert.ok(handler.startsWith('button.onclick=async()=>{'));
 const save=handler.indexOf('await saveCart(mergeCartItems(cart,[{code:p.code,qty}]));');
 const fly=handler.indexOf('animateCatalogueProductToCart(thumbnail,sourceRect)');
 assert.ok(save>=0&&fly>save,'Flight must not run before an authoritative cart save');
 assert.match(handler,/try\{animateCatalogueProductToCart\(thumbnail,sourceRect\)\}catch\{\}/);
 assert.match(handler,/catch\(e\)\{toast\(e.message\)\}/);
 assert.match(script,/document\.querySelector\('\.mm-bottom-nav \[data-view="cart"\] \.mm-bottom-icon'\)/);
 assert.equal((html.match(/class="mm-bottom-nav"/g)||[]).length,1);
 const destinations=[...html.matchAll(/data-view="cart" class="mm-bottom-tab/g)];
 assert.equal(destinations.length,1);
 assert.doesNotMatch(handler.slice(0,save),/animateCatalogueProductToCart/);
 assert.doesNotMatch(motion,/\/api\/v2\/|fetch\(|saveCart\(|checkout|order\.create/);
 assert.doesNotThrow(()=>new vm.Script(script));
});

function harness({reduced=false,visible=true}={}){
 const flights=[],pulses=[],appended=[];
 const target={
  isConnected:true,
  getBoundingClientRect:()=>visible?{left:600,top:750,width:40,height:40,bottom:790}:
   {left:0,top:0,width:0,height:0,bottom:0},
  animate(frames,settings){pulses.push({frames,settings});return {}}
 };
 const doc={
  querySelector(selector){
   assert.equal(selector,'.mm-bottom-nav [data-view="cart"] .mm-bottom-icon');
   return target;
  },
  createElement(tag){
   assert.equal(tag,'span');
   return {
    style:{},removed:false,attrs:{},
    setAttribute(key,value){this.attrs[key]=value},
    append(icon){this.icon=icon},
    animate(frames,settings){
     const animation={frames,settings,onfinish:null,oncancel:null};
     flights.push(animation);
     return animation;
    },
    remove(){this.removed=true}
   };
  },
  body:{append(node){appended.push(node)}}
 };
 const context={
  document:doc,
  window:{innerHeight:900,matchMedia:()=>({matches:reduced})}
 };
 const animate=vm.runInNewContext(motion+'\nanimateCatalogueProductToCart',context);
 const source={querySelector:()=>({cloneNode(){return {name:'static-product-svg'}}})};
 const origin={left:65,top:230,width:38,height:38,bottom:268};
 return {animate,source,origin,flights,pulses,appended};
}

test('confirmed add flies a visual-only SVG into cart and gives destination one pulse',()=>{
 const fx=harness();
 fx.animate(fx.source,fx.origin);
 assert.equal(fx.appended.length,1);
 assert.equal(fx.flights.length,1);
 assert.equal(fx.appended[0].className,'mm-cart-fly-token');
 assert.equal(fx.appended[0].attrs['aria-hidden'],'true');
 assert.equal(fx.appended[0].icon.name,'static-product-svg');
 assert.equal(fx.flights[0].settings.duration,640);
 assert.match(fx.flights[0].frames[2].transform,/translate3d/);
 assert.equal(fx.pulses.length,0);
 fx.flights[0].onfinish();
 assert.equal(fx.appended[0].removed,true);
 assert.equal(fx.pulses.length,1);
 assert.equal(fx.pulses[0].settings.duration,330);
});

test('motion preference and hidden bottom nav suppress flight safely',()=>{
 for(const options of [{reduced:true},{visible:false}]){
  const fx=harness(options);
  assert.doesNotThrow(()=>fx.animate(fx.source,fx.origin));
  assert.equal(fx.flights.length,0);
  assert.equal(fx.appended.length,0);
 }
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)\{\.mm-cart-fly-token\{display:none!important\}\}/);
 assert.match(html,/\.mm-cart-fly-token\{position:fixed;z-index:9999/);
});

test('existing cart tab badge reflects count and does not invent another cart',()=>{
 const block=script.match(/function renderBadge\(\)\{[\s\S]*?\n\}\nfunction mergeCartItems/)?.[0]||'';
 assert.ok(block,'renderBadge implementation missing');
 const source=block.slice(0,block.lastIndexOf('\nfunction mergeCartItems'));
 const composer={textContent:'',hidden:true};
 let badge,ariaLabel='',count=3,updated=0;
 const icon={
  querySelector:()=>badge||null,
  append(child){badge=child}
 };
 const cartTab={
  querySelector:(q)=>{assert.equal(q,'.mm-bottom-icon');return icon},
  setAttribute:(k,v)=>{assert.equal(k,'aria-label');ariaLabel=v}
 };
 const render=vm.runInNewContext(source+'\nrenderBadge',{
  document:{
   querySelector:()=>cartTab,
   createElement:()=>({setAttribute(){}})
  },
  displayedCartCount:()=>count,
  $:()=>composer,
  updateComposerAction:()=>{updated++}
 });
 render();
 assert.equal(composer.textContent,3);
 assert.equal(badge.textContent,'3');
 assert.equal(badge.hidden,false);
 assert.match(ariaLabel,/3 sản phẩm/);
 count=0;render();
 assert.equal(badge.hidden,true);
 count=120;render();
 assert.equal(badge.textContent,'99+');
 assert.match(ariaLabel,/120 sản phẩm/);
 assert.equal(updated,3);
});
