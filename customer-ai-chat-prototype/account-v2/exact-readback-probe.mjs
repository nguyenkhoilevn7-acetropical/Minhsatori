/**
 * One-shot, read-only HMAC health probe of Apps Script Version 16.
 * Never reads a real customer's invoice, changes the ledger, or logs secrets.
 * Uses an unguessable key that must NOT exist and requires NOT_FOUND.
 */
import crypto from 'node:crypto';
export async function probeCanonicalReadback({readOnlyReady,readMinhSatori,report=()=>{},
 randomId=()=>crypto.randomUUID()}={}){
 const emit=(status,revision=null)=>{
  const summary=Object.freeze({status,...(Number.isSafeInteger(revision)&&revision>=1?{revision}:{})});
  report(summary);
  return summary;
 };
 if(!readOnlyReady?.())return emit('SKIPPED_NOT_CONFIGURED');
 try{
  const requestId=randomId();
  if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(requestId))
   return emit('FAIL_RANDOM_ID');
  const result=await readMinhSatori('orders.findByRequestId',{requestId});
  const revision=result?.revision;
  if(!Number.isSafeInteger(revision)||revision<1)return emit('FAIL_BAD_REVISION');
  if(result?.data?.found!==false||result.data.state!=='NOT_FOUND'||
   result.data.order!=null)return emit('FAIL_UNEXPECTED_RECORD');
  return emit('PASS',revision);
 }catch(e){
  // Only known transport/auth categories; never log arbitrary upstream text,
  // raw errors, request IDs, secret keys or customer information.
  const known=new Map([
   ['READ_ONLY_SIGNED_INVALID_ACTION','FAIL_INVALID_ACTION'],
   ['READ_ONLY_SIGNED_FORBIDDEN','FAIL_FORBIDDEN'],
   ['READ_ONLY_SIGNED_AUTH_FAILED','FAIL_AUTH'],
   ['READ_ONLY_SIGNED_INVALID_REQUEST','FAIL_INVALID_REQUEST'],
   ['READ_ONLY_SIGNED_INVALID_STATE','FAIL_LEDGER_STATE'],
   ['READ_ONLY_SIGNED_EXPIRED','FAIL_TIMESTAMP'],
   ['READ_ONLY_SIGNED_REPLAYED','FAIL_REPLAY'],
   ['READ_ONLY_SIGNED_ERROR','FAIL_UPSTREAM_ERROR'],
   ['READ_ONLY_UPSTREAM_ERROR','FAIL_UPSTREAM_ERROR'],
   ['READ_ONLY_NON_JSON_RESPONSE','FAIL_NON_JSON']
  ]);
  if(known.has(e?.message))return emit(known.get(e.message));
  if(e?.name==='AbortError')return emit('FAIL_TIMEOUT');
  if(/^READ_ONLY_UPSTREAM_HTTP_[345]\d{2}$/.test(e?.message||''))
   return emit('FAIL_HTTP');
  return emit('FAIL_SIGNED_LOOKUP');
 }
}
