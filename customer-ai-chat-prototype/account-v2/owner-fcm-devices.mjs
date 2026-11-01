import crypto from 'node:crypto';

// All routes MUST pass through Account V2 auth(req,pool), CSRF and owner(actor)
// before calling these helpers. Never accept an account ID from the caller.
const deviceId = x => typeof x === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const fcmToken = x => typeof x === 'string' && x.length >= 40 &&
    x.length <= 4096 && /^[a-zA-Z0-9_:\-]+$/.test(x);
export const ownerFcmConfigured = (env=process.env) =>
    env.SATORI_OWNER_FCM_ENABLED === '1' &&
    typeof env.SATORI_OWNER_FCM_SERVICE_ACCOUNT_JSON === 'string' &&
    env.SATORI_OWNER_FCM_SERVICE_ACCOUNT_JSON.length > 100;

export function validateDevice(input){
    if (!input || !deviceId(input.deviceId) || !fcmToken(input.token))
        throw Object.assign(Error('INVALID_PUSH_DEVICE'),{status:400,code:'INVALID_PUSH_DEVICE'});
    return {deviceId:input.deviceId.toLowerCase(),token:input.token};
}
export async function registerOwnerDevice(pool,accountId,sessionHash,input){
    if(typeof sessionHash!=='string'||!/^[a-f0-9]{64}$/.test(sessionHash))
        throw Object.assign(Error('INVALID_OWNER_SESSION'),{status:401,code:'INVALID_OWNER_SESSION'});
    const d=validateDevice(input);
    const digest=crypto.createHash('sha256').update(d.token).digest('hex');
    // A stolen token cannot be reassigned across accounts by upsert.
    const owner=await pool.query(
      'SELECT account_id FROM satori_v2_owner_push_devices WHERE token_hash=$1 AND account_id<>$2 LIMIT 1',
      [digest,accountId]);
    if(owner.rowCount)throw Object.assign(Error('DEVICE_ALREADY_OWNED'),{status:403,code:'DEVICE_ALREADY_OWNED'});
    const changed=await pool.query('INSERT INTO satori_v2_owner_push_devices '+
      '(device_id,account_id,session_hash,token,token_hash) VALUES($1,$2,$3,$4,$5) '+
      'ON CONFLICT(device_id) DO UPDATE SET session_hash=EXCLUDED.session_hash,'+
      'token=EXCLUDED.token,token_hash=EXCLUDED.token_hash,'+
      'enabled=true,registered_at=now(),updated_at=now() '+
      'WHERE satori_v2_owner_push_devices.account_id=EXCLUDED.account_id',
      [d.deviceId,accountId,sessionHash,d.token,digest]);
    if(changed.rowCount!==1)throw Object.assign(Error('DEVICE_ALREADY_OWNED'),
        {status:403,code:'DEVICE_ALREADY_OWNED'});
    return {ok:true,enabled:true};
}
export async function revokeOwnerDevice(pool,accountId,input){
    if(!deviceId(input?.deviceId))throw Object.assign(Error('INVALID_PUSH_DEVICE'),{status:400,code:'INVALID_PUSH_DEVICE'});
    await pool.query('DELETE FROM satori_v2_owner_push_devices WHERE device_id=$1 AND account_id=$2',
      [input.deviceId.toLowerCase(),accountId]);
    return {ok:true};
}
export async function revokeAllOwnerDevices(pool,accountId){
    await pool.query('DELETE FROM satori_v2_owner_push_devices WHERE account_id=$1',[accountId]);
}
