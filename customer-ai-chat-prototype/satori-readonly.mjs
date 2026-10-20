/**
 * READ-ONLY production Bot API transport. NOT enabled or exposed by sandbox.
 * Use ONLY after business owner configures a distinct orders:read / customers:read
 * key on Apps Script and adds secrets through Render Environment.
 * No writes, no bulk customer export and never to the browser/Gemini.
 */
import crypto from 'node:crypto';
const permitted=new Set(['system.status','orders.list','customers.search']);
export function readOnlyReady(){
 return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(String(process.env.SATORI_READ_ENDPOINT||'').trim()) &&
 /^[A-Za-z0-9_-]{3,64}$/.test(String(process.env.SATORI_READ_KEY_ID||'')) &&
 String(process.env.SATORI_READ_HMAC_SECRET||'').length>=32;
}
export async function readMinhSatori(action,payload={}){
 if(!permitted.has(action))throw Error('READ_ONLY_ACTION_DENIED');
 if(!readOnlyReady())throw Error('READ_ONLY_NOT_CONFIGURED');
 if(typeof payload!=='object'||!payload||Array.isArray(payload))throw Error('BAD_PAYLOAD');
 // No broad customer discovery: only search one explicit phone or a specific name,
 // with short limits. Requires a separate authorized customer identity flow.
 if(action==='customers.search'){
  const phone=String(payload.phone||'').replace(/\D/g,'');
  const query=String(payload.query||'').trim();
  if(phone.length<7 && query.length<2)throw Error('CUSTOMER_QUERY_REQUIRED');
 }
 if(action==='orders.list'&&!String(payload.query||'').trim())throw Error('BULK_ORDER_EXPORT_DENIED');
 const safePayload={...payload};
 if(action!=='system.status')safePayload.limit=Math.min(20,Math.max(1,Number(payload.limit)||10));
 const keyId=String(process.env.SATORI_READ_KEY_ID),secret=String(process.env.SATORI_READ_HMAC_SECRET);
 const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('hex');
 const msg=[keyId,timestamp,nonce,action,JSON.stringify(safePayload)].join('\n');
 const signature=crypto.createHmac('sha256',secret).update(msg,'utf8').digest('hex');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{
  const result=await fetch(String(process.env.SATORI_READ_ENDPOINT),{
   method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},
   body:JSON.stringify({keyId,timestamp,nonce,action,payload:safePayload,signature})
  });
  if(!result.ok)throw Error('READ_ONLY_UPSTREAM_HTTP_'+result.status);
  const text=await result.text();if(text.length>200_000)throw Error('READ_ONLY_RESPONSE_TOO_LARGE');
  const parsed=JSON.parse(text);
  if(!parsed.ok||parsed.action!==action)throw Error('READ_ONLY_UPSTREAM_ERROR');
  return {revision:parsed.revision,data:parsed.data};
 }finally{clearTimeout(timer)}
}
