/**
 * Dedicated Minh Satori V2 backend entrypoint.
 * Only /app-v2, /api/v2/* and an unprivileged health check are exposed.
 * This process NEVER mounts old /real, /ctv, /admin or Apps Script writers.
 */
import http from 'node:http';
import {handleAccountV2} from './router.mjs';
import {readMinhSatori,readOnlyReady} from '../satori-readonly.mjs';
import {probeCanonicalReadback} from './exact-readback-probe.mjs';
const host='0.0.0.0';
const port=Number(process.env.PORT||10000);
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url||'/','http://localhost').pathname;
  if(pathname==='/healthz'&&req.method==='GET'){
   res.writeHead(200,{'content-type':'application/json','cache-control':'no-store',
    'x-content-type-options':'nosniff'});
   res.end(JSON.stringify({ok:true,service:'minh-satori-account-v2',legacyRoutesDisabled:true}));
   return;
  }
  if(pathname==='/'&&req.method==='GET'){
   res.writeHead(302,{location:'/app-v2','cache-control':'no-store'});res.end();return;
  }
  if(await handleAccountV2(req,res,pathname))return;
  res.writeHead(404,{'content-type':'application/json','cache-control':'no-store'});
  res.end('{"ok":false,"error":"V2_ROUTE_ONLY"}');
 }catch(e){
  if(res.headersSent){res.end();return}
  res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
  res.end('{"ok":false,"error":"V2_TEMPORARILY_UNAVAILABLE"}');
 }
});
server.headersTimeout=10000;
server.requestTimeout=15000;
server.listen(port,host,()=>{
 console.info('SATORI_ACCOUNT_V2_STANDALONE_LISTENING',port);
 // Passive diagnostic only: one signed read with a cryptographically random
 // requestId. Does not expose customer data, trigger an invoice write or fail boot.
 void probeCanonicalReadback({readOnlyReady,readMinhSatori,
  report:s=>console.info('SATORI_V2_HMAC_EXACT_REQUESTID_PROBE',JSON.stringify(s))});
});
