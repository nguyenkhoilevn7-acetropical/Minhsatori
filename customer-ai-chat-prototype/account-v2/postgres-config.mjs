/** Never log returned options: they contain server credentials. */
export function postgresConfig(env=process.env){
 let url;
 try{url=new URL(env.SATORI_ACCOUNT_V2_DATABASE_URL||'')}catch{throw Error('V2_DATABASE_URL_INVALID')}
 if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('V2_DATABASE_URL_INVALID');
 const neon=url.hostname.endsWith('.neon.tech');
 const tls=neon||env.SATORI_ACCOUNT_V2_PG_SSL==='1';
 if(neon&&url.searchParams.has('sslmode')&&!['require','verify-full','verify-ca'].includes(url.searchParams.get('sslmode')))
  throw Error('V2_DATABASE_TLS_REQUIRED');
 // pg connection-string SSL parameters override the ssl object. Remove them
 // only when enforcing authenticated TLS, never allow rejectUnauthorized=false.
 if(tls)for(const key of ['sslmode','sslcert','sslkey','sslrootcert','ssl'])url.searchParams.delete(key);
 return {connectionString:url.toString(),connectionTimeoutMillis:15000,
  ...(tls?{ssl:{rejectUnauthorized:true}}:{})};
}
export function assertNeonMigrationTarget(env=process.env){
 const options=postgresConfig(env),url=new URL(options.connectionString);
 if(env.SATORI_ACCOUNT_V2_MIGRATION_APPROVED!=='1'||
    env.SATORI_ACCOUNT_V2_DATABASE_PROVIDER!=='neon-free'||
    !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(url.hostname)||
    url.hostname!==env.SATORI_ACCOUNT_V2_MIGRATION_TARGET_HOST||
    !/^satori_v2_[a-z0-9_]+$/.test(env.SATORI_ACCOUNT_V2_MIGRATION_TARGET_DATABASE||'')||
    decodeURIComponent(url.pathname.slice(1))!==env.SATORI_ACCOUNT_V2_MIGRATION_TARGET_DATABASE)
  throw Error('V2_MIGRATION_NEON_TARGET_MISMATCH');
 if(url.hostname.split('.')[0].endsWith('-pooler'))throw Error('V2_MIGRATION_DIRECT_ENDPOINT_REQUIRED');
 return true;
}
