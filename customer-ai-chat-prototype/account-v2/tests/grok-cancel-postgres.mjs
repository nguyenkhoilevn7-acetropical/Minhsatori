/* Grok soft cancel against disposable localhost PostgreSQL ONLY.
 * Fake ledger rows and names; the fake ledger cancels through the REAL
 * api/BotApiOrderCancel.gs logic. No network beyond 127.0.0.1. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {ensureOwnerPushSchema} from '../owner-push.mjs';
import {requestCancel,confirmCancel} from '../grok-order-cancel.mjs';

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
 {id:'C3',invoiceNo:9303,date:'03/11/2026',name:'Khách Hết Hạn Giả',total:10000,status:'Chưa thanh toán',items:[]}];
const s={revision:1,values:{}};
const reader=async(action,p)=>{
 const f=rows.filter(o=>String(o.invoiceNo)===String(p.query));
 return {revision:s.revision,data:{totalMatches:f.length,orders:f.map(o=>({...o,customerPaid:o.status==='Đã thanh toán'}))}};
};
let relayCalls=0;
const relay={cancel:async p=>{
 relayCalls++;await delay(150); // widen the race window
 const out=SatoriOrderCancel.cancel(s,rows,p,'hmac:v2-writer');
 if(out.modified){s.revision++;Object.assign(s.values,out.extras)}
 return {ok:true,action:'orders.cancel',revision:s.revision,data:out.result};
}};
const pass=n=>console.log('PASS',n);
try{
 await ensureOwnerPushSchema(pool);
 await pool.query('TRUNCATE satori_v2_grok_cancel_requests');

 const req=await requestCancel(pool,reader,{invoiceNo:9301,reason:'Giả lập CI'},env);
 const stored=(await pool.query('SELECT status,expected_total,expires_at>now()+interval \'29 minutes\' AS ttl FROM satori_v2_grok_cancel_requests WHERE id=$1',[req.cancelRequestId])).rows[0];
 assert.deepEqual([stored.status,stored.expected_total,stored.ttl],['pending','250000.00',true]);
 assert.equal(relayCalls,0);assert.equal(rows[0].status,'Chưa thanh toán');
 pass('request stores a 30-minute pending row and writes nothing to the ledger');

 const results=await Promise.allSettled(Array.from({length:5},()=>confirmCancel(pool,reader,()=>relay,{cancelRequestId:req.cancelRequestId},env)));
 assert.equal(relayCalls,1,'one dispatcher only');
 assert.ok(results.some(r=>r.status==='fulfilled'&&r.value.state==='CANCELLED'));
 assert.ok(results.every(r=>r.status==='fulfilled'||r.reason.code==='CANCEL_IN_PROGRESS'));
 const again=await confirmCancel(pool,reader,()=>relay,{cancelRequestId:req.cancelRequestId},env);
 assert.equal(again.duplicate,true);assert.equal(relayCalls,1);
 assert.equal(rows[0].status,'Đã hủy');assert.equal(rows.length,3);
 assert.equal(JSON.parse(s.values.satori_order_cancel_audit_v1).length,1);
 const done=(await pool.query('SELECT status,confirmed_by,confirmed_at IS NOT NULL c,cancelled_at IS NOT NULL x,ledger_revision FROM satori_v2_grok_cancel_requests WHERE id=$1',[req.cancelRequestId])).rows[0];
 assert.deepEqual([done.status,done.confirmed_by,done.c,done.x,Number(done.ledger_revision)],['cancelled','grok-owner-connector',true,true,2]);
 pass('5 parallel confirms + 1 retry = exactly one soft cancel with audit');

 await assert.rejects(()=>requestCancel(pool,reader,{invoiceNo:9302,reason:'Giả lập CI'},env),e=>e.code==='PAID_ORDER_PROTECTED');
 pass('paid invoice refused');

 const late=await requestCancel(pool,reader,{invoiceNo:9303,reason:'Giả lập CI'},env);
 await pool.query("UPDATE satori_v2_grok_cancel_requests SET expires_at=now()-interval '1 second' WHERE id=$1",[late.cancelRequestId]);
 await assert.rejects(()=>confirmCancel(pool,reader,()=>relay,{cancelRequestId:late.cancelRequestId},env),e=>e.code==='CANCEL_REQUEST_EXPIRED');
 assert.equal((await pool.query('SELECT status FROM satori_v2_grok_cancel_requests WHERE id=$1',[late.cancelRequestId])).rows[0].status,'expired');
 assert.equal(rows[2].status,'Chưa thanh toán');assert.equal(relayCalls,1);
 pass('expired request is closed and never reaches the ledger');

 await assert.rejects(()=>confirmCancel(pool,reader,()=>relay,{cancelRequestId:req.cancelRequestId},{}),e=>e.code==='WRITES_DISABLED');
 pass('GROK_OWNER_WRITES_ENABLED off blocks confirm');
}finally{await pool.end()}
