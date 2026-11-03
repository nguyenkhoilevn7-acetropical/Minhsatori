/* Owner FCM push end-to-end against disposable localhost PostgreSQL ONLY.
 * Fake accounts, fake canonical ledger, fake FCM. No production data or keys. */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash,generateKeyPairSync} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import pg from 'pg';
import {scanInvoices,queueDeliveries,dispatch,sendTestPush,startOwnerPushRelay,
 ensureOwnerPushSchema} from '../owner-push.mjs';

const url=process.env.SATORI_V2_CI_DATABASE_URL||'';
assert.ok(url.includes('127.0.0.1')&&url.endsWith('/satori_v2_ci'),'CI database only');
const pool=new pg.Pool({connectionString:url,max:8});
const origin='https://v2-push-ci.example.invalid';
const ownerSub='fake-push-owner-'+randomUUID();
const hash=s=>createHash('sha256').update(s).digest('hex');
const one=async(sql,args)=>(await pool.query(sql,args)).rows[0];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:1024,
 privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const pushEnv={SATORI_OWNER_PUSH_ENABLED:'1',SATORI_FCM_PROJECT_ID:'satori-fake-ci',
 SATORI_FCM_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',project_id:'satori-fake-ci',
  client_email:'push@satori-fake-ci.iam.gserviceaccount.com',private_key:privateKey}),
 SATORI_ACCOUNT_V2_OWNER_SUB:ownerSub,SATORI_OWNER_PUSH_WAKE_SECRET:'ci-wake-secret-'+'z'.repeat(40)};
const results=[];
const pass=name=>{results.push(name);console.log('PASS',name)};

// Fake signed canonical ledger: today's invoices.
let ledger=[],revision=100,ledgerDown=false;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const reader=async(action,payload)=>{
 assert.equal(action,'orders.list');
 if(ledgerDown)throw Error('READ_ONLY_UPSTREAM_HTTP_503');
 const rows=payload.from===today?ledger:[];
 return {revision,data:{totalMatches:rows.length,orders:rows}};
};
// Fake FCM: records accepted messages; can simulate outages / dead tokens.
let fcmMode='ok';const delivered=[];
const send=async msg=>{
 if(fcmMode==='down')throw Object.assign(Error('FCM_UNAVAILABLE'),{code:'FCM_UNAVAILABLE',invalidToken:false});
 if(fcmMode==='offline')throw Object.assign(Error('FCM_NETWORK_ERROR'),{code:'FCM_NETWORK_ERROR',invalidToken:false});
 if(fcmMode==='dead')throw Object.assign(Error('FCM_TOKEN_UNREGISTERED'),{code:'FCM_TOKEN_UNREGISTERED',invalidToken:true});
 delivered.push(msg);return true;
};
const tick=async()=>{await scanInvoices(pool,reader);await queueDeliveries(pool,ownerSub);return dispatch(pool,ownerSub,send)};
const makeDue=()=>pool.query('UPDATE satori_v2_owner_push_deliveries SET retry_at=now() WHERE delivered_at IS NULL');

let child;
try{
 await ensureOwnerPushSchema(pool);
 // Isolate this run from earlier CI runs in the same database.
 await pool.query('TRUNCATE satori_v2_owner_push_deliveries,satori_v2_owner_push_events,satori_v2_owner_push_feed_state,satori_v2_owner_push_devices');
 const owner=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) VALUES($1,'push-owner@example.invalid','ACTIVE') RETURNING id",[ownerSub]);
 const customer=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) VALUES($1,'push-customer@example.invalid','ACTIVE') RETURNING id",['fake-push-customer-'+randomUUID()]);
 async function session(account){
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
  await pool.query("INSERT INTO satori_v2_sessions(token_hash,csrf_hash,account_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[hash(token),hash(csrf),account.id]);
  return {token,headers:{cookie:'satori_v2_session='+token+'; satori_v2_csrf='+csrf,'x-satori-csrf':csrf,origin,'content-type':'application/json'}};
 }
 const ownerSession=await session(owner),customerSession=await session(customer);
 child=spawn(process.execPath,['account-v2/standalone.mjs'],{env:{...process.env,PORT:'18771',
  SATORI_ACCOUNT_V2_ENABLED:'1',SATORI_ACCOUNT_V2_SIGNUP_ENABLED:'1',
  SATORI_ACCOUNT_V2_GOOGLE_CLIENT_ID:'fake-client',SATORI_ACCOUNT_V2_ORIGIN:origin,
  SATORI_ACCOUNT_V2_DATABASE_URL:url,SATORI_ACCOUNT_V2_PILOT_SUB:ownerSub,...pushEnv},
  stdio:['ignore','pipe','pipe']});
 const base='http://127.0.0.1:18771';
 for(let i=0;i<200&&!(await fetch(base+'/healthz').then(r=>r.ok).catch(()=>false));i++)await delay(50);
 const api=async(path,body,headers,method='POST')=>{
  const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,...await r.json()};
 };
 const deviceId=randomUUID();
 const token='fAkE_ci_tOkEn:APA91b'+randomBytes(60).toString('hex');

 // --- Endpoint security -------------------------------------------------
 const noCsrf={...ownerSession.headers};delete noCsrf['x-satori-csrf'];
 assert.equal((await api('/api/v2/admin/push/device',{deviceId,token,platform:'android'},noCsrf)).status,403);
 const badOrigin={...ownerSession.headers,origin:'https://evil.example.invalid'};
 assert.equal((await api('/api/v2/admin/push/device',{deviceId,token,platform:'android'},badOrigin)).status,403);
 const asCustomer=await api('/api/v2/admin/push/device',{deviceId,token,platform:'android'},customerSession.headers);
 assert.equal(asCustomer.status,403);assert.equal(asCustomer.error,'ADMIN_REQUIRED');
 assert.equal((await api('/api/v2/admin/push/device',{deviceId,token:'bad token'},ownerSession.headers)).status,400);
 pass('Only authenticated Owner with valid Origin+CSRF can register an FCM token');

 const reg=await api('/api/v2/admin/push/device',{deviceId,token,platform:'android'},ownerSession.headers);
 assert.equal(reg.status,200,JSON.stringify(reg));
 assert.equal(reg.registered,true);assert.equal(reg.tokenSuffix,token.slice(-6));
 assert.ok(!JSON.stringify(reg).includes(token),'full token never echoed');
 const again=await api('/api/v2/admin/push/device',{deviceId,token,platform:'android'},ownerSession.headers);
 assert.equal(again.status,200);
 assert.equal((await one('SELECT count(*)::int AS n FROM satori_v2_owner_push_devices')).n,1);
 const status=await api('/api/v2/admin/push/status?deviceId='+deviceId,undefined,ownerSession.headers,'GET');
 assert.equal(status.status,200);assert.equal(status.serverPushEnabled,true);
 assert.equal(status.device.registered,true);assert.equal(status.device.currentSession,true);
 assert.ok(!JSON.stringify(status).includes(token),'status never exposes the token');
 pass('Owner device registration is idempotent; status is safe (no token)');

 // --- Signed wake endpoint (no cookie) ---------------------------------
 const {createHmac}=await import('node:crypto');
 const wake=async(mutate={})=>{
  const ts=Date.now(),nonce=randomBytes(16).toString('hex'),changedAt=ts-1000;
  let sig=createHmac('sha256',pushEnv.SATORI_OWNER_PUSH_WAKE_SECRET).update(ts+'\n'+nonce+'\n'+changedAt).digest('hex');
  const body={ts,nonce,changedAt,...mutate.body};if(mutate.sig)sig=mutate.sig;
  const r=await fetch(base+'/api/v2/push/wake',{method:'POST',headers:{'content-type':'application/json','x-satori-wake-signature':sig},body:JSON.stringify(body)});
  return {status:r.status,...await r.json()};
 };
 assert.equal((await wake({sig:'0'.repeat(64)})).status,403);
 assert.equal((await wake({body:{changedAt:1}})).status,403,'tampered payload breaks signature');
 assert.equal((await wake({body:{ts:Date.now()-600_000}})).status,401,'stale request expired');
 const validWake=await wake();
 // Signature accepted; this CI child has no signed ledger reader configured,
 // so the relay correctly refuses to start instead of pretending success.
 assert.equal(validWake.status,503);assert.equal(validWake.error,'READ_ONLY_NOT_CONFIGURED');
 pass('Wake endpoint: forged/tampered rejected, valid signature accepted, fail-closed without ledger reader');

 // --- Relay: baseline, new invoice, idempotency ------------------------
 ledger=[{id:'L-1',invoiceNo:7001,status:'Chưa thanh toán'}];
 await tick();
 assert.equal(delivered.length,0,'first scan is a quiet baseline');
 // Event created after device registration
 ledger.push({id:'L-2',invoiceNo:7002,status:'Chưa thanh toán'});
 await tick();
 assert.equal(delivered.length,1);
 assert.deepEqual({type:delivered[0].data.type,invoiceNo:delivered[0].data.invoiceNo},
  {type:'verified_new_invoice',invoiceNo:'7002'});
 assert.match(delivered[0].data.eventId,/^[0-9a-f-]{36}$/);
 assert.equal(delivered[0].token,token);
 pass('TEST 01-04 server side: new canonical invoice -> exactly one FCM data message');

 for(let i=0;i<5;i++){revision++;await tick();await makeDue();}
 ledger[1]={...ledger[1],status:'Đã thanh toán'};await tick();
 assert.equal(delivered.length,1);
 pass('TEST 06: same bill re-synced / edited / paid -> no duplicate push');

 ledger.push({id:'L-3',invoiceNo:7003,status:'Đã hủy'},{id:'L-4',invoiceNo:7004,status:'Chưa thanh toán',excluded:true},
  {id:'L-5',invoiceNo:7005,status:'Chưa thanh toán',isTest:true},{id:'L-6',invoiceNo:7006,status:'DRAFT'});
 await tick();
 assert.equal(delivered.length,1);
 pass('Cancelled / excluded / TEST / draft invoices never notify');

 // --- Concurrency: two relay ticks at once -> one push -----------------
 ledger.push({id:'L-7',invoiceNo:7007,status:'Chưa thanh toán'});
 await Promise.all([tick(),tick(),tick()]);
 assert.equal(delivered.filter(x=>x.data.invoiceNo==='7007').length,1);
 pass('Concurrent relay ticks deliver exactly one push per invoice');

 // --- TEST 09: FCM outage never touches invoices; retried later --------
 fcmMode='down';
 ledger.push({id:'L-8',invoiceNo:7008,status:'Chưa thanh toán'});
 const ledgerBefore=JSON.stringify(ledger);
 await tick();
 assert.equal(delivered.filter(x=>x.data.invoiceNo==='7008').length,0);
 const failedRow=await one("SELECT p.attempts,p.last_error_code,p.delivered_at FROM satori_v2_owner_push_deliveries p JOIN satori_v2_owner_push_events e ON e.id=p.event_id WHERE e.invoice_no=7008");
 assert.equal(failedRow.last_error_code,'FCM_UNAVAILABLE');assert.equal(failedRow.delivered_at,null);
 assert.equal(JSON.stringify(ledger),ledgerBefore,'relay never mutates the ledger');
 fcmMode='ok';await tick();
 assert.equal(delivered.filter(x=>x.data.invoiceNo==='7008').length,0,'backoff respected');
 await makeDue();await tick();
 assert.equal(delivered.filter(x=>x.data.invoiceNo==='7008').length,1);
 await makeDue();await tick();
 assert.equal(delivered.filter(x=>x.data.invoiceNo==='7008').length,1);
 pass('TEST 09: FCM failure -> invoice untouched, retried with backoff, delivered once');

 // --- TEST 07: phone/network offline then back -------------------------
 fcmMode='offline';
 ledger.push({id:'L-9',invoiceNo:7009,status:'Chưa thanh toán'});
 await tick();await makeDue();await tick();
 fcmMode='ok';await makeDue();await tick();await makeDue();await tick();
 assert.equal(delivered.filter(x=>x.data.invoiceNo==='7009').length,1);
 ledgerDown=true;await assert.rejects(scanInvoices(pool,reader));ledgerDown=false;
 assert.equal((await one("SELECT count(*)::int n FROM satori_v2_owner_push_events WHERE invoice_no=7009")).n,1);
 pass('TEST 07: offline then online -> one valid notification, no duplicate; ledger outage safe');

 // --- Test push endpoint helper (synthetic, no invoice) ----------------
 const testPush=await sendTestPush(pool,{id:owner.id},hash(ownerSession.token),deviceId,send);
 assert.equal(testPush.accepted,true);
 assert.equal(delivered.at(-1).data.type,'owner_push_test');
 assert.equal(delivered.at(-1).data.invoiceNo,undefined);
 pass('Owner synthetic test push reaches only this session device, without invoice data');

 // --- Dead token is disabled -------------------------------------------
 const dead=await session(owner);const deadDevice=randomUUID();
 const deadToken='fAkE_dead_tOkEn:APA91b'+randomBytes(60).toString('hex');
 assert.equal((await api('/api/v2/admin/push/device',{deviceId:deadDevice,token:deadToken,platform:'android'},dead.headers)).status,200);
 const realSend=send;
 const mixed=async msg=>msg.token===deadToken?
  Promise.reject(Object.assign(Error('x'),{code:'FCM_TOKEN_UNREGISTERED',invalidToken:true})):realSend(msg);
 ledger.push({id:'L-10',invoiceNo:7010,status:'Chưa thanh toán'});
 await scanInvoices(pool,reader);await queueDeliveries(pool,ownerSub);await dispatch(pool,ownerSub,mixed);
 const deadRow=await one('SELECT enabled,last_error_code FROM satori_v2_owner_push_devices WHERE device_id=$1',[deadDevice]);
 assert.equal(deadRow.enabled,false);assert.equal(deadRow.last_error_code,'FCM_TOKEN_UNREGISTERED');
 assert.equal(delivered.filter(x=>x.data.invoiceNo==='7010').length,1,'healthy device still gets it');
 pass('Expired/unregistered FCM token is disabled with a safe audit code');

 // --- TEST 08: Owner logout revokes the device --------------------------
 assert.equal((await api('/api/v2/logout',{},ownerSession.headers)).status,200);
 assert.equal((await one('SELECT count(*)::int n FROM satori_v2_owner_push_devices WHERE device_id=$1',[deviceId])).n,0);
 ledger.push({id:'L-11',invoiceNo:7011,status:'Chưa thanh toán'});
 await tick();
 assert.equal(delivered.filter(x=>x.data.invoiceNo==='7011').length,0);
 assert.equal((await api('/api/v2/admin/push/status',undefined,ownerSession.headers,'GET')).status,401);
 pass('TEST 08: Owner logout -> token removed, no further pushes, status 401');

 // --- New device never receives historical events ----------------------
 const fresh=await session(owner);const freshId=randomUUID();
 const freshToken='fAkE_fresh_tOkEn:APA91b'+randomBytes(60).toString('hex');
 assert.equal((await api('/api/v2/admin/push/device',{deviceId:freshId,token:freshToken,platform:'android'},fresh.headers)).status,200);
 await tick();
 assert.equal(delivered.filter(x=>x.token===freshToken).length,0);
 pass('Newly registered phone is not flooded with historical invoices');

 // --- Relay lifecycle: kick() delivers without waiting for the interval --
 const relay=startOwnerPushRelay({env:pushEnv,pool,reader,send,intervalMs:3_600_000});
 assert.equal(relay.enabled,true);
 ledger.push({id:'L-12',invoiceNo:7012,status:'Chưa thanh toán'});
 relay.kick();
 for(let i=0;i<100&&!delivered.some(x=>x.data.invoiceNo==='7012');i++)await delay(30);
 assert.equal(delivered.filter(x=>x.data.invoiceNo==='7012'&&x.token===freshToken).length,1);
 await relay.stop();
 pass('Checkout COMMITTED kick() delivers immediately; durable interval is the fallback');

 console.log('PASS owner push PostgreSQL suite: '+results.length+' scenarios');
}finally{
 if(child){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped}
 await pool.end();
}
