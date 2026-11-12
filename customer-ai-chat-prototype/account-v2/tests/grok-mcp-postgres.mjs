/* Grok PDF-delivery MCP against disposable localhost PostgreSQL ONLY.
 * Fake ledger rows, fake names, no network beyond 127.0.0.1. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import pg from 'pg';
import {scanInvoices,ensureOwnerPushSchema} from '../owner-push.mjs';
import {grokPathAuthorized,deliveryText} from '../grok-mcp.mjs';

const url=process.env.SATORI_V2_CI_DATABASE_URL||'';
assert.ok(url.includes('127.0.0.1')&&url.endsWith('/satori_v2_ci'),'CI database only');
const pool=new pg.Pool({connectionString:url,max:4});
const token=randomBytes(32).toString('base64url');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let ledger=[];
const reader=async(action,p)=>{
 const rows=p.from===today?ledger:[];
 return {revision:1,data:{totalMatches:rows.length,orders:rows}};
};
const row=(no,extra={})=>({id:'G'+no,invoiceNo:no,date:today,name:'Khách giả '+no,
 status:'Chưa thanh toán',timestamp:Date.now(),...extra});
const results=[];const pass=n=>{results.push(n);console.log('PASS',n)};
let child;
try{
 // Unit: capability URL check.
 const env={SATORI_GROK_MCP_ENABLED:'1',SATORI_GROK_MCP_TOKEN:token};
 assert.equal(grokPathAuthorized('/mcp/grok/'+token,env),true);
 assert.equal(grokPathAuthorized('/mcp/grok/'+token+'/',env),true);
 assert.equal(grokPathAuthorized('/mcp/grok/'+token.slice(1),env),false);
 assert.equal(grokPathAuthorized('/mcp/grok/'+token,{...env,SATORI_GROK_MCP_ENABLED:'0'}),false);
 assert.equal(grokPathAuthorized('/mcp/grok/short',{SATORI_GROK_MCP_ENABLED:'1',SATORI_GROK_MCP_TOKEN:'short'}),false);
 assert.equal(deliveryText({invoice_no:6123,recipient_name:'Traky Cần Thơ'}),'Hóa đơn #6123\nTraky Cần Thơ');
 pass('Capability URL is constant-time, disabled by default, and rejects weak tokens');

 await ensureOwnerPushSchema(pool);
 await pool.query('TRUNCATE satori_v2_owner_pdf_deliveries,satori_v2_owner_push_deliveries,satori_v2_owner_push_events,satori_v2_owner_push_feed_state');
 ledger=[row(9100)];
 await scanInvoices(pool,reader,new Date(),{probePauseMs:0});
 assert.equal((await pool.query('SELECT count(*)::int n FROM satori_v2_owner_pdf_deliveries')).rows[0].n,0);
 ledger.unshift(row(9101),row(9102,{status:'Đã hủy'}),row(9103,{isTest:true}));
 await scanInvoices(pool,reader,new Date(),{probePauseMs:0});
 await scanInvoices(pool,reader,new Date(),{probePauseMs:0});
 ledger[0]={...ledger[0],status:'Đã thanh toán'};
 await scanInvoices(pool,reader,new Date(),{probePauseMs:0});
 const q=(await pool.query('SELECT invoice_no,ledger_id,recipient_name,order_date,status FROM satori_v2_owner_pdf_deliveries')).rows;
 assert.deepEqual(q.map(x=>Number(x.invoice_no)),[9101]);
 assert.equal(q[0].ledger_id,'G9101');assert.equal(q[0].recipient_name,'Khách giả 9101');assert.equal(q[0].status,'pending');
 assert.equal(q[0].order_date,today,'must be order date from signed ledger');
 pass('One delivery per NEW eligible invoice: no baseline, cancelled, TEST, re-scan or payment-change duplicates');

 child=spawn(process.execPath,['account-v2/standalone.mjs'],{env:{...process.env,PORT:'18773',
  SATORI_ACCOUNT_V2_DATABASE_URL:url,...env},stdio:['ignore','pipe','pipe']});
 const base='http://127.0.0.1:18773';
 for(let i=0;i<200&&!(await fetch(base+'/healthz').then(r=>r.ok).catch(()=>false));i++)await delay(50);
 const rpc=async(body,path='/mcp/grok/'+token)=>{
  const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify(body)});
  return {status:r.status,body:r.status===202?null:await r.json()};
 };
 assert.equal((await rpc({jsonrpc:'2.0',id:1,method:'tools/list'},'/mcp/grok/'+'x'.repeat(43))).status,404);
 assert.equal((await rpc({jsonrpc:'2.0',id:1,method:'tools/list'},'/mcp/grok/')).status,404);
 assert.equal((await fetch(base+'/mcp/grok/'+token)).status,405);
 pass('Wrong/missing token -> 404 (no probing signal); GET -> 405');

 const init=await rpc({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'grok-test',version:'0'}}});
 assert.equal(init.status,200);assert.equal(init.body.result.protocolVersion,'2025-03-26');
 assert.ok(init.body.result.capabilities.tools);
 assert.equal((await rpc({jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
 const list=await rpc({jsonrpc:'2.0',id:2,method:'tools/list'});
 assert.deepEqual(list.body.result.tools.map(t=>t.name),['satori_pending_pdf_deliveries','satori_mark_pdf_delivered']);
 assert.ok(!JSON.stringify(list.body).match(/orders_create|update|payment/i),'no write tool for invoices/payments');
 pass('MCP initialize / notifications / tools/list (only the two delivery tools)');

 const pending=await rpc({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'satori_pending_pdf_deliveries',arguments:{}}});
 const d=pending.body.result.structuredContent.deliveries;
 assert.equal(d.length,1);
 assert.equal(d[0].orderDate,today);
 assert.equal(d[0].fileName,'9101 - Khách giả 9101 - '+today+'.pdf');
 assert.equal(d[0].requiresFilenameVerification,false);
 assert.deepEqual({invoiceNo:d[0].invoiceNo,ledgerId:d[0].ledgerId,zaloText:d[0].zaloText},
  {invoiceNo:9101,ledgerId:'G9101',zaloText:'Hóa đơn #9101\nKhách giả 9101'});
 const failed=await rpc({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'satori_mark_pdf_delivered',arguments:{deliveryId:d[0].deliveryId,status:'failed',note:'Zalo chưa mở'}}});
 assert.equal(failed.body.result.structuredContent.status,'failed');
 assert.equal((await rpc({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'satori_pending_pdf_deliveries',arguments:{}}})).body.result.structuredContent.count,1,'failed is retried');
 const sent=await rpc({jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'satori_mark_pdf_delivered',arguments:{deliveryId:d[0].deliveryId,status:'sent'}}});
 assert.equal(sent.body.result.structuredContent.status,'sent');
 const again=await rpc({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'satori_mark_pdf_delivered',arguments:{deliveryId:d[0].deliveryId,status:'failed'}}});
 assert.equal(again.body.result.structuredContent.alreadyFinal,true);
 assert.equal(again.body.result.structuredContent.status,'sent','a sent PDF can never be re-queued');
 assert.equal((await rpc({jsonrpc:'2.0',id:8,method:'tools/call',params:{name:'satori_pending_pdf_deliveries',arguments:{}}})).body.result.structuredContent.count,0);
 const row1=(await pool.query('SELECT attempts,delivered_at FROM satori_v2_owner_pdf_deliveries')).rows[0];
 assert.equal(row1.attempts,1);assert.ok(row1.delivered_at);
 pass('Pending -> failed (retried) -> sent (final, never resent, audited)');

 const bad=await rpc({jsonrpc:'2.0',id:9,method:'tools/call',params:{name:'satori_mark_pdf_delivered',arguments:{deliveryId:'not-a-uuid',status:'sent'}}});
 assert.equal(bad.body.result.isError,true);
 const unknown=await rpc({jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'satori_orders_create',arguments:{}}});
 assert.equal(unknown.body.error.code,-32602);
 assert.equal((await rpc({jsonrpc:'2.0',id:11,method:'nope'})).body.error.code,-32601);
 pass('Invalid input, unknown tool and unknown method are rejected safely');

 console.log('PASS grok MCP suite: '+results.length+' scenarios');
}finally{
 if(child){const s=once(child,'exit');child.kill('SIGTERM');await s}
 await pool.end();
}
