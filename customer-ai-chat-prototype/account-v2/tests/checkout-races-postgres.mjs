/* HTTP checkout/Admin concurrency against disposable localhost PostgreSQL only. */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import pg from 'pg';

const url=process.env.SATORI_V2_CI_DATABASE_URL||'';
assert.ok(url.includes('127.0.0.1')&&url.endsWith('/satori_v2_ci'));
const pool=new pg.Pool({connectionString:url,max:8});
const origin='https://v2-ci.example.invalid';
const ownerSub='fake-race-owner-'+randomUUID();
const hash=s=>createHash('sha256').update(s).digest('hex');
const one=async(sql,args)=>(await pool.query(sql,args)).rows[0];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label){
 const end=Date.now()+10000;
 while(Date.now()<end){if(await check())return;await delay(20)}
 throw new Error('Timed out: '+label);
}
let child,blocker;
try{
 const owner=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) VALUES($1,'race-owner@example.invalid','ACTIVE') RETURNING id",[ownerSub]);
 const customer=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) VALUES($1,'race-customer@example.invalid','ACTIVE') RETURNING id",['fake-race-customer-'+randomUUID()]);
 const profile=await one("INSERT INTO satori_v2_profiles(account_id,type) VALUES($1,'retail') RETURNING id",[customer.id]);
 const address=await one("INSERT INTO satori_v2_addresses(profile_id,label,recipient_name,recipient_phone,address) VALUES($1,'Fake','Synthetic Customer','0900000000','123 Synthetic Street') RETURNING id",[profile.id]);
 const policy=await one("INSERT INTO satori_v2_policies(profile_id,discount_bps,version,approved_by) VALUES($1,2000,1,$2) RETURNING id",[profile.id,ownerSub]);
 const revision=(await one('SELECT COALESCE(MAX(revision),1) AS revision FROM satori_v2_catalogue')).revision;
 await pool.query("INSERT INTO satori_v2_catalogue(code,name,unit,list_price,revision) VALUES('TP-99998','Fake Water','box',100000,$1) ON CONFLICT(code) DO UPDATE SET revision=$1,active=true",[revision]);
 await pool.query('INSERT INTO satori_v2_carts(account_id,profile_id,lines) VALUES($1,$2,$3)',[customer.id,profile.id,JSON.stringify([{code:'TP-99998',qty:2}])]);
 async function session(account){
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
  await pool.query("INSERT INTO satori_v2_sessions(token_hash,csrf_hash,account_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[hash(token),hash(csrf),account.id]);
  return {cookie:'satori_v2_session='+token+'; satori_v2_csrf='+csrf,'x-satori-csrf':csrf,origin,'content-type':'application/json'};
 }
 const ownerHeaders=await session(owner),customerHeaders=await session(customer);
 child=spawn(process.execPath,['account-v2/standalone.mjs'],{env:{...process.env,PORT:'18769',
  SATORI_ACCOUNT_V2_ENABLED:'1',SATORI_ACCOUNT_V2_SIGNUP_ENABLED:'1',
  SATORI_ACCOUNT_V2_GOOGLE_CLIENT_ID:'fake-client',SATORI_ACCOUNT_V2_ORIGIN:origin,
  SATORI_ACCOUNT_V2_DATABASE_URL:url,SATORI_ACCOUNT_V2_OWNER_SUB:ownerSub,
  SATORI_ACCOUNT_V2_PILOT_SUB:ownerSub,SATORI_ACCOUNT_V2_TEST_ORDERS_ENABLED:'1'},stdio:['ignore','pipe','pipe']});
 const base='http://127.0.0.1:18769';
 await until(()=>fetch(base+'/healthz').then(r=>r.ok).catch(()=>false),'server readiness');
 async function api(path,body,headers=customerHeaders,method='POST'){
  const r=await fetch(base+path,{method,headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  return {status:r.status,...await r.json()};
 }
 const quotation=await api('/api/v2/quote',{profileId:profile.id,addressId:address.id});
 assert.equal(quotation.status,200,JSON.stringify(quotation));
 const request={quoteId:quotation.quoteId,requestId:randomUUID(),confirmedTest:true};
 blocker=await pool.connect();await blocker.query('BEGIN');
 await blocker.query('SELECT 1 FROM satori_v2_carts WHERE profile_id=$1 FOR UPDATE',[profile.id]);
 const checkout=api('/api/v2/test-orders',request);
 async function waiting(fragment){
  const r=await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND position($1 in query)>0",[fragment]);
  return r.rowCount>0;
 }
 await until(()=>waiting('SELECT lines,revision FROM satori_v2_carts'),'checkout holds profile');
 const revoke=api('/api/v2/admin/policies',{policyId:policy.id,profileId:profile.id,expectedRevision:1,enabled:false,confirmed:true},ownerHeaders,'PATCH');
 await until(()=>waiting('SELECT id FROM satori_v2_profiles'),'policy revocation waits for checkout');
 await blocker.query('COMMIT');blocker.release();blocker=null;
 const accepted=await checkout;assert.equal(accepted.status,201,JSON.stringify(accepted));
 assert.equal((await revoke).status,200);
 const retry=await api('/api/v2/test-orders',request);
 assert.equal(retry.status,200);assert.equal(retry.orderId,accepted.orderId);
 // A distinct quote made before revocation must fail freshness validation.
 const stale=await one("INSERT INTO satori_v2_quotes(account_id,profile_id,address_id,payload,cart_revision,catalogue_revision,expires_at) SELECT account_id,profile_id,address_id,payload,cart_revision,catalogue_revision,now()+interval '10 minutes' FROM satori_v2_quotes WHERE id=$1 RETURNING id",[quotation.quoteId]);
 const rejected=await api('/api/v2/test-orders',{...request,quoteId:stale.id,requestId:randomUUID()});
 assert.equal(rejected.error,'QUOTE_CHANGED_REQUOTE_REQUIRED');
 // Hold an uncommitted suspension: initial auth sees ACTIVE, final guard must
 // wait for account lock and then reject the committed SUSPENDED state.
 blocker=await pool.connect();await blocker.query('BEGIN');
 await blocker.query("UPDATE satori_v2_accounts SET access_status='SUSPENDED' WHERE id=$1",[customer.id]);
 const suspended=api('/api/v2/test-orders',{...request,quoteId:stale.id,requestId:randomUUID()});
 await until(()=>waiting('SELECT access_status FROM satori_v2_accounts'),'checkout waits for account decision');
 await blocker.query('COMMIT');blocker.release();blocker=null;
 assert.equal((await suspended).error,'ACCOUNT_ACCESS_DISABLED');
 const count=await one('SELECT count(*)::int AS n FROM satori_v2_order_requests WHERE account_id=$1',[customer.id]);
 assert.equal(count.n,1);
 console.log('PASS HTTP policy revocation/checkout serialization, stale quote rejection, idempotent retry and concurrent suspension');
}finally{
 if(blocker){await blocker.query('ROLLBACK');blocker.release()}
 if(child){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped}
 await pool.end();
}
