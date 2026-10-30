import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {interpret} from '../router.mjs';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const helperStart=html.indexOf('function clearPendingCatalogueProduct(){');
const helperEnd=html.indexOf('function count(){',helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,'Expected V2 conversation functions');

function frontendContext(){
 const sandbox={products:[
  {code:'TP-00003',name:'Nước tinh khiết Satori 500ml',unit:'Thùng'},
  {code:'TP-00058',name:'Nước ép ổi hồng',unit:'Thùng'},
  {code:'TP-00004',name:'Nước tinh khiết Satori 1500ml',unit:'Thùng'}
 ]};
 const context=vm.createContext(sandbox);
 vm.runInContext("let pendingCatalogueProduct=null;"+
  "let catalogueQuestionHasUnavailableProduct=false;"+
  "function foldProductSearch(value){"+
  "return String(value||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'')"+
  ".replace(/đ/g,'d').toLowerCase().trim();}"+
  html.slice(helperStart,helperEnd),context);
 return {context,run(code){return vm.runInContext(code,context)}};
}
test('verified catalogue answer permits short numeric follow-up with strict tenant scope',async()=>{
 const active=[
  {code:'TP-00003',name:'Nước tinh khiết Satori 500ml',unit:'Thùng'}];
 const pool={query:async()=>({rows:active})};
 const result=await interpret(pool,{message:'Satori có nước 500ml không?'});
 assert.equal(result.availableProductCode,'TP-00003');
 const {run}=frontendContext();
 run('rememberVerifiedCatalogueProduct('+JSON.stringify(result)+',"profileA","addressA")');
 const quantity=run('pendingCatalogueQuantity("cho 5 thùng","profileA","addressA")');
 assert.equal(quantity.code,'TP-00003');
 assert.equal(quantity.qty,5);
 assert.equal(run('pendingCatalogueQuantity("lấy 2 chai","profileA","addressA")?.message'),
  'Sản phẩm đã chọn có đơn vị thung. Vui lòng nhập số lượng đúng quy cách.');
 assert.equal(run('pendingCatalogueQuantity("2 thùng","profileA","addressB")'),null);
 assert.equal(run('pendingCatalogueQuantity("2 thùng","profileA","addressA")'),null,
  'Context must be invalidated after a different delivery point');
});
test('unsynced catalogue cannot create a trusted context, even with stale cart',async()=>{
 const result=await interpret({query:async()=>({rows:[]})},
  {message:'Satori có nước 500ml không?'});
 assert.equal(result.availableProductCode,null);
 const {run}=frontendContext();
 run('rememberVerifiedCatalogueProduct('+JSON.stringify(result)+',"p","a")');
 assert.equal(run('pendingCatalogueQuantity("5 thùng","p","a")'),null);
 assert.equal(run('catalogueQuestionHasUnavailableProduct'),true);
 assert.equal(run('pendingCatalogueQuantity("1000 thùng","p","a")'),null);
});
test('pure cart reconciliation compares exact validated quantities without order sensitivity',()=>{
 const {run}=frontendContext();
 assert.equal(run('sameCartLines([{code:"TP-00003",qty:5},{code:"TP-00058",qty:2}],'+
  '[{code:"TP-00058",qty:2},{code:"TP-00003",qty:5}])'),true);
 assert.equal(run('sameCartLines([{code:"TP-00003",qty:5}],'+
  '[{code:"TP-00003",qty:2}])'),false);
 assert.equal(run('sameCartLines([{code:"TP-00003",qty:5}],'+
  '[{code:"TP-00003",qty:5},{code:"TP-00058",qty:2}])'),false);
 assert.equal(run('sameCartLines([{code:"TP-00003",qty:5},{code:"TP-00003",qty:5}],'+
  '[{code:"TP-00003",qty:5},{code:"TP-00003",qty:5}])'),false);
 assert.equal(run('sameCartLines([{code:"TP-00003",qty:5},{code:"TP-00003",qty:5}],'+
  '[{code:"TP-00003",qty:5},{code:"TP-00058",qty:2}])'),false,
  'Duplicate actual SKU must never masquerade as a valid multi-line cart');
 assert.equal(run('sameCartLines([{code:"TP-00003",qty:5},{code:"TP-00058",qty:2}],'+
  '[{code:"TP-00003",qty:5},{code:"TP-00058",qty:2}])'),true);
});
test('mobile chat never blindly retries a potentially persisted cart write',()=>{
 const start=html.indexOf('async function saveCart(lines){');
 const end=html.indexOf('function foldProductSearch(',start);
 const save=html.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.match(save,/remote\.revision>expectedRevision&&sameCartLines\(remote\.lines,lines\)/);
 assert.match(save,/Giỏ đã được tải lại sau lỗi mạng/);
 assert.match(save,/Không xác minh được giỏ sau lỗi mạng/);
 assert.equal((save.match(/await call\('\/api\/v2\/cart',/g)||[]).length,1);
 assert.match(html,/const GEMINI_TYPING_MIN_MS=220/);
 assert.match(html,/await addChatOrderReceipt\(selection\)\.catch\(/);
 assert.match(html,/button\.disabled=!selectedDeliveryAddress\(\)\|\|savingCart\|\|busy/);
 assert.match(html,/if\(amount!==null&&catalogueQuestionHasUnavailableProduct\)/);
 assert.match(html,/controller\?\.signal\.aborted\?'NETWORK_TIMEOUT':'NETWORK_ERROR'/);
});
