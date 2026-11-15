// Grok = ChatGPT parity: edit, undo, payments, preview, trash/restore through the REAL
// production Apps Script (apps-script/production-snapshot-20261115/BotApi.gs + AccountingCore.gs)
// running in a VM with a fake Drive state. Grok's REAL transports are used end-to-end:
// readMinhSatori (V2 read key) and createOwnerWriteRelay (V2 writer key), real HMAC.
// Synthetic data only, no network. The production source is not in the Docker image: CI only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readMinhSatori} from '../../satori-readonly.mjs';
import {requestWrite,confirmWrite,createOwnerWriteRelay,callGrokWriteTool,buildDraft} from '../grok-owner-writes.mjs';
import {GrokOrderError} from '../grok-orders.mjs';
import {debtSummary} from '../grok-ledger-read.mjs';
import {grokToolList} from '../grok-mcp.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const PROD=path.join(HERE,'..','..','..','apps-script','production-snapshot-20261115');
const hasProd=fs.existsSync(path.join(PROD,'BotApi.gs'));
const opt=hasProd?{}:{skip:'production Apps Script snapshot not in this image (runs in CI)'};
const NOW=Date.parse('2026-11-16T03:00:00Z');
const ENDPOINT='https://script.google.com/macros/s/'+'P'.repeat(40)+'/exec';
const SECRET={reader:'fake-reader-secret-0123456789abcdefghij',writer:'fake-writer-secret-0123456789abcdefghij'};
const WRITER_SCOPES=['orders:read','orders:write','orders:delete','orders:update','payments:write'];
const ENV={GROK_OWNER_WRITES_ENABLED:'1',SATORI_GROK_MCP_ENABLED:'1',SATORI_GROK_MCP_TOKEN:'t'.repeat(48)};
const WRITER_ENV={SATORI_V2_CANONICAL_WRITES_ENABLED:'1',SATORI_V2_CANONICAL_WRITE_ENDPOINT:ENDPOINT,
 SATORI_V2_CANONICAL_WRITE_KEY_ID:'v2writer',SATORI_V2_CANONICAL_WRITE_SECRET:SECRET.writer,SATORI_READ_KEY_ID:'v2reader'};

const rowsFixture=()=>[
 {id:'L501',invoiceNo:501,date:'14/11/2026',timestamp:NOW-86400000,name:'Khách Sửa Giả',phone:'0900000501',location:'01 Đường Giả, Quận Giả',
  items:[{product:'Nước Giả 500ml',qty:2,unitPrice:150000}],product:'Nước Giả 500ml x2',qty:2,total:300000,goodsTotal:300000,
  shippingAmount:0,vatAmount:0,status:'Chưa thanh toán'},
 {id:'L502',invoiceNo:502,date:'14/11/2026',name:'Khách Đã Trả Giả',phone:'0900000502',location:'02 Đường Giả, Quận Giả',
  items:[{product:'Nước Giả',qty:1,unitPrice:90000}],total:90000,status:'Đã thanh toán',customerPaidAt:'2026-11-14T01:00:00.000Z'},
 {id:'L503',invoiceNo:503,date:'15/11/2026',name:'Khách Thanh Toán Giả',phone:'0900000503',location:'03 Đường Giả, Quận Giả',
  items:[{product:'Nước Giả',qty:1,unitPrice:120000}],total:120000,status:'Chưa thanh toán'},
 {id:'L504',invoiceNo:504,date:'15/11/2026',name:'CTV Nội Bộ Giả',phone:'0900000504',location:'04 Đường Giả, Quận Giả',
  items:[{product:'Nước Giả',qty:1,unitPrice:50000}],total:50000,status:'Chưa thanh toán',pairGroupId:'P1',pairRole:'collaborator',pairInvoiceNo:505},
 {id:'L506',invoiceNo:506,date:'15/11/2026',name:'Khách Có VAT Giả',phone:'0900000506',location:'06 Đường Giả, Quận Giả',
  items:[{product:'Nước Giả',qty:1,unitPrice:100000}],total:108000,goodsTotal:100000,vatAmount:8000,vat:'yes',status:'Chưa thanh toán'},
 {id:'L507',invoiceNo:507,date:'15/11/2026',name:'Khách Đã Hủy Giả',phone:'0900000507',location:'07 Đường Giả, Quận Giả',
  items:[{product:'Nước Giả',qty:1,unitPrice:70000}],total:70000,status:'Đã hủy'}];

/** Production BotApi in a VM. Returns the ledger plus Grok's real reader and writer relay wired to it. */
function production({writerScopes=WRITER_SCOPES,writerRole='owner'}={}){
 const src=f=>fs.readFileSync(path.join(PROD,f),'utf8');
 let raw=JSON.stringify({revision:20,updatedAt:'2026-11-16T00:00:00Z',values:{
  satori_orders_v15:JSON.stringify(rowsFixture()),satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]'}});
 let writes=0;const sent=[];
 const clients={v2reader:{secret:SECRET.reader,scopes:['orders:read','debt:read'],role:'owner'},
  v2writer:{secret:SECRET.writer,scopes:writerScopes,...(writerRole?{role:writerRole}:{})}};
 const props={STATE_FILE_ID:'fake-state',SATORI_BOT_CLIENTS_JSON:JSON.stringify(clients)};
 const cache=new Map();
 const file={getBlob:()=>({getDataAsString:()=>raw}),
  makeCopy:()=>{const copy=raw;return {getId:()=>'b',getBlob:()=>({getDataAsString:()=>copy})}},setContent:v=>{raw=v;writes++}};
 const out=s=>{const o={getContent:()=>s,setMimeType:()=>o,toString:()=>s};return o};
 const ctx={console,readState_:()=>JSON.parse(raw),
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null})},
  DriveApp:{getFileById:()=>file},
  Utilities:{Charset:{UTF_8:'utf8'},DigestAlgorithm:{SHA_256:'sha256'},
   computeHmacSha256Signature:(m,k)=>[...crypto.createHmac('sha256',k).update(m,'utf8').digest()],
   computeDigest:(a,m)=>[...crypto.createHash('sha256').update(String(m),'utf8').digest()],
   formatDate:()=>'16/11/2026',getUuid:()=>crypto.randomUUID()},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:out},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})}};
 vm.createContext(ctx);
 vm.runInContext(src('AccountingCore.gs'),ctx);
 vm.runInContext(src('BotApi.gs'),ctx);
 const fetcher=async(url,opts)=>{
  assert.equal(url,ENDPOINT);const body=JSON.parse(opts.body);sent.push({keyId:body.keyId,action:body.action});
  return {ok:true,text:async()=>String(ctx.doPost({postData:{contents:opts.body}}))};
 };
 const relay=createOwnerWriteRelay({env:WRITER_ENV,fetcher});
 const reader=async(action,payload)=>{
  const saved={...process.env},savedFetch=globalThis.fetch;
  Object.assign(process.env,{SATORI_READ_ENDPOINT:ENDPOINT,SATORI_READ_KEY_ID:'v2reader',SATORI_READ_HMAC_SECRET:SECRET.reader});
  globalThis.fetch=fetcher;
  try{return await readMinhSatori(action,payload)}
  finally{globalThis.fetch=savedFetch;for(const k of ['SATORI_READ_ENDPOINT','SATORI_READ_KEY_ID','SATORI_READ_HMAC_SECRET'])
   if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
 };
 const state=()=>JSON.parse(raw);
 return {reader,relay,rf:()=>relay,sent,get writes(){return writes},state,
  row:no=>JSON.parse(state().values.satori_orders_v15).find(o=>o.invoiceNo===no),
  editLog:()=>JSON.parse(state().values.satori_order_edit_audit_v1||'[]')};
}

/* in-memory stand-in for satori_v2_grok_write_requests (same SQL as the module issues) */
function makePool(){
 const rows=new Map();const pool={now:NOW,rows};const T='satori_v2_grok_write_requests';
 const run=async(sql,p=[])=>{
  const t=sql.replace(/\s+/g,' ').trim();
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(t))return {rows:[]};
  if(t.startsWith('INSERT INTO '+T)){
   const exp=new Date(pool.now+p[10]*60000);
   rows.set(p[0],{id:p[0],kind:p[1],request_id:p[2],invoice_no:String(p[3]),ledger_id:p[4],expected_name:p[5],expected_total:Number(p[6]).toFixed(2),
    reason:p[7],summary:p[8],requested_by:p[9],payload:p[11]==null?null:JSON.parse(p[11]),status:'pending',expires_at:exp,
    updated_at:new Date(pool.now),confirmed_at:null,confirmed_by:null,last_note:null,done_at:null,ledger_revision:null});
   return {rows:[{expires_at:exp}]};
  }
  if(t.startsWith('SELECT *,expires_at<now() AS expired')){const r=rows.get(p[0]);
   return {rows:r?[{...r,expired:r.expires_at.getTime()<pool.now,stale:r.updated_at.getTime()<pool.now-120000}]:[]}}
  const r=rows.get(p[0]);
  if(t.startsWith('UPDATE '+T+" SET status='expired'")){r.status='expired';return {rows:[]}}
  if(t.startsWith('UPDATE '+T+" SET status='submitting'")){r.status='submitting';r.confirmed_by=p[1];r.updated_at=new Date(pool.now);return {rows:[]}}
  if(t.startsWith('UPDATE '+T+' SET status=$2')){r.status=p[1];r.last_note=p[2];r.updated_at=new Date(pool.now);
   const m=t.match(/ledger_revision=(\d+)/);if(m)r.ledger_revision=Number(m[1]);return {rows:[]}}
  if(t.startsWith('SELECT invoice_no FROM'))return {rows:[]};
  throw Error('UNEXPECTED_SQL '+t.slice(0,80));
 };
 pool.query=run;pool.connect=async()=>({query:run,release(){}});
 return pool;
}
const code=async f=>{try{await f();return 'NO_ERROR'}catch(e){assert.ok(e instanceof GrokOrderError,String(e?.stack||e));return e.code}};
const call=(P,pool,name,args)=>callGrokWriteTool(pool,{reader:P.reader,ownerWriteRelayFactory:P.rf,env:ENV},name,args);
const EDIT={priceMode:'exclusive',items:[{product:'Nước Giả 500ml',qty:3,unitPrice:150000},{product:'Trà Giả',qty:1,unitPrice:50000}]};

/* ================= the read key never previews or writes ================= */
test('read transport refuses orders.previewUpdate / update / payments on the read key',opt,async()=>{
 for(const a of ['orders.previewUpdate','orders.update','orders.undoUpdate','payments.markCustomerPaid','orders.delete','orders.cancel'])
  await assert.rejects(()=>readMinhSatori(a,{invoiceNo:1}),/READ_ONLY_ACTION_DENIED/,a);
});

/* ================= edit ================= */
test('preview: production previewUpdate on the WRITER key, nothing written',opt,async()=>{
 const P=production(),pool=makePool(),rev=P.state().revision;
 const r=await call(P,pool,'satori_order_preview_update',{invoiceNo:501,reason:'Thêm hàng giả',order:EDIT});
 assert.equal(r.written,false);assert.equal(r.after.total,500000);assert.equal(r.before.total,300000);
 assert.equal(P.writes,0);assert.equal(P.state().revision,rev);
 assert.ok(P.sent.filter(x=>x.action==='orders.previewUpdate').every(x=>x.keyId==='v2writer'),'preview uses the writer key');
 assert.ok(P.sent.filter(x=>x.keyId==='v2reader').every(x=>!/update|payments|delete/i.test(x.action)),'read key only reads');
});
test('update: request writes nothing; confirm applies production orders.update once, edit log keeps before/after',opt,async()=>{
 const P=production(),pool=makePool();
 const req=await call(P,pool,'satori_order_update_request',{invoiceNo:501,reason:'Khách lấy thêm hàng giả',order:EDIT});
 assert.equal(req.written,false);assert.match(req.summary,/YÊU CẦU SỬA HÓA ĐƠN \(chưa thực hiện\)/);
 assert.match(req.summary,/Tổng mới: 500\.000 đ \(cũ 300\.000 đ\)/);assert.match(req.summary,/Trà Giả x1/);
 assert.equal(P.writes,0);assert.equal(P.row(501).total,300000);
 const ok=await call(P,pool,'satori_order_update_confirm',{requestId:req.requestId});
 assert.deepEqual([ok.state,ok.kind,ok.duplicate],['DONE','update',false]);
 const row=P.row(501);
 assert.equal(row.total,500000);assert.equal(row.items.length,2);assert.equal(row.name,'Khách Sửa Giả','customer fields kept');
 assert.equal(row.location,'01 Đường Giả, Quận Giả');
 const log=P.editLog();
 assert.equal(log.length,1);assert.equal(log[0].actor,'hmac:v2writer');assert.equal(log[0].reason,'Khách lấy thêm hàng giả');
 assert.equal(log[0].before.total,300000);assert.equal(log[0].after.total,500000);
 assert.equal(P.writes,1);
 const again=await call(P,pool,'satori_order_update_confirm',{requestId:req.requestId});
 assert.equal(again.duplicate,true);assert.equal(P.writes,1);assert.equal(P.editLog().length,1);
});
test('update refused like ChatGPT: paid, CTV pair, cancelled, VAT invoice without rate, bad prices (ledger message kept)',opt,async()=>{
 const P=production(),pool=makePool();
 assert.equal(await code(()=>call(P,pool,'satori_order_update_request',{invoiceNo:502,reason:'Sửa đã trả giả',order:EDIT})),'PAID_ORDER_PROTECTED');
 assert.equal(await code(()=>call(P,pool,'satori_order_update_request',{invoiceNo:504,reason:'Sửa CTV giả',order:EDIT})),'PAIRED_ORDER_LOCKED');
 assert.equal(await code(()=>call(P,pool,'satori_order_update_request',{invoiceNo:507,reason:'Sửa đã hủy giả',order:EDIT})),'NOT_COUNTED');
 assert.equal(await code(()=>call(P,pool,'satori_order_update_request',{invoiceNo:506,reason:'Sửa VAT giả',order:EDIT})),'VAT_RATE_REQUIRED');
 const vatOk=await call(P,pool,'satori_order_update_request',{invoiceNo:506,reason:'Sửa VAT giả',order:{...EDIT,vatRate:8}});
 assert.match(vatOk.summary,/VAT: 40\.000 đ/);assert.match(vatOk.summary,/Tổng mới: 540\.000 đ/);
 assert.equal(await code(()=>call(P,pool,'satori_order_update_request',{invoiceNo:501,reason:'Thiếu priceMode',order:{items:EDIT.items}})),'PRICE_MODE_REQUIRED');
 let msg='';
 try{await call(P,pool,'satori_order_update_request',{invoiceNo:501,reason:'Giá sai giả',
  order:{priceMode:'exclusive',items:[{product:'Nước Giả',qty:1,unitPrice:100000,listPrice:90000}]}})}catch(e){msg=e.code+' '+e.message}
 assert.match(msg,/^INVALID_ITEM .*Giá niêm yết thấp hơn giá bán/);
 assert.equal(P.writes,0);
});
test('update confirm refuses when the invoice changed or got paid after the request; expired request writes nothing',opt,async()=>{
 const P=production(),pool=makePool();
 const req=await call(P,pool,'satori_order_update_request',{invoiceNo:501,reason:'Sửa giả',order:EDIT});
 const pay=await call(P,pool,'satori_payment_request',{invoiceNo:501,change:'customer_paid',reason:'Khách chuyển khoản giả'});
 await call(P,pool,'satori_payment_confirm',{requestId:pay.requestId});
 assert.equal(await code(()=>call(P,pool,'satori_order_update_confirm',{requestId:req.requestId})),'PAID_ORDER_PROTECTED');
 assert.equal(P.row(501).total,300000);assert.equal(P.editLog().length,0);
 const req2=await call(P,pool,'satori_order_update_request',{invoiceNo:503,reason:'Sửa giả',order:EDIT});
 pool.now+=31*60000;
 assert.equal(await code(()=>call(P,pool,'satori_order_update_confirm',{requestId:req2.requestId})),'REQUEST_EXPIRED');
 assert.equal(P.row(503).total,120000);
});
test('undo: only the latest edit, through production orders.undoUpdate, restores the exact previous invoice',opt,async()=>{
 const P=production(),pool=makePool();
 const before=P.row(501);
 const u=await call(P,pool,'satori_order_update_request',{invoiceNo:501,reason:'Sửa giả',order:EDIT});
 await call(P,pool,'satori_order_update_confirm',{requestId:u.requestId});
 const editId=P.editLog()[0].requestId;
 assert.equal(await code(()=>call(P,pool,'satori_order_undo_update_request',{invoiceNo:501,reason:'Hoàn tác giả',undoRequestId:'grokupdate-doesnotexist'})),'UNDO_UNAVAILABLE');
 const r=await call(P,pool,'satori_order_undo_update_request',{invoiceNo:501,reason:'Khách đổi ý giả',undoRequestId:editId});
 assert.match(r.summary,/HOÀN TÁC/);assert.match(r.summary,/Tổng sau hoàn tác: 300\.000 đ/);assert.equal(P.row(501).total,500000);
 const ok=await call(P,pool,'satori_order_undo_update_confirm',{requestId:r.requestId});
 assert.equal(ok.state,'DONE');
 const after=P.row(501);
 assert.deepEqual(after.items,before.items);assert.equal(after.total,300000);
 assert.equal(P.editLog().length,2);assert.equal(P.editLog()[1].undoOf,editId);
 assert.equal(await code(()=>call(P,pool,'satori_order_undo_update_request',{invoiceNo:501,reason:'Hoàn tác cũ',undoRequestId:editId})),'REQUEST_SUPERSEDED');
 assert.equal((await call(P,pool,'satori_order_undo_update_confirm',{requestId:r.requestId})).duplicate,true);
});

/* ================= payments ================= */
test('payments: customer paid/unpaid and Satori paid/unpaid through production, debt follows, history kept',opt,async()=>{
 const P=production(),pool=makePool();
 const due0=(await debtSummary(P.reader,{},NOW)).totalDue;
 const req=await call(P,pool,'satori_payment_request',{invoiceNo:503,change:'customer_paid',reason:'Khách chuyển khoản giả'});
 assert.match(req.summary,/GHI NHẬN KHÁCH ĐÃ THANH TOÁN/);assert.match(req.summary,/120\.000 đ/);assert.equal(P.writes,0);
 assert.equal((await call(P,pool,'satori_payment_confirm',{requestId:req.requestId})).state,'DONE');
 assert.ok(P.row(503).customerPaidAt);assert.equal(P.row(503).status,'Đã thanh toán');
 assert.equal((await debtSummary(P.reader,{},NOW)).totalDue,due0-120000);
 assert.equal((await call(P,pool,'satori_payment_confirm',{requestId:req.requestId})).duplicate,true);assert.equal(P.writes,1);
 assert.equal(await code(()=>call(P,pool,'satori_payment_request',{invoiceNo:503,change:'customer_paid',reason:'Lần hai giả'})),'ALREADY_SET');
 const un=await call(P,pool,'satori_payment_request',{invoiceNo:503,change:'customer_unpaid',reason:'Ghi nhầm giả'});
 await call(P,pool,'satori_payment_confirm',{requestId:un.requestId});
 const row=P.row(503);
 assert.equal(row.customerPaidAt,null);assert.equal(row.status,'Chưa thanh toán');
 assert.equal(row.paymentAudit.at(-1).reason,'Ghi nhầm giả');assert.equal(row.paymentAudit.at(-1).action,'payments.markCustomerUnpaid');
 assert.equal((await debtSummary(P.reader,{},NOW)).totalDue,due0);
 const sp=await call(P,pool,'satori_payment_request',{invoiceNo:503,change:'satori_paid',reason:'Đối soát Satori giả'});
 await call(P,pool,'satori_payment_confirm',{requestId:sp.requestId});
 assert.ok(P.row(503).satoriPaidAt);assert.equal(P.row(503).status,'Đã TT Satori');
 const su=await call(P,pool,'satori_payment_request',{invoiceNo:503,change:'satori_unpaid',reason:'Nhầm đối soát giả'});
 await call(P,pool,'satori_payment_confirm',{requestId:su.requestId});
 assert.equal(P.row(503).satoriPaidAt,null);assert.equal(P.row(503).paymentAudit.length,3);
});
test('payments refused like production: cancelled, CTV internal bill, bad change; confirm tool kind is checked',opt,async()=>{
 const P=production(),pool=makePool();
 assert.equal(await code(()=>call(P,pool,'satori_payment_request',{invoiceNo:507,change:'customer_paid',reason:'Đã hủy giả'})),'NOT_COUNTED');
 assert.equal(await code(()=>call(P,pool,'satori_payment_request',{invoiceNo:504,change:'customer_paid',reason:'CTV giả'})),'CTV_INTERNAL_NOT_RECEIVABLE');
 assert.equal(await code(()=>call(P,pool,'satori_payment_request',{invoiceNo:503,change:'refund',reason:'Không có giả'})),'INVALID_REQUEST');
 const req=await call(P,pool,'satori_payment_request',{invoiceNo:503,change:'customer_paid',reason:'Giả'});
 assert.equal(await code(()=>call(P,pool,'satori_order_update_confirm',{requestId:req.requestId})),'WRONG_CONFIRM_TOOL');
 assert.equal(P.writes,0);
});
test('payment already set by someone else before confirm: no second write, clear message',opt,async()=>{
 const P=production(),pool=makePool();
 const a=await call(P,pool,'satori_payment_request',{invoiceNo:503,change:'customer_paid',reason:'Yêu cầu A giả'});
 const b=await call(P,pool,'satori_payment_request',{invoiceNo:503,change:'customer_paid',reason:'Yêu cầu B giả'});
 await call(P,pool,'satori_payment_confirm',{requestId:a.requestId});
 const r=await call(P,pool,'satori_payment_confirm',{requestId:b.requestId});
 assert.equal(r.state,'ALREADY_DONE');assert.equal(P.writes,1);
});

/* ================= trash / restore still through production ================= */
test('trash and restore through production orders.delete / orders.restore',opt,async()=>{
 const P=production(),pool=makePool();
 const t=await call(P,pool,'satori_order_trash_request',{invoiceNo:503,reason:'Nhập nhầm giả'});
 assert.equal((await call(P,pool,'satori_order_trash_confirm',{requestId:t.requestId})).state,'DONE');
 assert.equal(P.row(503),undefined);
 const r=await call(P,pool,'satori_order_restore_request',{invoiceNo:503,reason:'Xóa nhầm giả'});
 assert.equal((await call(P,pool,'satori_order_restore_confirm',{requestId:r.requestId})).state,'DONE');
 assert.equal(P.row(503).total,120000);
});

/* ================= missing permissions fail closed ================= */
test('writer key without orders:update / payments:write / owner role: clear message, nothing written',opt,async()=>{
 const P=production({writerScopes:['orders:read','orders:write','orders:delete']}),pool=makePool();
 assert.equal(await code(()=>call(P,pool,'satori_order_update_request',{invoiceNo:501,reason:'Thiếu quyền giả',order:EDIT})),'WRITER_NOT_READY');
 const pay=await call(P,pool,'satori_payment_request',{invoiceNo:503,change:'customer_paid',reason:'Thiếu quyền giả'});
 assert.equal(await code(()=>call(P,pool,'satori_payment_confirm',{requestId:pay.requestId})),'WRITER_NOT_READY');
 const P2=production({writerRole:null}),pool2=makePool();
 assert.equal(await code(()=>call(P2,pool2,'satori_order_preview_update',{invoiceNo:501,reason:'Không role giả',order:EDIT})),'WRITER_NOT_READY');
 assert.equal(P.writes+P2.writes,0);
});

/* ================= surface ================= */
test('tool list: ChatGPT-parity writes only with writes enabled; no cancel anywhere',()=>{
 const names=grokToolList(ENV).map(t=>t.name);
 for(const n of ['satori_order_preview_update','satori_order_update_request','satori_order_update_confirm','satori_order_undo_update_request',
  'satori_order_undo_update_confirm','satori_payment_request','satori_payment_confirm','satori_order_trash_request','satori_order_restore_request'])
  assert.ok(names.includes(n),n);
 assert.ok(!names.some(n=>/cancel/.test(n)));
 const ro=grokToolList({GROK_OWNER_READS_ENABLED:'1'}).map(t=>t.name);
 assert.ok(!ro.some(n=>/preview|update|payment|_request|_confirm/.test(n)),'read-only mode lists no write or writer-key tool');
});
test('buildDraft keeps customer fields, replaces only what the owner changed, refuses unknown fields',()=>{
 const raw={name:'A Giả',phone:'09',location:'01 Đường Giả',deliveryNote:'cổng sau',shippingAmount:20000,vatAmount:0};
 const d=buildDraft(raw,{priceMode:'inclusive',items:[{product:'X Giả',qty:1,unitPrice:1000}],location:'02 Đường Mới'});
 assert.deepEqual([d.name,d.location,d.deliveryNote,d.shippingAmount,d.vatRate],['A Giả','02 Đường Mới','cổng sau',20000,0]);
 assert.throws(()=>buildDraft(raw,{priceMode:'inclusive',items:[{product:'X',qty:1,unitPrice:1}],status:'Đã hủy'}),e=>e.code==='INVALID_ORDER');
});
