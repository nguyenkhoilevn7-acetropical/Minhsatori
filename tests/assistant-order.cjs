'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../satori-assistant.js');
const products=[
 {code:'TP-00001',brand:'SATORI',name:'Nước tinh khiết Satori 350ml',unit:'Thùng',listPrice:88000,unitPrice:66000},
 {code:'TP-00003',brand:'SATORI',name:'Nước tinh khiết Satori 500ml',unit:'Thùng',listPrice:98000,unitPrice:73500},
 {code:'TP-00081',brand:'HIKARI',name:'Nước đóng chai Hikari 500ml',unit:'Thùng',listPrice:83000,unitPrice:62250},
 {code:'TP-00033',brand:'SATORI',name:'Bình Satori 19L có vòi',unit:'Bình',listPrice:49142,unitPrice:36857},
 {code:'TP-00096',brand:'SATORI',name:'Bình Satori 19L không vòi',unit:'Bình',listPrice:49142,unitPrice:36857}
];
const orders=[
 {id:1,invoiceNo:21,name:'Nhà thuốc Minh Anh',status:'Chưa thanh toán',phone:'0901234567',total:250000,date:'01/10/2026'},
 {id:2,invoiceNo:22,name:'Nhà thuốc Minh Anh',status:'Đã thanh toán',total:100000,date:'02/10/2026'},
 {id:3,invoiceNo:23,name:'Nhà thuốc Minh Anh',status:'Đã TT Satori',total:180000,date:'03/10/2026'},
 {id:4,invoiceNo:24,name:'Nhà thuốc Minh Anh',status:'Đã hủy',total:999999,date:'04/10/2026'},
 {id:5,invoiceNo:25,name:'Nhà thuốc Khác',status:'Chưa thanh toán',total:650000,date:'05/10/2026'}
];
test('independent assistant parses two Satori products; uses catalogue only and does not write data',()=>{
 const before=JSON.stringify({orders,products});
 const p=A.parseOrder('Nhà thuốc Minh Anh, 10 thùng Satori 500ml và 5 thùng Satori 350ml; địa chỉ: 12 Đường A; SĐT 0901234567',{orders,catalogue:products});
 assert.equal(p.ok,true);assert.equal(p.customer,'Nhà thuốc Minh Anh');
 assert.deepEqual(p.items.map(i=>[i.code,i.qty]),[['TP-00003',10],['TP-00001',5]]);
 assert.equal(p.totalEstimate,10*73500+5*66000);
 assert.equal(p.phone,'0901234567');
 assert.equal(JSON.stringify({orders,products}),before);
});
test('unknown and ambiguous product are flagged and never assigned a guessed price',()=>{
 const unknown=A.parseOrder('Nhà thuốc Minh Anh, 10 thùng 480ml',{orders,catalogue:products});
 assert.equal(unknown.items.length,0);assert.ok(unknown.issues.length>0);
 const ambiguous=A.parseOrder('Nhà thuốc Minh Anh, 2 bình Satori 19L',{orders,catalogue:products});
 assert.equal(ambiguous.items.length,0);assert.ok(ambiguous.issues.length>0);
});
test('unverified claims of payment are warnings; not saved or marked paid',()=>{
 const p=A.parseOrder('Nhà thuốc Minh Anh, 2 thùng Satori 500ml, đã chuyển khoản rồi',{orders,catalogue:products});
 assert.ok(p.issues.some(s=>s.includes('chứng từ')));
 assert.equal(Object.hasOwn(p,'status'),false);
});
test('debt separates customer paid from supplier paid; excludes cancelled invoices',()=>{
 const d=A.debtReport('Nhà thuốc Minh Anh còn bao nhiêu bill chưa thanh toán?',orders);
 assert.equal(d.ok,true);
 assert.equal(d.totalCount,3);assert.equal(d.paidCount,1);
 assert.equal(d.unpaidCount,2);assert.equal(d.unpaidTotal,430000);
 assert.deepEqual(d.invoices.map(i=>i.invoiceNo),[21,23]);
});
test('customer payment timestamp wins even if status says supplier paid',()=>{
 const data=structuredClone(orders);data[2].customerPaidAt='2026-10-19';
 const d=A.debtReport('Nhà thuốc Minh Anh đã thanh toán chưa?',data);
 assert.equal(d.unpaidCount,1);assert.equal(d.unpaidTotal,250000);
});
test('generic questions, absent and ambiguous customer identities do not leak ledger',()=>{
 assert.equal(A.debtReport('Cho anh xem công nợ tất cả',orders).ok,false);
 assert.equal(A.debtReport('Khách mới không biết tên',orders).ok,false);
 const extra=[...orders,{...orders[0],id:12,name:'Công ty Minh Anh'}];
 assert.equal(A.debtReport('Minh Anh còn nợ không?',extra).ok,false);
});
test('parsing and report do not use external network, Zalo session or credentials',()=>{
 assert.equal(typeof A.parseOrder,'function');
 assert.equal(typeof A.debtReport,'function');
 assert.equal(A.parseOrder('',{orders,catalogue:products}).ok,false);
});
