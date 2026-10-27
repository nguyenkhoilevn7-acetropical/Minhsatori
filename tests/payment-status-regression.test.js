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
const accountingHandlers=section(accounting,'function saveOrders(next)', 'function partnerOptions(');
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
   $:id=>id==='paymentStatus'?{value:'Đã thanh toán'}:null,
   confirm:()=>true,
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
   assert.equal(h.ctx.orders[2].satoriPaidAt,fixture[2].satoriPaidAt);
   assert.equal(h.change(id,'Đã thanh toán'),true);
   assert.ok(h.ctx.orders[2].customerPaidAt);
   assert.equal(h.ctx.orders[2].satoriPaidAt,fixture[2].satoriPaidAt);
   assert.equal(h.change(id,'Đã TT Satori'),true);
   assert.equal(h.ctx.orders[2].satoriPaidAt,fixture[2].satoriPaidAt);
   assert.equal(C.paid(h.ctx.orders[2]),true);
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
test('editing customer payment preserves independent Satori receipt proof',()=>{
 const h=harness(false);
 const updated=h.ctx.paymentMeta(fixture[2]);
 assert.equal(updated.satoriPaidAt,fixture[2].satoriPaidAt);
 assert.ok(updated.customerPaidAt);
});

test('embedded handler delegates to accounting extension when available',()=>{
 const h=harness(true);
 let called=0;
 h.ctx.window.Acct={status(id,value){called++;assert.equal(id,C.key(fixture[1]));assert.equal(value,'Đã thanh toán');return true}};
 assert.equal(h.change(C.key(fixture[1]),'Đã thanh toán'),true);
 assert.equal(called,1);
 assert.equal(h.writes.length,0);
});

test('Satori settlement can be added/undone independently of customer payment',()=>{
 const h=harness(),key=C.key(fixture[0]);
 assert.equal(h.ctx.satoriSettlement(key,true),true);
 assert.equal(h.ctx.orders[0].status,'Chưa thanh toán');
 assert.ok(h.ctx.orders[0].satoriPaidAt);
 assert.equal(C.paid(h.ctx.orders[0]),false);
 assert.equal(h.ctx.satoriSettlement(key,false),true);
 assert.equal(h.ctx.orders[0].satoriPaidAt,null);
 assert.equal(h.ctx.orders[0].status,'Chưa thanh toán');
 assert.equal(C.paid(h.ctx.orders[0]),false);

 const customer=harness(),paid=C.key(fixture[1]);
 assert.equal(customer.change(paid,'Đã thanh toán'),true);
 const proof=customer.ctx.orders[1].customerPaidAt;
 assert.equal(customer.ctx.satoriSettlement(paid,true),true);
 assert.equal(customer.ctx.orders[1].customerPaidAt,proof);
 assert.equal(customer.ctx.satoriSettlement(paid,false),true);
 assert.equal(customer.ctx.orders[1].customerPaidAt,proof);
 assert.equal(customer.ctx.orders[1].status,'Đã thanh toán');
});
test('Satori unmark requires explicit confirmation and verified Drive readiness',()=>{
 const h=harness(),key=C.key(fixture[2]);
 h.ctx.confirm=()=>false;
 assert.equal(h.ctx.satoriSettlement(key,false),false);
 assert.equal(h.writes.length,0);
 h.ctx.window.__SATORI_DRIVE_APP__=true;
 h.ctx.window.__SATORI_DRIVE_READY__=false;
 assert.equal(h.ctx.satoriSettlement(key,true),false);
 assert.equal(h.writes.length,0);
});
test('clearing legacy combined Satori state restores customer status without deleting proof',()=>{
 const h=harness(),key=C.key(fixture[2]);
 h.ctx.orders[2].customerPaidAt='2026-10-26T00:00:00Z';
 assert.equal(h.ctx.satoriSettlement(key,false),true);
 assert.equal(h.ctx.orders[2].status,'Đã thanh toán');
 assert.equal(h.ctx.orders[2].customerPaidAt,'2026-10-26T00:00:00Z');
 assert.equal(h.ctx.orders[2].satoriPaidAt,null);
});
test('editing other classification never silently deletes historical payment evidence',()=>{
 const h=harness();
 h.ctx.$=()=>({value:'Không Tính'});
 const proof={...fixture[2],customerPaidAt:'2026-10-26T00:00:00Z'};
 const meta=h.ctx.paymentMeta(proof);
 assert.equal(meta.satoriPaidAt,proof.satoriPaidAt);
 assert.equal(meta.customerPaidAt,proof.customerPaidAt);
});
test('both accounting views expose independent Satori control; edit uses atomic storage then memory',()=>{
 const matches=html.match(/window\.Acct\?\.satoriSettlement\(/g)||[];
 assert.equal(matches.length,2);
 assert.match(html,/Hủy đánh dấu đã TT Satori/);
 const i=html.indexOf('const updatedOrders = orders.map((order, i) => i===editIdx');
 const write=html.indexOf('localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedOrders))',i);
 const mutate=html.indexOf('orders = updatedOrders;',write);
 assert.ok(i>0&&write>i&&mutate>write);
 assert.doesNotMatch(html,/đồng bộ chính xác 100% vào Sổ Kế Toán/);
 assert.match(html,/Đang chờ xác nhận đồng bộ Google Drive/);
});

test('payment patch is discoverable and browser cannot reuse the old accounting.js?v=191 asset',()=>{
 assert.match(html,/<script src="accounting\.js\?v=2026102701"><\/script>/);
 assert.doesNotMatch(html,/<script src="accounting\.js\?v=191"><\/script>/);
 assert.match(html,/V18\.3 · Thanh toán khách \/ Satori/);
 assert.match(accounting,/V18\.3 · Thanh toán khách \/ Satori/);
 assert.match(accounting,/window\.__SATORI_DRIVE_READY__/);
});
