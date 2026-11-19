/**
 * Short-lived signed download links for PDFs produced by the Grok connector.
 *
 * The link carries NO customer data: only kind, invoice number + ledger id,
 * a day window and an expiry, signed with HMAC-SHA256 under a sub-key derived
 * from SATORI_GROK_MCP_TOKEN (no new secret, the MCP token itself never leaves
 * the server). The PDF is re-rendered from the signed ledger on every download;
 * nothing is stored. Disabled whenever the Grok connector is disabled.
 */
import crypto from 'node:crypto';

export const GROK_FILE_PREFIX='/mcp/grok-files/';
export const FILE_LINK_TTL_SECONDS=15*60;
const KINDS=new Set(['invoice','debt']);

function fileKey(env){
 const token=String(env?.SATORI_GROK_MCP_TOKEN||'');
 if(env?.SATORI_GROK_MCP_ENABLED!=='1'||token.length<40||!/^[A-Za-z0-9_-]+$/.test(token))return null;
 return crypto.createHmac('sha256',token).update('satori-grok-file-link-v1').digest();
}
const b64=buf=>Buffer.from(buf).toString('base64url');

/** Validates the payload shape; returns a frozen copy or null. */
function cleanPayload(p){
 if(!p||!KINDS.has(p.k)||!Number.isSafeInteger(p.exp))return null;
 const out={k:p.k,exp:p.exp};
 if(p.k==='invoice'){
  if(!Number.isSafeInteger(p.n)||p.n<1||!/^[A-Za-z0-9_-]{1,80}$/.test(String(p.id||'')))return null;
  out.n=p.n;out.id=String(p.id);
 }else{
  if(!Number.isSafeInteger(p.d)||p.d<1||p.d>366||!/^20\d{2}-\d{2}-\d{2}$/.test(String(p.to||'')))return null;
  out.d=p.d;out.to=p.to;
  if(p.n!=null){
   if(!Number.isSafeInteger(p.n)||p.n<1||!/^[A-Za-z0-9_-]{1,80}$/.test(String(p.id||'')))return null;
   out.n=p.n;out.id=String(p.id);
  }
 }
 return Object.freeze(out);
}

/** Returns {path, token, expiresAt} or null when the connector is disabled. */
export function signFileLink(payload,env=process.env,now=Date.now()){
 const key=fileKey(env);
 const p=cleanPayload({...payload,exp:Math.floor(now/1000)+FILE_LINK_TTL_SECONDS});
 if(!key||!p)return null;
 const body=b64(JSON.stringify(p));
 const sig=b64(crypto.createHmac('sha256',key).update(body).digest());
 return {path:GROK_FILE_PREFIX+body+'.'+sig,expiresAt:new Date(p.exp*1000).toISOString()};
}

/** Constant-time verification. Returns the payload, or null (bad, expired, disabled). */
export function verifyFileToken(token,env=process.env,now=Date.now()){
 const key=fileKey(env);
 const m=/^([A-Za-z0-9_-]{10,400})\.([A-Za-z0-9_-]{43})$/.exec(String(token||''));
 if(!key||!m)return null;
 const want=crypto.createHmac('sha256',key).update(m[1]).digest();
 const given=Buffer.from(m[2],'base64url');
 if(given.length!==want.length||!crypto.timingSafeEqual(given,want))return null;
 let p;try{p=cleanPayload(JSON.parse(Buffer.from(m[1],'base64url').toString('utf8')))}catch{return null}
 if(!p||p.exp*1000<=now)return null;
 return p;
}

/** Absolute URL when the public origin is known, otherwise the path. */
export function absoluteUrl(baseUrl,path){
 return /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(String(baseUrl||''))?baseUrl+path:path;
}
