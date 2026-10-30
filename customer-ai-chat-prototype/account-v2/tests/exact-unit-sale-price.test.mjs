import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {discountFromUnitPrice,unitPriceFromDiscount,validateExactUnitPrice} from '../unit-sale-price.mjs';
import {calculateQuote} from '../domain.mjs';

const profileId='11111111-1111-4111-8111-111111111111',
 accountId='22222222-2222-4222-8222-222222222222',
 addressId='33333333-3333-4333-8333-333333333333',
 policyId='44444444-4444-4444-8444-444444444444';
const product={code:'TP-00003',name:'Satori 350ml',unit:'Thùng',listPrice:88000,active:true};
function quote(policy={},type='retail'){
 return calculateQuote({
  accountId,profile:{id:profileId,accountId,type},
  address:{id:addressId,profileId,active:true,label:'Nhà',
   recipientName:'Thử nghiệm',recipientPhone:'0900123456',address:'1 Đường Mẫu, TP.HCM'},
  catalogue:[product],cart:[{code:product.code,qty:10}],
  policies:[{id:policyId,profileId,addressId:null,productCode:product.code,enabled:true,
   discountBps:2614,version:1,invoiceMode:'single',...policy}],
  catalogueRevision:9
 });
}
test('88000 VND list -> 65000 exact selling price displays 26.14% (and back rounds 64997)',()=>{
 assert.equal(discountFromUnitPrice(88000,65000),2614);
 assert.equal(unitPriceFromDiscount(88000,2614),64997);
 assert.equal(validateExactUnitPrice(88000,65000,2614),65000);
 assert.throws(()=>validateExactUnitPrice(88000,65000,2615),/SALE_PRICE_RATE_MISMATCH/);
});
test('only a product-specific audited unit sale override produces the EXACT bill total',()=>{
 const exact=quote({unitPriceVnd:'65000'});
 assert.equal(exact.items[0].unitPrice,65000);
 assert.equal(exact.items[0].discountBps,2614);
 assert.equal(exact.items[0].lineTotal,650000);
 assert.equal(exact.totalVnd,650000);
 assert.equal(quote({}).totalVnd,649970);
 assert.throws(()=>quote({unitPriceVnd:'67000'}),/EXACT_PRICE_RATE_STALE/);
 assert.throws(()=>quote({unitPriceVnd:'88001'}),/EXACT_PRICE_INVALID/);
 assert.throws(()=>quote({productCode:null,unitPriceVnd:'65000'}),/EXACT_PRICE_SKU_REQUIRED|POLICY_/);
});
test('CTV internal reference retains its approved CTV rate; one customer invoice',()=>{
 const quoted=quote({unitPriceVnd:'65000',collaboratorBps:3500},'collaborator');
 assert.equal(quoted.invoiceMode,'single');
 assert.equal(quoted.items[0].unitPrice,65000);
 assert.equal(quoted.items[0].internalUnitPrice,57200);
 assert.equal(quoted.collaboratorMarginVnd,78000);
 assert.throws(()=>quote({unitPriceVnd:'65000',collaboratorBps:2000},'collaborator'),/CTV_RATE_INVALID/);
});
test('UI has SKU-specific unit sale price and two-way conversion, separate from global discount',()=>{
 const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1]||'';
 for(const key of ['function ownerUnitSalePriceEditor(account,role)','Đơn giá bán / ',
  'Chiết khấu sản phẩm (%)','Đơn giá bán theo sản phẩm','Lưu đơn giá bán',
  '/api/v2/admin/policies','unitPriceVnd:vnd','editMode===\'price\'',
  'knownProducts.filter','Math.round((p.listPrice-saleVnd())*10000/p.listPrice)',
  'ownerUnitSalePriceEditor(account,role)']){
  assert.ok(script.includes(key),key);
 }
 assert.match(script,/const customer=rateField\('Chiết khấu khách hàng \(%\)'/);
 assert.match(html,/\.crm-product-price-grid\{display:grid/);
 assert.doesNotThrow(()=>new vm.Script(script));
});
test('server persists exact price in immutable audit and retrieves it for quote/recheck',()=>{
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const domain=readFileSync(new URL('../domain.mjs',import.meta.url),'utf8');
 assert.match(router,/UNIT_PRICE_SKU_SCOPE_REQUIRED/);
 assert.match(router,/validateExactUnitPrice\(Number\(sku\.rows\[0\]\.listPrice\),input\.unitPriceVnd,input\.discountBps\)/);
 assert.match(router,/unitPriceVnd:input\.unitPriceVnd/);
 assert.equal((router.match(/aux\.resource_id=satori_v2_policies\.id/g)||[]).length,4);
 assert.equal((router.match(/unitPriceVnd",/g)||[]).length,4);
 assert.match(domain,/const unitPrice=exactPrice\?\?percentPrice/);
 assert.match(domain,/ensure\(internalUnitPrice===null\|\|unitPrice>=internalUnitPrice,'CTV_MARGIN_NEGATIVE'\)/);
 assert.doesNotThrow(()=>new vm.Script(router.replace(/^(?:import|export)\s[^\n]*\n/gm,'')));
});
