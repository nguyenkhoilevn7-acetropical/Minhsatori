'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../accounting-core.js');
const C = global.SatoriAccountingCore;
const accounting = fs.readFileSync(path.join(__dirname,'../accounting.js'),'utf8');
const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const fixture = [
 {id:7,invoiceNo:5914,name:'Customer A',status:'Chưa thanh toán',total:100},
 {id:7,invoiceNo:5918,name:'Customer B',status:'Chưa thanh toán',total:200},
 {id:9,invoiceNo:5920,name:'Customer C',status:'Đã TT Satori',satoriPaidAt:'2026-10-24T00:00:00Z',total:300}
];
function section(source,first,last){
 const begin=source.indexOf(first),end=source.indexOf(last,begin);
 assert.ok(begin>=0&&end>begin,'Missing handler boundary '+first);
 return source.slice(begin,end);
}
const accountingHandlers=section(accounting,'function saveOrders(next)', 'function formMeta(original)');
const fallbackHandler=section(html,'function updateStatus(id, newStatus)', 'function viewInvoice(id)');
function harness(fallback=false){
 const writes=[],messages=[],renders=[];
 const ctx={
   C,SatoriAccountingCore:C,STORAGE_KEY:'satori_orders_v15',orders:structuredClone(fixture),
   window:{__SATORI_DRIVE_APP__:false,__SATORI_DRIVE_READY__:false},
   localStorage:{setItem(k,v){writes.push([k,v]);}}, sizeCheck(){},
   renderTable(){renders.push('table')},renderArchiveInvoices(){renders.push('archive')},
   updateCounters(){renders.push('counts')},populateCustomerDatalist(){},
   populateExcelCustomerFilter(){},aiEscape:String,
   error(e){messages.push(String(e.message||e))},
   showModal(_title,message){messages.push(String(message))},
   Date,JSON,Number,String,Error,Object,Array
 };
 vm.createContext(ctx);
 vm.runInContext(fallback?fallbackHandler:accountingHandlers,ctx);
 return {ctx,writes,messages,renders,change:(id,value)=>fallback?ctx.updateStatus(id,value):ctx.status(id,value)};
}
for(const fallback of [false,true]){
 const kind=fallback?'embedded fallback':'accounting extension';
 test(kind+' updates only invoice with exact stable key, not duplicated numeric ID',()=>{
   const h=harness(fallback),id=C.key(fixture[1]);
   assert.equal(h.change(id,'Đã thanh toán'),true);
   assert.equal(h.writes.length,1);
   assert.equal(h.ctx.orders[0].status,'Chưa thanh toán');
   assert.equal(h.ctx.orders[1].status,'Đã thanh toán');
   assert.ok(h.ctx.orders[1].customerPaidAt);
   assert.equal(JSON.parse(h.writes[0][1])[0].status,'Chưa thanh toán');
   assert.ok(h.renders.includes('table'));
 });
 test(kind+' allows paid to unpaid with independent Satori settlement state',()=>{
   const h=harness(fallback),id=C.key(fixture[2]);
   assert.equal(h.change(id,'Chưa thanh toán'),true);
   assert.equal(h.ctx.orders[2].status,'Chưa thanh toán');
   assert.equal(h.ctx.orders[2].customerPaidAt,null);
   assert.equal(h.ctx.orders[2].satoriPaidAt,null);
   assert.equal(h.change(id,'Đã TT Satori'),true);
   assert.ok(h.ctx.orders[2].satoriPaidAt);
   assert.equal(C.paid(h.ctx.orders[2]),false);
 });
 test(kind+' blocks writes while Drive is unverified and reports the failure',()=>{
   const h=harness(fallback);
   h.ctx.window.__SATORI_DRIVE_APP__=true;
   h.ctx.window.__SATORI_DRIVE_READY__=false;
   assert.equal(h.change(C.key(fixture[0]),'Đã thanh toán'),false);
   assert.equal(h.writes.length,0);
   assert.equal(h.ctx.orders[0].status,'Chưa thanh toán');
   assert.match(h.messages.join(' '),/Drive/i);
 });
 test(kind+' fails closed for missing invoice or invalid status',()=>{
   const h=harness(fallback);
   assert.equal(h.change('not-found','Đã thanh toán'),false);
   assert.equal(h.change(C.key(fixture[0]),'UNKNOWN'),false);
   assert.equal(h.writes.length,0);
   assert.equal(h.ctx.orders[0].status,'Chưa thanh toán');
   assert.ok(h.messages.length>=2);
 });
 test(kind+' keeps in-memory state unchanged on failed storage write',()=>{
   const h=harness(fallback);
   h.ctx.localStorage.setItem=()=>{throw Error('storage quota')};
   assert.equal(h.change(C.key(fixture[0]),'Đã thanh toán'),false);
   assert.equal(h.ctx.orders[0].status,'Chưa thanh toán');
   assert.match(h.messages.join(' '),/quota/);
 });
}
test('embedded handler delegates to accounting extension when available',()=>{
 const h=harness(true);
 let called=0;
 h.ctx.window.Acct={status(id,value){called++;assert.equal(id,C.key(fixture[1]));assert.equal(value,'Đã thanh toán');return true}};
 assert.equal(h.change(C.key(fixture[1]),'Đã thanh toán'),true);
 assert.equal(called,1);
 assert.equal(h.writes.length,0);
});
