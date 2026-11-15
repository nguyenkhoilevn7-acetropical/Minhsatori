/* Grok cancel / trash / restore against disposable localhost PostgreSQL ONLY.
 * Fake ledger rows and names; cancel runs the REAL api/BotApiOrderCancel.gs
 * logic, trash/restore a faithful fake of BotApi removeOrder/recoverOrder.
 * No network beyond 127.0.0.1. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {ensureOwnerPushSchema} from '../owner-push.mjs';
import {requestWrite,confirmWrite} from '../grok-owner-writes.mjs';

const url=process.env.SATORI_V2_CI_DATABASE_URL||'';
assert.ok(url.includes('127.0.0.1')&&url.endsWith('/satori_v2_ci'),'CI database only');
const require=createRequire(import.meta.url);
const SatoriOrderCancel=require(path.join(path.dirname(fileURLToPath(import.meta.url)),'..','..','..','api','BotApiOrderCancel.gs'));
const pool=new pg.Pool({connectionString:url,max:6});
const env={GROK_OWNER_WRITES_ENABLED:'1'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));

const rows=[
 {id:'C1',invoiceNo:9301,date:'01/11/2026',name:'Khách Hủy Giả',total:250000,status:'Chưa thanh toán',items:[]},
 {id:'C2',invoiceNo:9302,date:'02/11/2026',name:'Khách Đã Trả Giả',total:90000,status:'Đã thanh toán',customerPaidAt:'x',items:[]},
 {id:'C3',invoiceNo:9303,date:'03/11/2026',name:'Khách Hết Hạn Giả',total:10000,status:'Chưa thanh toán',items:[]},
 {id:'C4',invoiceNo:9304,date:'04/11/2026',name:'Khách Xóa Giả',total:70000,status:'Chưa thanh toán',items:[]}];
const trash=[];
const s={revision:1,values:{}};
const reader=async(action,p)=>{
 if(action==='trash.list'){const f=trash.filter(t=>String(t.order.invoiceNo)===String(p.query));
  return {revision:s.revision,data:{totalMatches:f.length,invoices:f}}}
 const f=rows.filter(o=>String(o.invoiceNo)===String(p.query));
 return {revision:s.revision,data:{totalMatches:f.length,orders:f.map(o=>({...o,customerPaid:o.status==='Đã thanh toán'}))}};
};
let calls=0;
const relay={send:async(action,p)=>{
 calls++;await delay(150); // widen the race window
 let out;
 if(action==='orders.cancel')out=SatoriOrderCancel.cancel(s,rows,p,'hmac:v2-writer');
 else if(action==='orders.delete'){
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
 if(out.extras)Object.assign(s.values,out.extras);
 return {ok:true,action,revision:s.revision,data:out.result};
}};
const pass=n=>console.log('PASS',n);
const T='satori_v2_grok_write_requests';
try{
 await ensureOwnerPushSchema(pool);
 await pool.query('TRUNCATE '+T);

 const req=await requestWrite('cancel',pool,reader,{invoiceNo:9301,reason:'Giả lập CI'},env);
 const stored=(await pool.query('SELECT kind,status,expected_total,expires_at>now()+interval \'29 minutes\' AS ttl FROM '+T+' WHERE id=$1',[req.requestId])).rows[0];
 assert.deepEqual([stored.kind,stored.status,stored.expected_total,stored.ttl],['cancel','pending','250000.00',true]);
 assert.equal(calls,0);assert.equal(rows[0].status,'Chưa thanh toán');
 pass('request stores a 30-minute pending row and writes nothing to the ledger');

 const results=await Promise.allSettled(Array.from({length:5},()=>confirmWrite('cancel',pool,reader,()=>relay,{requestId:req.requestId},env)));
 assert.equal(calls,1,'one dispatcher only');
 assert.ok(results.some(r=>r.status==='fulfilled'&&r.value.state==='DONE'));
 assert.ok(results.every(r=>r.status==='fulfilled'||r.reason.code==='IN_PROGRESS'));
 const again=await confirmWrite('cancel',pool,reader,()=>relay,{requestId:req.requestId},env);
 assert.equal(again.duplicate,true);assert.equal(calls,1);
 assert.equal(rows.find(o=>o.invoiceNo===9301).status,'Đã hủy');
 assert.equal(JSON.parse(s.values.satori_order_cancel_audit_v1).length,1);
 const done=(await pool.query('SELECT status,confirmed_by,confirmed_at IS NOT NULL c,done_at IS NOT NULL x,ledger_revision FROM '+T+' WHERE id=$1',[req.requestId])).rows[0];
 assert.deepEqual([done.status,done.confirmed_by,done.c,done.x,Number(done.ledger_revision)],['done','grok-owner-connector',true,true,2]);
 pass('5 parallel confirms + 1 retry = exactly one cancel, kept in the ledger, with audit');

 const del=await requestWrite('trash',pool,reader,{invoiceNo:9304,reason:'Giả lập CI'},env);
 await Promise.allSettled(Array.from({length:3},()=>confirmWrite('trash',pool,reader,()=>relay,{requestId:del.requestId},env)));
 assert.equal(calls,2);assert.equal(trash.length,1);assert.ok(!rows.some(o=>o.invoiceNo===9304));
 const rs=await requestWrite('restore',pool,reader,{invoiceNo:9304,reason:'Giả lập CI'},env);
 assert.equal((await confirmWrite('restore',pool,reader,()=>relay,{requestId:rs.requestId},env)).state,'DONE');
 assert.equal(trash.length,0);assert.ok(rows.some(o=>o.invoiceNo===9304));assert.equal(calls,3);
 pass('delete moves to trash once, restore brings it back');

 await assert.rejects(()=>requestWrite('cancel',pool,reader,{invoiceNo:9302,reason:'Giả lập CI'},env),e=>e.code==='PAID_ORDER_PROTECTED');
 pass('paid invoice refused');

 const late=await requestWrite('trash',pool,reader,{invoiceNo:9303,reason:'Giả lập CI'},env);
 await pool.query("UPDATE "+T+" SET expires_at=now()-interval '1 second' WHERE id=$1",[late.requestId]);
 await assert.rejects(()=>confirmWrite('trash',pool,reader,()=>relay,{requestId:late.requestId},env),e=>e.code==='REQUEST_EXPIRED');
 assert.equal((await pool.query('SELECT status FROM '+T+' WHERE id=$1',[late.requestId])).rows[0].status,'expired');
 assert.ok(rows.some(o=>o.invoiceNo===9303));assert.equal(calls,3);
 pass('expired request is closed and never reaches the ledger');

 await assert.rejects(()=>confirmWrite('cancel',pool,reader,()=>relay,{requestId:req.requestId},{}),e=>e.code==='WRITES_DISABLED');
 pass('GROK_OWNER_WRITES_ENABLED off blocks confirm');
}finally{await pool.end()}
