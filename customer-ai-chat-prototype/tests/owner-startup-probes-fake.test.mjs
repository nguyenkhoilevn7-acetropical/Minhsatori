/* Synthetic startup probe regression. Never contacts Google or production. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createOwnerRealInvoice} from '../owner-live-invoice.mjs';
import {readMinhSatori} from '../satori-readonly.mjs';

const ownerEndpoint='https://script.google.com/macros/s/FAKE_OWNER_123456789012345678901234567890/exec';
const readEndpoint='https://script.google.com/macros/s/FAKE_READ_123456789012345678901234567890/exec';
const ownerKey='fake_owner_writer',readKey='fake_read_only';
const ownerSecret='FAKE_OWNER_SECRET_01234567890123456789012345';
const readSecret='FAKE_READ_SECRET_012345678901234567890123456';
const ownerEnv={GEMINI_OWNER_ONLY_REAL_PILOT:'1',
 GEMINI_SANDBOX_EMERGENCY_DEMO_ONLY:'0',
 SATORI_OWNER_CHECKOUT_ENDPOINT:ownerEndpoint,
 SATORI_OWNER_CHECKOUT_KEY_ID:ownerKey,
 SATORI_OWNER_CHECKOUT_SECRET:ownerSecret,
 CUSTOMER_LINKS_ADMIN_TOKEN:'FAKE_ADMIN_TOKEN_012345678901234567890123456',
 SATORI_READ_KEY_ID:readKey};
const originalFetch=globalThis.fetch;
const saved=Object.fromEntries(['SATORI_READ_ENDPOINT','SATORI_READ_KEY_ID',
 'SATORI_READ_HMAC_SECRET'].map(k=>[k,process.env[k]]));
process.env.SATORI_READ_ENDPOINT=readEndpoint;
process.env.SATORI_READ_KEY_ID=readKey;
process.env.SATORI_READ_HMAC_SECRET=readSecret;
let inFlight=0,maxInFlight=0,congested=false,forceTimeout=false;
const actions=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fakeBackend(url,options){
 const req=JSON.parse(options.body);
 const isOwner=url===ownerEndpoint;
 assert.ok(isOwner||url===readEndpoint,'only fake endpoints');
 const expectedKey=isOwner?ownerKey:readKey;
 const secret=isOwner?ownerSecret:readSecret;
 assert.equal(req.keyId,expectedKey,'separate HMAC identities');
 assert.equal(req.signature,crypto.createHmac('sha256',secret).update([
  req.keyId,req.timestamp,req.nonce,req.action,
  JSON.stringify(req.payload)].join('\n')).digest('hex'),'valid fake signature');
 assert.ok(['system.status','catalogue.list','orders.list','customers.search']
  .includes(req.action),'read-only probe action');
 actions.push({key:req.keyId,action:req.action});
 const simultaneous=++inFlight;
 maxInFlight=Math.max(maxInFlight,simultaneous);
 try{
  await delay(10);
  if(forceTimeout){const error=new Error('synthetic timeout');error.name='AbortError';throw error}
  if(congested&&simultaneous>1)throw Error('synthetic upstream capacity exceeded');
  const data=req.action==='system.status'?{orders:124}:
   req.action==='catalogue.list'?{source:'drive-ledger:satori_catalogue_v15',
    products:[{code:'TP-00003',name:'FAKE',unit:'thùng',listPrice:100000}]}:
   req.action==='orders.list'?{orders:[]}:{profiles:{profiles:[]}};
  return {ok:true,text:async()=>JSON.stringify({ok:true,action:req.action,
   revision:174,data})};
 }finally{inFlight--}
}
const owner=createOwnerRealInvoice({env:ownerEnv,fetcher:fakeBackend});
globalThis.fetch=fakeBackend;
try{
 assert.equal(owner.readiness().enabled,true);
 const proof=await owner.probeWriter();
 assert.equal(proof.verified,true);
 assert.equal(proof.revision,174);
 assert.equal(proof.invoiceCount,124);
 const status=await readMinhSatori('system.status');
 assert.equal(status.revision,174);
 await readMinhSatori('orders.list',{query:'FAKE_NO_MATCH',limit:1});
 await readMinhSatori('customers.search',{query:'FAKE_NO_MATCH',limit:1});
 assert.equal(maxInFlight,1,'serialized mock probes have no overlap');

 // This artificial capacity limit models a possible upstream contention.
 // It does NOT establish the cause of the real Render timeout.
 congested=true;
 const overlap=await Promise.allSettled([
  owner.probeWriter(),readMinhSatori('system.status')]);
 assert.ok(maxInFlight>=2,'both fake clients were in flight');
 assert.ok(overlap.some(x=>x.status==='rejected'),
  'mock contention can make an otherwise valid read probe fail');
 congested=false;
 assert.equal((await owner.probeWriter()).verified,true,
  'serial retry with same fake credentials succeeds');
 assert.equal((await readMinhSatori('system.status')).revision,174);

 forceTimeout=true;
 await assert.rejects(()=>owner.probeWriter(),e=>e.code==='OWNER_BOT_UNCERTAIN',
  'owner wrapper fails closed on transport uncertainty');
 await assert.rejects(()=>readMinhSatori('system.status'),e=>e.name==='AbortError',
  'read-only transport surfaces timeout without write fallback');
 assert.equal(actions.some(x=>x.action.includes('create')||x.action.includes('update')),false,
  'no fake or real invoice writes');
 console.log('PASS synthetic overlapping/serialized probes, isolated HMAC scopes, timeout fail-closed, zero writes');
}finally{
 globalThis.fetch=originalFetch;
 for(const [key,value] of Object.entries(saved)){
  if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
}
