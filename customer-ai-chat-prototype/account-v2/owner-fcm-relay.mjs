/**
 * V2 owner-only, opt-in FCM relay. NEVER writes to canonical invoice ledger.
 *
 * Reconciles confirmed invoices from the existing signed READ-ONLY Bot API,
 * and pending registrations from V2 PostgreSQL. First successful scan of
 * EACH feed establishes a quiet baseline. Outbox + per-device deliveries
 * survive retries/restarts; FCM acceptance is NOT a guarantee of OS display.
 */
import {readMinhSatori,readOnlyReady} from '../satori-readonly.mjs';
import {ownerFcmConfigured} from './owner-fcm-devices.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const MAX_BATCH = 20;
const INTERVAL_MS = 45_000;
const safeId = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x);
const text = x => String(x??'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
const excludedStatus = x => /(?:khong tinh|da huy|huy don|cancel|void|draft|test)/.test(text(x));

export function eligibleOfficialInvoice(row) {
    return !!row && Number.isSafeInteger(Number(row.invoiceNo)) &&
        Number(row.invoiceNo) > 0 && safeId(String(row.id||'')) &&
        !row.missing && row.excluded !== true &&
        row.testOnly !== true && row.isTest !== true &&
        !excludedStatus(row.status);
}
export function ownerEvent(type,key,invoiceNo=null) {
    if(!['official_invoice_created','owner_registration_pending'].includes(type) ||
       typeof key!=='string'||key.length<1||key.length>160)
       throw Error('OWNER_EVENT_INVALID');
    if(type==='official_invoice_created' &&
       (!Number.isSafeInteger(invoiceNo)||invoiceNo<=0))throw Error('INVOICE_NUMBER_INVALID');
    return {kind:type,sourceKey:key,invoiceNo:type==='official_invoice_created'?invoiceNo:null};
}
function monthRange(date) {
    const y=date.getUTCFullYear(),m=date.getUTCMonth();
    return {from:`${y}-${String(m+1).padStart(2,'0')}-01`,
        to:`${y}-${String(m+1).padStart(2,'0')}-${String(new Date(Date.UTC(y,m+1,0)).getUTCDate()).padStart(2,'0')}`};
}
function localCurrentMonth() {
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit'})
        .formatToParts(new Date());
    const get=k=>Number(parts.find(p=>p.type===k)?.value);
    return new Date(Date.UTC(get('year'),get('month')-1,1));
}

async function verifiedInvoiceRows(reader=readMinhSatori) {
    const current=localCurrentMonth();
    const months=[current,new Date(Date.UTC(current.getUTCFullYear(),
        current.getUTCMonth()-1,1))];
    const lists=await Promise.all(months.map(d=>reader('orders.list',
        {...monthRange(d),limit:100})));
    const found=new Map();
    for(const result of lists){
        if(!Number.isSafeInteger(result?.revision) || !Array.isArray(result?.data?.orders))
            throw Error('PUSH_LEDGER_NOT_VERIFIED');
        const rows=result.data.orders, count=Number(result.data.totalMatches??rows.length);
        if(count>rows.length || rows.length>100)throw Error('PUSH_LEDGER_TRUNCATED');
        for(const row of rows){
            const no=Number(row?.invoiceNo);
            if(!Number.isSafeInteger(no)||no<=0||!safeId(String(row?.id||'')))continue;
            found.set(no+'|'+String(row.id),{invoiceNo:no,id:String(row.id)});
        }
    }
    // Exact, signed readback is performed for candidates BEFORE deciding eligibility.
    return [...found.values()];
}
async function exactInvoiceProof(refs,reader=readMinhSatori){
    const confirmed=new Map();
    for(let i=0;i<refs.length;i+=MAX_BATCH){
        const batch=refs.slice(i,i+MAX_BATCH);
        const response=await reader('orders.getExactBatch',{refs:batch});
        if(!Number.isSafeInteger(response?.revision) ||
            !Array.isArray(response?.data?.orders) || response.data.orders.length!==batch.length)
            throw Error('PUSH_EXACT_PROOF_INVALID');
        for(let j=0;j<batch.length;j++){
            const row=response.data.orders[j];
            const ref=batch[j];
            if(Number(row?.invoiceNo)!==ref.invoiceNo ||
                String(row?.id)!==ref.id)throw Error('PUSH_EXACT_ID_MISMATCH');
            confirmed.set(ref.invoiceNo+'|'+ref.id,eligibleOfficialInvoice(row));
        }
    }
    return confirmed;
}

/** Inserts and marks sources exactly once; an edited/paid invoice cannot re-alert. */
async function reconcileFeed(pool,feed,items){
    const client=await pool.connect();
    try{
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['satori_owner_push_'+feed]);
        await client.query('INSERT INTO satori_v2_owner_push_feed_state(feed) VALUES($1) ON CONFLICT DO NOTHING',[feed]);
        const state=await client.query('SELECT initialized FROM satori_v2_owner_push_feed_state WHERE feed=$1 FOR UPDATE',[feed]);
        const initialized=state.rows[0].initialized===true;
        for(const event of items){
            await client.query('INSERT INTO satori_v2_owner_push_events(kind,source_key,invoice_no,eligible) '+
                'VALUES($1,$2,$3,$4) ON CONFLICT(kind,source_key) DO NOTHING',
                [event.kind,event.sourceKey,event.invoiceNo,initialized&&event.eligible===true]);
        }
        await client.query('UPDATE satori_v2_owner_push_feed_state SET initialized=true,last_checked_at=now() WHERE feed=$1',[feed]);
        await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
    finally{client.release()}
}

async function scanInvoices(pool,reader=readMinhSatori) {
    const refs=await verifiedInvoiceRows(reader);
    const known=await pool.query('SELECT source_key FROM satori_v2_owner_push_events WHERE kind=$1',
        ['official_invoice_created']);
    const seen=new Set(known.rows.map(x=>x.source_key));
    const unseen=refs.filter(x=>!seen.has(x.invoiceNo+'|'+x.id));
    const proof=await exactInvoiceProof(unseen,reader);
    const events=unseen.map(x=>({
        ...ownerEvent('official_invoice_created',x.invoiceNo+'|'+x.id,x.invoiceNo),
        eligible:proof.get(x.invoiceNo+'|'+x.id)===true
    }));
    await reconcileFeed(pool,'invoices',events);
}
async function scanRegistrations(pool){
    const data=await pool.query(
        'SELECT r.account_id::text AS id FROM satori_v2_registrations r '+
        'JOIN satori_v2_accounts a ON a.id=r.account_id '+
        "WHERE a.access_status='PENDING' AND r.reviewed_at IS NULL "+
        'ORDER BY r.submitted_at DESC LIMIT 201');
    if(data.rows.length>200)throw Error('PUSH_REGISTRATIONS_TRUNCATED');
    await reconcileFeed(pool,'registrations',data.rows.map(x=>({
        ...ownerEvent('owner_registration_pending',x.id),eligible:true
    })));
}
async function queueDeliveries(pool){
    // NEVER deliver pre-registration historical events to a newly enrolled phone.
    await pool.query('INSERT INTO satori_v2_owner_push_deliveries(event_id,device_id) '+
        'SELECT e.id,d.device_id FROM satori_v2_owner_push_events e '+
        'CROSS JOIN satori_v2_owner_push_devices d '+
        'JOIN satori_v2_accounts a ON a.id=d.account_id '+
        'WHERE e.eligible=true AND d.enabled=true AND a.access_status=\'ACTIVE\' '+
        'AND a.google_sub=$1 AND d.registered_at<=e.created_at '+
        'AND e.created_at>now()-interval \'7 days\' '+
        'ON CONFLICT DO NOTHING',[process.env.SATORI_ACCOUNT_V2_OWNER_SUB]);
}
async function claimDeliveries(pool){
    const r=await pool.query(
        'WITH candidate AS (SELECT event_id,device_id FROM satori_v2_owner_push_deliveries '+
        'WHERE delivered_at IS NULL AND retry_at<=now() AND attempts<12 '+
        'ORDER BY retry_at LIMIT 30 FOR UPDATE SKIP LOCKED) '+
        'UPDATE satori_v2_owner_push_deliveries d SET attempts=d.attempts+1, '+
        "retry_at=now()+interval '2 minutes' FROM candidate c "+
        'WHERE d.event_id=c.event_id AND d.device_id=c.device_id '+
        'RETURNING d.event_id,d.device_id');
    if(!r.rows.length)return [];
    const ids=r.rows.map((x,i)=>'($'+(i*2+1)+'::uuid,$'+(i*2+2)+'::uuid)').join(',');
    const keys=r.rows.flatMap(x=>[x.event_id,x.device_id]);
    const records=await pool.query(
        'SELECT e.id,e.kind,e.invoice_no,d.device_id,d.token FROM '+
        'satori_v2_owner_push_events e JOIN satori_v2_owner_push_deliveries p ON p.event_id=e.id '+
        'JOIN satori_v2_owner_push_devices d ON p.device_id=d.device_id '+
        'JOIN satori_v2_accounts a ON a.id=d.account_id '+
        'WHERE (e.id,d.device_id) IN ('+ids+') AND d.enabled=true '+
        'AND a.access_status=\'ACTIVE\' AND a.google_sub=
    return records.rows;
}
async function makeSender(env){
    const credentials=JSON.parse(env.SATORI_OWNER_FCM_SERVICE_ACCOUNT_JSON);
    if(!credentials || credentials.type!=='service_account' ||
       credentials.project_id!==env.SATORI_OWNER_FCM_PROJECT_ID)
        throw Error('PUSH_FIREBASE_CREDENTIALS_MISMATCH');
    const [{initializeApp,cert,getApps},{getMessaging}]=await Promise.all([
        import('firebase-admin/app'),import('firebase-admin/messaging')]);
    const app=getApps().find(x=>x.name==='satori-owner-fcm') ||
        initializeApp({credential:cert(credentials)},'satori-owner-fcm');
    const messaging=getMessaging(app);
    return async(row)=>messaging.send({
        token:row.token,
        data:{type:row.kind,eventId:String(row.id),
              ...(row.invoice_no?{invoiceNo:String(row.invoice_no)}:{})},
        android:{priority:'high',ttl:300000}
    });
}
async function dispatch(pool,send){
    for(const row of await claimDeliveries(pool)){
        try{
            await send(row);
            await pool.query('UPDATE satori_v2_owner_push_deliveries SET delivered_at=now(),'+
                'last_error_code=NULL WHERE event_id=$1 AND device_id=$2',
                [row.id,row.device_id]);
        }catch(e){
            const code=String(e?.code||'FCM_SEND_FAILED');
            const invalid=['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(code);
            if(invalid)await pool.query('UPDATE satori_v2_owner_push_devices SET enabled=false WHERE device_id=$1',[row.device_id]);
            await pool.query('UPDATE satori_v2_owner_push_deliveries SET last_error_code=$3 WHERE event_id=$1 AND device_id=$2',
                [row.id,row.device_id,invalid?'INVALID_TOKEN':'SEND_FAILED']);
        }
    }
}

/** Explicit flag prevents any network/send on normal production deploy. */
export async function startOwnerFcmRelay(env=process.env) {
    if(!ownerFcmConfigured(env) || !readOnlyReady())return {enabled:false};
    if(!env.SATORI_ACCOUNT_V2_DATABASE_URL) return {enabled:false};
    const [{default:pg},send]=await Promise.all([import('pg'),makeSender(env)]);
    const pool=new pg.Pool({connectionString:env.SATORI_ACCOUNT_V2_DATABASE_URL,
        max:2,connectionTimeoutMillis:5000,
        ssl:env.SATORI_ACCOUNT_V2_PG_SSL==='1'?{rejectUnauthorized:true}:undefined});
    let running=false;
    const tick=async()=>{
        if(running)return;
        running=true;
        try{
            // Independent feeds: one failed canonical read does not block registrations.
            await scanInvoices(pool).catch(()=>{console.warn('SATORI_FCM_INVOICE_SCAN_FAILED')});
            await scanRegistrations(pool).catch(()=>{console.warn('SATORI_FCM_REGISTRATION_SCAN_FAILED')});
            await queueDeliveries(pool);
            await dispatch(pool,send);
        }catch{console.warn('SATORI_FCM_RELAY_RETRY')}finally{running=false}
    };
    const timer=setInterval(()=>{void tick()},INTERVAL_MS);
    timer.unref();
    setTimeout(()=>{void tick()},3000).unref();
    return {enabled:true,stop:async()=>{clearInterval(timer);await pool.end()}};
}
+(keys.length+1),
        [...keys,process.env.SATORI_ACCOUNT_V2_OWNER_SUB]);
    return records.rows;
}
async function makeSender(env){
    const credentials=JSON.parse(env.SATORI_OWNER_FCM_SERVICE_ACCOUNT_JSON);
    if(!credentials || credentials.type!=='service_account' ||
       credentials.project_id!==env.SATORI_OWNER_FCM_PROJECT_ID)
        throw Error('PUSH_FIREBASE_CREDENTIALS_MISMATCH');
    const [{initializeApp,cert,getApps},{getMessaging}]=await Promise.all([
        import('firebase-admin/app'),import('firebase-admin/messaging')]);
    const app=getApps().find(x=>x.name==='satori-owner-fcm') ||
        initializeApp({credential:cert(credentials)},'satori-owner-fcm');
    const messaging=getMessaging(app);
    return async(row)=>messaging.send({
        token:row.token,
        data:{type:row.kind,eventId:String(row.id),
              ...(row.invoice_no?{invoiceNo:String(row.invoice_no)}:{})},
        android:{priority:'high',ttl:300000}
    });
}
async function dispatch(pool,send){
    for(const row of await claimDeliveries(pool)){
        try{
            await send(row);
            await pool.query('UPDATE satori_v2_owner_push_deliveries SET delivered_at=now(),'+
                'last_error_code=NULL WHERE event_id=$1 AND device_id=$2',
                [row.id,row.device_id]);
        }catch(e){
            const code=String(e?.code||'FCM_SEND_FAILED');
            const invalid=['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(code);
            if(invalid)await pool.query('UPDATE satori_v2_owner_push_devices SET enabled=false WHERE device_id=$1',[row.device_id]);
            await pool.query('UPDATE satori_v2_owner_push_deliveries SET last_error_code=$3 WHERE event_id=$1 AND device_id=$2',
                [row.id,row.device_id,invalid?'INVALID_TOKEN':'SEND_FAILED']);
        }
    }
}

/** Explicit flag prevents any network/send on normal production deploy. */
export async function startOwnerFcmRelay(env=process.env) {
    if(!ownerFcmConfigured(env) || !readOnlyReady())return {enabled:false};
    if(!env.SATORI_ACCOUNT_V2_DATABASE_URL) return {enabled:false};
    const [{default:pg},send]=await Promise.all([import('pg'),makeSender(env)]);
    const pool=new pg.Pool({connectionString:env.SATORI_ACCOUNT_V2_DATABASE_URL,
        max:2,connectionTimeoutMillis:5000,
        ssl:env.SATORI_ACCOUNT_V2_PG_SSL==='1'?{rejectUnauthorized:true}:undefined});
    let running=false;
    const tick=async()=>{
        if(running)return;
        running=true;
        try{
            // Independent feeds: one failed canonical read does not block registrations.
            await scanInvoices(pool).catch(()=>{console.warn('SATORI_FCM_INVOICE_SCAN_FAILED')});
            await scanRegistrations(pool).catch(()=>{console.warn('SATORI_FCM_REGISTRATION_SCAN_FAILED')});
            await queueDeliveries(pool);
            await dispatch(pool,send);
        }catch{console.warn('SATORI_FCM_RELAY_RETRY')}finally{running=false}
    };
    const timer=setInterval(()=>{void tick()},INTERVAL_MS);
    timer.unref();
    setTimeout(()=>{void tick()},3000).unref();
    return {enabled:true,stop:async()=>{clearInterval(timer);await pool.end()}};
}
