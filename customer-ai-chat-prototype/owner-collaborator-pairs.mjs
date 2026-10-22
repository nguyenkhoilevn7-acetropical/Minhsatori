/**
 * Owner-only collaborator pair policy transport. HMAC credentials stay on the
 * server and are never sent to browser, Android or Gemini. No public routes.
 *
 * Writes are OFF by default even if a key is accidentally provisioned.
 */
import crypto from 'node:crypto';
const refuse=code=>{const e=new Error(code);e.code=code;throw e};
const endpoint=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,180}\/exec$/;
const actions=new Set(['collaborators.pair.list','collaborators.pair.configure']);
function configuration(action,env){
 const url=String(env.SATORI_CTV_PAIR_ENDPOINT||'').trim();
 const write=action==='collaborators.pair.configure';
 const keyId=String(env[write?'SATORI_CTV_PAIR_APPROVE_KEY_ID':'SATORI_CTV_PAIR_READ_KEY_ID']||'');
 const secret=String(env[write?'SATORI_CTV_PAIR_APPROVE_SECRET':'SATORI_CTV_PAIR_READ_SECRET']||'');
 if(write&&env.SATORI_CTV_PAIR_CONFIG_ENABLED!=='1')refuse('CTV_PAIR_WRITE_DISABLED');
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
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
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
    'PAIR_POLICY_INVALID','REQUEST_ID_CONFLICT','PAIR_NOT_ENABLED','FORBIDDEN']);
   const code=String(data?.error?.code||'');
   refuse(allowed.has(code)?code:'CTV_PAIR_UPSTREAM_REJECTED');
  }
  if(!Number.isSafeInteger(data.revision)||data.revision<1)
   refuse('CTV_PAIR_RESPONSE_INVALID');
  if(action==='collaborators.pair.list'&&!Array.isArray(data.data?.policies))
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
