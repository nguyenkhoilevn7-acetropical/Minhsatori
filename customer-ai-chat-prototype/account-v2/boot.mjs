/**
 * Render Free web services have no shell/one-off jobs. An explicitly approved,
 * target-pinned boot-time migration supports one-time pilot schema setup
 * without opening PostgreSQL's public IP allowlist or exposing credentials.
 * REMOVE SATORI_ACCOUNT_V2_MIGRATION_APPROVED after successful migration.
 */
import {spawnSync} from 'node:child_process';
import {assertPilotMigrationTarget} from './migration-bootstrap.mjs';
import {readOnlyReady} from '../satori-readonly.mjs';
import {describeCanonicalReadEnv} from './read-transport-diagnostic.mjs';
// Logs only a boolean, never the signed ledger endpoint/key/secret.
console.info('SATORI_V2_CANONICAL_READ_READY',readOnlyReady());
console.info('SATORI_V2_CANONICAL_READ_FLAGS',JSON.stringify(describeCanonicalReadEnv(process.env)));
// Private, non-secret production diagnostic. Never print endpoints, keys or credentials.
import {ledgerRelayConfig} from './canonical-ledger-relay.mjs';
let writerStatus='READY';
if(process.env.SATORI_ACCOUNT_V2_REAL_CHECKOUT_ENABLED!=='1'){
 writerStatus='REAL_CHECKOUT_GATE_OFF';
}else{
 try{ledgerRelayConfig(process.env)}
 catch(e){writerStatus=['LEDGER_RELAY_DISABLED','LEDGER_RELAY_NOT_CONFIGURED',
  'LEDGER_WRITER_MUST_BE_SEPARATE'].includes(e?.code)?e.code:'WRITER_NOT_READY'}
}
console.info('SATORI_V2_CANONICAL_WRITER_STATUS',writerStatus);

import {describeGeminiRuntime} from './gemini-env-diagnostic.mjs';
// Private Render log: boolean-only checks, never API key contents.
console.info('SATORI_V2_GEMINI_RUNTIME_FLAGS',JSON.stringify(describeGeminiRuntime(process.env)));
if(process.env.SATORI_ACCOUNT_V2_MIGRATION_APPROVED==='1'){
 try{assertPilotMigrationTarget()}
 catch{console.error('V2_MIGRATION_TARGET_BLOCKED');process.exit(1)}
 const result=spawnSync(process.execPath,['account-v2/migrate.mjs'],{
  cwd:process.cwd(),env:process.env,stdio:'pipe',timeout:90_000
 });
 if(result.status!==0||result.error){
  // Never emit driver stderr or URL-bearing errors in public service logs.
  console.error('V2_MIGRATION_FAILED_CHECK_PRIVATE_RENDER_CONFIGURATION');
  process.exit(1);
 }
 console.info('V2_MIGRATION_SCHEMA_READBACK_PASSED');
}
await import('./standalone.mjs');
// Async read-only catalogue coverage; never block service availability.
import('./catalogue-readiness-log.mjs').then(({logCatalogueSnapshot})=>logCatalogueSnapshot()).catch(()=>{});
