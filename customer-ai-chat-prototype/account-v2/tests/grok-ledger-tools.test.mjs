// Grok owner connector: read tools, debt, PDFs, fuzzy search and soft cancel.
// Synthetic data only (fake names, fake ledger, in-memory PostgreSQL stand-in).
// The fake ledger cancels through the REAL api/BotApiOrderCancel.gs logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {matchScore,norm} from '../grok-search.mjs';
import {findCustomers,GrokOrderError} from '../grok-orders.mjs';
import {debtSummary,customerDebt,debtStatementPdf,invoicePdf,ordersList,orderGet,productsSearch,trashList,
 toCents,fromCents,resolveRange,handleGrokFileHttp,addDays,vnToday} from '../grok-ledger-read.mjs';
import {requestWrite,confirmWrite,createOwnerWriteRelay} from '../grok-owner-writes.mjs';
const requestCancel=(pool,reader,args,env)=>requestWrite('cancel',pool,reader,args,env);
const confirmCancel=(pool,reader,rf,args,env)=>confirmWrite('cancel',pool,reader,rf,args,env);
import {signFileLink,verifyFileToken} from '../grok-files.mjs';
import {grokToolList,handleGrokRpc} from '../grok-mcp.mjs';
import {renderDebtStatementPdf,debtStatementDefinition} from '../grok-debt-pdf.mjs';

const require=createRequire(import.meta.url);
const HERE=path.dirname(fileURLToPath(import.meta.url));
// The Docker image copies only customer-ai-chat-prototype/: the Apps Script
// source lives in api/ and is exercised in CI (repository checkout) only.
const GAS=path.join(HERE,'..','..','..','api','BotApiOrderCancel.gs');
const SatoriOrderCancel=fs.existsSync(GAS)?require(GAS):null;
const needsGas=SatoriOrderCancel?{}:{skip:'api/BotApiOrderCancel.gs not in this image (runs in CI)'};
const NOW=Date.parse('2026-11-15T05:00:00Z'); // 12:00 Asia/Ho_Chi_Minh
const TODAY=vnToday(NOW);
const ddmm=iso=>iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4);
const day=n=>ddmm(addDays(TODAY,-n));
const ENV={GROK_OWNER_WRITES_ENABLED:'1',SATORI_GROK_MCP_ENABLED:'1',SATORI_GROK_MCP_TOKEN:'t'.repeat(48)};

/* ---------- fake ledger with BotApi semantics ---------- */
const iso=d=>{const m=String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);return m?m[3]+'-'+m[2]+'-'+m[1]:''};
const active=o=>!['Đã hủy','Không Tính'].includes(o.status);
const paid=o=>active(o)&&(o.status==='Đã thanh toán'||!!o.customerPaidAt);
const visible=o=>({...o,customerPaid:paid(o),satoriPaid:active(o)&&(o.status==='Đã TT Satori'||!!o.satoriPaidAt)});
function makeLedger(rows){
 const s={revision:7,values:{}};const trash=[];
 const calls=[];
 const select=p=>rows.filter(o=>{
  const q=norm(p.query||''),dg=String(p.query||'').replace(/\D/g,'');
  if(q&&![o.name,o.phone,o.invoiceNo].some(v=>norm(v).includes(q))&&!(dg.length>=5&&String(o.phone||'').replace(/\D/g,'').includes(dg)))return false;
  const d=iso(o.date);if((p.from||p.to)&&(!d||(p.from&&d<p.from)||(p.to&&d>p.to)))return false;
  return true;
 });
 const reader=async(action,p={})=>{
  calls.push(action);
  if(action==='system.status')return {revision:s.revision,data:{orders:rows.length,updatedAt:'x'}};
  if(action==='orders.list'){const f=select(p);return {revision:s.revision,data:{totalMatches:f.length,orders:f.slice(0,Math.min(100,p.limit||30)).map(visible)}}}
  if(action==='debt.summary'){
   const f=select(p).filter(o=>active(o)&&!o._secondary),owed=f.filter(o=>!paid(o));
   return {revision:s.revision,data:{orders:f.length,unpaidCount:owed.length,excludedReferenceCount:0,reviewCount:0,
    total:f.reduce((n,o)=>n+Number(o.total),0),due:owed.reduce((n,o)=>n+Number(o.total),0),
    unpaidInvoices:owed.slice(0,100).map(visible),truncated:owed.length>100}};
  }
  if(action==='trash.list'){
   const q=norm(p.query||'');
   const hits=trash.filter(t=>[t.order.invoiceNo,t.order.name,t.order.phone].some(v=>norm(v).includes(q)));
   return {revision:s.revision,data:{totalMatches:hits.length,invoices:hits.map(t=>({order:visible(t.order),deletedAt:t.deletedAt,expiresAt:t.expiresAt}))}};
  }
  if(action==='catalogue.list')return {revision:s.revision,data:{products:[
   {code:'TP-00001',name:'Nước khoáng Lavie 500ml',brand:'Lavie',spec:'thùng 24 chai',unit:'Thùng',listPrice:110000,standardUnitPrice:95000,standardDiscountPercent:13.6},
   {code:'TP-00002',name:'Trà Ô Long Giả',brand:'Giả',spec:'',unit:'Thùng',listPrice:200000,standardUnitPrice:200000}]}};
  throw Error('READ_ONLY_ACTION_DENIED');
 };
 let relayCalls=0;
 // Faithful fakes of BotApi removeOrder/recoverOrder (same guards, same trash bin shape).
 const removeOrder=p=>{
  const prev=trash.find(t=>t.apiDeleteRequestId===p.requestId);
  if(prev)return {modified:false,result:{duplicate:true,deleted:true,invoiceNo:prev.order.invoiceNo}};
  if(s.revision!==p.expectedRevision)throw Object.assign(Error(),{code:'REVISION_CONFLICT'});
  const f=rows.filter(o=>o.invoiceNo===p.invoiceNo&&String(o.id)===String(p.id));
  if(f.length!==1)throw Object.assign(Error(),{code:'INVALID_ORDER'});
  const o=f[0];
  if(o.pairGroupId)throw Object.assign(Error(),{code:'PAIRED_ORDER_LOCKED'});
  if(norm(o.name)!==norm(p.expectedName)||Number(o.total)!==p.expectedTotal)throw Object.assign(Error(),{code:'ORDER_CHANGED'});
  if(['Đã thanh toán','Đã TT Satori'].includes(o.status)||o.customerPaidAt)throw Object.assign(Error(),{code:'PAID_ORDER_PROTECTED'});
  trash.unshift({order:o,deletedAt:NOW,expiresAt:NOW+30*86400000,apiDeleteRequestId:p.requestId});
  rows.splice(rows.indexOf(o),1);
  return {modified:true,result:{deleted:true,id:o.id,invoiceNo:o.invoiceNo,restorable:true}};
 };
 const recoverOrder=p=>{
  const prev=rows.find(o=>o.apiRestoreRequestId===p.requestId);
  if(prev)return {modified:false,result:{restored:true,duplicate:true}};
  if(s.revision!==p.expectedRevision)throw Object.assign(Error(),{code:'REVISION_CONFLICT'});
  const f=trash.filter(t=>String(t.order.id)===String(p.id)&&t.order.invoiceNo===p.invoiceNo);
  if(f.length!==1)throw Object.assign(Error(),{code:'TRASH_NOT_FOUND'});
  if(rows.some(v=>String(v.id)===String(p.id)||v.invoiceNo===p.invoiceNo))throw Object.assign(Error(),{code:'RESTORE_CONFLICT'});
  const item=f[0];rows.unshift({...item.order,apiRestoreRequestId:p.requestId});trash.splice(trash.indexOf(item),1);
  return {modified:true,result:{restored:true,duplicate:false}};
 };
 const relay={send:async(action,p)=>{
  relayCalls++;
  try{
   const out=action==='orders.cancel'?SatoriOrderCancel.cancel(s,rows,p,'hmac:v2-writer',NOW):
    action==='orders.delete'?removeOrder(p):action==='orders.restore'?recoverOrder(p):null;
   if(out.modified){s.revision++;Object.assign(s.values,out.extras||{})}
   return {ok:true,action,revision:s.revision,data:out.result};
  }catch(e){const x=Error(e.code);x.code={REVISION_CONFLICT:'LEDGER_REVISION_CONFLICT',INVALID_ORDER:'TARGET_GONE',TRASH_NOT_FOUND:'TARGET_GONE'}[e.code]||e.code;throw x}
 }};
 return {s,rows,trash,reader,calls,relay,relayCalls:()=>relayCalls};
}
const R=(no,name,date,total,extra={})=>({id:'L'+no,invoiceNo:no,date,name,phone:'0900000'+String(100+name.length),
 location:'01 Đường Giả',items:[{product:'Nước Giả',qty:1,unitPrice:total}],total,status:'Chưa thanh toán',...extra});
const fixture=()=>[
 R(101,'Nguyễn Thị Hoa',day(40),500000),
 R(102,'Nguyễn Thị Hoa',day(20),300000,{status:'Đã thanh toán',customerPaidAt:'x'}),
 R(103,'Nguyễn Thị Hoa',day(10),250000),
 R(104,'Nguyễn Thị Hoa',day(5),120000,{status:'Đã hủy'}),
 R(105,'Nguyễn Thị Hoa',day(2),80000),
 R(106,'Nguyễn Thị Hoa',day(1),70000,{_secondary:true,pairGroupId:'P1'}),
 R(201,'Minh Thị Hoa',day(3),90000,{location:'02 Ấp Giả'}),
 R(202,'Minh Thị Hoa',day(3),60000,{location:'09 Khu Giả'}),
 R(301,'Đặng Văn Long',day(4),1000000),
 R(302,'Long Hải Giả',day(6),40000,{status:'Đã TT Satori',satoriPaidAt:'x'})];

/* ---------- in-memory stand-in for satori_v2_grok_cancel_requests ---------- */
function makePool(){
 const rows=new Map();const pool={now:NOW,rows};
 const T='satori_v2_grok_write_requests';
 const run=async(sql,p=[])=>{
  const t=sql.replace(/\s+/g,' ').trim();
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(t))return {rows:[]};
  if(t.startsWith('INSERT INTO '+T)){
   const exp=new Date(pool.now+p[10]*60000);
   rows.set(p[0],{id:p[0],kind:p[1],request_id:p[2],invoice_no:String(p[3]),ledger_id:p[4],expected_name:p[5],expected_total:Number(p[6]).toFixed(2),
    reason:p[7],summary:p[8],requested_by:p[9],status:'pending',expires_at:exp,updated_at:new Date(pool.now),confirmed_at:null,confirmed_by:null,last_note:null,done_at:null,ledger_revision:null});
   return {rows:[{expires_at:exp}]};
  }
  if(t.startsWith('SELECT *,expires_at<now() AS expired')){
   const r=rows.get(p[0]);
   return {rows:r?[{...r,expired:r.expires_at.getTime()<pool.now,stale:r.updated_at.getTime()<pool.now-120000}]:[]};
  }
  const r=rows.get(p[0]);
  if(t.startsWith('UPDATE '+T+" SET status='expired'")){r.status='expired';r.updated_at=new Date(pool.now);return {rows:[]}}
  if(t.startsWith('UPDATE '+T+" SET status='submitting'")){
   r.status='submitting';r.confirmed_at??=new Date(pool.now);r.confirmed_by=p[1];r.updated_at=new Date(pool.now);return {rows:[]};
  }
  if(t.startsWith('UPDATE '+T+' SET status=$2')){
   r.status=p[1];r.last_note=p[2];r.updated_at=new Date(pool.now);
   if(t.includes('done_at=coalesce'))r.done_at??=new Date(pool.now);
   const m=t.match(/ledger_revision=(\d+)/);if(m)r.ledger_revision=Number(m[1]);
   return {rows:[]};
  }
  if(t.startsWith('SELECT invoice_no FROM'))return {rows:[]};
  throw Error('UNEXPECTED_SQL '+t.slice(0,80));
 };
 pool.query=run;pool.connect=async()=>({query:run,release(){}});
 return pool;
}
const code=async f=>{try{await f();return 'NO_ERROR'}catch(e){assert.ok(e instanceof GrokOrderError,String(e?.stack||e));return e.code}};

/* ================= fuzzy search ================= */
test('fuzzy: accent/case-insensitive, partial words, ranked; no merge or rename',async()=>{
 assert.equal(matchScore('Nguyễn Thị Hoa','nguyen thi hoa'),100);
 assert.ok(matchScore('Nguyễn Thị Hoa','NGUYEN HOA')>=60);
 assert.ok(matchScore('Đặng Văn Long','dang long')>=60);
 assert.equal(matchScore('Đặng Văn Long','tuan'),0);
 const L=makeLedger(fixture());
 const r=await findCustomers(L.reader,'minh hoa');
 assert.deepEqual(r.customers.map(c=>c.name),['Minh Thị Hoa','Minh Thị Hoa'],'two addresses stay two results');
 assert.deepEqual(new Set(r.customers.map(c=>c.location)),new Set(['02 Ấp Giả','09 Khu Giả']));
 const d=await findCustomers(L.reader,'dang van long');
 assert.equal(d.customers[0].name,'Đặng Văn Long');assert.equal(d.customers[0].matchScore,100);
 assert.equal(L.rows.find(x=>x.invoiceNo===201).name,'Minh Thị Hoa','ledger untouched');
});

/* ================= debt ================= */
test('debt_summary: same numbers as debt.summary, top customers grouped by name',async()=>{
 const L=makeLedger(fixture());
 const s=await debtSummary(L.reader,{},NOW);
 const raw=(await L.reader('debt.summary',{})).data;
 assert.equal(s.totalDue,raw.due);assert.equal(s.totalBilled,raw.total);assert.equal(s.unpaidCount,raw.unpaidCount);
 assert.equal(s.range,'ALL_TIME');
 assert.deepEqual(s.topCustomers.slice(0,2).map(c=>[c.name,c.owed]),[['Đặng Văn Long',1000000],['Nguyễn Thị Hoa',830000]]);
 // Same rule as BotApi paid(): "Đã TT Satori" does NOT mean the customer paid.
 assert.ok(s.topCustomers.some(c=>c.name==='Long Hải Giả'&&c.owed===40000));
});
test('customer_debt N days: per-invoice total/paid/owed/cumulative, cancelled + reference excluded, reconciles',async()=>{
 const L=makeLedger(fixture());
 const r=await customerDebt(L.reader,{customer:'nguyen thi hoa',days:30},null,NOW);
 assert.equal(r.customer.name,'Nguyễn Thị Hoa');
 assert.deepEqual(r.range,{from:addDays(TODAY,-29),to:TODAY,days:30});
 assert.deepEqual(r.invoices.map(x=>[x.invoiceNo,x.total,x.paid,x.owed,x.cumulative]),
  [[102,300000,300000,0,0],[103,250000,0,250000,250000],[105,80000,0,80000,330000]]);
 assert.deepEqual(r.excluded.map(x=>x.invoiceNo).sort(),[104,106]);
 assert.deepEqual([r.totals.total,r.totals.paid,r.totals.owed],[630000,300000,330000]);
 assert.equal(r.reconciledWithDebtSummary,true);
 const raw=(await L.reader('debt.summary',{query:'Nguyễn Thị Hoa',from:r.range.from,to:r.range.to})).data;
 assert.equal(r.totals.owed,raw.due,'matches ChatGPT debt_summary for the same name and window');
 const r7=await customerDebt(L.reader,{customer:'Nguyễn Thị Hoa',days:7},null,NOW);
 assert.deepEqual(r7.invoices.map(x=>x.invoiceNo),[105]);
});
test('customer_debt asks to choose when names are equally close',async()=>{
 const L=makeLedger(fixture());
 const r=await customerDebt(L.reader,{customer:'thi hoa'},null,NOW);
 assert.equal(r.state,'NEEDS_SELECTION');
 assert.deepEqual(r.candidates.map(c=>c.name).sort(),['Minh Thị Hoa','Nguyễn Thị Hoa']);
 const pick=await customerDebt(L.reader,{customerRef:r.candidates.find(c=>c.name==='Minh Thị Hoa').customerRef},null,NOW);
 assert.equal(pick.totals.owed,150000);
});
test('money is exact decimal (no float drift) and ranges validate',()=>{
 assert.equal(fromCents(toCents(0.1)+toCents(0.2)),0.3);
 assert.equal(fromCents(toCents('100.10')+toCents('200.20')),300.3);
 assert.equal(fromCents(toCents(99999999999)+toCents(1)),100000000000);
 assert.equal(toCents('12.345'),1235n);
 assert.throws(()=>resolveRange({days:0}),e=>e.code==='INVALID_RANGE');
 assert.throws(()=>resolveRange({from:'2026-11-10',to:'2026-11-01'}),e=>e.code==='INVALID_RANGE');
});

/* ================= PDFs + signed links ================= */
test('debt statement PDF is produced (real pdfmake in CI/Docker) with signed 15-minute link',async()=>{
 const L=makeLedger(fixture());
 const out=await debtStatementPdf(L.reader,{customer:'Nguyễn Thị Hoa',days:30},{env:ENV,now:NOW,baseUrl:'https://v2.example.test'});
 assert.match(out.fileName,/^Cong-no-nguyen-thi-hoa-\d{4}-\d{2}-\d{2}\.pdf$/);
 assert.equal(out._attachments[0].resource.mimeType,'application/pdf');
 const bytes=Buffer.from(out._attachments[0].resource.blob,'base64');
 assert.equal(bytes.subarray(0,5).toString('ascii'),'%PDF-');
 assert.equal(out.totals.owed,330000);
 assert.match(out.downloadUrl,/^https:\/\/v2\.example\.test\/mcp\/grok-files\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
 assert.doesNotMatch(Buffer.from(out.downloadUrl.split('/').pop().split('.')[0],'base64url').toString(),/Hoa|Nguy|090/,'no PII in the link');
 const probe=await renderDebtStatementPdf({customerName:'Nguyễn Thị Hoa',from:'2026-10-17',to:'2026-11-15',days:30,
  rows:[{invoiceNo:103,date:'2026-11-05',total:250000,paid:0,owed:250000,cumulative:250000}],totals:{total:250000,paid:0,owed:250000},generatedAt:'x'});
 if(!probe.stub){
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'debt-')),'s.pdf');fs.writeFileSync(file,probe.bytes);
  const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
  for(const re of [/BẢNG KÊ CÔNG NỢ/,/Nguyễn Thị Hoa/,/250\.000 đ/,/Còn nợ/])assert.match(text,re);
 }else console.log('# local run: pdfmake stub, real glyph check runs in CI/Docker');
 const all=debtStatementDefinition({customerName:null,from:'2026-11-01',to:'2026-11-15',rows:[],totals:{total:0,paid:0,owed:0}});
 assert.match(JSON.stringify(all),/Tất cả khách còn nợ/);
});
test('signed file link: verifies, rejects tamper/expiry/disabled, download re-renders from ledger',async()=>{
 const l=signFileLink({k:'invoice',n:103,id:'L103'},ENV,NOW);
 const tok=l.path.split('/').pop();
 assert.deepEqual({...verifyFileToken(tok,ENV,NOW)},{k:'invoice',exp:Math.floor(NOW/1000)+900,n:103,id:'L103'});
 assert.equal(verifyFileToken(tok,ENV,NOW+901000),null,'expired');
 assert.equal(verifyFileToken(tok.replace(/.$/,c=>c==='A'?'B':'A'),ENV,NOW),null,'tampered');
 assert.equal(verifyFileToken(tok,{...ENV,SATORI_GROK_MCP_ENABLED:'0'},NOW),null,'disabled');
 assert.equal(signFileLink({k:'invoice',n:103,id:'L103'},{},NOW),null);
 const L=makeLedger(fixture());
 const fake={bytes:Buffer.from('%PDF-1.4 fake invoice'.padEnd(200,' ')),sha256:'0'.repeat(64),filename:'Hóa đơn 103.pdf'};
 const res={status:0,headers:null,body:null,writeHead(s,h){this.status=s;this.headers=h},end(b){this.body=b}};
 await handleGrokFileHttp({method:'GET'},res,l.path,{env:ENV,now:NOW,reader:L.reader,invoicePdf:async()=>fake});
 assert.equal(res.status,200);assert.equal(res.headers['content-type'],'application/pdf');assert.equal(res.headers['cache-control'],'no-store');
 const bad={...res,status:0};
 await handleGrokFileHttp({method:'GET'},bad,l.path+'x',{env:ENV,now:NOW,reader:L.reader,invoicePdf:async()=>fake});
 assert.equal(bad.status,404);
});
test('invoice_pdf: official PDF of an active invoice, refuses a cancelled one',async()=>{
 const L=makeLedger(fixture());let asked;
 const out=await invoicePdf(L.reader,{invoiceNo:103},{env:ENV,now:NOW,invoicePdf:async ref=>{asked=ref;
  return {bytes:Buffer.from('%PDF-1.4'.padEnd(300,' ')),sha256:'a'.repeat(64),filename:'103 - Nguyen Thi Hoa.pdf'}}});
 assert.deepEqual(asked,{invoiceNo:103,ledgerId:'L103'});
 assert.equal(out._attachments.length,1);assert.ok(out.downloadUrl.startsWith('/mcp/grok-files/'));
 assert.equal(await code(()=>invoicePdf(L.reader,{invoiceNo:104},{env:ENV})),'ORDER_CANCELLED');
 assert.equal(await code(()=>invoicePdf(L.reader,{invoiceNo:999},{env:ENV})),'ORDER_NOT_FOUND');
});

/* ================= orders / products ================= */
test('orders_list/order_get/products_search are read-only and accent-insensitive',async()=>{
 const L=makeLedger(fixture());
 const u=await ordersList(L.reader,{customer:'nguyen thi hoa',status:'unpaid'},NOW);
 assert.deepEqual(u.orders.map(o=>o.invoiceNo),[106,105,103,101]);
 const c=await ordersList(L.reader,{customer:'Nguyen',status:'cancelled'},NOW);
 assert.deepEqual(c.orders.map(o=>o.invoiceNo),[104]);
 const w=await ordersList(L.reader,{days:7},NOW);
 assert.ok(w.orders.every(o=>o.date>=addDays(TODAY,-6)));
 assert.equal(await code(()=>ordersList(L.reader,{from:'2026-01-01',to:'2026-11-15'},NOW)),'RANGE_TOO_WIDE');
 const g=await orderGet(L.reader,{orderId:'103'});
 assert.equal(g.order.invoiceNo,103);assert.equal(g.order.items[0].product,'Nước Giả');
 const p=await productsSearch(L.reader,{q:'nuoc khoang lavie'});
 assert.equal(p.products[0].code,'TP-00001');assert.match(p.products[0].priceText,/95\.000 đ \/ Thùng/);
 assert.equal((await productsSearch(L.reader,{q:'tp-00002'})).products[0].name,'Trà Ô Long Giả');
 assert.ok(L.calls.every(a=>['orders.list','debt.summary','catalogue.list','system.status'].includes(a)));
});

/* ================= soft cancel ================= */
test('cancel_request writes nothing to the ledger; confirm once cancels softly with audit',needsGas,async()=>{
 const L=makeLedger(fixture()),pool=makePool();
 const before=JSON.stringify(L.rows),rev=L.s.revision;
 const req=await requestCancel(pool,L.reader,{invoiceNo:103,reason:'Khách đổi ý, giả lập'},ENV);
 assert.equal(req.written,false);assert.match(req.summary,/YÊU CẦU HỦY HÓA ĐƠN \(chưa thực hiện\)/);assert.match(req.summary,/#103/);
 assert.equal(JSON.stringify(L.rows),before);assert.equal(L.s.revision,rev);assert.equal(L.relayCalls(),0);
 const ok=await confirmCancel(pool,L.reader,()=>L.relay,{requestId:req.requestId},ENV);
 assert.equal(ok.state,'DONE');assert.equal(ok.duplicate,false);assert.equal(L.relayCalls(),1);
 const row=L.rows.find(o=>o.invoiceNo===103);
 assert.equal(row.status,'Đã hủy');assert.equal(row.statusBeforeCancel,'Chưa thanh toán');
 assert.equal(row.cancelReason,'Khách đổi ý, giả lập');assert.equal(row.cancelledBy,'hmac:v2-writer');
 assert.equal(L.rows.length,10,'never deleted');
 const audit=JSON.parse(L.s.values.satori_order_cancel_audit_v1);
 assert.equal(audit.length,1);assert.equal(audit[0].invoiceNo,103);assert.equal(audit[0].source,'grok-owner-connector');
 const stored=pool.rows.get(req.requestId);
 assert.equal(stored.status,'done');assert.ok(stored.confirmed_at&&stored.done_at);assert.equal(stored.ledger_revision,8);
});
test('confirm twice never cancels twice; a lost reply is retried by the same requestId',needsGas,async()=>{
 const L=makeLedger(fixture()),pool=makePool();
 const req=await requestCancel(pool,L.reader,{invoiceNo:105,reason:'Trùng đơn giả'},ENV);
 await confirmCancel(pool,L.reader,()=>L.relay,{requestId:req.requestId},ENV);
 const again=await confirmCancel(pool,L.reader,()=>L.relay,{requestId:req.requestId},ENV);
 assert.equal(again.state,'DONE');assert.equal(again.duplicate,true);assert.equal(L.relayCalls(),1);
 assert.equal(JSON.parse(L.s.values.satori_order_cancel_audit_v1).length,1);
 // Lost reply: ledger wrote, V2 marked uncertain -> retry hits the Apps Script replay path.
 const L2=makeLedger(fixture()),pool2=makePool();
 const r2=await requestCancel(pool2,L2.reader,{invoiceNo:103,reason:'Mất phản hồi giả'},ENV);
 let first=true;
 const flaky={send:async(a,p)=>{const out=await L2.relay.send(a,p);if(first){first=false;const e=Error('x');e.code='LEDGER_NETWORK_OR_TIMEOUT';throw e}return out}};
 assert.equal((await confirmCancel(pool2,L2.reader,()=>flaky,{requestId:r2.requestId},ENV)).state,'UNCERTAIN');
 const retry=await confirmCancel(pool2,L2.reader,()=>flaky,{requestId:r2.requestId},ENV);
 assert.equal(retry.state,'DONE');assert.equal(retry.duplicate,true);
 assert.equal(JSON.parse(L2.s.values.satori_order_cancel_audit_v1).length,1,'one cancellation only');
});
test('cancel request expires after 30 minutes; nothing is written',needsGas,async()=>{
 const L=makeLedger(fixture()),pool=makePool();
 const req=await requestCancel(pool,L.reader,{invoiceNo:103,reason:'Hết hạn giả'},ENV);
 pool.now+=31*60000;
 assert.equal(await code(()=>confirmCancel(pool,L.reader,()=>L.relay,{requestId:req.requestId},ENV)),'REQUEST_EXPIRED');
 assert.equal(await code(()=>confirmCancel(pool,L.reader,()=>L.relay,{requestId:req.requestId},ENV)),'REQUEST_EXPIRED');
 assert.equal(L.relayCalls(),0);assert.equal(L.rows.find(o=>o.invoiceNo===103).status,'Chưa thanh toán');
});
test('writes disabled blocks request and confirm (and tools are not listed)',needsGas,async()=>{
 const L=makeLedger(fixture()),pool=makePool();
 const req=await requestCancel(pool,L.reader,{invoiceNo:103,reason:'Thử chặn giả'},ENV);
 for(const env of [{},{GROK_OWNER_WRITES_ENABLED:'0'},{GROK_OWNER_WRITES_ENABLED:'true'}]){
  assert.equal(await code(()=>requestCancel(pool,L.reader,{invoiceNo:103,reason:'Thử chặn giả'},env)),'WRITES_DISABLED');
  assert.equal(await code(()=>confirmCancel(pool,L.reader,()=>L.relay,{requestId:req.requestId},env)),'WRITES_DISABLED');
  assert.ok(!grokToolList(env).some(t=>/cancel/.test(t.name)));
 }
 assert.equal(L.relayCalls(),0);
 const rpc=await handleGrokRpc(pool,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'satori_order_cancel_confirm',arguments:{requestId:req.requestId}}},{env:{},reader:L.reader});
 assert.equal(rpc.error.code,-32602);
});
test('paid invoices are refused with a clear reason (at request and if paid before confirm)',needsGas,async()=>{
 const L=makeLedger(fixture()),pool=makePool();
 assert.equal(await code(()=>requestCancel(pool,L.reader,{invoiceNo:102,reason:'Đã trả giả'},ENV)),'PAID_ORDER_PROTECTED');
 assert.equal(await code(()=>requestCancel(pool,L.reader,{invoiceNo:302,reason:'TT Satori giả'},ENV)),'PAID_ORDER_PROTECTED');
 assert.equal(await code(()=>requestCancel(pool,L.reader,{invoiceNo:104,reason:'Hủy lại giả'},ENV)),'ALREADY_CANCELLED');
 assert.equal(await code(()=>requestCancel(pool,L.reader,{invoiceNo:106,reason:'Cặp CTV giả'},ENV)),'PAIRED_ORDER_LOCKED');
 const req=await requestCancel(pool,L.reader,{invoiceNo:103,reason:'Trả sau khi yêu cầu'},ENV);
 Object.assign(L.rows.find(o=>o.invoiceNo===103),{status:'Đã thanh toán',customerPaidAt:'x'});
 assert.equal(await code(()=>confirmCancel(pool,L.reader,()=>L.relay,{requestId:req.requestId},ENV)),'PAID_ORDER_PROTECTED');
 assert.equal(pool.rows.get(req.requestId).status,'rejected');assert.equal(L.relayCalls(),0);
 assert.equal(await code(()=>confirmCancel(pool,L.reader,()=>L.relay,{requestId:req.requestId},ENV)),'REQUEST_CLOSED');
});
test('a cancelled invoice leaves debt (summary, per-customer and statement)',needsGas,async()=>{
 const L=makeLedger(fixture()),pool=makePool();
 const before=await customerDebt(L.reader,{customer:'Nguyễn Thị Hoa',days:30},null,NOW);
 const sumBefore=(await debtSummary(L.reader,{},NOW)).totalDue;
 const req=await requestCancel(pool,L.reader,{invoiceNo:103,reason:'Hủy để thử công nợ'},ENV);
 await confirmCancel(pool,L.reader,()=>L.relay,{requestId:req.requestId},ENV);
 const after=await customerDebt(L.reader,{customer:'Nguyễn Thị Hoa',days:30},null,NOW);
 assert.equal(before.totals.owed-after.totals.owed,250000);
 assert.ok(after.excluded.some(x=>x.invoiceNo===103));assert.ok(!after.invoices.some(x=>x.invoiceNo===103));
 assert.equal(sumBefore-(await debtSummary(L.reader,{},NOW)).totalDue,250000);
 const st=await debtStatementPdf(L.reader,{customer:'Nguyễn Thị Hoa',days:30},{env:ENV,now:NOW});
 assert.equal(st.totals.owed,80000);
});
test('Apps Script orders.cancel: revision, identity and replay guards',needsGas,()=>{
 const rows=fixture(),s={revision:3,values:{}};
 const p={requestId:'grokcancel-abc12345',expectedRevision:3,invoiceNo:103,id:'L103',expectedName:'nguyen thi hoa',expectedTotal:250000,reason:'Giả lập',confirmed:true};
 const err=f=>{try{f();return 'NO_ERROR'}catch(e){return e.code}};
 assert.equal(err(()=>SatoriOrderCancel.cancel(s,rows,{...p,expectedRevision:2},'a')),'REVISION_CONFLICT');
 assert.equal(err(()=>SatoriOrderCancel.cancel(s,rows,{...p,expectedTotal:1},'a')),'ORDER_CHANGED');
 assert.equal(err(()=>SatoriOrderCancel.cancel(s,rows,{...p,confirmed:false},'a')),'CONFIRMATION_REQUIRED');
 const first=SatoriOrderCancel.cancel(s,rows,p,'a',NOW);
 assert.equal(first.modified,true);s.revision++;Object.assign(s.values,first.extras);
 const replay=SatoriOrderCancel.cancel(s,rows,{...p,expectedRevision:1},'a',NOW);
 assert.deepEqual([replay.modified,replay.result.duplicate],[false,true]);
 assert.equal(err(()=>SatoriOrderCancel.cancel(s,rows,{...p,invoiceNo:105,id:'L105',expectedTotal:80000,expectedRevision:4},'a')),'REUSED_REQUEST_ID');
 assert.equal(err(()=>SatoriOrderCancel.cancel(s,rows,{...p,requestId:'grokcancel-other999',expectedRevision:4},'a')),'ALREADY_CANCELLED');
});
test('owner write relay signs orders.cancel with the WRITER key only and maps upstream refusals',async()=>{
 const env={SATORI_V2_CANONICAL_WRITES_ENABLED:'1',SATORI_V2_CANONICAL_WRITE_ENDPOINT:'https://script.google.com/macros/s/'+'A'.repeat(30)+'/exec',
  SATORI_V2_CANONICAL_WRITE_KEY_ID:'v2-writer-test',SATORI_V2_CANONICAL_WRITE_SECRET:'w'.repeat(40),SATORI_READ_KEY_ID:'v2-reader-test'};
 let sent;
 const relay=createOwnerWriteRelay({env,fetcher:async(u,o)=>{sent=JSON.parse(o.body);return {ok:true,text:async()=>JSON.stringify({ok:false,error:{code:'PAID_ORDER_PROTECTED'}})}}});
 await assert.rejects(()=>relay.send('orders.cancel',{requestId:'grokcancel-x1234567'}),e=>e.code==='PAID_ORDER_PROTECTED');
 await assert.rejects(()=>relay.send('orders.update',{}),e=>e.code==='LEDGER_ACTION_DENIED','only cancel/delete/restore');
 assert.equal(sent.action,'orders.cancel');assert.equal(sent.keyId,'v2-writer-test');assert.ok(!JSON.stringify(sent).includes('w'.repeat(40)));
 assert.throws(()=>createOwnerWriteRelay({env:{...env,SATORI_READ_KEY_ID:'v2-writer-test'},fetcher:fetch}),/LEDGER_WRITER_MUST_BE_SEPARATE/);
});

/* ================= cancel = 0 đ, still listed ================= */
test('cancel: invoice stays listed with effective 0 đ; debt and bill total drop by its amount',needsGas,async()=>{
 const L=makeLedger(fixture()),pool=makePool();
 const billBefore=(await debtSummary(L.reader,{},NOW)).totalBilled;
 const req=await requestCancel(pool,L.reader,{invoiceNo:101,reason:'Khách hủy giả'},ENV);
 assert.match(req.summary,/số tiền hiệu lực về 0 đ/);assert.match(req.summary,/500\.000 đ/);
 await confirmCancel(pool,L.reader,()=>L.relay,{requestId:req.requestId},ENV);
 assert.equal((await debtSummary(L.reader,{},NOW)).totalBilled,billBefore-500000,'bill total drops');
 const listed=await ordersList(L.reader,{customer:'Nguyễn Thị Hoa',status:'cancelled'},NOW);
 const row=listed.orders.find(o=>o.invoiceNo===101);
 assert.ok(row,'still in the system');assert.deepEqual([row.status,row.total,row.effectiveTotal],['Đã hủy',500000,0]);
 const g=await orderGet(L.reader,{invoiceNo:101});
 assert.equal(g.order.items.length,1,'lines kept');assert.match(g.order.note,/0 đ/);
 assert.equal(JSON.parse(L.s.values.satori_order_cancel_audit_v1)[0].originalTotal,500000);
 assert.equal(L.trash.length,0,'cancel never touches the trash bin');
});

/* ================= delete = trash bin, restorable ================= */
const requestTrash=(pool,reader,args,env)=>requestWrite('trash',pool,reader,args,env);
const confirmTrash=(pool,reader,rf,args,env)=>confirmWrite('trash',pool,reader,rf,args,env);
const requestRestore=(pool,reader,args,env)=>requestWrite('restore',pool,reader,args,env);
const confirmRestore=(pool,reader,rf,args,env)=>confirmWrite('restore',pool,reader,rf,args,env);
test('delete: request writes nothing; confirm moves to trash (gone from list + debt); restore brings it back',async()=>{
 const L=makeLedger(fixture()),pool=makePool();
 const due0=(await debtSummary(L.reader,{},NOW)).totalDue;
 const req=await requestTrash(pool,L.reader,{invoiceNo:103,reason:'Nhập nhầm giả'},ENV);
 assert.match(req.summary,/Thùng Rác 30 ngày/);assert.equal(req.written,false);
 assert.equal(L.relayCalls(),0);assert.ok(L.rows.some(o=>o.invoiceNo===103));
 const ok=await confirmTrash(pool,L.reader,()=>L.relay,{requestId:req.requestId},ENV);
 assert.deepEqual([ok.state,ok.kind,ok.duplicate],['DONE','trash',false]);
 assert.ok(!L.rows.some(o=>o.invoiceNo===103));assert.equal(L.trash.length,1);
 assert.equal(await code(()=>orderGet(L.reader,{invoiceNo:103})),'ORDER_NOT_FOUND');
 assert.equal((await debtSummary(L.reader,{},NOW)).totalDue,due0-250000);
 const tl=await trashList(L.reader,{query:'103'});
 assert.equal(tl.invoices[0].invoiceNo,103);assert.ok(tl.invoices[0].restorableUntil);
 const again=await confirmTrash(pool,L.reader,()=>L.relay,{requestId:req.requestId},ENV);
 assert.equal(again.duplicate,true);assert.equal(L.trash.length,1);assert.equal(L.relayCalls(),1);
 assert.equal(await code(()=>confirmCancel(pool,L.reader,()=>L.relay,{requestId:req.requestId},ENV)),'WRONG_CONFIRM_TOOL');
 const rr=await requestRestore(pool,L.reader,{invoiceNo:103,reason:'Xóa nhầm giả'},ENV);
 assert.match(rr.summary,/KHÔI PHỤC/);assert.equal(L.trash.length,1,'restore request writes nothing');
 const back=await confirmRestore(pool,L.reader,()=>L.relay,{requestId:rr.requestId},ENV);
 assert.equal(back.state,'DONE');assert.equal(L.trash.length,0);
 assert.equal((await orderGet(L.reader,{invoiceNo:103})).order.status,'Chưa thanh toán');
 assert.equal((await debtSummary(L.reader,{},NOW)).totalDue,due0);
 assert.equal((await confirmRestore(pool,L.reader,()=>L.relay,{requestId:rr.requestId},ENV)).duplicate,true);
 assert.equal(L.relayCalls(),2);
});
test('delete/restore: expiry, writes disabled, paid refused, lost reply retried once',async()=>{
 const L=makeLedger(fixture()),pool=makePool();
 const req=await requestTrash(pool,L.reader,{invoiceNo:105,reason:'Hết hạn giả'},ENV);
 pool.now+=31*60000;
 assert.equal(await code(()=>confirmTrash(pool,L.reader,()=>L.relay,{requestId:req.requestId},ENV)),'REQUEST_EXPIRED');
 assert.equal(L.relayCalls(),0);pool.now=NOW;
 for(const env of [{},{GROK_OWNER_WRITES_ENABLED:'0'}]){
  assert.equal(await code(()=>requestTrash(pool,L.reader,{invoiceNo:105,reason:'Tắt ghi giả'},env)),'WRITES_DISABLED');
  assert.equal(await code(()=>requestRestore(pool,L.reader,{invoiceNo:105,reason:'Tắt ghi giả'},env)),'WRITES_DISABLED');
  assert.ok(!grokToolList(env).some(t=>/trash_request|restore/.test(t.name)));
 }
 assert.equal(await code(()=>requestTrash(pool,L.reader,{invoiceNo:102,reason:'Đã trả giả'},ENV)),'PAID_ORDER_PROTECTED');
 assert.equal(await code(()=>requestRestore(pool,L.reader,{invoiceNo:105,reason:'Không có trong thùng'},ENV)),'TRASH_NOT_FOUND');
 const r2=await requestTrash(pool,L.reader,{invoiceNo:105,reason:'Mất phản hồi giả'},ENV);
 let first=true;
 const flaky={send:async(a,p)=>{const out=await L.relay.send(a,p);if(first){first=false;const e=Error('x');e.code='LEDGER_NETWORK_OR_TIMEOUT';throw e}return out}};
 assert.equal((await confirmTrash(pool,L.reader,()=>flaky,{requestId:r2.requestId},ENV)).state,'UNCERTAIN');
 const retry=await confirmTrash(pool,L.reader,()=>flaky,{requestId:r2.requestId},ENV);
 assert.deepEqual([retry.state,retry.duplicate],['DONE',true]);assert.equal(L.trash.length,1,'moved once');
});

/* ================= MCP surface ================= */
test('tool list: reads with writes or GROK_OWNER_READS_ENABLED; cancel only with writes; PDF returned as resource',async()=>{
 const names=env=>grokToolList(env).map(t=>t.name);
 assert.deepEqual(names({}),['satori_pending_pdf_deliveries','satori_mark_pdf_delivered']);
 const ro=names({GROK_OWNER_READS_ENABLED:'1'});
 assert.ok(ro.includes('satori_customer_debt')&&ro.includes('satori_trash_list')&&ro.includes('satori_find_customer')&&!ro.includes('satori_order_draft')&&!ro.some(n=>/cancel|_request|_confirm/.test(n)));
 const all=names(ENV);
 for(const n of ['satori_order_cancel_request','satori_order_cancel_confirm','satori_debt_summary','satori_customer_debt',
  'satori_debt_statement_pdf','satori_orders_list','satori_order_get','satori_invoice_pdf','satori_products_search',
  'satori_order_audit_history','satori_order_preview_update','satori_system_status','satori_order_draft','satori_order_confirm',
  'satori_order_trash_request','satori_order_trash_confirm','satori_order_restore_request','satori_order_restore_confirm','satori_trash_list'])
  assert.ok(all.includes(n),n);
 assert.equal(new Set(all).size,all.length,'no duplicate tool names');
 const writers=grokToolList(ENV).filter(t=>t.annotations.readOnlyHint===false).map(t=>t.name).sort();
 assert.deepEqual(writers,['satori_mark_pdf_delivered','satori_order_cancel_confirm','satori_order_confirm','satori_order_draft',
  'satori_order_restore_confirm','satori_order_trash_confirm']);
 assert.ok(!JSON.stringify(grokToolList(ENV)).match(/markPaid|markCustomerPaid|hard delete/i));
 const L=makeLedger(fixture());
 const rpc=await handleGrokRpc(makePool(),{jsonrpc:'2.0',id:9,method:'tools/call',params:{name:'satori_invoice_pdf',arguments:{invoiceNo:103}}},
  {env:ENV,reader:L.reader,invoicePdf:async()=>({bytes:Buffer.from('%PDF-1.4'.padEnd(300,' ')),sha256:'b'.repeat(64),filename:'103.pdf'})});
 assert.equal(rpc.result.content[1].type,'resource');assert.equal(rpc.result.content[1].resource.mimeType,'application/pdf');
 assert.ok(!('_attachments' in rpc.result.structuredContent));
 const miss=await handleGrokRpc(makePool(),{jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'satori_customer_debt',arguments:{customer:'khong co ai'}}},{env:ENV,reader:L.reader});
 assert.equal(miss.result.isError,true);assert.match(miss.result.content[0].text,/^CUSTOMER_NOT_FOUND/);
 const init=await handleGrokRpc(null,{jsonrpc:'2.0',id:1,method:'initialize',params:{}},{env:ENV});
 assert.match(init.result.instructions,/satori_order_cancel_request/);
});
