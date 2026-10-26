// CI-only encrypted pg_dump -> authenticated decryption -> pg_restore -> exact row digest proof.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {tableManifest,exportBackup} from '../backup/export.mjs';
import {openBackup} from '../backup/archive.mjs';
const [mode,base]=process.argv.slice(2),uri=process.env.SATORI_V2_CI_DATABASE_URL||'';
assert.ok(uri.includes('127.0.0.1')&&/^postgresql:\/\//.test(uri));
assert.ok(base&&base.startsWith('/'));
const c=new pg.Client({connectionString:uri});await c.connect();
try{
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const tables=await tableManifest(c);
 if(mode==='seal'){
  assert.ok(uri.endsWith('/satori_v2_ci'));
  const key=randomBytes(32),source=new URL(uri);
  await exportBackup({...process.env,SATORI_ACCOUNT_V2_DATABASE_URL:uri,
   SATORI_V2_BACKUP_KEY_BASE64:key.toString('base64'),SATORI_V2_BACKUP_APPROVED:'1',
   SATORI_V2_BACKUP_SOURCE_HOST:source.hostname,SATORI_V2_BACKUP_SOURCE_DATABASE:'satori_v2_ci',
   SATORI_V2_BACKUP_OUTPUT:base+'.encrypted'});
  await writeFile(base+'.key',key,{flag:'wx',mode:0o600});
  const decoded=openBackup(await readFile(base+'.encrypted'),await readFile(base+'.key'));
  assert.deepEqual(decoded.manifest.tables,tables);
  // pg_restore below consumes bytes recovered from the authenticated archive.
  await writeFile(base+'.recovered.dump',decoded.dump,{flag:'wx',mode:0o600});
 }else{
  assert.equal(mode,'verify');assert.ok(uri.endsWith('/satori_v2_restore'));
  const {manifest}=openBackup(await readFile(base+'.encrypted'),await readFile(base+'.key'));
  assert.deepEqual(tables,manifest.tables);
  console.log('PASS encrypted archive restored: exact counts and SHA-256 digests for every V2 table');
 }
 await c.query('COMMIT');
}finally{await c.end()}
