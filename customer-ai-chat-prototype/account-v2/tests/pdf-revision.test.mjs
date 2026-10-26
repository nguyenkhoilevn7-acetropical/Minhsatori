import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {resolveSandboxPdf} from '../canonical-adapters.mjs';

function fixture() {
 const invoiceId=randomUUID(),actor={id:randomUUID()};
 const bytes=Buffer.from('%PDF-1.4\nSYNTHETIC ONLY\n%%EOF');
 let receipt={canonical_id:'TEST-identity',revision:1,pdf:{fileId:'SYNTHETIC_FILE_123',mimeType:'application/pdf',sha256:createHash('sha256').update(bytes).digest('hex')}};
 let active=true;
 const pool={async query(sql){
  if(sql.includes('JOIN satori_v2_accounts'))return {rows:active?[{id:invoiceId}]:[]};
  if(sql.startsWith('SELECT canonical_id,pdf,revision'))return {rows:receipt?[structuredClone(receipt)]:[]};
  throw Error('Unexpected query');
 }};
 const reader={testOnly:true,async read(ref){return {...ref,mimeType:'application/pdf',bytes}}};
 return {pool,actor,invoiceId,reader,bytes,update(fn){receipt=fn(receipt)},revoke(){active=false}};
}
test('PDF reader receives stored revision and returns verified revision',async()=>{
 const f=fixture();let request;
 const reader={...f.reader,async read(ref){request=ref;return f.reader.read(ref)}};
 const result=await resolveSandboxPdf(f.pool,f.actor,{invoiceId:f.invoiceId},reader);
 assert.equal(request.expectedRevision,1);assert.equal(result.revision,1);assert.deepEqual(result.bytes,f.bytes);
});
for(const [name,change] of [
 ['revision',r=>({...r,revision:2})],
 ['canonical identity',r=>({...r,canonical_id:'TEST-other'})],
 ['file identity',r=>({...r,pdf:{...r.pdf,fileId:'ANOTHER_FILE_123'}})],
 ['file digest',r=>({...r,pdf:{...r.pdf,sha256:'0'.repeat(64)}})],
 ['removed receipt',()=>null]
])test(`PDF rejects concurrent ${name} change`,async()=>{
 const f=fixture();const reader={testOnly:true,async read(ref){const result=await f.reader.read(ref);f.update(change);return result}};
 await assert.rejects(resolveSandboxPdf(f.pool,f.actor,{invoiceId:f.invoiceId},reader),/PDF_REVISION_CONFLICT/);
});
test('PDF invalid stored revision fails before remote read',async()=>{
 const f=fixture();f.update(r=>({...r,revision:0}));let calls=0;
 await assert.rejects(resolveSandboxPdf(f.pool,f.actor,{invoiceId:f.invoiceId},{testOnly:true,async read(){calls++}}),/PDF_REVISION_INVALID/);
 assert.equal(calls,0);
});
test('PDF still refuses account revoked during remote read',async()=>{
 const f=fixture();await assert.rejects(resolveSandboxPdf(f.pool,f.actor,{invoiceId:f.invoiceId},{testOnly:true,async read(ref){f.revoke();return f.reader.read(ref)}}),/INVOICE_FORBIDDEN/);
});
