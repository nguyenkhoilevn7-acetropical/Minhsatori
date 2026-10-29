/**
 * Read-only V2 database readiness without Render Shell or exposed credentials.
 * Safe to call before Google OAuth configuration; returns only schema health,
 * never customer rows, connection URLs, DB errors, addresses or passwords.
 */
export const V2_REQUIRED_COLUMNS=Object.freeze({
 satori_v2_accounts:['id','google_sub','access_status','revision'],
 satori_v2_sessions:['token_hash','csrf_hash','account_id'],
 satori_v2_profiles:['id','account_id','type','revision'],
 satori_v2_addresses:['id','profile_id','active','revision'],
 satori_v2_policies:['id','profile_id','enabled','revision'],
 satori_v2_catalogue:['code','list_price','revision'],
 satori_v2_carts:['account_id','profile_id','lines','revision'],
 satori_v2_quotes:['id','account_id','payload','expires_at'],
 satori_v2_order_requests:['id','quote_id','request_id','state'],
 satori_v2_audit:['id','event_type'],
 satori_v2_registrations:['account_id','full_name','phone','address','revision'],
 satori_v2_customer_leads:['id','discount_bps','collaborator_bps','revision']
});

export async function inspectV2Storage(pool){
 // Only metadata: never SELECT customer tables or their private contents.
 const tables=Object.keys(V2_REQUIRED_COLUMNS);
 const result=await pool.query(
  'SELECT t.table_name AS "tableName",c.column_name AS "columnName" '+
  'FROM information_schema.tables t JOIN information_schema.columns c '+
  'ON c.table_schema=t.table_schema AND c.table_name=t.table_name '+
  "WHERE t.table_schema=current_schema() AND t.table_type='BASE TABLE' "+
  'AND t.table_name=ANY($1::text[])',
  [tables]);
 const found=new Map();
 for(const row of result.rows){
  if(!found.has(row.tableName))found.set(row.tableName,new Set());
  found.get(row.tableName).add(row.columnName);
 }
 const schemaReady=tables.every(t=>found.has(t)&&
  V2_REQUIRED_COLUMNS[t].every(c=>found.get(t).has(c)));
 return Object.freeze({connected:true,schemaReady,tableCount:found.size});
}

export function createCachedStorageProbe(check,clock=()=>Date.now(),ttlMs=30000){
 let value=null,until=0,inflight=null;
 return async()=>{
  if(value!==null&&clock()<until)return value;
  if(inflight)return inflight;
  inflight=Promise.resolve().then(check)
   .catch(()=>({connected:false,schemaReady:false,tableCount:0}))
   .then(result=>{
    // Do not cache raw error messages, connection data or user records.
    const safe=Object.freeze({
     connected:result.connected===true,
     schemaReady:result.connected===true&&result.schemaReady===true,
     tableCount:Number.isSafeInteger(result.tableCount)?result.tableCount:0
    });
    value=safe;until=clock()+ttlMs;inflight=null;
    return safe;
   });
  return inflight;
 };
}
