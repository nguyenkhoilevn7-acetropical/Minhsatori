// Offline owner CTV admin bridge tests — no network or real HMAC secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {ownerPairAction,probeOwnerPairRead,ownerPairConfigReadiness} from '../owner-collaborator-pairs.mjs';

const url='https://script.google.com/macros/s/FAKE_SANDBOX_ENDPOINT_0123456789abcde/exec';
const key='test_owner_scope',secret='OFFLINE_FAKE_HMAC_SECRET_12345678901234567890';
const env={SATORI_CTV_PAIR_ENDPOINT:url,SATORI_CTV_PAIR_READ_KEY_ID:key,
 SATORI_CTV_PAIR_READ_SECRET:secret,SATORI_CTV_PAIR_APPROVE_KEY_ID:key,
 SATORI_CTV_PAIR_APPROVE_SECRET:secret,SATORI_CTV_PAIR_CONFIG_ENABLED:'0'};
let requests=0,latestPayload=null;
const fetcher=async (endpoint,req)=>{
 assert.equal(endpoint,url);requests++;
 const body=JSON.parse(req.body);latestPayload=body.payload;
 assert.match(body.nonce,/^[A-Za-z0-9_-]{16,128}$/);
 assert.equal(body.signature,crypto.createHmac('sha256',secret).update([
  body.keyId,body.timestamp,body.nonce,body.action,JSON.stringify(body.payload)].join('\n')).digest('hex'));
 return {ok:true,text:async()=>JSON.stringify({
  ok:true,action:body.action,revision:8,data:body.action==='collaborators.pair.list'?
   {policies:[{collaboratorId:'ctv-01',enabled:false}],
    collaborators:[{id:'ctv-01',name:'Fixture CTV',active:true}]}:
   {policy:{collaboratorId:body.payload.collaboratorId,enabled:body.payload.enabled}}
 })};
};
const configCheck=ownerPairConfigReadiness({env});
assert.equal(configCheck.read.ready,true);
assert.equal(configCheck.configure.ready,false);
assert.equal(configCheck.configure.reason,'CTV_PAIR_WRITE_DISABLED');
assert.equal(configCheck.orderWrite.reason,'CTV_PAIR_WRITE_DISABLED');
assert.equal(ownerPairConfigReadiness({env:{}}).read.reason,'CTV_PAIR_NOT_CONFIGURED');
const opts={env,fetcher,now:()=>1792700000000,
 nonce:()=> 'owner_nonce_1234567890abcdef'};
const response=await ownerPairAction('collaborators.pair.list',{},opts);
assert.equal(response.revision,8);
assert.equal(response.collaborators[0].name,'Fixture CTV');
assert.equal(requests,1);
const config={collaboratorId:'ctv-01',enabled:true,
 customerDiscountPercent:20,collaboratorDiscountPercent:35,shippingPercent:8,
 vatPercent:0,requestId:'test-config-001',expectedRevision:8,confirmed:true};
await assert.rejects(()=>ownerPairAction('collaborators.pair.configure',config,opts),
 e=>e?.code==='CTV_PAIR_WRITE_DISABLED');
assert.equal(requests,1);
const saved=await ownerPairAction('collaborators.pair.configure',config,
 {...opts,env:{...env,SATORI_CTV_PAIR_CONFIG_ENABLED:'1'}});
assert.equal(saved.policy.enabled,true);
assert.equal(latestPayload.collaboratorDiscountPercent,35);
assert.equal(requests,2);
await assert.rejects(()=>ownerPairAction('orders.create.pair',config,opts),
 e=>e?.code==='CTV_PAIR_WRITE_DISABLED');
await assert.rejects(()=>ownerPairAction('collaborators.pair.list',{},
 {...opts,env:{...env,SATORI_CTV_PAIR_READ_SECRET:''}}),
 e=>e?.code==='CTV_PAIR_NOT_CONFIGURED');
// Existing read-only key must be usable for a no-write policy probe, but
// it must NEVER gain the ability to approve policies or create invoices.
const inheritedEnv={
 SATORI_READ_ENDPOINT:url,SATORI_READ_KEY_ID:key,
 SATORI_READ_HMAC_SECRET:secret,SATORI_CTV_PAIR_CONFIG_ENABLED:'0'
};
const read=await ownerPairAction('collaborators.pair.list',{},{
 ...opts,env:inheritedEnv
});
assert.equal(read.revision,8);
const proof=await probeOwnerPairRead({...opts,env:inheritedEnv});
assert.equal(proof.ready,true);
assert.equal(proof.revision,8);
assert.equal(proof.collaborators,1);
assert.equal(proof.activePolicies,0);
const writesBefore=requests;
await assert.rejects(()=>ownerPairAction('collaborators.pair.configure',config,{
 ...opts,env:inheritedEnv
}),e=>e?.code==='CTV_PAIR_WRITE_DISABLED');
assert.equal(writesBefore,requests,'inherited read credentials cannot write');
// If Bot API returns FORBIDDEN, diagnostic must fail closed without leaks.
const forbidden=await probeOwnerPairRead({...opts,env:inheritedEnv,
 fetcher:async()=>({ok:true,text:async()=>JSON.stringify({
   ok:false,error:{code:'FORBIDDEN',message:'do not expose upstream details'}
 })})});
assert.equal(forbidden.ready,false);
assert.equal(forbidden.reason,'FORBIDDEN');
assert.equal(JSON.stringify(forbidden).includes('upstream'),false);
assert.equal((await probeOwnerPairRead({...opts,env:{}})).reason,'CTV_PAIR_NOT_CONFIGURED');
// Upstream HTTP denials must be actionable and must never disclose response
// bodies or credentials; no Bot API writes occur in these offline probes.
for(const [status,code] of [
 [403,'CTV_PAIR_UPSTREAM_AUTH_DENIED'],
 [404,'CTV_PAIR_UPSTREAM_DEPLOYMENT_INVALID'],
 [429,'CTV_PAIR_UPSTREAM_THROTTLED'],
 [503,'CTV_PAIR_UPSTREAM_SERVER_ERROR']
]){
 await assert.rejects(
  ()=>ownerPairAction('collaborators.pair.configure',config,{
   ...opts,env:{...env,SATORI_CTV_PAIR_CONFIG_ENABLED:'1'},
   fetcher:async()=>({ok:false,status,
    text:async()=>secret+' SHOULD NEVER BE READ'})
  }),
  e=>e?.code===code&&!String(e).includes(secret)
 );
}
const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
assert.ok(server.includes("p==='/api/admin/collaborator-pairs/readiness'"));
assert.ok(server.includes("SATORI_CTV_CONFIGURATION_READINESS"),'startup must report credential readiness without secrets');
assert.ok(server.includes('selection.refs.slice(i,i+2)'),
 'existing CTV policy must verify 17 destinations in bounded groups');
assert.ok(!server.includes('Promise.all(destinationInvoiceNos.map('),
 'existing CTV path must never flood the Apps Script lock');
assert.ok(server.includes('CTV_OWNER_POLICY_SAVE_FAILED'),
 'policy save errors must have privacy-safe server diagnostics');
const transport=fs.readFileSync(new URL('../owner-collaborator-pairs.mjs',import.meta.url),'utf8');
assert.ok(transport.includes("action==='collaborators.pair.list'?12000:30000"),
 'Drive-backed policy writes must not use the former 8-second deadline');

const admin=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
const scripts=[...admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
assert.ok(scripts.length>0,'admin has inline script');
for(const [,src] of scripts)new vm.Script(src,{filename:'CTV owner dashboard'});
for(const id of ['pairPartner','pairEnabled','pairCustomerDiscount','pairCollaboratorDiscount',
 'pairShipping','pairVat','pairSave','pairRefresh'])assert.ok(admin.includes('id="'+id+'"'));
assert.ok(admin.includes("pairLoadSuccessful=false"));
assert.ok(admin.includes('id="pairLinkPanel"'),'CTV must show verified single link in customers');
assert.ok(admin.includes("issueSavedPairLink(id)"),'post-save verified policy should issue link');
assert.ok(admin.includes('d.locationCandidates||[]'),
 'CTV owner wizard must show verified unique delivery points, not per-invoice rows');
assert.ok(admin.includes('destinationRefs:refs'),
 'CTV wizard must use exact source IDs when saving a policy');
assert.ok(admin.includes("JSON.stringify(savedRefs)===JSON.stringify(expectedRefs)"),
 'readback must match exact selected delivery source IDs');
assert.ok(admin.includes("confirmedPolicy.reviewedByOwner===true"),
 'readback must require owner-approved policy');
assert.ok(admin.includes("CTV_LINKS_NOT_READY"),
 'link credentials and production write readiness must remain guarded');
assert.ok(admin.includes("disabled"),'owner UI disabled until backend is verified');
console.log('PASS scoped owner-only CTV policy admin HMAC, default-off writes, 20/35 flexible GUI syntax (FAKE only)');
