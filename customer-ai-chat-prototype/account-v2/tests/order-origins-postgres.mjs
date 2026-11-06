// Synthetic database only. No Production network or invoice writes.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {readVerifiedOrderOrigins} from '../order-origins.mjs';
const uri=process.env.SATORI_V2_CI_DATABASE_URL;
assert.ok(uri && new URL(uri).hostname==='127.0.0.1','localhost CI database required');
const pool=new Pool({connectionString:uri});
const one=async(sql,args)=>(await pool.query(sql,args)).rows[0];
try {
 for(const [i,role] of ['collaborator','agency','retail'].entries()){
  const a=await one('INSERT INTO satori_v2_accounts(google_sub,email,display_name) VALUES($1,$2,$3) RETURNING id',['origin-'+randomUUID(),'fake@example.invalid','Fake Login']);
  const p=await one('INSERT INTO satori_v2_profiles(account_id,type,display_name) VALUES($1,$2,$3) RETURNING id',[a.id,role,'Fake '+role]);
  const d=await one('INSERT INTO satori_v2_addresses(profile_id,label,recipient_name,recipient_phone,address) VALUES($1,$2,$3,$4,$5) RETURNING id',[p.id,'fake','Different Recipient','000','Fake Address']);
  const q=await one("INSERT INTO satori_v2_quotes(account_id,profile_id,address_id,payload,cart_revision,catalogue_revision,expires_at) VALUES($1,$2,$3,'{}',1,1,now()+interval '1 hour') RETURNING id",[a.id,p.id,d.id]);
  const request=randomUUID(),ledger='fake-origin-'+randomUUID(),no=990001+i;
  await pool.query("INSERT INTO satori_v2_order_requests(quote_id,account_id,request_id,state,ledger_invoice_id,ledger_invoice_no,canonical_intent) VALUES($1,$2,$3,'COMMITTED',$4,$5,$6)",[q.id,a.id,request,ledger,no,{requestId:request}]);
  const before=await one('SELECT * FROM satori_v2_order_requests WHERE request_id=$1',[request]);
  const out=await readVerifiedOrderOrigins(pool);
  assert.deepEqual(out.entries.find(r=>r.ledgerInvoiceId===ledger),{ledgerInvoiceId:ledger,invoiceNo:String(no),accountId:a.id,accountName:'Fake '+role,accountRole:role,requestId:request});
  assert.deepEqual(await one('SELECT * FROM satori_v2_order_requests WHERE request_id=$1',[request]),before);
 }
 console.log('PASS synthetic PostgreSQL: exact checkout joins, three roles, submitted rows unchanged');
} finally {await pool.end()}
