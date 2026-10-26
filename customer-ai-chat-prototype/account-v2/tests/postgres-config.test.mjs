import test from 'node:test';import assert from 'node:assert/strict';
import {postgresConfig,assertNeonMigrationTarget} from '../postgres-config.mjs';
const env={SATORI_ACCOUNT_V2_DATABASE_URL:'postgresql://fake:fake@ep-example-123.ap-southeast-1.aws.neon.tech/satori_v2_pilot?sslmode=require',
 SATORI_ACCOUNT_V2_DATABASE_PROVIDER:'neon-free',SATORI_ACCOUNT_V2_MIGRATION_APPROVED:'1',
 SATORI_ACCOUNT_V2_MIGRATION_TARGET_HOST:'ep-example-123.ap-southeast-1.aws.neon.tech',
 SATORI_ACCOUNT_V2_MIGRATION_TARGET_DATABASE:'satori_v2_pilot'};
test('Neon always verifies TLS and removes connection-string SSL override',()=>{
 const c=postgresConfig(env);assert.equal(c.ssl.rejectUnauthorized,true);assert.ok(!c.connectionString.includes('sslmode'));
 assert.throws(()=>postgresConfig({...env,SATORI_ACCOUNT_V2_DATABASE_URL:env.SATORI_ACCOUNT_V2_DATABASE_URL.replace('require','disable')}),/TLS_REQUIRED/);
});
test('Neon migration pins exact host and isolated database, rejects pooler and generic database',()=>{
 assert.equal(assertNeonMigrationTarget(env),true);
 for(const edit of [{SATORI_ACCOUNT_V2_MIGRATION_APPROVED:'0'},
  {SATORI_ACCOUNT_V2_MIGRATION_TARGET_HOST:'ep-other.ap-southeast-1.aws.neon.tech'},
  {SATORI_ACCOUNT_V2_MIGRATION_TARGET_DATABASE:'neondb'},
  {SATORI_ACCOUNT_V2_DATABASE_PROVIDER:'paid'}])assert.throws(()=>assertNeonMigrationTarget({...env,...edit}));
 const host=env.SATORI_ACCOUNT_V2_MIGRATION_TARGET_HOST.replace('123.','123-pooler.');
 assert.throws(()=>assertNeonMigrationTarget({...env,SATORI_ACCOUNT_V2_MIGRATION_TARGET_HOST:host,
  SATORI_ACCOUNT_V2_DATABASE_URL:env.SATORI_ACCOUNT_V2_DATABASE_URL.replace('123.','123-pooler.')}),/DIRECT_ENDPOINT/);
});

// Exercise the real CLI entry point: rejection must happen before any network call.
test('direct migration CLI refuses unpinned Neon targets before connecting',async()=>{
 const {spawnSync}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const migration=fileURLToPath(new URL('../migrate.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[migration],{encoding:'utf8',timeout:3000,
  env:{...process.env,...env,SATORI_ACCOUNT_V2_MIGRATION_TARGET_HOST:'ep-wrong.ap-southeast-1.aws.neon.tech'}});
 assert.equal(result.status,1);assert.match(result.stderr,/V2_MIGRATION_NEON_TARGET_MISMATCH/);
 assert.doesNotMatch(result.stderr,/getaddrinfo|ECONNREFUSED|password authentication/);
});
