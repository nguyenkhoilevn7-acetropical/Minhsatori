import assert from 'node:assert/strict';
import {preflightCheckout} from '../checkout-preflight.mjs';
const catalog=[
 {code:'TP-00003',name:'Satori 500ml',unit:'Thùng',listPrice:98000},
 {code:'TP-00056',name:'Satori Juice mãng cầu',unit:'Thùng',listPrice:333333},
 {code:'TP-00081',name:'Hikari 500ml',unit:'Thùng',listPrice:110000}
];
const customer={verifiedByServer:true,profileId:'internal-verified-customer',
 sourceReference:{id:1275,invoiceNo:222},
 name:'Khách TEST',phone:'0900000000',location:'123 Đường TEST, HCM',
 approvedDiscountPercent:20};
const lines=[{code:'TP-00003',qty:2},{code:'TP-00056',qty:3}];
const goods=Math.round(98000*.8)*2+Math.round(333333*.8)*3,vat=Math.round(goods*.08);
const base={revision:105,requestId:'test_idempotency_0001',customer,source:catalog,
 lines,expectedTotal:goods+vat+15000,shippingAmount:15000,vatRate:8,confirmedByCustomer:true};
let n=0;const ok=(v,label)=>{assert.ok(v,label);n++};
const valid=preflightCheckout(base);
ok(valid.action==='orders.create','verified create action');
ok(valid.payload.expectedRevision===105&&valid.payload.requestId===base.requestId,'exact source version and stable request ID');
ok(valid.payload.customerRef.id===1275&&valid.payload.customerRef.invoiceNo===222,'customer linked to specific source invoice/delivery point');
ok(valid.payload.order.items.length===2&&valid.payload.order.items[1].code==='TP-00056','multiple SKU lines remain in one payload');
ok(valid.payload.order.items[1].unitPrice===Math.round(333333*.8),'server-owned discount, no client-set price');
ok(valid.payload.order.total===goods+vat+15000,'VAT, freight and grand total recomputed');
ok(valid.preview.totalUnits===5&&valid.preview.sourceRevision===105,'screen preview tied to source revision');
for(const [change,err] of [
 [{confirmedByCustomer:false},'CONFIRMATION_REQUIRED'],
 [{revision:0},'SOURCE_REVISION_REQUIRED'],
 [{requestId:'bad'},'INVALID_REQUEST_ID'],
 [{customer:{...customer,verifiedByServer:false}},'CUSTOMER_NOT_VERIFIED'],
 [{customer:{...customer,sourceReference:{id:1275}}},'CUSTOMER_NOT_VERIFIED'],
 [{customer:{...customer,approvedDiscountPercent:71}},'CUSTOMER_DISCOUNT_UNVERIFIED'],
 [{vatRate:7},'VAT_POLICY_REQUIRED'],
 [{shippingAmount:-1},'INVALID_SHIPPING'],
 [{expectedTotal:goods+vat+15001},'QUOTE_STALE_OR_MISMATCH'],
 [{lines:[{code:'TP-00003',qty:1},{code:'TP-00003',qty:1}]},'INVALID_LINE'],
 [{lines:[{code:'TP-99999',qty:1}]},'UNKNOWN_SOURCE_PRODUCT'],
 [{lines:[{code:'TP-00003',qty:501}]},'INVALID_LINE'],
 [{lines:[]},'ITEM_COUNT_INVALID'],
 [{source:[]},'SOURCE_CATALOGUE_REQUIRED'],
 [{source:[catalog[0],catalog[0]]},'SOURCE_CATALOGUE_INVALID']
 ]){
 assert.throws(()=>preflightCheckout({...base,...change}),(e)=>e.code===err,err);n++;
}
ok(!JSON.stringify(valid).includes('HMAC')&&!JSON.stringify(valid).includes('secret'),'no HMAC secret or transport sent in payload');
console.log('PASS '+n+'/'+n+' verified-customer source-priced checkout preflight checks — NO production writes');
