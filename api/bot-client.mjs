/**
 * Server-side client for the authenticated Minh Satori Bot API.
 * Requires Node >=18. NEVER import this into index.html or other browser code.
 * Configure SATORI_BOT_API_URL, SATORI_BOT_KEY_ID and SATORI_BOT_SECRET
 * only on a trusted server/connector's secret store.
 */
import {createHmac, randomBytes} from 'node:crypto';

const cleanURL=(value)=>{
  const url=new URL(value);
  if(url.protocol!=='https:' || url.username || url.password || url.searchParams.has('key') || url.searchParams.has('token')){
    throw new Error('Only HTTPS Apps Script URL without credentials in URL is allowed');
  }
  return url.toString();
};

export async function callBotAPI(action,payload={},options={}){
  const env=options.env||process.env;
  const url=cleanURL(options.url||env.SATORI_BOT_API_URL||'');
  const keyId=options.keyId||env.SATORI_BOT_KEY_ID;
  const secret=options.secret||env.SATORI_BOT_SECRET;
  if(!/^[a-zA-Z0-9_-]{3,64}$/.test(keyId||'') || String(secret||'').length<32){
    throw new Error('Missing secure server-side key ID or secret');
  }
  if(!/^[a-z][a-z.]*$/.test(action) || payload===null || typeof payload!=='object' || Array.isArray(payload)){
    throw new Error('Invalid action or payload');
  }
  const stamp=Date.now(),nonce=randomBytes(18).toString('base64url');
  const body={keyId,timestamp:stamp,nonce,action,payload};
  const message=[body.keyId,body.timestamp,body.nonce,body.action,JSON.stringify(body.payload)].join('\n');
  body.signature=createHmac('sha256',secret).update(message).digest('hex');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),options.timeoutMs||35000);
  let response;
  try{
    response=await (options.fetch||fetch)(url,{
      method:'POST',redirect:'follow',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(body),
      signal:controller.signal
    });
  }finally{clearTimeout(timeout)}
  if(!response.ok)throw new Error('API transport HTTP '+response.status);
  const raw=await response.text();
  let parsed;
  try{parsed=JSON.parse(raw)}catch(e){throw new Error('API did not return JSON: check Apps Script access/deployment')}
  if(parsed.ok!==true) {
    const err=new Error(parsed.error?.message||'API rejected request');
    err.code=parsed.error?.code||'API_ERROR';
    throw err;
  }
  return parsed;
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
  // Read-only commands are convenient for one-time post-deployment health checks.
  const action=process.argv[2]||'system.status';
  if(!['system.status','customers.search','orders.list','debt.summary'].includes(action)){
    console.error('CLI supports read-only actions; mutation requires explicit application confirmation.');
    process.exitCode=2;
  }else{
    let payload={};
    try{payload=JSON.parse(process.argv[3]||'{}')}catch(e){console.error('Payload must be valid JSON');process.exitCode=2}
    if(!process.exitCode)callBotAPI(action,payload).then(data=>{
      console.log(JSON.stringify(data,null,2));
    }).catch(err=>{console.error(err.code||'ERROR',err.message);process.exitCode=1});
  }
}
