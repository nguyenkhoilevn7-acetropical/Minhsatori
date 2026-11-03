/* >100 invoices/day: 101, 150, 250 new orders while the relay was asleep.
 * Disposable localhost PostgreSQL + a FAKE ledger that reproduces BotApi.gs
 * orders.list semantics exactly: newest first (unshift), max 100 rows,
 * substring query over name/phone/invoiceNo, totalMatches = all matches. */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
import {scanInvoices,queueDeliveries,dispatch,ensureOwnerPushSchema} from '../owner-push.mjs';

const url=process.env.SATORI_V2_CI_DATABASE_URL||'';
assert.ok(url.includes('127.0.0.1')&&url.endsWith('/satori_v2_ci'),'CI database only');
const pool=new pg.Pool({connectionString:url,max:4});
const hash=s=>createHash('sha256').update(s).digest('hex');
const one=async(sql,args)=>(await pool.query(sql,args)).rows[0];
const vnDay=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const now=new Date();
const today=vnDay(now),yesterday=vnDay(new Date(now.getTime()-86_400_000));

function fakeBotApi(ledger,stats){
 const norm=v=>String(v??'').toLowerCase();
 return async(action,p)=>{
  assert.equal(action,'orders.list','only the existing owner orders:read action is used');
  assert.ok(Number(p.limit)<=100);
  stats.calls++;if(p.query)stats.probes++;
  const q=norm(p.query||'');
  const found=ledger.filter(o=>{
   if(q&&![o.name,o.phone,o.invoiceNo].some(v=>norm(v).includes(q)))return false;
   if(p.status&&o.status!==p.status)return false;
   if((p.from||p.to)&&((p.from&&o.date<p.from)||(p.to&&o.date>p.to)))return false;
   return true;
  });
  return {revision:stats.revision,data:{totalMatches:found.length,
   orders:found.slice(0,Math.min(100,Math.max(1,Number(p.limit)||30)))}};
 };
}

async function scenario(newCount,ownerSub,deviceId,token){
 await pool.query('TRUNCATE satori_v2_owner_push_deliveries,satori_v2_owner_push_events,satori_v2_owner_push_feed_state');
 const ledger=[],stats={calls:0,probes:0,revision:1};
 let no=9000;
 const order=(date,extra={})=>({id:'L'+(++no),invoiceNo:no,date,name:'Khách giả '+no,
  phone:'09'+String(Math.floor(Math.random()*1e8)).padStart(8,'0'),status:'Chưa thanh toán',timestamp:Date.now(),...extra});
 for(let i=0;i<30;i++)ledger.unshift(order(yesterday));
 for(let i=0;i<40;i++)ledger.unshift(order(today));
 const reader=fakeBotApi(ledger,stats);
 await scanInvoices(pool,reader,now);
 // Relay asleep: newCount official orders arrive (some phones deliberately
 // contain another invoice number to stress the substring readback).
 const fresh=[];
 for(let i=0;i<newCount;i++){
  const o=order(today,i%17===0?{phone:'0908'+String(no+3).padStart(6,'0')}:{});
  ledger.unshift(o);fresh.push(o.invoiceNo);stats.revision++;
 }
 const sent=[];
 const send=async m=>{sent.push(m);return true};
 let ticks=0,res;
 do{
  res=await scanInvoices(pool,reader,now);
  await queueDeliveries(pool,ownerSub);
  await dispatch(pool,ownerSub,send);
  ticks++;
 }while(res.backlog>0&&ticks<30);
 assert.equal(res.backlog,0,'backfill completes');
 assert.equal(res.unresolved,0);
 // Deliveries are claimed 30 per dispatch; drain the queue.
 for(let i=0;i<20;i++){
  await pool.query('UPDATE satori_v2_owner_push_deliveries SET retry_at=now() WHERE delivered_at IS NULL');
  await dispatch(pool,ownerSub,send);
 }
 const numbers=sent.map(m=>Number(m.data.invoiceNo));
 assert.equal(new Set(numbers).size,numbers.length,'no duplicate notification');
 assert.deepEqual([...numbers].sort((a,b)=>a-b),[...fresh].sort((a,b)=>a-b),
  "every new invoice notified, missing="+JSON.stringify(fresh.filter(x=>!numbers.includes(x)))+" extra="+JSON.stringify(numbers.filter(x=>!fresh.includes(x))));
 assert.ok(sent.every(m=>m.token===token));
 // Re-scan after completion: no new pushes, no extra probes beyond the window.
 const before=stats.probes;
 await scanInvoices(pool,reader,now);await queueDeliveries(pool,ownerSub);await dispatch(pool,ownerSub,send);
 assert.equal(sent.length,newCount);
 assert.equal(stats.probes,before,'steady state uses only the two day-window reads');
 const lastFeed=await one('SELECT backfill_next,last_error_code FROM satori_v2_owner_push_feed_state WHERE feed=$1',['invoices']);
 assert.equal(lastFeed.backfill_next,null);assert.equal(lastFeed.last_error_code,null);
 console.log(`PASS ${newCount} new invoices/day: ${newCount} pushes, 0 duplicates, ${ticks} ticks, ${stats.probes} exact readbacks`);
}

try{
 await ensureOwnerPushSchema(pool);
 await pool.query('TRUNCATE satori_v2_owner_push_deliveries,satori_v2_owner_push_events,satori_v2_owner_push_feed_state,satori_v2_owner_push_devices');
 const ownerSub='fake-volume-owner-'+randomUUID();
 const owner=await one("INSERT INTO satori_v2_accounts(google_sub,email,access_status) VALUES($1,'volume-owner@example.invalid','ACTIVE') RETURNING id",[ownerSub]);
 const session=randomBytes(32).toString('hex');
 await pool.query("INSERT INTO satori_v2_sessions(token_hash,csrf_hash,account_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[hash(session),hash('csrf'),owner.id]);
 const deviceId=randomUUID(),token='fAkE_volume_tOkEn:APA91b'+randomBytes(60).toString('hex');
 await pool.query("INSERT INTO satori_v2_owner_push_devices(device_id,account_id,session_hash,token,token_hash,registered_at) VALUES($1,$2,$3,$4,$5,now()-interval '1 hour')",
  [deviceId,owner.id,hash(session),token,hash(token)]);
 for(const n of [101,150,250])await scenario(n,ownerSub,deviceId,token);

 // Pathological: >100 same-day, same-status rows whose phone contains the
 // probed digits. The number cannot be resolved yet -> cursor HOLDS (never
 // skipped), safe error code is recorded, and it is delivered once resolvable.
 {
  await pool.query('TRUNCATE satori_v2_owner_push_deliveries,satori_v2_owner_push_events,satori_v2_owner_push_feed_state');
  const ledger=[],stats={calls:0,probes:0,revision:1},sent=[];
  const send=async m=>{sent.push(m);return true};
  const mk=(n,phone)=>({id:'P'+n,invoiceNo:n,date:today,name:'Khách giả '+n,phone,status:'Chưa thanh toán',timestamp:Date.now()});
  ledger.unshift(mk(8000,'0900000000'));
  const reader=fakeBotApi(ledger,stats);
  await scanInvoices(pool,reader,now);
  ledger.unshift(mk(8001,'0900000001'));               // the hard-to-read invoice
  for(let n=8002;n<8130;n++)ledger.unshift(mk(n,'098'+'8001'+String(n).slice(-3)));
  let r;for(let i=0;i<6;i++)r=await scanInvoices(pool,reader,now);
  const st=await one('SELECT backfill_next,last_error_code FROM satori_v2_owner_push_feed_state WHERE feed=$1',['invoices']);
  assert.equal(Number(st.backfill_next),8001,'cursor holds on the unresolved invoice');
  assert.equal(st.last_error_code,'PUSH_BACKFILL_UNRESOLVED');
  assert.ok(r.backlog>0);
  // Owner marks 40 colliding orders paid -> the day+status read now fits.
  ledger.filter(o=>o.invoiceNo>=8090).forEach(o=>{o.status='Đã thanh toán'});
  for(let i=0;i<5&&(r=await scanInvoices(pool,reader,now)).backlog>0;i++);
  assert.equal(r.backlog,0);
  await queueDeliveries(pool,ownerSub);
  for(let i=0;i<8;i++){
   await pool.query('UPDATE satori_v2_owner_push_deliveries SET retry_at=now() WHERE delivered_at IS NULL');
   await dispatch(pool,ownerSub,send);
  }
  assert.equal(sent.filter(m=>m.data.invoiceNo==='8001').length,1,'never skipped');
  const nums=sent.map(m=>m.data.invoiceNo);assert.equal(new Set(nums).size,nums.length);
  console.log('PASS unresolvable readback holds the cursor (no skip) and recovers exactly once');
 }

 // An invoice older than 48h (restored from trash / found after a long outage) never alerts.
 await pool.query('TRUNCATE satori_v2_owner_push_deliveries,satori_v2_owner_push_events,satori_v2_owner_push_feed_state');
 const ledger=[{id:'R1',invoiceNo:100,date:today,name:'a',phone:'0',status:'Chưa thanh toán',timestamp:Date.now()}];
 const stats={calls:0,probes:0,revision:1},reader=fakeBotApi(ledger,stats),sent=[];
 await scanInvoices(pool,reader,now);
 ledger.unshift({id:'R2',invoiceNo:50,date:today,name:'b',phone:'0',status:'Chưa thanh toán',timestamp:Date.now()-5*86_400_000});
 await scanInvoices(pool,reader,now);await queueDeliveries(pool,ownerSub);await dispatch(pool,ownerSub,async m=>{sent.push(m);return true});
 assert.equal(sent.length,0);
 console.log('PASS restored / >48h-old invoice does not notify');
}finally{await pool.end()}
