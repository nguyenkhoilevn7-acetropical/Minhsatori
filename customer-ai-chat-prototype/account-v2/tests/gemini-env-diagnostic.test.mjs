import test from 'node:test';
import assert from 'node:assert/strict';
import {describeGeminiRuntime} from '../gemini-env-diagnostic.mjs';

test('diagnostic detects exact Gemini flag and key without revealing secrets',()=>{
 const key='TEST_SUPER_SECRET_NEVER_EXPOSE_123';
 const x=describeGeminiRuntime({GEMINI_API_KEY:key,GEMINI_FREE_TIER_ONLY:'true'});
 assert.deepEqual(x,{
  apiKeyPresent:true,freeTierFlagPresent:true,
  freeTierFlagExactTrue:true,freeTierFlagNormalizedTrue:true,
  googleApiKeyOnly:false
 });
 assert.equal(Object.isFrozen(x),true);
 assert.equal(JSON.stringify(x).includes(key),false);
});

test('diagnostic disambiguates missing key, legacy alias and whitespace flag',()=>{
 const missing=describeGeminiRuntime({GEMINI_FREE_TIER_ONLY:'true'});
 assert.equal(missing.apiKeyPresent,false);
 const alias=describeGeminiRuntime({GOOGLE_API_KEY:'fake',GEMINI_FREE_TIER_ONLY:'true'});
 assert.equal(alias.googleApiKeyOnly,true);
 const whitespace=describeGeminiRuntime({GEMINI_API_KEY:' x ',GEMINI_FREE_TIER_ONLY:' TRUE '});
 assert.equal(whitespace.apiKeyPresent,true);
 assert.equal(whitespace.freeTierFlagPresent,true);
 assert.equal(whitespace.freeTierFlagExactTrue,false);
 assert.equal(whitespace.freeTierFlagNormalizedTrue,true);
 const falseFlag=describeGeminiRuntime({GEMINI_API_KEY:'x',GEMINI_FREE_TIER_ONLY:'false'});
 assert.equal(falseFlag.freeTierFlagExactTrue,false);
 assert.equal(falseFlag.freeTierFlagNormalizedTrue,false);
});

test('diagnostic never returns arbitrary environment values',()=>{
 const bad='very_sensitive_dummy_fake_key';
 const checks=describeGeminiRuntime({
  GEMINI_API_KEY:bad,GEMINI_FREE_TIER_ONLY:'other-flag',SATORI_ACCOUNT_V2_DATABASE_URL:bad
 });
 assert.equal(JSON.stringify(checks).includes(bad),false);
 assert.deepEqual(Object.keys(checks).sort(),[
  'apiKeyPresent','freeTierFlagPresent','freeTierFlagExactTrue',
  'freeTierFlagNormalizedTrue','googleApiKeyOnly'
 ].sort());
});
