import crypto from 'node:crypto';
import {GoogleAuth} from 'google-auth-library';

const FCM_SCOPE='https://www.googleapis.com/auth/firebase.messaging';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
let authCache=null;

export function ownerPushReady(env=process.env){
 return env.SATORI_OWNER_PUSH_ENABLED==='1' &&
  /^[a-z][a-z0-9-]{5,60}$/.test(env.SATORI_FCM_PROJECT_ID||'') &&
  typeof env.SATORI_FCM_SERVICE_ACCOUNT_JSON==='string' &&
  env.SATORI_FCM_SERVICE_ACCOUNT_JSON.length>100;
}

function googleClient(env){
 if(!authCache){
  const credentials=JSON.parse(env.SATORI_FCM_SERVICE_ACCOUNT_JSON);
  if(credentials.type!=='service_account'||
   !credentials.client_email||!credentials.private_key||
   credentials.project_id!==env.SATORI_FCM_PROJECT_ID)
   throw new Error('FCM_SERVICE_ACCOUNT_INVALID');
  authCache=new GoogleAuth({credentials,scopes:[FCM_SCOPE]});
 }
 return authCache;
}

export function validateOwnerDevice(input){
 if(!input||input.platform!=='android'||typeof input.token!=='string'||
  input.token.length<50||input.token.length>4096||
  !/^[A-Za-z0-9:_-]+$/.test(input.token))
  throw Object.assign(new Error('FCM_DEVICE_TOKEN_INVALID'),{status:400});
 return input.token;
}

/** Call only after router.auth() and router.owner(); never accept ownerId in JSON. */
export async function registerOwnerDevice(pool,actor,input,env=process.env){
 if(!ownerPushReady(env))
  throw Object.assign(new Error('FCM_NOT_CONFIGURED'),{status:503});
 const token=validateOwnerDevice(input);
 await pool.query('INSERT INTO satori_v2_owner_push_devices '+
  '(token_sha,account_id,fcm_token,platform,last_seen_at) '+
  'VALUES($1,$2,$3,\'android\',now()) '+
  'ON CONFLICT(token_sha) DO UPDATE SET account_id=EXCLUDED.account_id, '+
  'fcm_token=EXCLUDED.fcm_token,last_seen_at=now()',
  [sha(token),actor.id,token]);
 return {ok:true,enabled:true};
}

async function sendFcm(token,invoiceNo,env,fetcher){
 const client=await googleClient(env).getClient();
 const access=await client.getAccessToken();
 const bearer=access.token;
 if(!bearer)throw new Error('FCM_OAUTH_UNAVAILABLE');
 const response=await fetcher('https://fcm.googleapis.com/v1/projects/'+
  env.SATORI_FCM_PROJECT_ID+'/messages:send',{
  method:'POST',
  headers:{'content-type':'application/json','authorization':'Bearer '+bearer},
  body:JSON.stringify({message:{
   token,
   data:{type:'verified_new_invoice',invoiceNo:String(invoiceNo)},
   android:{priority:'high',ttl:'60s'}
  }}),
  signal:AbortSignal.timeout(7000)
 });
 // Neither the token nor Google error response is written to logs.
 return response.ok;
}

/**
 * No checkout mutation: the invoice must already be COMMITTED in the canonical
 * ledger. Do not send on quotes, drafts, REJECTED or UNCERTAIN states.
 */
export async function notifyConfirmedInvoice(pool,invoiceNo,ownerId,
 env=process.env,fetcher=fetch){
 if(!ownerPushReady(env))return {sent:0,disabled:true};
 const number=Number(invoiceNo);
 if(!Number.isSafeInteger(number)||number<1)
  throw new Error('CANONICAL_INVOICE_NUMBER_INVALID');
 await pool.query('INSERT INTO satori_v2_owner_push_events(invoice_no) VALUES($1) '+
  'ON CONFLICT(invoice_no) DO NOTHING',[number]);
 const due=await pool.query('SELECT delivered_at FROM satori_v2_owner_push_events '+
  'WHERE invoice_no=$1',[number]);
 if(due.rows[0]?.delivered_at)return {sent:0,duplicate:true};
 const devices=await pool.query('SELECT fcm_token FROM satori_v2_owner_push_devices '+
  'WHERE account_id=$1 AND last_seen_at>now()-interval \'90 days\' LIMIT 10',
  [ownerId]);
 if(!devices.rows.length)return {sent:0,noDevices:true};
 let sent=0;
 for(const device of devices.rows){
  try{if(await sendFcm(device.fcm_token,number,env,fetcher))sent++}
  catch{ /* no raw token, no customer PII, retry on next confirmed event */ }
 }
 await pool.query('UPDATE satori_v2_owner_push_events SET attempts=attempts+1,'+
  'delivered_at=CASE WHEN $2>0 THEN now() ELSE delivered_at END WHERE invoice_no=$1',
  [number,sent]);
 return {sent};
}
