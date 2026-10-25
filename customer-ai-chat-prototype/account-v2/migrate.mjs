/**
 * Run against a NEW, dedicated Minh Satori V2 PostgreSQL database only.
 * Never against the Apps Script accounting ledger or unrelated SQL databases.
 * Usage:
 * SATORI_ACCOUNT_V2_MIGRATION_APPROVED=1
 * SATORI_ACCOUNT_V2_DATABASE_URL=postgresql://... node account-v2/migrate.mjs
 *
 * Deliberately refuses to run if other application tables are present.
 * The operation is transactional, lock-guarded, repeatable and read back.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const here=path.dirname(fileURLToPath(import.meta.url));
const uri=process.env.SATORI_ACCOUNT_V2_DATABASE_URL||'';
if(process.env.SATORI_ACCOUNT_V2_MIGRATION_APPROVED!=='1')
 throw Error('V2_MIGRATION_NOT_APPROVED');
if(!/^postgres(?:ql)?:\/\//.test(uri))throw Error('V2_DATABASE_URL_REQUIRED');
const u=new URL(uri);
if(!u.hostname||!u.pathname||u.pathname==='/postgres'||u.pathname==='/template1')
 throw Error('V2_DEDICATED_DATABASE_REQUIRED');
const client=new pg.Client({
 connectionString:uri,
 connectionTimeoutMillis:5000,
 ssl:process.env.SATORI_ACCOUNT_V2_PG_SSL==='1'?{rejectUnauthorized:true}:undefined
});
await client.connect();
let committed=false;
try{
 await client.query('BEGIN');
 await client.query("SET LOCAL lock_timeout='10s'");
 await client.query("SET LOCAL statement_timeout='60s'");
 await client.query('SELECT pg_advisory_xact_lock($1,$2)',[20261025,9]);
 const tables=await client.query(
  "SELECT tablename FROM pg_catalog.pg_tables "+
  "WHERE schemaname=current_schema() AND tablename NOT LIKE 'satori_v2_%'");
 if(tables.rows.length)throw Error('NON_V2_TABLES_PRESENT_MIGRATION_DENIED');
 const sql=filename=>fs.readFileSync(path.join(here,filename),'utf8');
 await client.query(sql('schema.sql'));
 await client.query(sql('migrations/20261025_owner_edits.sql'));
 await client.query(sql('migrations/20261025_policy_revision.sql'));
 const expected=[
  'satori_v2_accounts','satori_v2_sessions','satori_v2_profiles',
  'satori_v2_addresses','satori_v2_policies','satori_v2_catalogue',
  'satori_v2_carts','satori_v2_quotes','satori_v2_order_requests','satori_v2_audit'
 ];
 const check=await client.query(
  'SELECT table_name FROM information_schema.tables '+
  'WHERE table_schema=current_schema() AND table_name LIKE $1',
  ['satori_v2_%']);
 const found=new Set(check.rows.map(x=>x.table_name));
 if(expected.some(x=>!found.has(x)))throw Error('V2_SCHEMA_READBACK_FAILED');
 const revisionCheck=await client.query(
  'SELECT table_name FROM information_schema.columns WHERE table_schema=current_schema() '+
  "AND column_name='revision' AND table_name IN ('satori_v2_profiles','satori_v2_addresses','satori_v2_policies')");
 if(revisionCheck.rowCount!==3)throw Error('V2_REVISION_MIGRATION_FAILED');
 await client.query('COMMIT');
 committed=true;
 console.log('PASS V2 dedicated PostgreSQL schema, policy/profile/address CAS and migration readback: '+expected.length+' tables');
}finally{
 if(!committed)await client.query('ROLLBACK').catch(()=>{});
 await client.end();
}
