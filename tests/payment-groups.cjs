const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
require('../accounting-core.js');const C=global.SatoriAccountingCore;
const initial=[{id:1,invoiceNo:11,name:'Khách A',phone:'0901 234 567',customerCode:'KH001',date:'01/10/2026',status:'Chưa thanh toán',total:100},{id:1,invoiceNo:12,name:'Khách A',date:'02/10/2026',status:'Đã thanh toán',total:200},{id:3,invoiceNo:13,name:'Khách B',date:'03/10/2026',status:'Chưa thanh toán',total:300},{id:4,invoiceNo:14,status:'Đã hủy'}];
const keys=initial.slice(0,2).map(C.key),at='2026-10-17T15:45:00.000Z',receipt={id:'receipt-group-1',name:'Thanh toan',mime:'image/jpeg',data:'data:image/jpeg;base64,dGVzdA==',uploadedAt:at};
let next=C.paymentGroup(initial,keys,{id:'group-1',target:'satori',receipt,at});assert.equal(next[0].status,'Đã TT Satori');assert(!C.paid(next[0]));assert(C.paid(next[1]));assert.equal(next[2],initial[2]);assert.equal(next.filter(o=>o.paymentReceipts?.[0].data).length,1);assert.equal(C.resolveReceipt(next[1].paymentReceipts[0],next).data,receipt.data);assert.equal(JSON.stringify(initial).includes('group-1'),false);
next=C.paymentGroup(next,keys,{id:'group-2',target:'customer',at});assert.equal(next[0].status,'Đã TT Satori');assert(C.paid(next[0]));assert.equal(next[0].satoriPaidAt,at);
const moved=C.preserveReceiptAssets(next.slice(1),next);assert.equal(C.resolveReceipt(moved[0].paymentReceipts[0],moved).data,receipt.data);assert.equal(moved.filter(o=>o.paymentReceipts?.some(r=>r.data)).length,1);
assert.throws(()=>C.paymentGroup(initial,[keys[0],'missing'],{id:'g',target:'customer',at}));assert.throws(()=>C.paymentGroup(initial,[C.key(initial[3])],{id:'g',target:'customer',at}));assert.throws(()=>C.paymentGroup(initial,[keys[0]],{id:'g',target:'customer',markPaid:false,receipt,at}));assert(C.customerMatches(initial[0],'khach a'));assert(C.customerMatches(initial[0],'KH001'));assert(C.customerMatches(initial[0],'0901234567'));
const sameIds=C.paymentGroup(initial,[keys[1]],{id:'one',target:'satori',at});assert.equal(sameIds[0],initial[0]);assert.equal(sameIds[1].status,'Đã TT Satori');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');for(const x of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!x[1].includes('src=')&&!/application\/json|application\/ld\+json/.test(x[1]))new vm.Script(x[2]);
const app=fs.readFileSync(__dirname+'/../accounting.js','utf8');new vm.Script(app);new vm.Script(fs.readFileSync(__dirname+'/../accounting-workbook.js','utf8'));
function harness(){
 const nodes=new Map(),data=new Map([['orders',JSON.stringify(initial)]]);let writes=0,fail=false,checkboxes=[],form,pendingReader;
 const basic=()=>({value:'',textContent:'',style:{},isConnected:true,disabled:false,files:[],checked:false,setAttribute(){},addEventListener(){},removeEventListener(){},focus(){},remove(){for(const k of [...nodes.keys()])if(k.startsWith('acct-bulk'))nodes.delete(k);}});
 for(const [id,value] of Object.entries({searchInput:'',filterStatus:'all',excelFilterCustomer:'all',excelFilterCustomerName:'KH001',excelFilterFromDate:'2026-10-01',excelFilterToDate:'2026-10-31'}))nodes.set(id,{...basic(),value});
 const c={FileReader:class {readAsDataURL(){pendingReader=this;}},URL,window:{addEventListener:()=>{}},SatoriAccountingCore:C,orders:structuredClone(initial),STORAGE_KEY:'orders',aiEscape:v=>String(v??''),renderTable:()=>{},editOrder:()=>{},updateStatus:()=>{},exportToExcel:()=>{},renderArchiveInvoices:()=>{},updateCounters:()=>{},getOrderProfit:()=>0,crypto:{randomUUID:()=> 'test-group'},catalogue:[],document:{activeElement:null,documentElement:{style:{}},body:{style:{},appendChild(n){nodes.set(n.id,n);c.showModal('',n.innerHTML);}},getElementById:id=>nodes.get(id),createElement:basic},localStorage:{get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)||null,setItem(k,v){if(fail)throw Error('quota');writes++;data.set(k,v);}},matchOrderUniversal:(o,q)=>C.customerMatches(o,q),isOrderInDateRange:(date,from,to)=>{const [d,m,y]=date.split('/');const t=`${y}-${m}-${d}`;return (!from||t>=from)&&(!to||t<=to);},getTrashBinOrders:()=>[],closeModal:()=>{nodes.delete('acct-bulk-form');},showModal:(title,content)=>{
  if(!content.includes('id="acct-bulk-form"'))return;
  for(const id of ['acct-bulk-form','acct-bulk-all','acct-bulk-total','acct-bulk-party','acct-bulk-paid','acct-bulk-file','acct-bulk-link','acct-bulk-progress','acct-bulk-save','acct-bulk-close'])nodes.set(id,basic());
  checkboxes=[...content.matchAll(/data-bulk-key="([^"]+)"/g)].map(m=>({checked:true,dataset:{bulkKey:m[1]}}));form=nodes.get('acct-bulk-form');form.querySelectorAll=()=>checkboxes;form.addEventListener=(type,f)=>form.submit=f;nodes.get('acct-bulk-party').value='customer';nodes.get('acct-bulk-paid').checked=true;
 }};vm.createContext(c);vm.runInContext(app,c);return {c,nodes,data,get form(){return form;},get writes(){return writes;},quota:()=>fail=true,get reader(){return pendingReader;}};
}
(async()=>{
 const h=harness();assert.equal(h.c.window.Acct.filteredOrders().length,1,'same customer code/date filter');h.c.window.Acct.bulkForm();h.nodes.get('acct-bulk-link').value='https://drive.google.com/file/d/test/view';await h.form.submit({preventDefault(){}});assert.equal(h.writes,1,'one atomic save');assert.equal(h.c.orders[0].status,'Đã thanh toán');assert.equal(h.c.orders[2].status,'Chưa thanh toán');assert.equal(h.c.orders[0].paymentReceipts.length,1);
 const q=harness();q.c.window.Acct.bulkForm();q.quota();await q.form.submit({preventDefault(){}});assert.equal(q.writes,0);assert.equal(q.c.orders[0].status,'Chưa thanh toán');assert.match(q.nodes.get('acct-bulk-progress').textContent,/quota/);
 const bad=harness();bad.c.window.Acct.bulkForm();bad.nodes.get('acct-bulk-link').value='https://evil.example/a';await bad.form.submit({preventDefault(){}});assert.equal(bad.writes,0);assert.equal(bad.c.orders[0].status,'Chưa thanh toán');
 const frozen=harness();frozen.nodes.get('excelFilterCustomerName').value='khach a';frozen.c.window.Acct.bulkForm();frozen.nodes.get('excelFilterCustomerName').value='khach b';await frozen.form.submit({preventDefault(){}});assert.equal(frozen.c.orders[0].status,'Đã thanh toán');assert.equal(frozen.c.orders[2].status,'Chưa thanh toán','changing filters must not change captured group');
 const stale=harness();stale.c.window.Acct.bulkForm();stale.nodes.get('acct-bulk-file').files=[{name:'proof.pdf',type:'application/pdf',size:100,slice:()=>({text:async()=>'%PDF-'})}];const pending=stale.form.submit({preventDefault(){}});for(let i=0;i<5;i++)await Promise.resolve();assert(stale.reader);stale.c.orders[0]={...stale.c.orders[0],total:999};stale.reader.result='data:application/pdf;base64,dGVzdA==';stale.reader.onload();await pending;assert.equal(stale.writes,0);assert.match(stale.nodes.get('acct-bulk-progress').textContent,/thay đổi/);
 const cancel=harness();cancel.c.window.Acct.bulkForm();cancel.nodes.get('acct-bulk-file').files=[{name:'proof.pdf',type:'application/pdf',size:100,slice:()=>({text:async()=>'%PDF-'})}];const cancelled=cancel.form.submit({preventDefault(){}});for(let i=0;i<5;i++)await Promise.resolve();cancel.c.window.Acct.cancelBulk();cancel.reader.result='data:application/pdf;base64,dGVzdA==';cancel.reader.onload();await cancelled;assert.equal(cancel.writes,0,'closing the dedicated dialog cancels pending uploads');assert.equal(cancel.nodes.has('acct-bulk-dialog'),false);
  const proof=harness(),paidKey=C.key(proof.c.orders[0]);
 proof.c.window.Acct.status(paidKey,'Đã TT Satori');
 const satoriProof=proof.c.orders[0].satoriPaidAt;
 assert.ok(satoriProof,'Satori payment receives independent proof');
 assert.equal(C.paid(proof.c.orders[0]),false,'Satori payment does not imply customer payment');
 proof.c.window.Acct.status(paidKey,'Đã thanh toán');
 assert.ok(C.paid(proof.c.orders[0]),'Customer payment can be independently recorded');
 assert.equal(proof.c.orders[0].satoriPaidAt,satoriProof,
  'Customer payment must not erase Satori payment receipt');
 proof.c.window.Acct.status(paidKey,'Chưa thanh toán');
 assert.equal(C.paid(proof.c.orders[0]),false);
 assert.equal(proof.c.orders[0].satoriPaidAt,satoriProof,
  'Undoing customer payment must preserve independent Satori payment');
 proof.nodes.set('paymentStatus',{value:'Đã thanh toán'});
 assert.equal(proof.c.window.Acct.paymentMeta(proof.c.orders[0]).satoriPaidAt,satoriProof,
  'Editing an old invoice must not erase Satori payment proof');
 console.log('PASS: stable-key grouping, independent customer/Satori payment, single receipt storage and resolution, deletion promotion, invalid/cancelled IDs, customer-code/phone/date filtering, complete group form save, atomic quota failure and invalid-link rejection, all scripts syntax');
})().catch(e=>{console.error(e);process.exitCode=1;});

