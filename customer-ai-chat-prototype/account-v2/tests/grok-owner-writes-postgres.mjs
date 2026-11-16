/* Grok owner writes (trash / restore / payment / update payload) against disposable
 * localhost PostgreSQL ONLY. Fake ledger rows and names; the fake relay follows
 * production BotApi semantics for orders.delete/restore and payments.markCustomerPaid.
 * Full production-code parity runs in grok-chatgpt-parity.test.mjs. No network beyond 127.0.0.1. */
import assert from 'node:assert/strict';
import pg from 'pg';
import {ensureOwnerPushSchema} from '../owner-push.mjs';
import {requestWrite,confirmWrite} from '../grok-owner-writes.mjs';

const url=process.env.SATORI_V2_CI_DATABASE_URL||'';
assert.ok(url.includes('127.0.0.1')&&url.endsWith('/satori_v2_ci'),'CI database only');
const pool=new pg.Pool({connectionString:url,max:6});
const env={GROK_OWNER_WRITES_ENABLED:'1'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));

const rows=[
 {id:'C1',invoiceNo:9301,date:'01/11/2026',name:'Khách Thanh Toán Giả',total:250000,status:'Chưa thanh toán',items:[]},
 {id:'C2',invoiceNo:9302,date:'02/11/2026',name:'Khách Đã Trả Giả',total:90000,status:'Đã thanh toán',customerPaidAt:'x',items:[]},
 {id:'C3',invoiceNo:9303,date:'03/11/2026',name:'Khách Hết Hạn Giả',total:10000,status:'Chưa thanh toán',items:[]},
 {id:'C4',invoiceNo:9304,date:'04/11/2026',name:'Khách Xóa Giả',total:70000,status:'Chưa thanh toán',items:[]},
 {id:'C5',invoiceNo:9305,date:'05/11/2026',name:'Khách Sửa Giả',phone:'0900009305',location:'05 Đường Giả',total:80000,status:'Chưa thanh toán',
  items:[{product:'Nước Giả',qty:1,unitPrice:80000}]}];
const trash=[];const editLog=[];
const s={revision:1,values:{}};
const visible=o=>({...o,customerPaid:o.status==='Đã thanh toán'||!!o.customerPaidAt});
const reader=async(action,p)=>{
 if(action==='trash.list'){const f=trash.filter(t=>String(t.order.invoiceNo)===String(p.query));
  return {revision:s.revision,data:{totalMatches:f.length,invoices:f}}}
 if(action==='orders.auditHistory')return {revision:s.revision,data:{entries:editLog.filter(e=>e.invoiceNo===p.invoiceNo)}};
 const f=rows.filter(o=>String(o.invoiceNo)===String(p.query));
 return {revision:s.revision,data:{totalMatches:f.length,orders:f.map(visible)}};
};
let calls=0;
const relay={send:async(action,p)=>{
 if(action==='orders.get')return {ok:true,action,revision:s.revision,data:{order:rows.find(o=>o.invoiceNo===p.invoiceNo)}};
 if(action==='orders.previewUpdate')return {ok:true,action,revision:s.revision,data:{preview:true,order:{...rows.find(o=>o.invoiceNo===p.invoiceNo),
  items:p.order.items,total:p.order.items.reduce((n,i)=>n+i.qty*i.unitPrice,0)}}};
 calls++;await delay(150); // widen the race window
 let out;
 if(action==='payments.markCustomerPaid'){
  const o=rows.find(x=>x.invoiceNo===p.invoiceNo);
  if(o.customerPaidAt)out={modified:false,result:{alreadyPaid:true}};
  else{Object.assign(o,{customerPaidAt:new Date().toISOString(),status:'Đã thanh toán'});out={modified:true,result:{alreadyPaid:false}}}
 }else if(action==='orders.update'){
  const o=rows.find(x=>x.invoiceNo===p.invoiceNo);
  if(editLog.some(e=>e.requestId===p.requestId))out={modified:false,result:{duplicate:true}};
  else{const before={...o};Object.assign(o,{items:p.order.items,total:p.order.items.reduce((n,i)=>n+i.qty*i.unitPrice,0)});
   editLog.push({requestId:p.requestId,invoiceNo:o.invoiceNo,reason:p.reason,before,after:{...o}});out={modified:true,result:{updated:true}}}
 }else if(action==='orders.delete'){
  const prev=trash.find(t=>t.apiDeleteRequestId===p.requestId);
  if(prev)out={modified:false,result:{duplicate:true}};
  else{const o=rows.find(x=>x.invoiceNo===p.invoiceNo);trash.push({order:o,deletedAt:Date.now(),expiresAt:Date.now()+30*86400000,apiDeleteRequestId:p.requestId});
   rows.splice(rows.indexOf(o),1);out={modified:true,result:{deleted:true}}}
 }else{
  const prev=rows.find(o=>o.apiRestoreRequestId===p.requestId);
  if(prev)out={modified:false,result:{duplicate:true}};
  else{const t=trash.find(x=>x.order.invoiceNo===p.invoiceNo);rows.push({...t.order,apiRestoreRequestId:p.requestId});trash.splice(trash.indexOf(t),1);out={modified:true,result:{restored:true}}}
 }
 if(out.modified)s.revision++;
 return {ok:true,action,revision:s.revision,data:out.result};
}};
const pass=n=>console.log('PASS',n);
const T='satori_v2_grok_write_requests';
try{
 await ensureOwnerPushSchema(pool);
 await ensureOwnerPushSchema(pool); // idempotent
 await pool.query('TRUNCATE '+T);

 const req=await requestWrite('pay_customer_paid',pool,reader,{invoiceNo:9301,reason:'Giả lập CI'},env,()=>relay);
 const stored=(await pool.query('SELECT kind,status,expected_total,expires_at>now()+interval \'29 minutes\' AS ttl FROM '+T+' WHERE id=$1',[req.requestId])).rows[0];
 assert.deepEqual([stored.kind,stored.status,stored.expected_total,stored.ttl],['pay_customer_paid','pending','250000.00',true]);
 assert.equal(calls,0);assert.equal(rows[0].status,'Chưa thanh toán');
 pass('request stores a 30-minute pending row and writes nothing to the ledger');

 const results=await Promise.allSettled(Array.from({length:5},()=>confirmWrite('pay',pool,reader,()=>relay,{requestId:req.requestId},env)));
 assert.equal(calls,1,'one dispatcher only');
 assert.ok(results.some(r=>r.status==='fulfilled'&&r.value.state==='DONE'));
 assert.ok(results.every(r=>r.status==='fulfilled'||r.reason.code==='IN_PROGRESS'));
 const again=await confirmWrite('pay',pool,reader,()=>relay,{requestId:req.requestId},env);
 assert.equal(again.duplicate,true);assert.equal(calls,1);
 assert.equal(rows.find(o=>o.invoiceNo===9301).status,'Đã thanh toán');
 const done=(await pool.query('SELECT status,confirmed_by,confirmed_at IS NOT NULL c,done_at IS NOT NULL x,ledger_revision FROM '+T+' WHERE id=$1',[req.requestId])).rows[0];
 assert.deepEqual([done.status,done.confirmed_by,done.c,done.x,Number(done.ledger_revision)],['done','grok-owner-connector',true,true,2]);
 pass('5 parallel confirms + 1 retry = exactly one payment record');

 const up=await requestWrite('update',pool,reader,{invoiceNo:9305,reason:'Giả lập CI',
  order:{priceMode:'exclusive',items:[{product:'Nước Giả',qty:2,unitPrice:80000}]}},env,()=>relay);
 const pl=(await pool.query('SELECT payload FROM '+T+' WHERE id=$1',[up.requestId])).rows[0].payload;
 assert.equal(pl.order.priceMode,'exclusive');assert.equal(pl.order.items[0].qty,2);assert.equal(pl.afterTotal,160000);
 assert.equal(pl.order.name,'Khách Sửa Giả','customer fields kept in the stored draft');
 await Promise.allSettled(Array.from({length:3},()=>confirmWrite('update',pool,reader,()=>relay,{requestId:up.requestId},env)));
 assert.equal(calls,2);assert.equal(editLog.length,1);assert.equal(rows.find(o=>o.invoiceNo===9305).total,160000);
 pass('update draft round-trips through the jsonb payload column; applied once');

 const del=await requestWrite('trash',pool,reader,{invoiceNo:9304,reason:'Giả lập CI'},env);
 await Promise.allSettled(Array.from({length:3},()=>confirmWrite('trash',pool,reader,()=>relay,{requestId:del.requestId},env)));
 assert.equal(calls,3);assert.equal(trash.length,1);assert.ok(!rows.some(o=>o.invoiceNo===9304));
 const rs=await requestWrite('restore',pool,reader,{invoiceNo:9304,reason:'Giả lập CI'},env);
 assert.equal((await confirmWrite('restore',pool,reader,()=>relay,{requestId:rs.requestId},env)).state,'DONE');
 assert.equal(trash.length,0);assert.ok(rows.some(o=>o.invoiceNo===9304));assert.equal(calls,4);
 pass('delete moves to trash once, restore brings it back');

 await assert.rejects(()=>requestWrite('trash',pool,reader,{invoiceNo:9302,reason:'Giả lập CI'},env),e=>e.code==='PAID_ORDER_PROTECTED');
 await assert.rejects(()=>requestWrite('pay_customer_paid',pool,reader,{invoiceNo:9302,reason:'Giả lập CI'},env),e=>e.code==='ALREADY_SET');
 await assert.rejects(()=>pool.query("INSERT INTO "+T+"(id,kind,request_id,invoice_no,ledger_id,expected_name,expected_total,reason,summary,requested_by,expires_at) "+
  "VALUES(gen_random_uuid(),'nope','groknope-12345678',1,'X','X',1,'abc','s','x',now())"),/check constraint/);
 pass('paid invoice refused; unknown kind rejected by the database');

 const late=await requestWrite('trash',pool,reader,{invoiceNo:9303,reason:'Giả lập CI'},env);
 await pool.query("UPDATE "+T+" SET expires_at=now()-interval '1 second' WHERE id=$1",[late.requestId]);
 await assert.rejects(()=>confirmWrite('trash',pool,reader,()=>relay,{requestId:late.requestId},env),e=>e.code==='REQUEST_EXPIRED');
 assert.equal((await pool.query('SELECT status FROM '+T+' WHERE id=$1',[late.requestId])).rows[0].status,'expired');
 assert.ok(rows.some(o=>o.invoiceNo===9303));assert.equal(calls,4);
 pass('expired request is closed and never reaches the ledger');

 await assert.rejects(()=>confirmWrite('pay',pool,reader,()=>relay,{requestId:req.requestId},{}),e=>e.code==='WRITES_DISABLED');
 pass('GROK_OWNER_WRITES_ENABLED off blocks confirm');

 const mark=await requestWrite('mark_paid',pool,reader,{invoiceNo:9303,id:'C3',expectedName:'Khách Hết Hạn Giả',
  expectedTotal:10000,customerPaid:true,proofNote:'FAKE-CI-BANK'},env,()=>relay);
 const prevCalls=calls;
 const race=await Promise.allSettled(Array.from({length:5},()=>confirmWrite('mark_paid',pool,reader,()=>relay,{requestId:mark.requestId},env)));
 assert.ok(race.some(r=>r.status==='fulfilled'&&r.value.state==='DONE'));
 assert.ok(race.every(r=>r.status==='fulfilled'||r.reason.code==='IN_PROGRESS'));
 assert.equal(calls,prevCalls+1);
 const audit=(await pool.query('SELECT payload,reason,confirmed_at,done_at FROM '+T+' WHERE id=$1',[mark.requestId])).rows[0];
 assert.equal(audit.reason,'FAKE-CI-BANK');assert.equal(audit.payload.before.customerPaid,false);
 assert.equal(audit.payload.after.customerPaid,true);assert.ok(audit.confirmed_at);assert.ok(audit.done_at);
 assert.equal((await confirmWrite('mark_paid',pool,reader,()=>relay,{requestId:mark.requestId},env)).duplicate,true);
 assert.equal(calls,prevCalls+1);
 pass('mark-paid jsonb audit + five concurrent confirmations + retry: one ledger call');
}finally{await pool.end()}
