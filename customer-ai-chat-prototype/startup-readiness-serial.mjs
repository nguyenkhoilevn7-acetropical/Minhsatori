/**
 * Startup-only, non-mutating diagnostic scheduler.
 * Apps Script is shared by multiple scoped HMAC readers; avoid overlapping
 * readiness requests to reduce contention and make failures attributable.
 * This does not change request bodies, credentials, scopes or checkout gates.
 * Failures are handled by a fixed-code onError callback; never log the error
 * object, URL, signed payload, or credentials.
 */
export async function runSerializedStartupReadiness(steps) {
 if(!Array.isArray(steps))throw new TypeError('STARTUP_STEPS_INVALID');
 const results=[];
 for(const step of steps){
  if(!step?.enabled)continue;
  if(typeof step.name!=='string'||typeof step.run!=='function')
   throw new TypeError('STARTUP_STEP_INVALID');
  try{
   await step.run();
   results.push({name:step.name,completed:true});
  }catch{
   results.push({name:step.name,completed:false});
   if(typeof step.onError==='function'){
    try{step.onError()}catch{/* never reveal untrusted upstream failure */}
   }
  }
 }
 return results;
}
