'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(x=>x.trim());
for(const code of scripts) new vm.Script(code); // all embedded source must remain parseable
const bridge=scripts.find(s=>s.includes("const channel = 'minhsatori-drive-v1'"));
assert.ok(bridge,'Authenticated Drive sync iframe source missing');
const origin='https://n-odiq6uswj4btzrnvxzkeunjxowbbmowt7yh4sqa-0lu-script.googleusercontent.com';
const state={revision:93,values:{
  satori_orders_v15:'[]',satori_catalogue_v15:'[]',satori_ai_customer_memory:'[]',
  satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]',
  satori_system_default_cost_discount:'45'
}};
function app(){
 const store=new Map();
 class Storage {
   getItem(k){return store.has(k)?store.get(k):null}
   setItem(k,v){store.set(k,String(v))}
   removeItem(k){store.delete(k)}
 }
 const storage=new Storage(),created=[],handlers={},docHandlers={};
 const element=(type)=>{
   const e={type,hidden:false,style:{},textContent:'',title:'',attributes:{},listeners:{},
     setAttribute(k,v){this.attributes[k]=v},getAttribute(k){return this.attributes[k]},
     addEventListener(k,fn){this.listeners[k]=fn},append(){},appendChild(){}};
   created.push(e);return e;
 };
 const dot=element('dot'),parent={postMessage(m){posted.push(m)}},posted=[];
 const body={append(){}};
 const doc={readyState:'complete',hidden:false,body,
   getElementById(id){return id==='driveSyncDot'?dot:null},
   createElement:element,addEventListener(k,fn){docHandlers[k]=fn}};
 let next=1;
 const scheduled=new Map(),intervals=[];
 const setTimeout=(fn,ms)=>{let id=next++;scheduled.set(id,{fn,ms});return id};
 const clearTimeout=id=>scheduled.delete(id);
 const setInterval=(fn,ms)=>{intervals.push({fn,ms});return next++};
 const URL={createObjectURL(){return 'blob:test'},revokeObjectURL(){}};
 const window={__SATORI_DRIVE_APP__:true,localStorage:storage,parent,
   addEventListener(k,fn){handlers[k]=fn}};
 const env={window,document:doc,location:{hash:'#satori-drive=1'},Storage,setTimeout,clearTimeout,setInterval,Blob,URL,
   console,JSON,Date,Object,Array,String,Number,Error,Map,Set};
 vm.runInNewContext(bridge,env,{timeout:2000});
 function timer(ms){const entry=[...scheduled.entries()].find(([id,v])=>v.ms===ms);assert.ok(entry,'Missing timer '+ms);scheduled.delete(entry[0]);entry[1].fn()}
 function response(type,props={}){
   const sent=posted.at(-1);assert.ok(sent,'No request posted');
   handlers.message({source:parent,origin,data:{channel:'minhsatori-drive-v1',
     type,id:sent.id,...(type==='state'?{state}:{error:'Có hai thiết bị sửa cùng một hóa đơn'}),...props}});
 }
 return {storage,window,dot,parent,posted,created,timer,response,intervals,scheduled};
}
test('Drive read unlocks after valid response, bad commit never blocks whole screen',()=>{
 const x=app();x.timer(0);
 assert.equal(x.posted[0].type,'read');
 x.response('state');
 assert.equal(x.window.__SATORI_DRIVE_READY__,true);
 const cover=x.created.find(e=>e.type==='div'&&e.id==='driveLoadingCover');
 // The cover is not assigned an id in the source; identify it by style.
 const overlay=x.created.find(e=>e.style?.cssText?.includes('position:fixed;inset:0'));
 assert.ok(overlay);
 assert.equal(overlay.style.display,'none');
 x.storage.setItem('satori_orders_v15','[{"id":100,"invoiceNo":100}]');
 assert.equal(x.window.__SATORI_DRIVE_READY__,false);
 x.timer(1000);
 assert.equal(x.posted.at(-1).type,'commit');
 const posts=x.posted.length;
 x.response('error');
 assert.equal(x.window.__SATORI_DRIVE_READY__,false);
 assert.equal(overlay.style.display,'none');
 assert.equal(overlay.hidden,true);
 assert.equal(x.storage.getItem('satori_orders_v15'),'[{"id":100,"invoiceNo":100}]');
 x.intervals.find(t=>t.ms===15000).fn();
 assert.equal(x.posted.length,posts,'No automatic retry loop after conflict');
 const retry=x.created.find(e=>e.type==='button'&&e.textContent==='Thử kết nối lại Drive');
 assert.ok(retry);retry.listeners.click();
 x.timer(0);
 assert.equal(x.posted.length,posts+1,'Manual retry sends exactly one request');
});
test('Drive read times out to nonblocking error and preserves existing local records',()=>{
 const x=app();
 x.storage.setItem('satori_orders_v15','[{"id":22}]');
 x.timer(0);
 x.timer(30000);
 const overlay=x.created.find(e=>e.style?.cssText?.includes('position:fixed;inset:0'));
 assert.equal(overlay.style.display,'none');
 assert.equal(x.window.__SATORI_DRIVE_READY__,false);
 assert.equal(x.storage.getItem('satori_orders_v15'),'[{"id":22}]');
 assert.equal(x.posted.length,1);
 x.intervals.find(t=>t.ms===15000).fn();
 assert.equal(x.posted.length,1,'No repeated request in stalled state');
});
test('Save and delete require confirmed cloud state within authenticated webapp',()=>{
 assert.match(html,/function handleSaveAndGenerate\(\) \{\s*if\(window\.__SATORI_DRIVE_APP__ && !window\.__SATORI_DRIVE_READY__\)/);
 assert.match(html,/function deleteOrder\(id\) \{\s*if\(window\.__SATORI_DRIVE_APP__ && !window\.__SATORI_DRIVE_READY__\)/);
});
