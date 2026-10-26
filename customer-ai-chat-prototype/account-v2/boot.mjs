/**
 * Render Free web services have no shell/one-off jobs. An explicitly approved,
 * target-pinned boot-time migration supports one-time pilot schema setup
 * without opening PostgreSQL's public IP allowlist or exposing credentials.
 * REMOVE SATORI_ACCOUNT_V2_MIGRATION_APPROVED after successful migration.
 */
import {spawnSync} from 'node:child_process';
import {assertPilotMigrationTarget} from './migration-bootstrap.mjs';
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
