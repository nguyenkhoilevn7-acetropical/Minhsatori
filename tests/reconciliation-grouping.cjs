const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
require('../accounting-core.js');const C=global.SatoriAccountingCore;
const html=fs.readFileSync(__dirname+'/../index.html','utf8');const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(x=>!x[1].includes('src=')&&!/application\/ld\+json|application\/json/.test(x[1]));for(const s of scripts)new vm.Script(s[2]);
const ctx={window:{addEventListener:()=>{}},SatoriAccountingCore:C};vm.runInNewContext(scripts.find(x=>x[1].includes('satori-reconciliation'))[2],ctx);const E=ctx.window.SatoriRecon.engine;
const opts={from:'1900-01-01',to:'2100-12-31',tax:0,customerFilter:'',documentAmount:false};
const row=(invoice,ref,product,amount,extra={})=>({invoice,ref,product,amount,qty:2,unit:'thung',customer:'khach',address:'377 Nguyen Duy Trinh',date:'2026-10-16',row:1,...extra});
const input=[row('B-1','O-1','water350',100),row('B-1','O-2','water500',200,{row:2,address:'377 Nguyễn Duy Trinh, P Bình Trưng Tây'}),row('B-2','O-3','water',300,{row:3}),row('','O-2','water20',50,{row:4})];
let g=E.autoDocuments(input,[],opts,null).companies;assert.equal(g.length,2);assert.equal(g[0].rows.length,3);assert.equal(g[0].amount,350);assert.equal(g[0].qty,6);assert.equal(g[0].invoices[0],'B-1');assert.equal(g[0].refs.length,2);assert.match(g[0].address,/Nguyễn/);
assert.equal(C.groupCompanyRows([row('A','','x',1),row('','A','x',1)]).length,2,'invoice/order namespaces');
assert.equal(C.groupCompanyRows([row('','','x',1),row('','','x',1)]).length,2,'missing IDs cannot group by address');
assert.equal(C.groupCompanyRows([row('001','','x',1),row('1','','x',1)]).length,2,'preserve leading zeros');
assert.equal(C.groupCompanyRows([row(' b-1 ','','x',1),row('B-1','','y',2)]).length,1,'case/space normalized');
assert.equal(C.groupCompanyRows([row('A','X','a',1),row('B','Y','b',2),row('A','Y','c',3)]).length,1,'transitive same-bill/order consolidation');
const repeated=[row('A','X','x',500),row('A','X','y',500,{row:2})];g=E.autoDocuments(repeated,[],{...opts,documentAmount:true},null).companies;assert.equal(g[0].amount,500,'whole bill total counted once');
g=E.autoDocuments([row('A','X','x',500),row('B','X','y',600,{row:2})],[],{...opts,documentAmount:true},null).companies;assert.equal(g[0].amount,1100,'different bill totals in same order counted once each');
g=E.autoDocuments([row('A','X','x',500),row('A','X','y',600,{row:2})],[],{...opts,documentAmount:true},null).companies;assert.equal(g[0].amount,null,'conflicting repeated total not guessed');
g=E.autoDocuments([row('A','X','x',500),row('A','X','x',500,{row:2})],[],opts,null).companies;assert.equal(g[0].amount,null,'exact duplicate row not silently double-counted');
const locals=[{invoice:5901,ref:'O-1',address:'377 nguyen duy trinh',rows:[{invoice:5901}],amount:350}];g=E.autoDocuments(input,[],opts,null).companies;
const report=C.identityMatch(g,locals);assert.equal(report[0].category,'matched');assert.equal(report[0].company.length,3);assert.equal(report[0].delta,0);assert.match(report[0].detail,/Đã gom 3 dòng/);
const ledger=[['Số chứng từ','TK đối ứng','Phát sinh','','Số dư','Đơn đặt hàng','Ngày chứng từ','Số hóa đơn','Tên khách hàng','Diễn giải chung'],['','','Nợ','Có'],['D1','511',100,0,'','O1','16/10/2026','BILL1','K','K giao 16/10; địa chỉ: 377 Nguyễn Duy Trinh'],['D2','511',200,0,'','O2','16/10/2026','BILL1','K','K giao 16/10; địa chỉ: 377 Nguyễn Duy Trinh'],['D2','3331',30,0,'','O2','16/10/2026','BILL1','K','K giao 16/10; địa chỉ: 377 Nguyễn Duy Trinh'],['P1','112',0,330,'','','16/10/2026','','K','Thanh toán'],['Tổng cộng','',330,330,0]];
const l=E.parseLedger(ledger);assert.equal(l.groups.length,1);assert.equal(l.groups[0].net,300);assert.equal(l.groups[0].vat,30);assert.equal(l.payments,330);assert.equal(l.groups[0].entries.length,3);
g=E.autoDocuments([],[],{...opts,tax:10},l).companies;assert.equal(g.length,1);assert.equal(g[0].amount,330);assert.equal(g[0].rows.reduce((s,r)=>s+r.amount,0),330);assert.equal(g[0].invoice,'BILL1');
console.log('PASS: source syntax; invoice/order consolidation; multi-product totals; missing IDs; identifier namespaces; transitive grouping; duplicate/whole bill totals; one grouped match; ledger VAT and payment exclusion');
(async()=>{
 const nodes=new Map();function node(id){if(!nodes.has(id))nodes.set(id,{value:({'rc-sheet':'0','rc-header':'1','rc-match':'auto','rc-from':'2026-01-01','rc-to':'2026-12-31','rc-tolerance':'0','rc-tax':'0','rc-locale':'vi','rc-amount-mode':'line'}[id]||''),style:{},innerHTML:'',textContent:'',hidden:false,after(n){nodes.set(n.id,n);},remove(){nodes.delete(id);}});return nodes.get(id);}
 const fixture=[['Số hóa đơn','Mã đặt hàng','Địa chỉ','Tên sản phẩm','Số lượng','ĐVT','Thành tiền'],['BILL-X','ORDER-1','377 Nguyễn Duy Trinh','350ml',2,'Thùng',100],['BILL-X','ORDER-2','377 Nguyen Duy Trinh','500ml',3,'Thùng',200]];
 const ws={rows:fixture};
 const X={read:()=>({SheetNames:['Data'],Sheets:{Data:ws}}),utils:{sheet_to_json:s=>s.rows.map(r=>[...r])}};
 const c={window:{addEventListener:()=>{},XLSX:X},document:{getElementById:node,createElement:()=>({})},orders:[],catalogue:[],SatoriAccountingCore:C};vm.runInNewContext(scripts.find(x=>x[1].includes('satori-reconciliation'))[2],c);
 await c.window.SatoriRecon.upload({files:[{name:'fixture.xlsx',size:100,arrayBuffer:async()=>new ArrayBuffer(0)}]});
 let r=c.window.__SATORI_RECON_REPORT__;assert(r,node('rc-error').textContent);assert.equal(r.grouping.bills,1);assert.equal(r.rows[0].companyAmount,300);assert.equal(r.rows[0].source.invoice,'BILL-X');assert.equal(r.rows[0].source.refs.length,2);assert.match(node('rc-identity-results').innerHTML,/Xem 2 dòng gốc/);
 // True merged invoice and amount cells are expanded, then whole-bill money counted once.
 ws.rows=[fixture[0],['BILL-Y','ORDER-1','377 Nguyen Duy Trinh','350ml',2,'Thùng',500],['','ORDER-2','','500ml',3,'Thùng','']];ws['!merges']=[{s:{r:1,c:0},e:{r:2,c:0}},{s:{r:1,c:6},e:{r:2,c:6}}];
 await c.window.SatoriRecon.upload({files:[{name:'merged.xlsx',size:100,arrayBuffer:async()=>new ArrayBuffer(0)}]});r=c.window.__SATORI_RECON_REPORT__;assert(r,node('rc-error').textContent);assert.equal(r.grouping.bills,1);assert.equal(r.rows[0].companyAmount,500);assert.equal(r.rows[0].company.length,2);
 console.log('PASS: complete upload→header mapping→group→match→render flow, automatic merged-cell bill IDs and whole-bill total detection');
})().catch(e=>{console.error(e);process.exitCode=1;});
