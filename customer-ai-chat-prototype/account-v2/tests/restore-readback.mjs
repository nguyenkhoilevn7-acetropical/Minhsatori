// Validate a restored CI snapshot against real PostgreSQL, not a mock.
import assert from 'node:assert/strict';
import {Pool} from 'pg';
const uri=process.env.SATORI_V2_CI_DATABASE_URL;
assert.ok(uri&&uri.endsWith('/satori_v2_restore')&&uri.includes('127.0.0.1'),
 'Only the dedicated local restore database is authorized');
const pool=new Pool({connectionString:uri,max:2});
try{
 for(const name of ['satori_v2_accounts','satori_v2_profiles','satori_v2_addresses',
  'satori_v2_policies','satori_v2_carts','satori_v2_quotes','satori_v2_order_requests']){
  const row=await pool.query('SELECT count(*)::integer AS count FROM '+name);
  assert.ok(row.rows[0].count>=1,name+' must be recovered from pg_dump');
 }
 const one=await pool.query('SELECT r.state,c.revision,q.catalogue_revision FROM '+
  'satori_v2_order_requests r JOIN satori_v2_quotes q ON r.quote_id=q.id '+
  'JOIN satori_v2_carts c ON c.account_id=q.account_id AND c.profile_id=q.profile_id');
 assert.equal(one.rowCount,1);
 assert.equal(one.rows[0].state,'PENDING_INTEGRATION');
 assert.equal(one.rows[0].revision,2);
 assert.equal(one.rows[0].catalogue_revision,1);
 console.log('PASS isolated V2 pg_dump/pg_restore owner-data readback; no invoice marked committed');
}finally{await pool.end()}
