/**
 * A one-shot, read-only Render startup diagnostic: active catalogue coverage.
 * Logs no rows, prices, customer information, DB endpoints or credentials.
 */
export async function catalogueSnapshot(query){
 const result=await query(
  "SELECT COUNT(*)::int AS active_count, "+
  "COUNT(*) FILTER (WHERE code='TP-00003')::int AS satori_500, "+
  "COUNT(*) FILTER (WHERE code='TP-00058')::int AS juice_oi "+
  "FROM satori_v2_catalogue WHERE active=true");
 const one=result?.rows?.[0];
 if(!one)throw Error('CATALOGUE_READINESS_UNAVAILABLE');
 return Object.freeze({
  activeCount:Number(one.active_count),
  satori500Active:Number(one.satori_500)>0,
  oiHongActive:Number(one.juice_oi)>0
 });
}
export async function logCatalogueSnapshot(env=process.env,log=console.info){
 // The diagnostic is guarded by existing pilot enablement and DB URL.
 if(env.SATORI_ACCOUNT_V2_ENABLED!=='1'||!env.SATORI_ACCOUNT_V2_DATABASE_URL)return;
 let pool;
 try{
  const {default:pg}=await import('pg');
  pool=new pg.Pool({connectionString:env.SATORI_ACCOUNT_V2_DATABASE_URL,
   max:1,connectionTimeoutMillis:4000,idleTimeoutMillis:2000,
   ssl:env.SATORI_ACCOUNT_V2_PG_SSL==='1'?{rejectUnauthorized:true}:undefined});
  const result=await catalogueSnapshot(statement=>pool.query(statement));
  log('SATORI_V2_CATALOGUE_READINESS',JSON.stringify(result));
 }catch{
  log('SATORI_V2_CATALOGUE_READINESS','read_only_unavailable');
 }finally{
  if(pool)await pool.end().catch(()=>{});
 }
}
