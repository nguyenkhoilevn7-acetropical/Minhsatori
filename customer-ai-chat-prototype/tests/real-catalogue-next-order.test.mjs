import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../real-gemini-adapter.js',import.meta.url),'utf8');

test('confirmed invoice never disables next catalogue plus/minus inputs',()=>{
 const controlCode=source.slice(source.indexOf('function syncOrderInputState('),
  source.indexOf('function showLockNoticeOnce('));
 assert.match(controlCode,/for\(const control of document\.querySelectorAll\('\.real-catalog-stepper button/);
 assert.match(controlCode,/control\.disabled=confirming\|\|submissionUncertain\|\|requestsBusy\|\|!catalogue/);
 const catalogueOnly=controlCode.slice(0,
  controlCode.indexOf("for(const control of document.querySelectorAll('.inline-cart-row"));
 assert.doesNotMatch(catalogueOnly,/control\.disabled=locked\|\|requestsBusy/);
 assert.match(source,/down\.dataset\.qtyAction='minus'/);
 assert.match(source,/qty\.value=String\(submitted\?0:/);
 new vm.Script(source,{filename:'real-gemini-adapter.js'});
});

test('first + after a confirmed order creates one clean cart, not a duplicate invoice',()=>{
 const start=source.indexOf(' function changeQty(');
 const end=source.indexOf(' function category(',start);
 assert.ok(start>=0&&end>start);
 const part=source.slice(start,end);
 const factory=new Function('cart','products','signals',`
 let submitted=true,submissionUncertain=false,confirming=false,requestsBusy=false;
 function startNewCart(automatic){
  if(!automatic)throw Error('Expected automatic fresh draft');
  signals.newCart++;submitted=false;cart.clear();return true;
 }
 function showLockNoticeOnce(){signals.lockNotice++}
 function validCart(next){if(next.size>6)throw Error('TOO_MANY')}
 function invalidate(){signals.invalidates++}
 function updateCart(){signals.renders++}
 `+part+'\nreturn {changeQty,isSubmitted:()=>submitted};');
 const product={code:'TP-00001',name:'Satori 350ml',unit:'Thùng'};
 const cart=new Map([['TP-00001',{...product,qty:4}]]);
 const signals={newCart:0,lockNotice:0,invalidates:0,renders:0};
 const fn=factory(cart,new Map([[product.code,product]]),signals);
 assert.equal(fn.changeQty(product.code,1),true);
 assert.equal(signals.newCart,1);
 assert.equal(cart.get(product.code).qty,1);
 assert.equal(fn.isSubmitted(),false);
 assert.equal(fn.changeQty(product.code,5),true);
 assert.equal(cart.get(product.code).qty,5);
 assert.equal(signals.newCart,1,'one new cart for all subsequent taps');
});

test('catalogue plus, typed quantity and minus update a real product row',()=>{
 const start=source.indexOf(' function renderCatalogue(');
 const end=source.indexOf(' function openCatalogue(',start);
 assert.ok(start>=0&&end>start);
 class El{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.value='';
   this.classList={add:()=>{},remove:()=>{}};}
  append(...children){this.children.push(...children)}
  replaceChildren(...children){this.children=[...children]}
  setAttribute(){}
 }
 const doc={createElement:tag=>new El(tag)};
 const nodes={'catalogItems':new El('div'),'catalogSearch':new El('input')};
 const products=[{code:'TP-00001',name:'Satori 350ml',unit:'Thùng',unitPrice:70400}];
 const cart=new Map([['TP-00001',{...products[0],qty:4}]]);
 const calls=[];
 const maker=new Function('document','$','currentProducts','category','cash',
  'cart','setText','syncOrderInputState','bubble','calls',
  `let submitted=true,catalogFilter='ALL';
   const changeQty=(code,qty)=>{
    if(submitted){submitted=false;cart.clear()}
    if(qty)cart.set(code,{code,qty});else cart.delete(code);
    calls.push(qty);return true;
   };
  `+source.slice(start,end)+'\nreturn {renderCatalogue,isSubmitted:()=>submitted};');
 const m=maker(doc,id=>nodes[id],()=>products,()=> 'SATORI',
  n=>String(n)+' đ',cart,()=>{},()=>{},()=>{},calls);
 m.renderCatalogue();
 const row=()=>nodes.catalogItems.children[0];
 const controls=()=>row().children[2];
 assert.equal(controls().children[1].value,'0','old order is not editable as new cart');
 controls().children[2].onclick();
 assert.equal(calls.at(-1),1);
 assert.equal(controls().children[1].value,'1');
 controls().children[1].value='5';
 controls().children[1].onchange();
 assert.equal(calls.at(-1),5);
 controls().children[0].onclick();
 assert.equal(calls.at(-1),4);
 assert.deepEqual(calls,[1,5,4]);
 assert.equal(cart.get('TP-00001').qty,4);
});

test('history panel excludes unverifiable local receipts and stale badges',()=>{
 const a=source.indexOf(' function renderInvoiceHistory(');
 const b=source.indexOf(' async function loadInvoiceHistory(',a);
 const panel=source.slice(a,b);
 assert.ok(a>=0&&b>a);
 assert.match(panel,/const rows=\(verified\?historyOrders:\[\]\)\.filter/);
 assert.doesNotMatch(panel,/for\(const invoiceNo of \[\.\.\.sessionInvoices\]/);
 assert.doesNotMatch(panel,/for\(const old of cachedHistory\)/);
 const badge=source.slice(source.indexOf(' function updateInvoiceBadge('),
  source.indexOf(' updateInvoiceBadge();'));
 assert.doesNotMatch(badge,/for\(const invoiceNo of sessionInvoices\)/);
 assert.match(source,/historyOrders=\[\];persistedInvoiceCount=null;historyIncomplete=true/);
});
