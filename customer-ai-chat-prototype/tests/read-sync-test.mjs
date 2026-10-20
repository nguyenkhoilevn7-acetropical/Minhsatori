/* Mock-only authenticated read-only bridge tests. Never talks to production. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readOnlyReady,readMinhSatori} from '../satori-readonly.mjs';
let n=0;const ok=(v,s)=>{assert.ok(v,s);n++};
const original=globalThis.fetch;
process.env.SATORI_READ_ENDPOINT='https://script.google.com/macros/s/TEST123/exec';
process.env.SATORI_READ_KEY_ID='sandbox_read';
process.env.SATORI_READ_HMAC_SECRET='TEST_ONLY_NOT_A_REAL_KEY_123456789000';
let calls=0;
globalThis.fetch=async(_,opt)=>{
 calls++;const req=JSON.parse(opt.body);
 const sig=crypto.createHmac('sha256',process.env.SATORI_READ_HMAC_SECRET)
 .update([req.keyId,req.timestamp,req.nonce,req.action,JSON.stringify(req.payload)].join('\n'),'utf8').digest('hex');
 ok(sig===req.signature,'HMAC over canonical Bot payload');
 ok(['system.status','orders.list','customers.search'].includes(req.action),'allowed actions only');
 return {ok:true,text:async()=>JSON.stringify({ok:true,action:req.action,revision:123,data:{revision:123,profiles:[]}})};
};
try{
 ok(readOnlyReady(),'valid key ID, endpoint and secret required');
 const r=await readMinhSatori('system.status');
 ok(r.revision===123,'revision returned');
 let blocked=false;try{await readMinhSatori('orders.create',{})}catch(e){blocked=e.message==='READ_ONLY_ACTION_DENIED'}
 ok(blocked,'rejects all Bot writes before network');
 blocked=false;try{await readMinhSatori('orders.list',{})}catch(e){blocked=e.message==='BULK_ORDER_EXPORT_DENIED'}
 ok(blocked,'rejects bulk order export');
 blocked=false;try{await readMinhSatori('customers.search',{phone:'12'})}catch(e){blocked=e.message==='CUSTOMER_QUERY_REQUIRED'}
 ok(blocked,'rejects broad customer search');
 await readMinhSatori('customers.search',{phone:'0000000123',limit:10000});
 ok(calls===2,'only narrowly scoped reads sent');
 console.log('PASS '+n+'/'+n+' read-only sync bridge signature and authorization mock checks');
}finally{globalThis.fetch=original;delete process.env.SATORI_READ_ENDPOINT;delete process.env.SATORI_READ_KEY_ID;delete process.env.SATORI_READ_HMAC_SECRET}
