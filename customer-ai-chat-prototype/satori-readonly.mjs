/**
 * READ-ONLY production Bot API transport. NOT enabled or exposed by sandbox.
 * Use ONLY after business owner configures a distinct orders:read / customers:read
 * key on Apps Script and adds secrets through Render Environment.
 * No writes, no bulk customer export and never to the browser/Gemini.
 */
import crypto from 'node:crypto';
const permitted=new Set(['system.status','catalogue.list','orders.list','customers.search','customers.list','trash.list']);
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
 // Recently deleted invoices are a separate 30-day ledger, never counted as
 // unpaid/live. Strict exact-name query from a sealed guest invite, or
 // owner-approved admin route only. No unbounded trash browsing.
 if(action==='trash.list'&&String(payload.query||'').trim().length<2)
  throw Error('TRASH_QUERY_REQUIRED');
 if(action==='orders.list'&&!String(payload.query||'').trim()){
  // A signed owner request may browse a single calendar month only, not
  // extract the full production ledger in one request.
  const from=String(payload.from||''),to=String(payload.to||'');
  const validDate=x=>/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(x)&&
   !Number.isNaN(Date.parse(x))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
  if(!validDate(from)||!validDate(to)||from>to||from.slice(0,7)!==to.slice(0,7))
   throw Error('BULK_ORDER_EXPORT_DENIED');
 }
 const safePayload={...payload};
 if(action!=='system.status'&&action!=='catalogue.list')
  safePayload.limit=Math.min(['orders.list','trash.list'].includes(action)?100:
   action==='customers.list'?2000:20,Math.max(1,Number(payload.limit)||10));
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
