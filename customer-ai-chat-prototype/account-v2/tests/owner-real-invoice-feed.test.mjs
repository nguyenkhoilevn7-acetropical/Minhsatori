import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Evaluate the exact production admin feed function in a fake, offline DOM.
// No Google account, HMAC credentials, real invoices or network calls.
const html=fs.readFileSync(new URL('../../admin.html',import.meta.url),'utf8');
const start=html.indexOf('// Real invoices are polled through the owner-authenticated');
const end=html.indexOf('// Owner-only live inbox: initial load establishes baseline');
assert.ok(start>=0&&end>start,'real owner feed implementation is required');
const code=html.slice(start,end);

test('real invoice feed: safe baseline, edited bills not new, no duplicate alerts, failure preserves state',async()=>{
 const queue=[];
 const queried=[];
 const alerts=[];
 let rings=0;
 const nodes=new Map();
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{
   hidden:false,textContent:'',children:[],replaceChildren(){this.children=[]},
   append(item){this.children.push(item)}
  });
  return nodes.get(id);
 };
 const fakeDOM={hidden:false,createElement:()=>({
  className:'',textContent:'',children:[],append(...items){this.children.push(...items)}
 }),addEventListener(){}};
 const sandbox={
  secret:'test-owner-session',document:fakeDOM,$:node,
  window:{},bellEnabled:true,
  request:async url=>{
   queried.push(url);
   const next=queue.shift();
   if(next instanceof Error)throw next;
   return next;
  },
  ringForNewOrder:()=>{rings++},
  Notification:class {static permission='granted';constructor(title,opts){alerts.push({title,opts})}},
  money:n=>n.toLocaleString('vi-VN'),
  setInterval:()=>0,console
 };
 vm.createContext(sandbox);
 vm.runInContext(code,sandbox,{filename:'production-admin-feed.js'});
 const poll=vm.runInContext('pollRealOrderFeed',sandbox);
 const invoice=(invoiceNo,status='Chưa thanh toán')=>({
  invoiceNo,name:'Fake Customer',total:40000,status,isTest:false
 });
 queue.push({readOnly:true,revision:40,invoices:[invoice(2001)],truncated:false});
 await poll(true);
 assert.equal(rings,0);
 assert.equal(alerts.length,0,'first owner read must never ring for old invoices');
 queue.push({readOnly:true,revision:41,invoices:[invoice(2001,'Đã thanh toán'),invoice(2002)],truncated:false});
 await poll(true);
 assert.equal(rings,1);
 assert.equal(alerts.length,1);
 assert.match(alerts[0].title,/1 hóa đơn thật mới/);
 queue.push({readOnly:true,revision:42,invoices:[invoice(2001),invoice(2002,'Đã thanh toán')],truncated:false});
 await poll(true);
 assert.equal(rings,1,'payment edits cannot be counted as new bills');
 queue.push(new Error('upstream unavailable'));
 await poll(true);
 assert.match(node('productionFeedState').textContent,/Chưa đọc được/);
 queue.push({readOnly:true,revision:43,invoices:[invoice(2001),invoice(2002),invoice(2003,{})],truncated:true});
 await poll(true);
 assert.equal(rings,2,'a transient failure must not reset the baseline');
 assert.match(node('productionFeedState').textContent,/chưa đầy đủ/);
 assert.equal(queried.length,5);
 for(const url of queried)assert.match(url,/^\/api\/admin\/live-search\?kind=invoices&month=\d{4}-\d{2}$/);
});
