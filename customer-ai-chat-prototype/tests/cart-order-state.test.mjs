// Execute the production adapter against a small DOM and an entirely fake ledger.
// No network or real customer/order data is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {renderOriginalGeminiProduction} from '../production-gemini-shell.mjs';

const source=fs.readFileSync(new URL('../real-gemini-adapter.js',import.meta.url),'utf8');
const html=renderOriginalGeminiProduction(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),source);
const token='fake-customer-link-'.padEnd(100,'x');
const orderKey='satori-order:'+token.slice(0,32);
const submittedKey='satori-submitted:'+token.slice(0,32);
const pendingKey='satori-pending:'+token.slice(0,32);
function fixture({storage=new Map(),failConfirm=false,deferConfirm=false}={}){
 const nodes=new Set();let activeElement=null;
 class Element{
  constructor(tag='div'){this.tagName=tag.toLowerCase();this.children=[];this.parentElement=null;this.dataset={};this.attributes={};this.hidden=false;this.disabled=false;this.value='';this._text='';this.className='';this.listeners={};nodes.add(this);
   this.style={setProperty(k,v){this[k]=v},removeProperty(k){delete this[k]}};
   this.classList={add:(...a)=>{this.className=[...new Set([...this.className.split(' '),...a])].join(' ').trim()},remove:(...a)=>{this.className=this.className.split(' ').filter(x=>!a.includes(x)).join(' ')},contains:a=>this.className.split(' ').includes(a),toggle:(a,on)=>{on??=!this.classList.contains(a);on?this.classList.add(a):this.classList.remove(a)}};
  }
  set textContent(x){this._text=String(x);this.children=[]} get textContent(){return this._text+this.children.map(x=>x.textContent).join('')}
  append(...children){for(const c of children){if(c.parentElement)c.remove();this.children.push(c);c.parentElement=this}}
  prepend(...children){for(const c of children.reverse()){if(c.parentElement)c.remove();this.children.unshift(c);c.parentElement=this}}
  insertBefore(c,b){if(c.parentElement)c.remove();const i=this.children.indexOf(b);this.children.splice(i<0?this.children.length:i,0,c);c.parentElement=this}
  replaceChildren(...c){for(const x of this.children)x.parentElement=null;this._text='';this.children=[];this.append(...c)}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);this.parentElement=null}
  setAttribute(k,v){this.attributes[k]=String(v);if(k==='id')this.id=String(v)}
  getAttribute(k){return this.attributes[k]??null}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)}
  dispatch(type,event={}){for(const fn of this.listeners[type]||[])fn(event)}
  setPointerCapture(){} focus(){activeElement=this}
  getBoundingClientRect(){return {height:70}}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  querySelectorAll(selector){return descendants(this).filter(x=>matches(x,selector))}
  closest(selector){for(let x=this;x;x=x.parentElement)if(matches(x,selector))return x;return null}
 }
 function descendants(e){return e.children.flatMap(c=>[c,...descendants(c)])}
 function matches(e,selector){return selector.split(',').some(sel=>{
  const parts=sel.trim().split(/\s+/);const one=parts.pop();
  const id=one.match(/^#([\w-]+)$/);const cl=one.match(/^\.([\w-]+)$/);const tag=one.match(/^([a-z]+)/)?.[1];
  let own=id?e.id===id[1]:cl?e.classList.contains(cl[1]):tag?e.tagName===tag:false;
  if(one.includes('[type=submit]'))own=own&&e.type==='submit';
  if(one==='[data-brand]')own=e.dataset.brand!==undefined;
  if(!own)return false;
  if(parts.length){let p=e.parentElement;const ancestor=parts.join(' ');while(p&&!matches(p,ancestor))p=p.parentElement;return !!p}return true;
 })}
 const root=new Element('body'),documentElement=new Element('html');
 const initial=new Map();for(const [,id] of html.matchAll(/id="([^"]+)"/g)){const e=new Element();e.id=id;initial.set(id,e);root.append(e)}
 const send=new Element('button');send.type='submit';initial.get('sendForm').append(send);
 const document={body:root,documentElement,createElement:t=>new Element(t),getElementById:id=>[...nodes].find(n=>n.id===id)||null,querySelectorAll:s=>descendants(root).filter(e=>matches(e,s)),querySelector:s=>document.querySelectorAll(s)[0]||null,addEventListener(){},get activeElement(){return activeElement}};
 const calls=[];let releaseConfirm;
 const customer={name:'Khách giả',phone:'0000000000',location:'Địa chỉ test'};
 const products=[{code:'WATER',name:'Nước test',unit:'thùng',unitPrice:100}];
 const response=data=>({ok:true,json:async()=>({ok:true,...data})});
 let invoiceNo=100;
 const fetch=async(endpoint,options)=>{const body=JSON.parse(options.body);calls.push({endpoint,body});
  if(endpoint==='/api/real/catalogue')return response({customer,products,discountPercent:0});
  if(endpoint==='/api/real/history')return response({orders:[],revision:1,complete:true});
  if(endpoint==='/api/real/interpret')return response({cart:[{code:'WATER',qty:2}],message:'Đã thêm giỏ test'});
  if(endpoint==='/api/real/quote')return response({quoteToken:'quote-'+calls.length,customer,items:[{product:'Nước test',qty:2,unit:'thùng',unitPrice:100}],subtotal:200,total:200,shippingAmount:0,vatAmount:0});
  if(endpoint==='/api/real/confirm'){
   if(deferConfirm)await new Promise(resolve=>{releaseConfirm=resolve});
   if(failConfirm)throw Error('Fake lost response');
   return response({saved:true,invoiceNo:++invoiceNo,total:200,createdAt:'2026-10-24T00:00:00Z'});
  }
  throw Error('Unexpected endpoint '+endpoint);
 };
 const dialogs=[];
 const context={document,location:{hash:'#'+token},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))},crypto:{randomUUID},fetch,Intl,Date,Number,Map,Set,Option:function(t,v){const n=new Element('option');n.textContent=t;n.value=v;return n},URL,console,navigator:{userAgent:'Fake browser'},requestAnimationFrame:f=>f(),setInterval,clearInterval};
 context.window={innerHeight:800,addEventListener(){},confirm:message=>{dialogs.push(message);return true}};
 vm.runInNewContext(source,context,{filename:'real-gemini-adapter.js'});
 const $=id=>document.getElementById(id);
 const all=selector=>document.querySelectorAll(selector);
 const confirmCalls=()=>calls.filter(c=>c.endpoint==='/api/real/confirm').length;
 const submit=async()=>{ $('messageInput').value='thêm 2 nước';await $('sendForm').onsubmit({preventDefault(){}})};
 const login=async()=>{$('realCode').value='fake-pin';await $('realOpen').onclick()};
 const quote=async()=>{$('composeCart').onclick();await new Promise(resolve=>setImmediate(resolve));return all('.live-real-confirm').at(-1)};
 return {$,all,login,submit,quote,storage,calls,dialogs,confirmCalls,release:()=>releaseConfirm(),send,document};
}

test('successful order locks its cart; explicit new cart reopens chat without login, retains invoices and cannot replay old quote',async()=>{
 const f=fixture();await f.login();await f.submit();
 const order1=f.storage.get(orderKey);const button=await f.quote();await button.onclick();
 assert.equal(f.confirmCalls(),1);assert.equal(f.send.disabled,false);assert.equal(f.$('messageInput').disabled,false);
 assert.equal(f.$('composeCart').disabled,true);
 const saved=f.storage.get(submittedKey);assert.equal(JSON.parse(saved).invoiceNo,101);
 // Repeated old confirmation cannot replay its invoice. A new chat starts only a new draft.
 await button.onclick();await f.submit();await f.submit();assert.equal(f.confirmCalls(),1);
 assert.notEqual(f.storage.get(orderKey),order1);
 f.$('realNewCartButton').onclick();
 assert.notEqual(f.storage.get(orderKey),order1);assert.equal(f.send.disabled,false);assert.equal(f.$('messageInput').disabled,false);
 assert.equal(f.storage.get(submittedKey),saved);assert.equal(f.storage.get(pendingKey),'');
 await f.submit();const newButton=await f.quote();
 // Even a stale handler called directly cannot submit the new cart.
 await button.onclick();assert.equal(f.confirmCalls(),1);
 await newButton.onclick();assert.equal(f.confirmCalls(),2);
 assert.deepEqual(JSON.parse(f.storage.get(submittedKey)).invoiceNos,[101,102]);
 assert.equal(f.calls.filter(c=>c.endpoint==='/api/real/catalogue').length,1);
});

test('locked catalogue mutations produce one notice, keep cart and old invoice; no automatic retries',async()=>{
 const f=fixture();await f.login();await f.submit();await (await f.quote()).onclick();
 const before=f.$('messages').children.length;
 f.$('allProductsButton').onclick();
 const up=f.all('.real-catalog-stepper button')[1];
 for(let n=0;n<12;n++)up.onclick();
 assert.equal(f.$('messages').children.length,before+1);
 assert.equal(f.confirmCalls(),1);assert.equal(f.all('.real-cart-count')[0].textContent,'2');
 assert.equal(up.disabled,true);
 f.$('clearCart').onclick();assert.equal(f.all('.real-cart-count')[0].textContent,'2');
});

test('lost confirm response requires invoice review and an explicit new cart; never resubmits',async()=>{
 const f=fixture({failConfirm:true});await f.login();await f.submit();const order=f.storage.get(orderKey);
 const button=await f.quote();await button.onclick();
 assert.equal(f.send.disabled,false);assert.equal(f.confirmCalls(),1);assert.ok(f.storage.get(pendingKey));
 const before=f.$('messages').children.length;
 await button.onclick();await f.submit();await f.submit();
 assert.equal(f.$('messages').children.length,before);assert.equal(f.confirmCalls(),1);
 // Sending chat while uncertain already opened the Hóa đơn review.
 // A separate new-cart click still requires explicit confirmation.
 assert.equal(f.$('historyBackdrop').classList.contains('open'),true);
 assert.equal(f.storage.get(orderKey),order);assert.equal(f.dialogs.length,0);
 await new Promise(resolve=>setImmediate(resolve));
 f.$('realNewCartButton').onclick();
 assert.equal(f.dialogs.length,1);assert.notEqual(f.storage.get(orderKey),order);assert.equal(f.send.disabled,false);
 assert.equal(f.confirmCalls(),1);
});

test('pending order survives reload and cannot silently start another cart',async()=>{
 const id=randomUUID();const storage=new Map([[orderKey,id],[pendingKey,JSON.stringify({orderId:id,startedAt:1})]]);
 const f=fixture({storage});await f.login();assert.equal(f.send.disabled,false);
 f.$('realNewCartButton').onclick();assert.equal(f.storage.get(orderKey),id);assert.equal(f.$('historyBackdrop').classList.contains('open'),true);
 assert.equal(f.confirmCalls(),0);
});

test('new cart is blocked while confirmation is in flight, then becomes usable after success',async()=>{
 const f=fixture({deferConfirm:true});await f.login();await f.submit();const order=f.storage.get(orderKey);
 const button=await f.quote();const confirming=button.onclick();
 assert.equal(f.$('realNewCartButton').disabled,true);f.$('realNewCartButton').onclick();assert.equal(f.storage.get(orderKey),order);
 f.release();await confirming;assert.equal(f.$('realNewCartButton').disabled,false);
 f.$('realNewCartButton').onclick();assert.equal(f.send.disabled,false);assert.notEqual(f.storage.get(orderKey),order);
});


test('one swipe opens or closes the cart; absent synthetic click does not swallow the next touch',async()=>{
 const f=fixture();await f.login();await f.submit();const handle=f.$('realCartHandle');
 const down=y=>handle.dispatch('pointerdown',{pointerId:1,pointerType:'touch',clientY:y});
 const up=y=>handle.dispatch('pointerup',{pointerId:1,pointerType:'touch',clientY:y});
 down(200);up(120);assert.equal(f.$('quickCart').dataset.cartMode,'full');
 down(120);up(200);assert.equal(f.$('quickCart').dataset.cartMode,'collapsed');
 // No click event followed the drag. The next independent tap still opens.
 down(200);up(200);handle.onclick();assert.equal(f.$('quickCart').dataset.cartMode,'full');
 f.$('messages').dispatch('click',{target:f.$('messages')});assert.equal(f.$('quickCart').dataset.cartMode,'collapsed');
 f.$('quickCartEdit').onclick();assert.equal(f.$('quickCart').dataset.cartMode,'full');
 f.$('realCartClose').onclick();assert.equal(f.$('quickCart').dataset.cartMode,'collapsed');
 assert.equal(f.all('.real-cart-direction')[0].textContent,'⌃');
});

test('restored successful invoice keeps chat tappable and the next explicit chat makes a fresh draft only',async()=>{
 const original=randomUUID(),storage=new Map([[orderKey,original],[submittedKey,
  JSON.stringify({orderId:original,invoiceNo:101,invoiceNos:[101]})]]);
 const f=fixture({storage});await f.login();
 assert.equal(f.$('messageInput').disabled,false);
 assert.equal(f.send.disabled,false);
 assert.equal(f.storage.get(orderKey),original);
 await f.submit();
 assert.notEqual(f.storage.get(orderKey),original);
 assert.equal(f.confirmCalls(),0);
 assert.equal(f.calls.filter(x=>x.endpoint==='/api/real/interpret').length,1);
 assert.equal(JSON.parse(f.storage.get(submittedKey)).invoiceNo,101);
});
test('uncertain invoice permits typing but cannot interpret or create orders before invoice review',async()=>{
 const id=randomUUID(),storage=new Map([[orderKey,id],[pendingKey,
  JSON.stringify({orderId:id,startedAt:1})]]);
 const f=fixture({storage});await f.login();
 assert.equal(f.$('messageInput').disabled,false);
 await f.submit();
 assert.equal(f.storage.get(orderKey),id);
 assert.equal(f.calls.filter(x=>x.endpoint==='/api/real/interpret').length,0);
 assert.equal(f.$('historyBackdrop').classList.contains('open'),true);
});
