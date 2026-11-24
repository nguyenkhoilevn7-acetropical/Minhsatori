import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const motion=script.match(/\/\* CART FLY FEEDBACK[\s\S]*?\/\* END CART FLY FEEDBACK \*\//)?.[0]||'';
const send=script.slice(script.indexOf("$('send').onclick=async()=>{"),
 script.indexOf("$('message').onkeydown"));

test('Gemini send animates only AFTER successful verified cart writes in all 3 paths',()=>{
 assert.doesNotThrow(()=>new vm.Script(script));
 assert.ok(send.startsWith("$('send').onclick=async()=>{"));
 assert.match(send,/const cartBeforeSend=cart\.map\(line=>\(\{code:line\.code,qty:line\.qty\}\)\)/);
 assert.match(send,/const sentBubble=bubble\(message,'me'\)/);
 const branches=[
  'await saveCart(mergeCartItems(cart,selection));',
  'await saveCart(revised);',
  'await saveCart(merged);'
 ];
 for(const snippet of branches){
  const at=send.indexOf(snippet);
  const fly=send.indexOf('try{animateChatProductsToCart(cartBeforeSend,sentBubble)}catch{}',at);
  assert.ok(at>=0&&fly>at&&fly-at<200,'Fly must follow confirmed '+snippet);
 }
 assert.equal((send.match(/animateChatProductsToCart\(cartBeforeSend,sentBubble\)/g)||[]).length,3);
 // Product flight is not triggered by Send itself; it needs a verified cart delta.
 const beforeFirstSave=send.slice(0,send.indexOf(branches[0]));
 assert.doesNotMatch(beforeFirstSave,/animateChatProductsToCart/);
 const noProducts=send.slice(send.indexOf('if(!Array.isArray(result.suggestedItems)'),
  send.indexOf('// Validate exact quantities'));
 assert.doesNotMatch(noProducts,/animateChatProductsToCart/);
 assert.match(noProducts,/rememberDeliveryRequest\(result.deliveryRequest\)/);
 assert.match(send,/result.baseCartRevision!==cartRev/);
 assert.match(send,/catch\(e\)\{[\s\S]*reply\.classList\.add\('error'\)/);
 // No new cart write/route or fake Gemini result is introduced by the animation.
 assert.doesNotMatch(motion,/saveCart\(|fetch\(|\/api\/v2\/|checkout|order\.create/);
});

function fixture({before=[],after=[],reduced=false,visible=true,bubbleVisible=true}={}){
 const flights=[],pulses=[],appended=[],queries=[];
 const source={querySelector(selector){
  assert.equal(selector,'svg');
  return {cloneNode(){return {kind:'product-bottle-icon'}}};
 }};
 const cartTarget={
  isConnected:true,
  getBoundingClientRect:()=>visible?
   {left:585,top:755,width:40,height:40,bottom:795}:
   {left:0,top:0,width:0,height:0,bottom:0},
  animate(frames,settings){pulses.push({frames,settings})}
 };
 const body={append(node){appended.push(node)}};
 const doc={
  querySelector(selector){
   queries.push(selector);
   if(selector==='.mm-bottom-nav [data-view="catalogue"] .mm-bottom-icon')return source;
   if(selector==='.mm-bottom-nav [data-view="cart"] .mm-bottom-icon')return cartTarget;
   throw Error('unexpected selector '+selector);
  },
  createElement(tag){
   assert.equal(tag,'span');
   return {
    style:{}, removed:false, attrs:{},
    setAttribute(name,value){this.attrs[name]=value},
    append(icon){this.icon=icon},
    animate(frames,settings){
     const flight={frames,settings,onfinish:null,oncancel:null};
     flights.push(flight);
     return flight;
    },
    remove(){this.removed=true}
   };
  },body
 };
 const elements={
  messages:{getBoundingClientRect:()=>({left:10,top:140,width:600,height:550,bottom:690})},
  send:{getBoundingClientRect:()=>({left:550,top:700,width:46,height:44,bottom:744})}
 };
 const ctx={
  document:doc,
  window:{innerHeight:900,matchMedia:()=>({matches:reduced})},
  $:id=>elements[id],
  products:after.map(l=>({code:l.code})),
  cart:after
 };
 const play=vm.runInNewContext(motion+'\nanimateChatProductsToCart',ctx);
 const bubble={getBoundingClientRect:()=>bubbleVisible?
  {left:65,top:300,width:230,height:52,bottom:352}:
  {left:65,top:-500,width:230,height:52,bottom:-448}};
 return {play,bubble,before,after,flights,pulses,appended,queries};
}

test('one newly added SKU flies from sent bubble to the EXISTING bottom cart',()=>{
 const fx=fixture({after:[{code:'WATER',qty:10}]});
 fx.play(fx.before,fx.bubble);
 assert.equal(fx.appended.length,1);
 assert.equal(fx.flights.length,1);
 assert.equal(fx.appended[0].icon.kind,'product-bottle-icon');
 assert.equal(fx.appended[0].attrs['aria-hidden'],'true');
 assert.equal(fx.flights[0].settings.duration,640);
 assert.equal(fx.flights[0].settings.delay,0);
 assert.equal(fx.appended[0].style.left,'160px');
 assert.equal(fx.appended[0].style.top,'306px');
 assert.match(fx.flights[0].frames[2].transform,/translate3d/);
 fx.flights[0].onfinish();
 assert.equal(fx.appended[0].removed,true);
 assert.equal(fx.pulses.length,1);
 assert.equal(fx.pulses[0].settings.duration,330);
});

test('three different added SKUs create at most 3 staggered flights, not per quantity',()=>{
 const fx=fixture({before:[{code:'A',qty:2}],
  after:[{code:'A',qty:9},{code:'B',qty:10},{code:'C',qty:5},
   {code:'D',qty:3},{code:'E',qty:1}]});
 fx.play(fx.before,fx.bubble);
 assert.equal(fx.flights.length,3);
 assert.deepEqual(fx.flights.map(x=>x.settings.delay),[0,120,240]);
});

test('quantity decrease, unchanged cart, or empty cart never create a success animation',()=>{
 for(const [before,after] of [
  [[{code:'A',qty:3}],[{code:'A',qty:2}]],
  [[{code:'A',qty:3}],[{code:'A',qty:3}]],
  [[{code:'A',qty:3}],[]]
 ]){
  const fx=fixture({before,after});fx.play(fx.before,fx.bubble);
  assert.equal(fx.flights.length,0);
  assert.equal(fx.appended.length,0);
 }
});

test('reduced motion, hidden cart and off-screen chat bubble behave gracefully',()=>{
 for(const options of [{reduced:true},{visible:false}]){
  const fx=fixture({...options,after:[{code:'A',qty:2}]});
  fx.play(fx.before,fx.bubble);
  assert.equal(fx.flights.length,0);
 }
 const fx=fixture({after:[{code:'A',qty:2}],bubbleVisible:false});
 fx.play(fx.before,fx.bubble);
 assert.equal(fx.flights.length,1);
 assert.equal(fx.appended[0].style.top,'702px'); // Send button fallback
 assert.match(html,/\.mm-cart-fly-token\{position:fixed/);
 assert.equal((html.match(/class="mm-bottom-nav"/g)||[]).length,1);
});
