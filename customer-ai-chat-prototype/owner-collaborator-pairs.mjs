/**
 * Owner-only collaborator pair policy transport. HMAC credentials stay on the
 * server and are never sent to browser, Android or Gemini. No public routes.
 *
 * Writes are OFF by default even if a key is accidentally provisioned.
 */
import crypto from 'node:crypto';
const refuse=code=>{const e=new Error(code);e.code=code;throw e};
const endpoint=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,180}\/exec$/;
const actions=new Set(['collaborators.pair.list','collaborators.pair.configure','collaborators.mark','orders.create.pair']);
function configuration(action,env){
 const write=action!=='collaborators.pair.list';
 const orderWrite=action==='orders.create.pair';
 // Read-only probe can reuse the existing owner READ key without copying the
 // HMAC secret or granting it new scope. Apps Script itself decides FORBIDDEN.
 // Approval/writes NEVER fall back to an existing key.
 const useOwnerRead=!write&&!env.SATORI_CTV_PAIR_READ_KEY_ID&&!env.SATORI_CTV_PAIR_READ_SECRET;
 const url=String(useOwnerRead?
  (env.SATORI_READ_ENDPOINT||env.SATORI_CTV_PAIR_ENDPOINT):
  env.SATORI_CTV_PAIR_ENDPOINT||'').trim();
 const keyId=String(useOwnerRead?env.SATORI_READ_KEY_ID:
  env[write?(orderWrite?'SATORI_CTV_PAIR_WRITE_KEY_ID':'SATORI_CTV_PAIR_APPROVE_KEY_ID'):'SATORI_CTV_PAIR_READ_KEY_ID']||'');
 const secret=String(useOwnerRead?env.SATORI_READ_HMAC_SECRET:
  env[write?(orderWrite?'SATORI_CTV_PAIR_WRITE_SECRET':'SATORI_CTV_PAIR_APPROVE_SECRET'):'SATORI_CTV_PAIR_READ_SECRET']||'');
 if(write&&env[orderWrite?'SATORI_CTV_PAIR_ORDER_ENABLED':'SATORI_CTV_PAIR_CONFIG_ENABLED']!=='1')refuse('CTV_PAIR_WRITE_DISABLED');
 if(!endpoint.test(url)||!/^[A-Za-z0-9_-]{3,64}$/.test(keyId)||secret.length<32)
  refuse('CTV_PAIR_NOT_CONFIGURED');
 return {url,keyId,secret};
}
export async function ownerPairAction(action,payload={},{
 env=process.env,fetcher=fetch,now=Date.now,
 nonce=()=>crypto.randomBytes(18).toString('hex')
}={}){
 if(!actions.has(action)||!payload||typeof payload!=='object'||Array.isArray(payload))
  refuse('INVALID_CTV_ACTION');
 const {url,keyId,secret}=configuration(action,env);
 const timestamp=now(),id=nonce();
 if(!Number.isSafeInteger(timestamp)||!/^[A-Za-z0-9_-]{16,128}$/.test(id))
  refuse('INVALID_CTV_REQUEST');
 const msg=[keyId,timestamp,id,action,JSON.stringify(payload)].join('\n');
 const signature=crypto.createHmac('sha256',secret).update(msg,'utf8').digest('hex');
 // GAS may hold its ScriptLock while copying a verified Drive backup before
 // a real CTV policy write. An 8s timeout can give the owner an ambiguous
 // result even if the ledger eventually commits; never automatically retry.
 const timeoutMs=action==='collaborators.pair.list'?12000:30000;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetcher(url,{method:'POST',redirect:'follow',signal:controller.signal,
   headers:{'content-type':'application/json'},
   body:JSON.stringify({keyId,timestamp,nonce:id,action,payload,signature})});
  if(!response?.ok)refuse('CTV_PAIR_UPSTREAM_UNAVAILABLE');
  const raw=await response.text();
  if(raw.length>30000)refuse('CTV_PAIR_RESPONSE_INVALID');
  let data;
  try{data=JSON.parse(raw)}catch{refuse('CTV_PAIR_RESPONSE_INVALID')}
  if(!data?.ok||data.action!==action){
   const allowed=new Set(['REVISION_CONFLICT','COLLABORATOR_NOT_ACTIVE',
    'PAIR_POLICY_INVALID','REQUEST_ID_CONFLICT','PAIR_NOT_ENABLED','FORBIDDEN',
    'CTV_SOURCE_UNVERIFIED','CTV_DESTINATIONS_INVALID','CTV_DESTINATION_NOT_APPROVED',
    'CTV_DESTINATION_UNVERIFIED','PAIR_POLICY_CHANGED','COLLABORATOR_NOT_ACTIVE',
    'INVALID_REQUEST','INVALID_ORDER','INVALID_ITEM','REVISION_REQUIRED','REVISION_CONFLICT']);
   const code=String(data?.error?.code||'');
   refuse(allowed.has(code)?code:'CTV_PAIR_UPSTREAM_REJECTED');
  }
  if(!Number.isSafeInteger(data.revision)||data.revision<1)
   refuse('CTV_PAIR_RESPONSE_INVALID');
  if(action==='collaborators.pair.list'&&!Array.isArray(data.data?.policies))
   refuse('CTV_PAIR_RESPONSE_INVALID');
  if(action==='collaborators.mark'&&data.data?.collaboratorId==null)
   refuse('CTV_PAIR_RESPONSE_INVALID');
  if(action==='orders.create.pair'&&(!data.data?.customerInvoice||!data.data?.collaboratorInvoice))
   refuse('CTV_PAIR_RESPONSE_INVALID');
  if(action==='collaborators.pair.configure'&&
     (!data.data?.policy||data.data.policy.collaboratorId!==payload.collaboratorId))
   refuse('CTV_PAIR_RESPONSE_INVALID');
  return Object.freeze({revision:data.revision,...data.data});
 }catch(e){
  if(e?.code)throw e;
  refuse('CTV_PAIR_RESPONSE_UNCERTAIN');
 }finally{clearTimeout(timer)}
}

// A side-effect-free check of whether the running Bot API grants CTV policy
// visibility to the existing owner read client. Logs only fixed categories;
// never expose key IDs, URLs, customer records or HMAC contents.
export async function probeOwnerPairRead(options={}){
 try{
  const info=await ownerPairAction('collaborators.pair.list',{},options);
  if(!Array.isArray(info.collaborators))
   return Object.freeze({ready:false,reason:'CTV_DIRECTORY_NOT_RETURNED'});
  return Object.freeze({ready:true,reason:'READ_SCOPE_CONFIRMED',
   revision:info.revision,collaborators:info.collaborators.length,
   activePolicies:info.policies.filter(p=>p?.enabled===true).length});
 }catch(e){
  const allowed=new Set(['FORBIDDEN','CTV_PAIR_NOT_CONFIGURED',
   'CTV_PAIR_UPSTREAM_UNAVAILABLE','CTV_PAIR_RESPONSE_INVALID',
   'CTV_PAIR_RESPONSE_UNCERTAIN','CTV_PAIR_UPSTREAM_REJECTED']);
  return Object.freeze({ready:false,
   reason:allowed.has(e?.code)?e.code:'CTV_PAIR_PROBE_FAILED'});
 }
}

/**
 * Credentials/configuration health without any network or ledger mutation.
 * Return fixed categories only: never expose URLs, HMAC keys or secrets.
 */
export function ownerPairConfigReadiness({env=process.env}={}){
 const check=(action,probeEnv=env)=>{
  try{configuration(action,probeEnv);return Object.freeze({ready:true,reason:'CONFIGURED'})}
  catch(e){return Object.freeze({ready:false,reason:[
   'CTV_PAIR_WRITE_DISABLED','CTV_PAIR_NOT_CONFIGURED'].includes(e?.code)?
   e.code:'CTV_PAIR_NOT_READY'})}
 };
 return Object.freeze({
  read:check('collaborators.pair.list'),
  configure:check('collaborators.pair.configure'),
  mark:check('collaborators.mark'),
  orderWrite:check('orders.create.pair'),
  // Presence only, evaluated as though flags were enabled: never sends a request.
  approveCredentials:check('collaborators.pair.configure',
   {...env,SATORI_CTV_PAIR_CONFIG_ENABLED:'1'}),
  orderCredentials:check('orders.create.pair',
   {...env,SATORI_CTV_PAIR_ORDER_ENABLED:'1'})
 });
}
