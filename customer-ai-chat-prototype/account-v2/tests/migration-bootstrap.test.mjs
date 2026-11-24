import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPilotMigrationTarget} from '../migration-bootstrap.mjs';
const ok={SATORI_ACCOUNT_V2_MIGRATION_APPROVED:'1',
 SATORI_ACCOUNT_V2_MIGRATION_TARGET_DATABASE:'minh_satori_v2_pilot_isolated',
 SATORI_ACCOUNT_V2_DATABASE_URL:'postgresql://fake-user:fake-pass@dpg-dbevfkm7bikc73bl2v80-a/minh_satori_v2_pilot_isolated'};
const deny=override=>assert.throws(()=>assertPilotMigrationTarget({...ok,...override}),
 /V2_MIGRATION_/);
test('explicit pilot target is required, not default-enabled',()=>{
 assert.equal(assertPilotMigrationTarget(ok),true);
 deny({SATORI_ACCOUNT_V2_MIGRATION_APPROVED:'0'});
 deny({SATORI_ACCOUNT_V2_MIGRATION_TARGET_DATABASE:'other'});
});
test('refuses connection URL to an unrelated PostgreSQL database',()=>{
 deny({SATORI_ACCOUNT_V2_DATABASE_URL:'postgresql://u:p@production-database/mydb'});
 deny({SATORI_ACCOUNT_V2_DATABASE_URL:'postgresql://u:p@dpg-dbevfkm7bikc73bl2v80-a/production'});
 deny({SATORI_ACCOUNT_V2_DATABASE_URL:'postgresql://u:p@dpg-dbevfkm7bikc73bl2v80-a-attacker/minh_satori_v2_pilot_isolated'});
 deny({SATORI_ACCOUNT_V2_DATABASE_URL:'invalid-url'});
});
test('accepts private Render hostname, without revealing secret',()=>{
 assert.equal(assertPilotMigrationTarget({...ok,
  SATORI_ACCOUNT_V2_DATABASE_URL:'postgres://fake:fake@dpg-dbevfkm7bikc73bl2v80-a.internal/minh_satori_v2_pilot_isolated'}),true);
});
