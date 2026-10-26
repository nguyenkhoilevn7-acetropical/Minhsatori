/** Operator-only runner. No HTTP route, no DB writes, no restore or URL cutover. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {postgresConfig} from '../postgres-config.mjs';
import {backupKey,sealBackup,openBackup} from './archive.mjs';
const exec=promisify(execFile);
export async function tableManifest(client){
 const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
 if(!tables.length||tables.some(t=>!/^satori_v2_[a-z0-9_]+$/.test(t)))throw Error('BACKUP_NON_V2_OR_EMPTY_DATABASE');
 const result=[];
 for(const table of tables){
  const hash=createHash('sha256');let count=0;
  await client.query(`DECLARE backup_rows NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text AS row FROM public."${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`);
  for(;;){
   const batch=await client.query('FETCH 100 FROM backup_rows');if(!batch.rows.length)break;
   for(const {row} of batch.rows){const b=Buffer.from(row);hash.update(String(b.length)+':');hash.update(b);count++}
  }
  await client.query('CLOSE backup_rows');result.push({table,count,sha256:hash.digest('hex')});
 }
 return result;
}
export async function exportBackup(env=process.env){
 const key=backupKey(env.SATORI_V2_BACKUP_KEY_BASE64),options=postgresConfig(env),url=new URL(options.connectionString);
 if(env.SATORI_V2_BACKUP_APPROVED!=='1'||url.hostname!==env.SATORI_V2_BACKUP_SOURCE_HOST||
  decodeURIComponent(url.pathname.slice(1))!==env.SATORI_V2_BACKUP_SOURCE_DATABASE)throw Error('BACKUP_SOURCE_NOT_PINNED');
 if(!env.SATORI_V2_BACKUP_OUTPUT)throw Error('BACKUP_OUTPUT_REQUIRED');
 const c=new pg.Client(options);await c.connect();
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await c.query("SET LOCAL statement_timeout='120s'");
  const info=(await c.query('SELECT current_database() AS database,current_setting(\'server_version_num\')::int AS version,pg_export_snapshot() AS snapshot')).rows[0];
  const version=await exec('pg_dump',['--version']);
  const major=Number(version.stdout.match(/(\d+)\./)?.[1]);
  if(major<Math.floor(info.version/10000)||!major)throw Error('BACKUP_CLIENT_TOO_OLD');
  const extensions=(await c.query('SELECT extname,extversion FROM pg_extension ORDER BY extname')).rows;
  const tables=await tableManifest(c);
  // Credentials stay in child environment, never argv or logs. Exact tables only.
  const childEnv={PATH:env.PATH,PGHOST:url.hostname,PGPORT:url.port||'5432',
   PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),
   PGDATABASE:info.database,PGSSLMODE:options.ssl?'verify-full':'disable',PGCONNECT_TIMEOUT:'15'};
  const args=['--format=custom','--no-owner','--no-acl','--no-password','--strict-names','--snapshot='+info.snapshot,
   ...tables.flatMap(t=>['--table=public.'+t.table])];
  let dump;
  try{dump=(await exec('pg_dump',args,{env:childEnv,encoding:'buffer',maxBuffer:64*1024*1024,timeout:180000})).stdout}
  catch{throw Error('BACKUP_DUMP_FAILED')}
  const manifest={createdAt:new Date().toISOString(),sourceDatabase:info.database,serverVersion:info.version,
   dumpClientMajor:major,extensions,tables,snapshotConsistency:'exported-repeatable-read',restoreVerified:false};
  const {archive,receipt}=sealBackup(dump,manifest,key);
  await writeFile(env.SATORI_V2_BACKUP_OUTPUT,archive,{flag:'wx',mode:0o600});
  const readback=openBackup(await readFile(env.SATORI_V2_BACKUP_OUTPUT),key);
  if(readback.manifest.dumpBytes!==dump.length)throw Error('BACKUP_READBACK_FAILED');
  await c.query('COMMIT');return {...receipt,tableCount:tables.length,restoreVerified:false};
 }finally{await c.end();key.fill(0)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 exportBackup().then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('V2_BACKUP_FAILED_NO_CREDENTIALS_LOGGED');process.exitCode=1});
}
