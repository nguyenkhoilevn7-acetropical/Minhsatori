import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAccountV2} from '../router.mjs';
function fakeRes(){
 const result={status:0,headers:{},body:''};
 return {result,writeHead(status,headers){result.status=status;result.headers=headers},
 end(body){result.body=String(body||'')}};
}
function getReq(method,url){return {method,url,headers:{origin:'https://example.invalid'}}}
test('account route never captures any legacy /real, /ctv or /admin path',async()=>{
 process.env.SATORI_ACCOUNT_V2_ENABLED='0';
 for(const p of ['/real','/ctv','/admin','/api/real/quote','/api/ctv/confirm']){
  const res=fakeRes();
  assert.equal(await handleAccountV2(getReq('GET',p),res,p),false);
  assert.equal(res.result.status,0);
 }
});
test('account API fails closed without server credentials, independent of client settings',async()=>{
 process.env.SATORI_ACCOUNT_V2_ENABLED='0';
 const statusRes=fakeRes();
 assert.equal(await handleAccountV2(getReq('GET','/api/v2/status'),statusRes,'/api/v2/status'),true);
 assert.equal(statusRes.result.status,200);
 const status=JSON.parse(statusRes.result.body);
 assert.equal(status.enabled,false);
 assert.equal(status.realInvoicesEnabled,false);
 for(const [method,p] of [['POST','/api/v2/confirm'],['GET','/api/v2/me'],['POST','/api/v2/auth/google']]){
  const res=fakeRes();
  await handleAccountV2(getReq(method,p),res,p);
  assert.equal(res.result.status,503);
  assert.equal(JSON.parse(res.result.body).error,'ACCOUNT_V2_DISABLED');
 }
});
test('owner pilot page is readable, but does not enable customer checkout',async()=>{
 process.env.SATORI_ACCOUNT_V2_ENABLED='0';
 const res=fakeRes();
 await handleAccountV2(getReq('GET','/app-v2'),res,'/app-v2');
 assert.equal(res.result.status,200);
 assert.match(res.result.body,/id="menu"/);
 assert.match(res.result.body,/id="cartBadge"/);
 assert.match(res.result.body,/id="signIn"/);
 assert.match(res.result.body,/Xác nhận đặt hàng \(chưa mở trong Pilot\)/);
 assert.match(res.result.headers['content-security-policy'],/frame-ancestors 'none'/);
});
