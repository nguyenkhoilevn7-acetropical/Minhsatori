export function assertSyntheticEnvironment(env){
 if(env.SATORI_SYNTHETIC_STAGING!=='1')throw Error('SYNTHETIC_ONLY');
 for(const key of Object.keys(env)){
  if(/^(SATORI_READ_|SATORI_V1_|SATORI_V2_CANONICAL_|SATORI_GROK_MCP_TOKEN|SATORI_ACCOUNT_V2_DATABASE_URL|ENABLE_ZALO_SEND)/.test(key)&&env[key])
   throw Error('SYNTHETIC_ONLY');
 }
 let db;try{db=new URL(env.SATORI_V2_CI_DATABASE_URL)}catch{throw Error('LOCAL_DATABASE_ONLY')}
 if(!['postgres:','postgresql:'].includes(db.protocol)||db.hostname!=='127.0.0.1'||db.pathname!=='/satori_v2_ci')throw Error('LOCAL_DATABASE_ONLY');
 return true;
}
