/**
 * PostgreSQL 16 integration gate: synthetic rows only.
 * Exercises the actual schema, additive migration, 100 concurrent revision-CAS
 * attempts and 100 duplicate checkout IDs. Does not call Apps Script, Render,
 * Gemini, production data or any external service.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';

const uri=process.env.SATORI_V2_CI_DATABASE_URL;
assert.ok(uri && uri.includes('127.0.0.1'),'Only localhost test database is permitted');
const pool=new Pool({connectionString:uri,max:20,connectionTimeoutMillis:10000});
const sql=(file)=>readFileSync(new URL(file,import.meta.url),'utf8');
const one=async(text,values=[])=>{
 const result=await pool.query(text,values);
 assert.equal(result.rowCount,1);
 return result.rows[0];
};
try{
 await pool.query(sql('../schema.sql'));
 await pool.query(sql('../schema.sql')); // repeat migration idempotence
 await pool.query(sql('../migrations/20261025_owner_edits.sql'));
 await pool.query(sql('../migrations/20261025_owner_edits.sql'));
 await pool.query(sql('../migrations/20261025_policy_revision.sql'));
 await pool.query(sql('../migrations/20261025_policy_revision.sql'));
 const account=await one(
  'INSERT INTO satori_v2_accounts(google_sub,email,display_name) VALUES($1,$2,$3) RETURNING id',
  ['ci-'+randomUUID(),'sandbox-only@example.invalid','Fake Owner']);
 const profile=await one(
  'INSERT INTO satori_v2_profiles(account_id,type,display_name) VALUES($1,$2,$3) RETURNING id,revision',
  [account.id,'collaborator','Fake Partner']);
 const address=await one(
  'INSERT INTO satori_v2_addresses(profile_id,label,recipient_name,recipient_phone,address) '+
  'VALUES($1,$2,$3,$4,$5) RETURNING id,revision',
  [profile.id,'fake-destination','Fake Recipient','0900000000','1 Example Street']);
 assert.equal(profile.revision,1);
 assert.equal(address.revision,1);
 const policy=await one(
  'INSERT INTO satori_v2_policies(profile_id,address_id,product_code,discount_bps,'+
  'collaborator_bps,invoice_mode,version,approved_by) '+
  'VALUES($1,$2,$3,2500,3500,$4,1,$5) RETURNING discount_bps,collaborator_bps',
  [profile.id,address.id,'TP-00001','pair','ci-owner']);
 assert.equal(policy.discount_bps,2500);
 assert.equal(policy.collaborator_bps,3500);
 // Same-account customer address edit must succeed only at the expected revision.
 const changed=await one(
  'UPDATE satori_v2_addresses AS a SET label=$3,revision=a.revision+1,updated_at=now() '+
  'FROM satori_v2_profiles AS p WHERE a.id=$1 AND a.profile_id=$2 '+
  'AND p.id=a.profile_id AND p.account_id=$4 AND a.revision=$5 RETURNING a.revision',
  [address.id,profile.id,'Edited Fake Destination',account.id,1]);
 assert.equal(changed.revision,2);
 const stale=await pool.query(
  'UPDATE satori_v2_addresses AS a SET label=$3,revision=a.revision+1 '+
  'FROM satori_v2_profiles AS p WHERE a.id=$1 AND a.profile_id=$2 '+
  'AND p.id=a.profile_id AND p.account_id=$4 AND a.revision=$5 RETURNING a.id',
  [address.id,profile.id,'Stale overwrite rejected',account.id,1]);
 assert.equal(stale.rowCount,0,'stale address edit must not overwrite fresh revision');
 // Disable a previously approved policy through revision CAS, preserving history.
 const original=await one('SELECT id,revision FROM satori_v2_policies WHERE profile_id=$1',[profile.id]);
 assert.equal(original.revision,1);
 const policyOff=await one(
  'UPDATE satori_v2_policies SET enabled=false,revision=revision+1 '+
  'WHERE id=$1 AND revision=$2 AND enabled=true RETURNING revision,enabled',
  [original.id,1]);
 assert.equal(policyOff.revision,2);assert.equal(policyOff.enabled,false);
 const repeatedOff=await pool.query(
  'UPDATE satori_v2_policies SET enabled=false,revision=revision+1 '+
  'WHERE id=$1 AND revision=$2 AND enabled=true',[original.id,1]);
 assert.equal(repeatedOff.rowCount,0,'stale policy updates cannot succeed');
 const replacement=await one(
  'INSERT INTO satori_v2_policies(profile_id,address_id,product_code,discount_bps,'+
  'collaborator_bps,invoice_mode,version,approved_by) '+
  'VALUES($1,$2,$3,3000,3500,$4,2,$5) RETURNING version,revision,enabled',
  [profile.id,address.id,'TP-00001','pair','ci-owner']);
 assert.equal(replacement.version,2);assert.equal(replacement.revision,1);
 const cart=await one(
  'INSERT INTO satori_v2_carts(account_id,profile_id,lines) VALUES($1,$2,$3) '+
  'RETURNING revision',
  [account.id,profile.id,JSON.stringify([{code:'TP-00001',qty:3}])]);
 assert.equal(cart.revision,1);

 // Every client was handed the same cart version. Exactly ONE can advance it.
 const cartWrites=await Promise.all(Array.from({length:100},()=>pool.query(
  'UPDATE satori_v2_carts SET revision=revision+1,updated_at=now() '+
  'WHERE account_id=$1 AND profile_id=$2 AND revision=1 RETURNING revision',
  [account.id,profile.id])));
 assert.equal(cartWrites.filter(x=>x.rowCount===1).length,1,'100 devices cannot overwrite same revision');
 const fresh=await one('SELECT revision FROM satori_v2_carts WHERE account_id=$1 AND profile_id=$2',
  [account.id,profile.id]);
 assert.equal(fresh.revision,2);

 // 100 duplicate confirmations share one stable server-side request ID.
 // This proves database uniqueness, NOT real signed Apps Script delivery.
 const quote=await one(
  'INSERT INTO satori_v2_quotes(account_id,profile_id,address_id,payload,cart_revision,'+
  'catalogue_revision,expires_at) VALUES($1,$2,$3,$4,2,1,now()+interval '+
  "'10 minutes'"+') RETURNING id',
  [account.id,profile.id,address.id,JSON.stringify({totalVnd:100000})]);
 const idempotencyKey=randomUUID();
 const confirmations=await Promise.all(Array.from({length:100},()=>pool.query(
  'INSERT INTO satori_v2_order_requests(quote_id,account_id,request_id,state) '+
  'VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',
  [quote.id,account.id,idempotencyKey,'PENDING_INTEGRATION'])));
 assert.equal(confirmations.filter(x=>x.rowCount===1).length,1,'100 retries must result in one request');
 const reqCount=await one('SELECT count(*)::integer AS count FROM satori_v2_order_requests '+
  'WHERE account_id=$1 AND request_id=$2',[account.id,idempotencyKey]);
 assert.equal(reqCount.count,1);
 const duplicateQuoteDifferentKey=await pool.query(
  'INSERT INTO satori_v2_order_requests(quote_id,account_id,request_id,state) '+
  'VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',
  [quote.id,account.id,randomUUID(),'PENDING_INTEGRATION']);
 assert.equal(duplicateQuoteDifferentKey.rowCount,0,
  'a second requestId cannot produce another order from an already-submitted quote');
 const reqState=await one('SELECT state FROM satori_v2_order_requests WHERE quote_id=$1',[quote.id]);
 assert.equal(reqState.state,'PENDING_INTEGRATION','never claim the invoice is committed');

 // Invalid ownership cannot bind a second customer's quote to this address.
 const stranger=await one(
  'INSERT INTO satori_v2_accounts(google_sub,email,display_name) VALUES($1,$2,$3) RETURNING id',
  ['ci-'+randomUUID(),'not-a-user@example.invalid','Fake Other']);
 const forbidden=await pool.query(
  'UPDATE satori_v2_addresses AS a SET label=$3,revision=a.revision+1 '+
  'FROM satori_v2_profiles AS p WHERE a.id=$1 AND a.profile_id=$2 '+
  'AND p.id=a.profile_id AND p.account_id=$4 AND a.revision=$5 RETURNING a.id',
  [address.id,profile.id,'Cross-account overwrite attempt',stranger.id,2]);
 assert.equal(forbidden.rowCount,0,'customer cannot update another account address');
 // V2 history is cross-checked against BOTH quote and request account IDs.
 const ownHistory=await pool.query(
  'SELECT r.state,q.payload->>\'totalVnd\' AS total_vnd FROM '+
  'satori_v2_order_requests r JOIN satori_v2_quotes q ON q.id=r.quote_id '+
  'WHERE r.account_id=$1 AND q.account_id=$1',[account.id]);
 assert.equal(ownHistory.rowCount,1);
 assert.equal(ownHistory.rows[0].state,'PENDING_INTEGRATION');
 const strangerHistory=await pool.query(
  'SELECT r.id FROM satori_v2_order_requests r JOIN satori_v2_quotes q ON q.id=r.quote_id '+
  'WHERE r.account_id=$1 AND q.account_id=$1',[stranger.id]);
 assert.equal(strangerHistory.rowCount,0,'history must never leak across accounts');
 const unrelated=await one(
  'INSERT INTO satori_v2_profiles(account_id,type,display_name) VALUES($1,$2,$3) RETURNING id',
  [stranger.id,'retail','Other']);
 await assert.rejects(()=>pool.query(
  'INSERT INTO satori_v2_quotes(account_id,profile_id,address_id,payload,cart_revision,'+
  "catalogue_revision,expires_at) VALUES($1,$2,$3,'{}',1,1,now()+interval '10 minutes')",
  [stranger.id,unrelated.id,address.id]),{code:'23503'});
 console.log('PASS V2 PostgreSQL schema + migration replay + owner FK + 100 CART CAS + policy disable CAS + own-address CAS + cross-account denial + 100 identical checkout requestId; sandbox rows only');
}finally{await pool.end()}
