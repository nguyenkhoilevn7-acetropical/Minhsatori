import test from 'node:test';
import assert from 'node:assert/strict';
import {describeCanonicalReadEnv} from '../read-transport-diagnostic.mjs';

test('private diagnostics expose only booleans, never signed gateway credentials',()=>{
 const secret='fake_'+'x'.repeat(36),id='test_read_key';
 const endpoint='https://script.google.com/macros/s/TEST_DEPLOYMENT_ID/exec';
 const flags=describeCanonicalReadEnv({
  SATORI_READ_ENDPOINT:endpoint,
  SATORI_READ_KEY_ID:id,
  SATORI_READ_HMAC_SECRET:secret
 });
 assert.deepEqual(flags,{readEndpointValid:true,readKeyIdValid:true,readHmacSecretValid:true});
 assert.equal(Object.isFrozen(flags),true);
 for(const sensitive of [secret,id,endpoint])
  assert.equal(JSON.stringify(flags).includes(sensitive),false);
});
test('incomplete or invalid gateway config is classified without private values',()=>{
 const flags=describeCanonicalReadEnv({
  SATORI_READ_ENDPOINT:'https://other.example/exec',
  SATORI_READ_KEY_ID:'bad id',
  SATORI_READ_HMAC_SECRET:'short'
 });
 assert.deepEqual(flags,{readEndpointValid:false,readKeyIdValid:false,readHmacSecretValid:false});
});
