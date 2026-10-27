import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readSharedSandboxPdf,sendSharedPdf,SHARED_SANDBOX_PDF_PATH} from '../invoice-document.mjs';

function fixture(){
 const invoiceId=randomUUID(),ownerId=randomUUID(),otherId=randomUUID();
 const pdf=Buffer.from('%PDF-1.4\nONE-CANONICAL-FAKE-PDF\n%%EOF');
 const sha256=createHash('sha256').update(pdf).digest('hex');
 let latest={canonical_id:'TEST-one',revision:1,
  pdf:{fileId:'SYNTHETIC_FILE_123',mimeType:'application/pdf',sha256}};
 let reads=0, remoteReads=0;
 const pool={async query(sql,args){
  if(sql.includes('JOIN satori_v2_accounts')){
   return {rows:args[1]===ownerId?[{id:invoiceId}]:[]};
  }
  if(sql.startsWith('SELECT canonical_id,pdf,revision')){
   reads++;
   return {rows:latest?[structuredClone(latest)]:[]};
  }
  throw Error('Unexpected SQL: '+sql);
 }};
 const reader={testOnly:true,async read(ref){
  remoteReads++;
  assert.equal(ref.fileId,'SYNTHETIC_FILE_123');
  assert.equal(ref.canonicalId,'TEST-one');
  assert.equal(ref.expectedRevision,1);
  return {fileId:ref.fileId,canonicalId:ref.canonicalId,
   mimeType:'application/pdf',bytes:pdf};
 }};
 return {pool,invoiceId,owner:{id:ownerId},outsider:{id:otherId},
  reader,pdf,sha256,getReads:()=>reads,getRemoteReads:()=>remoteReads,
  update(fn){latest=fn(latest)}};
}
function responseCapture(){
 const response={code:null,headers:null,body:null,
  writeHead(code,headers){this.code=code;this.headers=headers},
  end(data){this.body=Buffer.from(data)}};
 return response;
}
test('web, Android and Gemini all receive precisely the same stored PDF bytes and SHA-256',async()=>{
 const f=fixture();
 const outputs=[];
 for(const surface of ['website','android','gemini']){
  // Surface intentionally is NOT an input: it cannot affect PDF content.
  const verified=await readSharedSandboxPdf(f.pool,f.owner,f.invoiceId,f.reader);
  const res=responseCapture();
  sendSharedPdf(res,verified);
  outputs.push({surface,res,verified});
 }
 for(const output of outputs){
  assert.equal(output.res.code,200);
  assert.equal(output.res.headers['content-type'],'application/pdf');
  assert.equal(output.res.headers['content-length'],String(f.pdf.length));
  assert.equal(output.res.headers['x-content-sha256'],f.sha256);
  assert.equal(output.res.headers.etag,'"sha256-'+f.sha256+'"');
  assert.equal(output.res.headers['cache-control'],'private, no-store, max-age=0');
  assert.deepEqual(output.res.body,f.pdf);
  assert.equal(output.verified.invoiceId,f.invoiceId);
  assert.equal(output.verified.revision,1);
 }
 assert.equal(f.getRemoteReads(),3);
 assert.equal(SHARED_SANDBOX_PDF_PATH,'/api/v2/sandbox-invoice-document');
});
test('unauthorized history/PDF never reaches remote Drive reader',async()=>{
 const f=fixture();
 await assert.rejects(readSharedSandboxPdf(f.pool,f.outsider,f.invoiceId,f.reader),/INVOICE_FORBIDDEN/);
 assert.equal(f.getRemoteReads(),0);
});
test('missing reader fails closed instead of generating a PDF',async()=>{
 const f=fixture();
 await assert.rejects(readSharedSandboxPdf(f.pool,f.owner,f.invoiceId),/CANONICAL_PDF_NOT_CONFIGURED/);
 assert.equal(f.getRemoteReads(),0);
});
test('invalid PDF bytes and changed signed PDF digest never stream',async()=>{
 const f=fixture();
 const reader={testOnly:true,async read(ref){
  return {fileId:ref.fileId,canonicalId:ref.canonicalId,
   mimeType:'application/pdf',bytes:Buffer.from('%PDF-1.4\nTAMPER\n%%EOF')};
 }};
 await assert.rejects(readSharedSandboxPdf(f.pool,f.owner,f.invoiceId,reader),/PDF_HASH_MISMATCH/);
 const bad=responseCapture();
 assert.throws(()=>sendSharedPdf(bad,{invoiceId:f.invoiceId,testOnly:true,
  bytes:f.pdf,sha256:'0'.repeat(64)}),/PDF_HASH_MISMATCH/);
 assert.equal(bad.code,null);
});
test('remote read racing with canonical receipt change is rejected',async()=>{
 const f=fixture();
 const reader={testOnly:true,async read(ref){
  f.update(x=>({...x,revision:x.revision+1}));
  return {fileId:ref.fileId,canonicalId:ref.canonicalId,
   mimeType:'application/pdf',bytes:f.pdf};
 }};
 await assert.rejects(readSharedSandboxPdf(f.pool,f.owner,f.invoiceId,reader),
  /PDF_REVISION_CONFLICT/);
});
