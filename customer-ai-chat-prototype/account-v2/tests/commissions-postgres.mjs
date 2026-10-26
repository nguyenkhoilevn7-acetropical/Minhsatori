// Synthetic PostgreSQL + real local HTTP. Never authenticates to Google or calls Gemini/production.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import pg from 'pg';
const url=process.env.SATORI_V2_CI_DATABASE_URL||'';
assert.ok(url.includes('127.0.0.1')&&url.endsWith('/satori_v2_ci'));
const pool=new pg.Pool({connectionString:url});
const one=async(s,p=[]) => (await pool.query(s,p)).rows[0];
const origin='https://synthetic.invalid',ownerSub='test-'+randomUUID();
let server;
async function start(){
 server=spawn(process.execPath,['account-v2/standalone.mjs'],{env:{...process.env,PORT:'18771',
  SATORI_ACCOUNT_V2_ENABLED:'1',SATORI_ACCOUNT_V2_SIGNUP_ENABLED:'1',
  SATORI_ACCOUNT_V2_GOOGLE_CLIENT_ID:'synthetic-only',SATORI_ACCOUNT_V2_ORIGIN:origin,
  SATORI_ACCOUNT_V2_DATABASE_URL:url,SATORI_ACCOUNT_V2_OWNER_SUB:ownerSub,
  SATORI_ACCOUNT_V2_PILOT_SUB:ownerSub,SATORI_ACCOUNT_V2_TEST_ORDERS_ENABLED:'1'},stdio:'ignore'});
 for(let n=0;n<100;n++){
  if(await fetch('http://127.0.0.1:18771/healthz').then(r=>r.ok).catch(()=>false))return;
  await new Promise(r=>setTimeout(r,50));
 }
 throw Error('Local API did not start');
}
async function stop(){server.kill();await once(server,'exit');server=null}
async function account(sub,type='retail'){
 const a=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) VALUES($1,'synthetic@example.invalid','ACTIVE') RETURNING id",[sub]);
 const p=await one('INSERT INTO satori_v2_profiles(account_id,type) VALUES($1,$2) RETURNING id',[a.id,type]);
 const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
 const sha=x=>createHash('sha256').update(x).digest('hex');
 await pool.query("INSERT INTO satori_v2_sessions(token_hash,csrf_hash,account_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[sha(token),sha(csrf),a.id]);
 return {...a,profileId:p.id,headers:{cookie:`satori_v2_session=${token}; satori_v2_csrf=${csrf}`,
  'x-satori-csrf':csrf,origin,'content-type':'application/json'}};
}
async function api(a,path,body,method=body?'POST':'GET'){
 const r=await fetch('http://127.0.0.1:18771/api/v2/'+path,{method,headers:a.headers,
  ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 return {status:r.status,...await r.json()};
}
try{
 const owner=await account(ownerSub),ctv=await account('test-'+randomUUID(),'collaborator');
 const buyer=await account('test-'+randomUUID()),stranger=await account('test-'+randomUUID());
 const addr=await one("INSERT INTO satori_v2_addresses(profile_id,label,recipient_name,recipient_phone,address) VALUES($1,'Test','Fake Buyer','0900000000','Synthetic location') RETURNING id",[buyer.profileId]);
 const rev=Number((await one('SELECT COALESCE(MAX(revision),1) AS r FROM satori_v2_catalogue')).r);
 await pool.query("INSERT INTO satori_v2_catalogue(code,name,unit,list_price,revision) VALUES('TP-99997','Synthetic water','box',100000,$1) ON CONFLICT(code) DO UPDATE SET list_price=100000,revision=$1,active=true",[rev]);
 await start();
 const grant={profileId:buyer.profileId,collaboratorAccountId:ctv.id,enabled:true,expectedRevision:0,
  collaboratorBps:3500,customerBps:1000,minCustomerBps:0,maxCustomerBps:2500,confirmed:true};
 assert.equal((await api(buyer,'admin/commission-grants',grant,'PUT')).status,403);
 assert.equal((await api(owner,'admin/commission-grants',grant,'PUT')).status,200);
 const edit={profileId:buyer.profileId,expectedRevision:1,customerBps:2000,confirmed:true};
 assert.equal((await api(stranger,'ctv/customer-discount',edit,'PATCH')).status,409);
 assert.equal((await api(ctv,'ctv/customer-discount',{...edit,collaboratorBps:9000},'PATCH')).status,409);
 assert.equal((await api(ctv,'ctv/customer-discount',{...edit,customerBps:3000},'PATCH')).status,409);
 assert.equal((await api(ctv,'ctv/customer-discount',edit,'PATCH')).status,200);
 assert.equal((await api(buyer,'cart',{profileId:buyer.profileId,addressId:addr.id,expectedRevision:0,lines:[{code:'TP-99997',qty:10}]},'PUT')).status,200);
 const quote=await api(buyer,'quote',{profileId:buyer.profileId,addressId:addr.id});
 assert.equal(quote.status,200,JSON.stringify(quote));assert.equal(quote.totalVnd,800000);
 assert.doesNotMatch(JSON.stringify(quote),/commission|internalUnitPrice|settlementGoods/);
 const request={quoteId:quote.quoteId,requestId:randomUUID(),confirmedTest:true};
 const results=await Promise.all(Array.from({length:100},()=>api(buyer,'test-orders',request)));
 assert.ok(results.every(r=>r.status===200||r.status===201),JSON.stringify(results.filter(r=>r.status>201)));
 const invoices=await api(buyer,'test-invoices');assert.equal(invoices.invoices.length,1);
 const id=invoices.invoices[0].id;assert.equal(invoices.invoices[0].savingsVnd,200000);
 assert.doesNotMatch(JSON.stringify(invoices),/commission|internalUnitPrice|settlementGoods/);
 assert.equal((await api(stranger,'test-invoices?id='+id)).status,409);
 const ctvInvoices=await api(ctv,'test-invoices');assert.equal(ctvInvoices.invoices[0].commission.commissionVnd,150000);
 assert.equal(ctvInvoices.invoices[0].commission.settlementGoodsVnd,650000);
 assert.ok((await api(owner,'admin/test-invoices?id='+id)).invoices.length===1);
 const month=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,7);
 const report=await api(ctv,'ctv/test-report?month='+month);
 assert.equal(report.reports[0].commissionVnd,'150000');
 assert.equal((await api(stranger,'ctv/test-report?month='+month)).reports.length,0);
 assert.equal((await api(owner,'admin/test-settlements',{invoiceId:id,confirmedTest:true})).status,200);
 assert.equal((await api(ctv,'ctv/test-report?month='+month)).reports[0].settledCommissionVnd,'150000');
 // Per-CTV OFF spans all current/future grants, but preserves prior commission snapshots.
 const pendingQuote=await api(buyer,'quote',{profileId:buyer.profileId,addressId:addr.id});
 const mode={accountId:ctv.id,enabled:false,expectedRevision:1,confirmed:true};
 assert.equal((await api(ctv,'admin/ctv-mode',mode,'PATCH')).status,403);
 assert.equal((await api(owner,'admin/ctv-mode',mode,'PATCH')).status,200);
 assert.equal((await api(owner,'admin/ctv-mode',mode,'PATCH')).status,409);
 assert.equal((await api(ctv,'ctv/customer-discount',{...edit,expectedRevision:2},'PATCH')).status,409);
 const disabled=await api(buyer,'quote',{profileId:buyer.profileId,addressId:addr.id});
 assert.equal(disabled.totalVnd,1000000);
 assert.equal((await api(buyer,'test-orders',{quoteId:pendingQuote.quoteId,requestId:randomUUID(),confirmedTest:true})).status,409);
 assert.equal((await api(ctv,'test-invoices?id='+id)).invoices[0].commission.commissionVnd,150000);
 assert.equal((await api(owner,'admin/ctv-mode',{...mode,enabled:true,expectedRevision:2},'PATCH')).status,200);
 assert.equal((await api(buyer,'quote',{profileId:buyer.profileId,addressId:addr.id})).totalVnd,800000);
 // Grant changes cannot rewrite issued test invoice snapshots.
 assert.equal((await api(owner,'admin/commission-grants',{...grant,enabled:false,expectedRevision:2},'PUT')).status,200);
 await stop();await start();
 const after=await api(ctv,'test-invoices?id='+id);
 assert.equal(after.invoices[0].commission.commissionVnd,150000);
 assert.equal(after.invoices[0].commission.grantVersion,2);
 assert.equal((await api(buyer,'test-orders',request)).alreadySubmitted,true);
 const count=await one('SELECT count(*)::int AS n FROM satori_v2_test_invoices WHERE order_id=$1',[invoices.invoices[0].orderId]);
 assert.equal(count.n,1);
 assert.equal((await api(buyer,'confirm',{})).status,503);
 console.log('PASS: Admin 35%, CTV customer 20%, one invoice / 100 retries, tenant privacy, reports, settlement, immutable snapshot, restart persistence; NO real OAuth/Gemini/ledger writes.');
}finally{if(server)await stop();await pool.end()}
