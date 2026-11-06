/**
 * Identity rollout policy for Account V2. Raw Google ID tokens are ONLY accepted
 * after google-auth-library has verified signature, issuer and client audience.
 * No public registration by accident: customer access defaults to owner-only.
 */
export function acceptedSubjects(env=process.env){
 const owner=String(env.SATORI_ACCOUNT_V2_OWNER_SUB||'').trim();
 const pilot=String(env.SATORI_ACCOUNT_V2_PILOT_SUB||'').trim();
 const authorizedOwner=owner.length>=4&&owner===pilot;
 const customersEnabled=env.SATORI_ACCOUNT_V2_CUSTOMERS_ENABLED==='1';
 const raw=String(env.SATORI_ACCOUNT_V2_CUSTOMER_ALLOWLIST_SUBS||'');
 let approved=[];
 if(customersEnabled && raw.length<=32768){
  try{
   const parsed=JSON.parse(raw);
   if(Array.isArray(parsed)&&parsed.length<=500&&parsed.every(
    s=>typeof s==='string'&&s.length>=4&&s.length<=256)){
    approved=parsed;
   }
  }catch{}
 }
 const customerSet=new Set(approved);
 return Object.freeze({
  ownerReady:authorizedOwner,
  customerRolloutReady:authorizedOwner&&customersEnabled&&customerSet.size>0,
  allows(sub){
   return typeof sub==='string'&&(
    (authorizedOwner&&sub===owner)||
    (authorizedOwner&&customersEnabled&&customerSet.has(sub)));
  },
  isOwner(sub){return authorizedOwner&&sub===owner}
 });
}
