import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {selectLatestReorderSuggestion} from '../reorder-suggestion.mjs';

const catalog=[
 {code:'TP-00001',name:'Nước Satori 350ml',unit:'thùng',active:true},
 {code:'TP-00003',name:'Nước Satori 500ml',unit:'Thùng',active:true},
 {code:'TP-00058',name:'Nước ép ổi hồng',unit:'thùng',active:true}
];
const order=(invoiceNo,orderedAt='2026-10-30T08:30:00.000Z')=>({
 state:'COMMITTED',invoiceNo,ledgerId:'ledger-'+invoiceNo,orderedAt
});
const ledger=(invoiceNo,items,extra={})=>({
 invoiceNo,id:'ledger-'+invoiceNo,status:'Chưa thanh toán',excluded:false,
 items,...extra
});
const index=(...invoices)=>new Map(invoices.map(x=>[x.invoiceNo+'|'+x.id,x]));

test('suggests every product and exact qty from the latest CURRENT invoice, not old quote prices',()=>{
 const result=selectLatestReorderSuggestion([order(5935)],
  index(ledger(5935,[{code:'TP-00058',qty:3,unit:'Thùng',unitPrice:78000},
   {code:'TP-00003',qty:10,unit:'thùng',unitPrice:96000}])),catalog);
 assert.deepEqual(result,{
  orderedAt:'2026-10-30T08:30:00.000Z',
  items:[{code:'TP-00058',qty:3,name:'Nước ép ổi hồng',unit:'thùng'},
   {code:'TP-00003',qty:10,name:'Nước Satori 500ml',unit:'Thùng'}]
 });
 assert.equal(JSON.stringify(result).includes('unitPrice'),false);
});

test('cancelled, excluded, missing and malformed newer bills cannot be suggested',()=>{
 const valid=ledger(500,[{code:'TP-00001',qty:2,unit:'thùng'}]);
 for(const invalid of [
  ledger(501,[{code:'TP-00003',qty:5,unit:'thùng'}],{status:'Đã hủy'}),
  ledger(501,[{code:'TP-00003',qty:5,unit:'thùng'}],{status:'Không Tính',excluded:true}),
  ledger(501,[{code:'TP-00003',qty:5,unit:'thùng'}],{missing:true}),
  ledger(501,[{code:'TP-99999',qty:5,unit:'thùng'}]),
  ledger(501,[{code:'TP-00003',qty:0,unit:'thùng'}]),
  ledger(501,[{code:'TP-00003',qty:7,unit:'chai'}]),
  ledger(501,[{code:'TP-00003',qty:501,unit:'thùng'}])
 ]){
  assert.deepEqual(selectLatestReorderSuggestion([order(501),order(500)],
   index(invalid,valid),catalog)?.items,[{code:'TP-00001',qty:2,name:'Nước Satori 350ml',unit:'thùng'}]);
 }
});

test('unknown or inactive products fail closed instead of generating partial reorder',()=>{
 const unavailable=[...catalog,{code:'TP-00059',name:'Old SKU',unit:'thùng',active:false}];
 const current=index(ledger(505,[{code:'TP-00058',qty:1,unit:'thùng'},
  {code:'TP-00059',qty:3,unit:'thùng'}]));
 assert.equal(selectLatestReorderSuggestion([order(505)],current,unavailable),null);
 assert.equal(selectLatestReorderSuggestion([order(505)],new Map(),catalog),null);
});

test('multiple canonical lines of same SKU are aggregated and bounded',()=>{
 const c=index(ledger(506,[{code:'TP-00003',qty:2,unit:'thùng'},
  {code:'TP-00003',qty:5,unit:'Thùng'}]));
 assert.deepEqual(selectLatestReorderSuggestion([order(506)],c,catalog)?.items,
  [{code:'TP-00003',qty:7,name:'Nước Satori 500ml',unit:'Thùng'}]);
 const excessive=index(ledger(506,[{code:'TP-00003',qty:300,unit:'Thùng'},
  {code:'TP-00058',qty:201,unit:'thùng'}]));
 assert.equal(selectLatestReorderSuggestion([order(506)],excessive,catalog),null);
});

test('server binds suggestion to authenticated actor, owned profile, selected address, canonical ledger',()=>{
 const router=fs.readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const first=router.indexOf("if(pathname==='/api/v2/reorder-suggestion'");
 const last=router.indexOf("if(pathname==='/api/v2/orders'&&req.method==='GET')",first);
 assert.ok(first>router.indexOf('const actor=await auth(req,pool)')&&last>first);
 const api=router.slice(first,last);
 assert.match(api,/profileFor\(pool,actor,profileId\)/);
 assert.match(api,/id=\$1 AND profile_id=\$2 AND active=true/);
 assert.match(api,/r\.account_id=\$1 AND q\.account_id=\$1 AND q\.profile_id=\$2 AND q\.address_id=\$3/);
 assert.match(api,/r\.state='COMMITTED'/);
 assert.match(api,/readExactCurrentInvoices\(refs\)/);
 assert.doesNotMatch(api,/UPDATE |INSERT |DELETE |\/api\/v2\/confirm/);
});

test('chat offers an explicit optional cart draft and never auto submits an invoice',()=>{
 const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
 const a=html.indexOf('async function suggestReorderForSelectedAddress()');
 const b=html.indexOf('const GEMINI_TYPING_MIN_MS',a);
 assert.ok(a>0&&b>a);
 const ui=html.slice(a,b);
 assert.match(ui,/selectedDeliveryAddress\(\)/);
 assert.match(ui,/Đặt lại đơn này/);
 assert.match(ui,/Không cần/);
 assert.match(ui,/await saveCart\(lines\)/);
 assert.match(ui,/view\('cart'\)/);
 assert.match(ui,/reorderSuggestionEpoch/);
 assert.doesNotMatch(ui,/\/api\/v2\/confirm|\/api\/v2\/test-orders|submitTestOrder.*click/);
 assert.match(html,/void suggestReorderForSelectedAddress\(\)/);
});
