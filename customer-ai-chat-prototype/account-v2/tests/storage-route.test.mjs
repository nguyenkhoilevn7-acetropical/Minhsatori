import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAccountV2} from '../router.mjs';
test('V2 storage health is available before Google OAuth and never leaks credentials',async()=>{
 const original=process.env.SATORI_ACCOUNT_V2_DATABASE_URL;
 try{
  delete process.env.SATORI_ACCOUNT_V2_DATABASE_URL;
  let status,headers,body;
  const res={writeHead(code,h){status=code;headers=h},end(text){body=text}};
  const handled=await handleAccountV2({method:'GET',url:'/api/v2/storage-readiness',
   headers:{}},res,'/api/v2/storage-readiness');
  assert.equal(handled,true);
  assert.equal(status,200);
  assert.equal(headers['cache-control'],'no-store');
  assert.deepEqual(JSON.parse(body),{
   ok:true,service:'minh-satori-account-v2',
   configured:false,connected:false,schemaReady:false,
   tableCount:0,realInvoicesEnabled:false
  });
  assert.doesNotMatch(body,/DATABASE_URL|postgresql:|password/i);
 }finally{
  if(original===undefined)delete process.env.SATORI_ACCOUNT_V2_DATABASE_URL;
  else process.env.SATORI_ACCOUNT_V2_DATABASE_URL=original;
 }
});
