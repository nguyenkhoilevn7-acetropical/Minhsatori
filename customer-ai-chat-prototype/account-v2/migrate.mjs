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
import {postgresConfig,assertNeonMigrationTarget} from './postgres-config.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const uri=process.env.SATORI_ACCOUNT_V2_DATABASE_URL||'';
if(process.env.SATORI_ACCOUNT_V2_MIGRATION_APPROVED!=='1')
 throw Error('V2_MIGRATION_NOT_APPROVED');
if(!/^postgres(?:ql)?:\/\//.test(uri))throw Error('V2_DATABASE_URL_REQUIRED');
const u=new URL(uri);
// Direct CLI execution must enforce the same Neon destination as boot.
if(u.hostname.endsWith('.neon.tech')||process.env.SATORI_ACCOUNT_V2_DATABASE_PROVIDER==='neon-free')
 assertNeonMigrationTarget();
if(!u.hostname||!u.pathname||u.pathname==='/postgres'||u.pathname==='/template1')
 throw Error('V2_DEDICATED_DATABASE_REQUIRED');
const client=new pg.Client(postgresConfig());
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
 // Existing standalone migrations contain their own BEGIN/COMMIT.
 // Strip ONLY these boundaries so every migration shares the outer transaction.
 const statements=file=>sql(file).replace(/^\s*(?:BEGIN|COMMIT)\s*;\s*$/gmi,'');
 await client.query(statements('migrations/20261025_owner_edits.sql'));
 await client.query(statements('migrations/20261025_policy_revision.sql'));
 await client.query(statements('migrations/20261025_customer_crm.sql'));
 await client.query(statements('migrations/20261026_commissions.sql'));
 await client.query(statements('migrations/20261026_invoice_bindings.sql'));
 await client.query(statements('migrations/20261026_gemini_budget.sql'));
 await client.query(statements('migrations/20261026_ctv_mode.sql'));
 const expected=[
  'satori_v2_accounts','satori_v2_sessions','satori_v2_profiles',
  'satori_v2_addresses','satori_v2_policies','satori_v2_catalogue',
  'satori_v2_carts','satori_v2_quotes','satori_v2_order_requests','satori_v2_audit',
  'satori_v2_commission_grants','satori_v2_test_invoices','satori_v2_test_settlements',
  'satori_v2_invoice_bindings','satori_v2_gemini_budget',
  'satori_v2_commission_grants','satori_v2_test_invoices','satori_v2_test_settlements',
  'satori_v2_invoice_bindings','satori_v2_gemini_budget'
 ];
 const check=await client.query(
  'SELECT table_name FROM information_schema.tables '+
  'WHERE table_schema=current_schema() AND table_name LIKE $1',
  ['satori_v2_%']);
 const found=new Set(check.rows.map(x=>x.table_name));
 if(expected.some(x=>!found.has(x)))throw Error('V2_SCHEMA_READBACK_FAILED');
 const crmTables=['satori_v2_registrations','satori_v2_customer_leads'];
 if(crmTables.some(x=>!found.has(x)))throw Error('V2_CRM_READBACK_FAILED');
 const stateColumns=await client.query(
  "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() "+
  "AND table_name='satori_v2_accounts' AND column_name IN ('access_status','revision')");
 if(stateColumns.rowCount!==2)throw Error('V2_ACCESS_CONTROL_MIGRATION_FAILED');
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
