// Independent synthetic fixtures; no ledger, OAuth, or Gemini network calls.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {reserveGeminiBudget} from '../gemini-order.mjs';
import {bindInvoice,invoiceDetail,invoiceIndex} from '../invoice-history.mjs';
const uri=process.env.SATORI_V2_CI_DATABASE_URL||'';
assert.ok(uri.includes('127.0.0.1')&&uri.endsWith('/satori_v2_ci'));
let pool=new pg.Pool({connectionString:uri,max:20});
try {
 const account=async()=> (await pool.query("INSERT INTO satori_v2_accounts(google_sub,email,access_status) VALUES($1,'fake@example.invalid','ACTIVE') RETURNING id",['ci-'+randomUUID()])).rows[0];
 const owner=await account(),customer=await account(),other=await account();
 const legacyId='fake-'+randomUUID(),invoiceNo=900000001;
 const read=async()=>({revision:8,data:{orders:[{id:legacyId,invoiceNo,total:800000,paidAmount:300000,commission:150000}]}});
 const input={accountId:customer.id,legacyId,invoiceNo,expectedLedgerRevision:8,confirmedIdentity:true};
 const result=await bindInvoice(pool,owner,input,read);
 await assert.rejects(bindInvoice(pool,owner,input,read),/INVOICE_ALREADY_BOUND/);
 let called=false;
 await assert.rejects(invoiceDetail(pool,other,result.bindingId,async()=>{called=true}),/FORBIDDEN/);
 assert.equal(called,false);
 assert.equal((await invoiceIndex(pool,other)).invoices.length,0);
 const detail=await invoiceDetail(pool,customer,result.bindingId,read);
 assert.equal(detail.dueVnd,500000);assert.equal(detail.commission,undefined);
 const day=new Date('2040-01-01T00:00:00Z');
 const attempts=await Promise.all(Array.from({length:100},()=>reserveGeminiBudget(pool,customer.id,day)));
 assert.equal(attempts.filter(Boolean).length,10);
 assert.equal(Number((await pool.query("SELECT calls FROM satori_v2_gemini_budget WHERE day='2040-01-01' AND bucket='global'")).rows[0].calls),10);
 await pool.end();pool=new pg.Pool({connectionString:uri});
 assert.equal(await reserveGeminiBudget(pool,customer.id,day),false);
 assert.equal((await invoiceDetail(pool,customer,result.bindingId,read)).totalVnd,800000);
 assert.equal(Number((await pool.query("SELECT count(*) FROM satori_v2_audit WHERE event_type='INVOICE_ACCESS_BOUND' AND resource_id=$1",[result.bindingId])).rows[0].count),1);
 console.log('PASS invoice ownership, duplicate binding, private fields, 100 budget races, reconnect persistence');
} finally {await pool.end()}
