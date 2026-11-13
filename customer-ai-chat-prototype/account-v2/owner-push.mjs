/**
 * Owner-only FCM push for NEW, verified canonical invoices.
 *
 * Pipeline (every official source: Website V2, Gemini V2, ChatGPT connector,
 * any other writer of the canonical Minh Satori ledger):
 *   canonical ledger (signed READ-ONLY orders.list)
 *     -> satori_v2_owner_push_events   (stable event id per invoiceNo|ledgerId)
 *     -> satori_v2_owner_push_deliveries (per device, retry/backoff, audit code)
 *     -> FCM HTTP v1 (Google service account from Render secrets)
 *     -> Android FirebaseMessagingService (data message, high priority)
 *
 * Safety:
 *  - NEVER writes the canonical ledger, invoices, payments, VAT, or shipping.
 *  - A push failure can never fail or duplicate an invoice: the relay runs
 *    outside every checkout transaction and only reads the signed ledger.
 *  - Events are idempotent (UNIQUE kind+source_key); an edited/paid invoice
 *    can never re-alert. The FIRST scan is a quiet baseline (no flood).
 *  - Disabled unless SATORI_OWNER_PUSH_ENABLED=1 AND a matching service
 *    account is configured. No token, cookie, key or customer data is logged
 *    or sent in the push (only the numeric invoice number and event id).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const TZ='Asia/Ho_Chi_Minh';
const FCM_SCOPE='https://www.googleapis.com/auth/firebase.messaging';
const MAX_ATTEMPTS=12;
const INTERVAL_MS=30_000;
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const pushError=(code,status)=>Object.assign(new Error(code),{code,status});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const fold=x=>String(x??'').normalize('NFD').replace(/[̀-ͯ]/g,'')
 .replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
const excludedStatus=x=>/(?:khong tinh|da huy|huy don|bi tu choi|cancel|void|draft|nhap|test|reject)/
 .test(fold(x));

/** Shared relay diagnostics (process-local, no secrets). */
export const relayState={started:false,lastScanAt:null,lastScanError:null,
 lastDispatchAt:null,lastDispatchError:null,kicks:0};
let activeRelay=null;

/** Validates server configuration WITHOUT logging or returning any secret. */
export function ownerPushConfig(env=process.env){
 if(env.SATORI_OWNER_PUSH_ENABLED!=='1')return {enabled:false,reason:'PUSH_DISABLED'};
 const projectId=String(env.SATORI_FCM_PROJECT_ID||'');
 if(!/^[a-z][a-z0-9-]{4,62}$/.test(projectId))
  return {enabled:false,reason:'FCM_PROJECT_ID_MISSING'};
 let credentials;
 try{credentials=JSON.parse(String(env.SATORI_FCM_SERVICE_ACCOUNT_JSON||''))}
 catch{return {enabled:false,reason:'FCM_SERVICE_ACCOUNT_MISSING'}}
 if(!credentials||credentials.type!=='service_account'||
  typeof credentials.client_email!=='string'||
  typeof credentials.private_key!=='string'||
  !credentials.private_key.includes('PRIVATE KEY'))
  return {enabled:false,reason:'FCM_SERVICE_ACCOUNT_INVALID'};
 if(credentials.project_id!==projectId)
  return {enabled:false,reason:'FCM_PROJECT_MISMATCH'};
 return {enabled:true,reason:'READY',projectId,credentials};
}
export const ownerPushReady=(env=process.env)=>ownerPushConfig(env).enabled;

export function validateDevice(input){
 if(!input||typeof input!=='object'||!UUID.test(String(input.deviceId||''))||
  typeof input.token!=='string'||input.token.length<40||input.token.length>4096||
  !/^[A-Za-z0-9:_-]+$/.test(input.token)||
  (input.platform!==undefined&&input.platform!=='android'))
  throw pushError('PUSH_DEVICE_INVALID',400);
 return {deviceId:input.deviceId.toLowerCase(),token:input.token};
}

let schemaReady=null;
/** Additive idempotent DDL; only invoked when the owner explicitly enables push. */
export function ensureOwnerPushSchema(pool){
 if(!schemaReady)schemaReady=pool.query(fs.readFileSync(
  path.join(HERE,'migrations/20261103_owner_push.sql'),'utf8'))
  .then(()=>pool.query(fs.readFileSync(
   path.join(HERE,'migrations/20261111_owner_pdf_delivery.sql'),'utf8')))
  .then(()=>pool.query(fs.readFileSync(
   path.join(HERE,'migrations/20261112_pdf_filename.sql'),'utf8')))
  .then(()=>pool.query(fs.readFileSync(
   path.join(HERE,'migrations/20261112_grok_order_drafts.sql'),'utf8')))
  .then(()=>true).catch(e=>{schemaReady=null;throw e});
 return schemaReady;
}

/** Call ONLY after auth() (session + CSRF + Origin) and owner(actor). */
export async function registerOwnerDevice(pool,actor,sessionHash,input,env=process.env){
 const cfg=ownerPushConfig(env);
 if(!cfg.enabled)throw pushError(cfg.reason,503);
 if(!/^[a-f0-9]{64}$/.test(String(sessionHash||'')))
  throw pushError('OWNER_SESSION_INVALID',401);
 const device=validateDevice(input);
 await ensureOwnerPushSchema(pool);
 const digest=sha(device.token);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // A token can belong to only one device row; a reinstall re-registers it.
  const other=await client.query('SELECT device_id,account_id FROM satori_v2_owner_push_devices '+
   'WHERE token_hash=$1 FOR UPDATE',[digest]);
  if(other.rows.some(r=>r.account_id!==actor.id))
   throw pushError('PUSH_DEVICE_ALREADY_OWNED',403);
  await client.query('DELETE FROM satori_v2_owner_push_devices WHERE token_hash=$1 AND device_id<>$2',
   [digest,device.deviceId]);
  const saved=await client.query('INSERT INTO satori_v2_owner_push_devices '+
   '(device_id,account_id,session_hash,token,token_hash) VALUES($1,$2,$3,$4,$5) '+
   'ON CONFLICT(device_id) DO UPDATE SET session_hash=EXCLUDED.session_hash,'+
   'token=EXCLUDED.token,token_hash=EXCLUDED.token_hash,enabled=true,'+
   'last_error_code=NULL,updated_at=now() '+
   'WHERE satori_v2_owner_push_devices.account_id=EXCLUDED.account_id '+
   'RETURNING (xmax=0) AS inserted',
   [device.deviceId,actor.id,sessionHash,device.token,digest]);
  if(saved.rowCount!==1)throw pushError('PUSH_DEVICE_ALREADY_OWNED',403);
  await client.query('COMMIT');
  return {ok:true,registered:true,serverPushEnabled:true,
   tokenSuffix:device.token.slice(-6)};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
 finally{client.release()}
}

export async function revokeOwnerDevice(pool,actor,input){
 if(!UUID.test(String(input?.deviceId||'')))throw pushError('PUSH_DEVICE_INVALID',400);
 await ensureOwnerPushSchema(pool);
 const r=await pool.query('DELETE FROM satori_v2_owner_push_devices WHERE device_id=$1 AND account_id=$2',
  [input.deviceId.toLowerCase(),actor.id]);
 return {ok:true,revoked:r.rowCount>0};
}

/** Safe diagnostic summary: never returns a token, cookie or credential. */
export async function ownerPushStatus(pool,actor,sessionHash,deviceId,env=process.env){
 const cfg=ownerPushConfig(env);
 const out={ok:true,serverPushEnabled:cfg.enabled,serverReason:cfg.reason,
  ownerSession:'VALID',device:null,relay:{...relayState}};
 if(!cfg.enabled)return out;
 await ensureOwnerPushSchema(pool);
 if(UUID.test(String(deviceId||''))){
  const d=await pool.query('SELECT d.enabled,d.registered_at AS "registeredAt",'+
   'd.updated_at AS "updatedAt",d.last_error_code AS "lastErrorCode",'+
   'right(d.token,6) AS "tokenSuffix",(d.session_hash=$3) AS "currentSession",'+
   '(SELECT max(delivered_at) FROM satori_v2_owner_push_deliveries p WHERE p.device_id=d.device_id) AS "lastDeliveredAt",'+
   '(SELECT last_error_code FROM satori_v2_owner_push_deliveries p WHERE p.device_id=d.device_id '+
   'AND p.last_error_code IS NOT NULL ORDER BY retry_at DESC LIMIT 1) AS "lastDeliveryError" '+
   'FROM satori_v2_owner_push_devices d WHERE d.device_id=$1 AND d.account_id=$2',
   [String(deviceId).toLowerCase(),actor.id,sessionHash]);
  out.device=d.rows[0]?{registered:true,...d.rows[0]}:{registered:false};
 }
 const feed=await pool.query('SELECT initialized,last_checked_at AS "lastCheckedAt",'+
  'last_error_code AS "lastErrorCode" FROM satori_v2_owner_push_feed_state WHERE feed=$1',['invoices']);
 out.feed=feed.rows[0]||{initialized:false};
 return out;
}

/** Older invoices (e.g. restored from trash, or found after a long outage) never alert. */
const MAX_INVOICE_AGE_MS=48*3_600_000;
const MAX_CLOCK_SKEW_MS=10*60_000;
const vnDay=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',
 month:'2-digit',day:'2-digit'}).format(new Date(ms));
function isoDate(value){
 const v=String(value??'').trim();
 const m=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
 const iso=m?m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'):v;
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(iso))return null;
 const d=new Date(iso+'T00:00:00Z');
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===iso?iso:null;
}
const plausibleMs=(x,now)=>Number.isSafeInteger(x)&&x>=946_684_800_000&&x<=now+MAX_CLOCK_SKEW_MS;
/**
 * Freshness, fail-closed. BotApi.gs writes timestamp=Date.now() on every new
 * order. If it is missing/invalid/in the future, fall back to the invoice date
 * (must be today or yesterday, Vietnam time), then to a millisecond ledger id.
 * If the age cannot be established the invoice does NOT notify.
 */
export function invoiceIsFresh(row,now=Date.now()){
 const ts=Number(row?.timestamp);
 if(row?.timestamp!=null&&plausibleMs(ts,now))return now-ts<=MAX_INVOICE_AGE_MS;
 const date=isoDate(row?.date);
 if(date)return date===vnDay(now)||date===vnDay(now-86_400_000);
 const idMs=/^\d{13}$/.test(String(row?.id??''))?Number(row.id):NaN;
 if(plausibleMs(idMs,now))return now-idMs<=MAX_INVOICE_AGE_MS;
 return false;
}
export function eligibleOfficialInvoice(row,now=Date.now()){
 return !!row&&Number.isSafeInteger(Number(row.invoiceNo))&&Number(row.invoiceNo)>0&&
  safeId(String(row.id??''))&&row.missing!==true&&row.excluded!==true&&
  row.testOnly!==true&&row.isTest!==true&&row.draft!==true&&
  !excludedStatus(row.status)&&invoiceIsFresh(row,now);
}

/** Today and yesterday (Vietnam time). */
export function scanDays(now=new Date()){
 const day=d=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',
  month:'2-digit',day:'2-digit'}).format(d);
 return [...new Set([day(now),day(new Date(now.getTime()-86_400_000))])];
}

const PROBE_PER_TICK=40;
// Resource bounds. BotApi.gs takes the script lock for EVERY request (reads
// too), so readback must never monopolise it: a fixed Apps Script call budget
// per pass, a pause between readbacks so order writers can take the lock,
// a cap on consecutive passes per tick and a pause between passes.
const READ_BUDGET_PER_PASS=45;
const PROBE_PAUSE_MS=250;
const MAX_PASSES_PER_TICK=2;
const DRAIN_PAUSE_MS=3000;
const sleep=ms=>ms>0?new Promise(r=>setTimeout(r,ms)):Promise.resolve();
// Above this backlog a warning code is recorded; the backlog is NEVER truncated.
const LARGE_BACKFILL=1000;
function signedRows(result){
 if(!Number.isSafeInteger(result?.revision)||!Array.isArray(result?.data?.orders))
  throw pushError('PUSH_LEDGER_NOT_VERIFIED');
 const rows=result.data.orders;
 const total=Number(result.data.totalMatches??rows.length);
 if(!Number.isSafeInteger(total)||total<rows.length)throw pushError('PUSH_LEDGER_NOT_VERIFIED');
 return {rows,truncated:total>rows.length};
}
function refOf(row){
 const no=Number(row?.invoiceNo);
 return Number.isSafeInteger(no)&&no>0&&safeId(String(row?.id??''))?{no,key:no+'|'+String(row.id)}:null;
}

/**
 * Exact single-invoice readback with the SAME owner orders:read scope already
 * used by local-invoice-read.mjs (orders.list query=<number>, filtered to an
 * exact invoiceNo). If the substring query matches >100 rows (phones/names can
 * contain the digits), it is narrowed with the filters BotApi.gs select()
 * already supports: a single day, then day + status. No new Bot API action.
 */
const KNOWN_STATUSES=['Chưa thanh toán','Đã thanh toán','Đã TT Satori','Đã hủy','Không Tính'];
export async function probeInvoiceNumber(reader,no,{days=[],statuses=[]}={}){
 const attempt=async payload=>{
  const {rows,truncated}=signedRows(await reader('orders.list',{query:String(no),limit:100,...payload}));
  const exact=rows.filter(r=>Number(r?.invoiceNo)===no&&refOf(r));
  return {exact,truncated};
 };
 let r=await attempt({});
 if(r.exact.length)return {state:'FOUND',rows:r.exact};
 if(!r.truncated)return {state:'MISSING',rows:[]};
 let allDaysComplete=true;
 for(const d of days){
  r=await attempt({from:d,to:d});
  if(r.exact.length)return {state:'FOUND',rows:r.exact};
  if(!r.truncated)continue;
  let dayComplete=true;
  for(const status of [...new Set([...KNOWN_STATUSES,...statuses])]){
   const x=await attempt({from:d,to:d,status});
   if(x.exact.length)return {state:'FOUND',rows:x.exact};
   if(x.truncated)dayComplete=false;
  }
  if(!dayComplete)allDaysComplete=false;
 }
 // Not in the recent days: an older/deleted number, never a new order to alert.
 return {state:allDaysComplete?'MISSING':'UNRESOLVED',rows:[]};
}

/**
 * The canonical Bot API returns newest invoices FIRST (BotApi.gs unshift) and
 * at most 100 rows per read. A day window therefore always contains the most
 * recent invoices. Any invoice number between the highest number already known
 * and the oldest unseen row in the window (e.g. >100 orders while the service
 * slept) is read back one number at a time, PROBE_PER_TICK per tick, with a
 * persisted cursor, so invoice #101, #150, #250 of a day are never skipped.
 */
export async function scanInvoices(pool,sourceReader,now=new Date(),
 {probeLimit=PROBE_PER_TICK,readBudget=READ_BUDGET_PER_PASS,probePauseMs=PROBE_PAUSE_MS}={}){
 const nowMs=now.getTime();
 let reads=0;
 // Hard cap: no code path (including the FIRST adversarial readback)
 // may call Apps Script after the 45-request budget is exhausted.
 const reader=(action,payload)=>{
  if(reads>=readBudget)throw pushError('PUSH_READ_BUDGET_EXHAUSTED');
  reads++;
  return sourceReader(action,payload);
 };
 const found=new Map();
 const add=row=>{const r=refOf(row);if(r)found.set(r.key,{invoiceNo:r.no,
  ledgerId:String(row.id),recipientName:String(row.name??'').trim().slice(0,160),
   orderDate:String(row.date??'').trim().slice(0,30),
   eligible:eligibleOfficialInvoice(row,nowMs)})};
 const statuses=new Set();
 for(const d of scanDays(now)){
  const {rows}=signedRows(await reader('orders.list',{from:d,to:d,limit:100}));
  rows.forEach(add);
  rows.forEach(r=>{if(typeof r?.status==='string'&&r.status.length<=40)statuses.add(r.status)});
 }
 const known=await pool.query('SELECT max(invoice_no)::bigint AS max FROM satori_v2_owner_push_events');
 const knownMax=known.rows[0]?.max==null?null:Number(known.rows[0].max);
 const seen=new Set((await pool.query('SELECT source_key FROM satori_v2_owner_push_events '+
  'WHERE source_key=ANY($1::text[])',[[...found.keys()]])).rows.map(r=>r.source_key));
 const unseenNos=[...found].filter(([k])=>!seen.has(k)).map(([,x])=>x.invoiceNo);
 const st=await pool.query('SELECT initialized,backfill_next,backfill_until FROM satori_v2_owner_push_feed_state WHERE feed=$1',['invoices']);
 let next=st.rows[0]?.backfill_next==null?null:Number(st.rows[0].backfill_next);
 let until=st.rows[0]?.backfill_until==null?null:Number(st.rows[0].backfill_until);
 if(st.rows[0]?.initialized===true&&knownMax!=null&&unseenNos.length){
  const gapHigh=Math.min(...unseenNos)-1, gapLow=knownMax+1;
  if(gapHigh>=gapLow){
   next=next==null?gapLow:Math.min(next,gapLow);
   until=Math.max(until??gapHigh,gapHigh);
  }
 }
 let unresolved=0,budgetExhausted=false;
 // Worst case for one number: 1 + days*(1 + statuses) readbacks.
 const worstProbeReads=1+scanDays(now).length*(2+KNOWN_STATUSES.length+statuses.size);
 for(let probes=0;next!=null&&next<=until&&probes<probeLimit;probes++,next++){
  if([...found.values()].some(x=>x.invoiceNo===next))continue;
  // Stop BEFORE a readback could exceed the budget; the cursor stays on `next`.
  if(reads+worstProbeReads>readBudget&&probes>0){budgetExhausted=true;break}
  if(reads>=readBudget){budgetExhausted=true;break}
  if(probes>0)await sleep(probePauseMs);
  let probe;
  try{
   probe=await probeInvoiceNumber(reader,next,{days:scanDays(now),statuses:[...statuses]});
  }catch(e){
   // The cursor stays on this invoice; alert diagnostics instead of
   // exceeding the per-pass lock contention budget or silently skipping it.
   if(e?.code!=='PUSH_READ_BUDGET_EXHAUSTED')throw e;
   budgetExhausted=true;
   break;
  }
  probe.rows.forEach(add);
  // Never skip an unresolved number: keep the cursor here and retry next tick.
  if(probe.state==='UNRESOLVED'){unresolved++;break}
 }
 if(next!=null&&next>until){next=null;until=null}
 const client=await pool.connect();
 let inserted=0;
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['satori_owner_push_invoices']);
  await client.query('INSERT INTO satori_v2_owner_push_feed_state(feed) VALUES($1) ON CONFLICT DO NOTHING',['invoices']);
  const state=await client.query('SELECT initialized FROM satori_v2_owner_push_feed_state WHERE feed=$1 FOR UPDATE',['invoices']);
  const initialized=state.rows[0]?.initialized===true;
  for(const [key,x] of found){
   const r=await client.query('INSERT INTO satori_v2_owner_push_events(kind,source_key,invoice_no,eligible) '+
    'VALUES($1,$2,$3,$4) ON CONFLICT(kind,source_key) DO NOTHING',
    ['verified_new_invoice',key,x.invoiceNo,initialized&&x.eligible]);
   inserted+=r.rowCount;
   // Same decision as the push: only a NEW, eligible invoice (never the quiet
   // baseline, a re-scan, an edit or a payment change) gets one PDF delivery.
   if(r.rowCount===1&&initialized&&x.eligible)
    await client.query('INSERT INTO satori_v2_owner_pdf_deliveries(source_key,invoice_no,ledger_id,recipient_name,order_date) '+
      'VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_key) DO NOTHING',
      [key,x.invoiceNo,x.ledgerId,x.recipientName,x.orderDate]);
  }
  await client.query('UPDATE satori_v2_owner_push_feed_state SET initialized=true,last_checked_at=now(),'+
   'backfill_next=$2,backfill_until=$3,last_error_code=$4 WHERE feed=$1',
   ['invoices',next,until,unresolved?'PUSH_BACKFILL_UNRESOLVED':
    next!=null&&until-next+1>LARGE_BACKFILL?'PUSH_BACKFILL_LARGE':
    budgetExhausted?'PUSH_READ_BUDGET_EXHAUSTED':null]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
 finally{client.release()}
 return {seen:found.size,inserted,backlog:next==null?0:until-next+1,unresolved,reads,budgetExhausted};
}

// A subscribed owner phone keeps receiving pushes after the 7-day web session
// that registered it expires: the app cannot re-register while that session is
// expired, so filtering on expires_at silently stopped every push. Revocation is
// unchanged: logout/account revocation DELETE the session row, which cascades to
// the device (FK ON DELETE CASCADE); the bell toggle revokes; FCM token errors
// disable; a removed/suspended or non-owner account never receives.
const ownerDeviceFilter=
 'JOIN satori_v2_accounts a ON a.id=d.account_id '+
 "WHERE d.enabled=true AND a.google_sub=$1 AND a.access_status NOT IN ('REMOVED','SUSPENDED') ";

export async function queueDeliveries(pool,ownerSub){
 if(!ownerSub)return 0;
 // A newly enrolled phone never receives historical events. A "new order" alert
 // older than 2h is noise (the in-app badge still lists it), so it is not sent late.
 const r=await pool.query('INSERT INTO satori_v2_owner_push_deliveries(event_id,device_id) '+
  'SELECT e.id,d.device_id FROM satori_v2_owner_push_events e '+
  'CROSS JOIN satori_v2_owner_push_devices d '+ownerDeviceFilter+
  'AND e.eligible=true AND e.created_at>=d.registered_at '+
  "AND e.created_at>now()-interval '2 hours' ON CONFLICT DO NOTHING",[ownerSub]);
 return r.rowCount;
}

async function claimDeliveries(pool,ownerSub){
 const claimed=await pool.query(
  'WITH due AS (SELECT event_id,device_id FROM satori_v2_owner_push_deliveries '+
  'WHERE delivered_at IS NULL AND retry_at<=now() AND attempts<$1 '+
  'ORDER BY retry_at LIMIT 30 FOR UPDATE SKIP LOCKED) '+
  'UPDATE satori_v2_owner_push_deliveries p SET attempts=p.attempts+1,'+
  // Lease + exponential backoff: 1,2,4..30 min. A crash simply retries later.
  "retry_at=now()+least(interval '30 minutes',interval '1 minute'*power(2,p.attempts)) "+
  'FROM due WHERE p.event_id=due.event_id AND p.device_id=due.device_id '+
  'RETURNING p.event_id,p.device_id',[MAX_ATTEMPTS]);
 if(!claimed.rows.length)return [];
 const r=await pool.query('SELECT e.id,e.invoice_no,d.device_id,d.token '+
  'FROM satori_v2_owner_push_events e '+
  'JOIN satori_v2_owner_push_deliveries p ON p.event_id=e.id '+
  'JOIN satori_v2_owner_push_devices d ON d.device_id=p.device_id '+ownerDeviceFilter+
  'AND p.event_id=ANY($2::uuid[]) AND p.device_id=ANY($3::uuid[]) AND p.delivered_at IS NULL',
  [ownerSub,claimed.rows.map(x=>x.event_id),claimed.rows.map(x=>x.device_id)]);
 const wanted=new Set(claimed.rows.map(x=>x.event_id+'|'+x.device_id));
 return r.rows.filter(x=>wanted.has(x.id+'|'+x.device_id));
}

/**
 * Maps an FCM HTTP v1 response to a SAFE low-cardinality audit code.
 * A device is disabled ONLY for a verified token error (FcmError UNREGISTERED,
 * or INVALID_ARGUMENT naming the registration token). A bare 404 (wrong
 * project/endpoint), 401/403 (credentials) or SENDER_ID_MISMATCH (server
 * project differs from the app's Firebase project) is a CONFIGURATION error:
 * it must never wipe every owner device.
 */
export function classifyFcmFailure(status,body){
 const details=Array.isArray(body?.error?.details)?body.error.details:[];
 const fcmCode=String(details.find(d=>/google\.firebase\.fcm\.v1\.FcmError$/.test(String(d?.['@type']||''))
  &&typeof d?.errorCode==='string')?.errorCode||'');
 const message=String(body?.error?.message||'');
 if(fcmCode==='UNREGISTERED')return {code:'FCM_TOKEN_UNREGISTERED',invalidToken:true};
 if(status===400&&(fcmCode==='INVALID_ARGUMENT'||body?.error?.status==='INVALID_ARGUMENT')&&
  /registration token/i.test(message))
  return {code:'FCM_TOKEN_INVALID',invalidToken:true};
 if(fcmCode==='SENDER_ID_MISMATCH')return {code:'FCM_SENDER_ID_MISMATCH',invalidToken:false,config:true};
 if(status===404)return {code:'FCM_PROJECT_OR_ENDPOINT_NOT_FOUND',invalidToken:false,config:true};
 if(status===401||status===403)return {code:'FCM_AUTH_FAILED',invalidToken:false,config:true};
 if(status===429||fcmCode==='QUOTA_EXCEEDED')return {code:'FCM_QUOTA_EXCEEDED',invalidToken:false};
 if(status>=500||fcmCode==='UNAVAILABLE'||fcmCode==='INTERNAL')return {code:'FCM_UNAVAILABLE',invalidToken:false};
 return {code:'FCM_HTTP_'+Number(status||0),invalidToken:false};
}

/** FCM HTTP v1 sender. The OAuth token comes from the service account only. */
export function createFcmSender(env=process.env,{fetcher=fetch,accessToken}={}){
 const cfg=ownerPushConfig(env);
 if(!cfg.enabled)throw pushError(cfg.reason,503);
 let client=null;
 const bearer=accessToken||(async()=>{
  if(!client){
   const {GoogleAuth}=await import('google-auth-library');
   client=await new GoogleAuth({credentials:cfg.credentials,scopes:[FCM_SCOPE]}).getClient();
  }
  const t=await client.getAccessToken();
  if(!t?.token)throw pushError('FCM_OAUTH_UNAVAILABLE');
  return t.token;
 });
 return async({token,data})=>{
  let response;
  try{
   response=await fetcher('https://fcm.googleapis.com/v1/projects/'+cfg.projectId+'/messages:send',{
    method:'POST',
    headers:{'content-type':'application/json','authorization':'Bearer '+await bearer()},
    body:JSON.stringify({message:{token,data,
     // Data-only + HIGH priority: onMessageReceived runs while the app is in
     // background or was closed by the system. TTL 6h covers offline phones.
     android:{priority:'HIGH',ttl:'21600s'}}}),
    signal:AbortSignal.timeout(8000)
   });
  }catch(e){
   if(e?.code&&String(e.code).startsWith('FCM_'))throw e;
   throw Object.assign(pushError('FCM_NETWORK_ERROR'),{invalidToken:false});
  }
  if(response.ok)return true;
  let body=null;try{body=await response.json()}catch{}
  const failure=classifyFcmFailure(response.status,body);
  throw Object.assign(pushError(failure.code),failure);
 };
}

export async function dispatch(pool,ownerSub,send){
 let sent=0,failed=0;
 for(const row of await claimDeliveries(pool,ownerSub)){
  try{
   await send({token:row.token,data:{type:'verified_new_invoice',
    invoiceNo:String(row.invoice_no),eventId:String(row.id)}});
   await pool.query('UPDATE satori_v2_owner_push_deliveries SET delivered_at=now(),last_error_code=NULL '+
    'WHERE event_id=$1 AND device_id=$2',[row.id,row.device_id]);
   sent++;
  }catch(e){
   failed++;
   const code=/^[A-Z0-9_]{3,40}$/.test(String(e?.code||''))?e.code:'FCM_SEND_FAILED';
   if(e?.invalidToken){
    await pool.query('UPDATE satori_v2_owner_push_devices SET enabled=false,last_error_code=$2,updated_at=now() '+
     'WHERE device_id=$1',[row.device_id,code]);
   }
   await pool.query('UPDATE satori_v2_owner_push_deliveries SET last_error_code=$3 '+
    'WHERE event_id=$1 AND device_id=$2',[row.id,row.device_id,code]);
  }
 }
 return {sent,failed};
}

/** Owner-triggered synthetic push to THIS session's device. No invoice data. */
export async function sendTestPush(pool,actor,sessionHash,deviceId,send){
 if(!UUID.test(String(deviceId||'')))throw pushError('PUSH_DEVICE_INVALID',400);
 await ensureOwnerPushSchema(pool);
 const d=await pool.query('SELECT token FROM satori_v2_owner_push_devices '+
  'WHERE device_id=$1 AND account_id=$2 AND session_hash=$3 AND enabled=true',
  [String(deviceId).toLowerCase(),actor.id,sessionHash]);
 if(!d.rows.length)throw pushError('PUSH_DEVICE_NOT_REGISTERED',404);
 const eventId='test-'+crypto.randomUUID();
 try{
  await send({token:d.rows[0].token,data:{type:'owner_push_test',eventId}});
  return {ok:true,accepted:true,eventId};
 }catch(e){
  const code=/^[A-Z0-9_]{3,40}$/.test(String(e?.code||''))?e.code:'FCM_SEND_FAILED';
  if(e?.invalidToken)await pool.query('UPDATE satori_v2_owner_push_devices SET enabled=false,'+
   'last_error_code=$2,updated_at=now() WHERE device_id=$1',[String(deviceId).toLowerCase(),code]);
  return {ok:false,accepted:false,errorCode:code};
 }
}

const wakeNonces=new Map();
/**
 * Authenticated wake-up from the canonical ledger side (Apps Script time-driven
 * trigger, see api/OwnerPushWake.gs). The request carries NO invoice data and
 * NO authority: it only makes a sleeping Render service start and re-read the
 * signed ledger. HMAC-SHA256 over "ts\nnonce\nchangedAt", +-5 min, single-use nonce.
 */
export function verifyWakeRequest(signature,input,env=process.env,now=Date.now()){
 const secret=String(env.SATORI_OWNER_PUSH_WAKE_SECRET||'');
 if(secret.length<32)return {ok:false,code:'PUSH_WAKE_NOT_CONFIGURED',status:503};
 const ts=input?.ts,nonce=String(input?.nonce||''),changedAt=input?.changedAt;
 if(!Number.isSafeInteger(ts)||!Number.isSafeInteger(changedAt)||changedAt<0||
  !/^[a-f0-9]{32}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(String(signature||'')))
  return {ok:false,code:'PUSH_WAKE_INVALID',status:400};
 if(Math.abs(now-ts)>300_000)return {ok:false,code:'PUSH_WAKE_EXPIRED',status:401};
 const expected=crypto.createHmac('sha256',secret).update(ts+'\n'+nonce+'\n'+changedAt,'utf8').digest();
 const given=Buffer.from(String(signature),'hex');
 if(given.length!==expected.length||!crypto.timingSafeEqual(given,expected))
  return {ok:false,code:'PUSH_WAKE_FORBIDDEN',status:403};
 for(const [k,exp] of wakeNonces)if(exp<now)wakeNonces.delete(k);
 if(wakeNonces.has(nonce))return {ok:false,code:'PUSH_WAKE_REPLAYED',status:409};
 if(wakeNonces.size>=2000)wakeNonces.delete(wakeNonces.keys().next().value);
 wakeNonces.set(nonce,now+600_000);
 return {ok:true};
}

/**
 * Starts the durable relay. Safe to call many times; returns the same relay.
 * kick() runs a tick immediately (e.g. right after a V2 checkout COMMITTED);
 * the interval tick is the durable fallback for every other source.
 */
export function startOwnerPushRelay({env=process.env,pool,reader,send,intervalMs=INTERVAL_MS,
 maxPassesPerTick=MAX_PASSES_PER_TICK,drainPauseMs=DRAIN_PAUSE_MS,scanOptions={}}={}){
 if(activeRelay)return activeRelay;
 const cfg=ownerPushConfig(env);
 if(!cfg.enabled||!pool||!reader)return {enabled:false,reason:cfg.enabled?'RELAY_DEPENDENCY_MISSING':cfg.reason,kick(){}};
 const sender=send||createFcmSender(env);
 const ownerSub=env.SATORI_ACCOUNT_V2_OWNER_SUB||'';
 let running=false,again=false;
 const tick=async()=>{
  if(running){again=true;return}
  running=true;
  let passes=0;
  try{
   do{
    again=false;passes++;
    try{
     await ensureOwnerPushSchema(pool);
     const scan=await scanInvoices(pool,reader,new Date(),scanOptions);
     relayState.lastScanAt=new Date().toISOString();relayState.lastScanError=null;
     relayState.backlog=scan.backlog;relayState.lastScanReads=scan.reads;
     // Continue draining in this tick only within the pass cap; never while
     // the cursor is held on an unresolved number.
     if(scan.backlog>0&&!scan.unresolved)again=true;
    }catch(e){
     const code=/^[A-Z0-9_]{3,40}$/.test(String(e?.code||e?.message||''))?(e.code||e.message):'PUSH_SCAN_FAILED';
     relayState.lastScanError=code;
     await pool.query('UPDATE satori_v2_owner_push_feed_state SET last_error_code=$2 WHERE feed=$1',
      ['invoices',code]).catch(()=>{});
     console.warn('SATORI_OWNER_PUSH_SCAN_FAILED',code);
    }
    try{
     await queueDeliveries(pool,ownerSub);
     await dispatch(pool,ownerSub,sender);
     relayState.lastDispatchAt=new Date().toISOString();relayState.lastDispatchError=null;
    }catch{
     relayState.lastDispatchError='PUSH_DISPATCH_FAILED';
     console.warn('SATORI_OWNER_PUSH_DISPATCH_FAILED');
    }
    if(again&&passes<maxPassesPerTick)await sleep(drainPauseMs);
   }while(again&&passes<maxPassesPerTick);
   // Remaining backlog continues on the next interval tick from the persisted
   // cursor: nothing is skipped, and Apps Script/V2 get a rest in between.
   if(again)relayState.deferredTicks=(relayState.deferredTicks||0)+1;
  }finally{running=false;relayState.lastTickPasses=passes}
 };
 const timer=setInterval(()=>{void tick()},intervalMs);
 timer.unref?.();
 const first=setTimeout(()=>{void tick()},1500);
 first.unref?.();
 relayState.started=true;
 activeRelay={enabled:true,tick,
  kick(){relayState.kicks++;setTimeout(()=>{void tick()},0).unref?.()},
  async stop(){clearInterval(timer);clearTimeout(first);activeRelay=null;relayState.started=false}};
 return activeRelay;
}
export const kickOwnerPushRelay=()=>{activeRelay?.kick()};
