import {assertNeonMigrationTarget} from './postgres-config.mjs';
/**
 * Guard the Render Free V2 pilot DB only. This is not a generic production
 * migrator. Never log connection strings or raw parser errors.
 */
const PILOT_DB='minh_satori_v2_pilot_isolated';
const PILOT_HOST='dpg-dbevfkm7bikc73bl2v80-a';
export function assertPilotMigrationTarget(env=process.env){
 if(env.SATORI_ACCOUNT_V2_DATABASE_PROVIDER==='neon-free')return assertNeonMigrationTarget(env);
 if(env.SATORI_ACCOUNT_V2_MIGRATION_APPROVED!=='1')
  throw Error('V2_MIGRATION_NOT_APPROVED');
 if(env.SATORI_ACCOUNT_V2_MIGRATION_TARGET_DATABASE!==PILOT_DB)
  throw Error('V2_MIGRATION_TARGET_NOT_APPROVED');
 let url;
 try{url=new URL(env.SATORI_ACCOUNT_V2_DATABASE_URL||'')}
 catch{throw Error('V2_MIGRATION_DATABASE_URL_INVALID')}
 if(!['postgres:','postgresql:'].includes(url.protocol)||
    !url.hostname.startsWith(PILOT_HOST)||
    !(url.hostname.length===PILOT_HOST.length||
      url.hostname[PILOT_HOST.length]==='.')||
    decodeURIComponent(url.pathname.slice(1))!==PILOT_DB)
  throw Error('V2_MIGRATION_TARGET_MISMATCH');
 return true;
}
