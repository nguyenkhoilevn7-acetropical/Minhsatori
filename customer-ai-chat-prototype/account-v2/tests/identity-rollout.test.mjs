import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptedSubjects} from '../identity-rollout.mjs';

const config=(overrides={})=>({
 SATORI_ACCOUNT_V2_OWNER_SUB:'owner-sub-1234',
 SATORI_ACCOUNT_V2_PILOT_SUB:'owner-sub-1234',
 SATORI_ACCOUNT_V2_CUSTOMERS_ENABLED:'0',
 SATORI_ACCOUNT_V2_CUSTOMER_ALLOWLIST_SUBS:'["approved-customer-1234"]',
 ...overrides
});

test('default disabled public signup: owner only',()=>{
 const p=acceptedSubjects(config());
 assert.equal(p.ownerReady,true);
 assert.equal(p.customerRolloutReady,false);
 assert.equal(p.allows('owner-sub-1234'),true);
 assert.equal(p.allows('approved-customer-1234'),false);
 assert.equal(p.allows('unknown-customer-987'),false);
});
test('approved customers only after both opt-in AND exact allowlist match',()=>{
 const p=acceptedSubjects(config({SATORI_ACCOUNT_V2_CUSTOMERS_ENABLED:'1'}));
 assert.equal(p.customerRolloutReady,true);
 assert.equal(p.allows('approved-customer-1234'),true);
 assert.equal(p.allows('approved-customer-123'),false);
 assert.equal(p.isOwner('approved-customer-1234'),false);
 assert.equal(p.isOwner('owner-sub-1234'),true);
});
test('unverified owner, malformed allowlist, and overlarge input fail closed',()=>{
 assert.equal(acceptedSubjects(config({SATORI_ACCOUNT_V2_PILOT_SUB:'attacker-sub'})).allows('owner-sub-1234'),false);
 assert.equal(acceptedSubjects(config({SATORI_ACCOUNT_V2_CUSTOMERS_ENABLED:'1',
  SATORI_ACCOUNT_V2_CUSTOMER_ALLOWLIST_SUBS:'{not json'})).allows('approved-customer-1234'),false);
 assert.equal(acceptedSubjects(config({SATORI_ACCOUNT_V2_CUSTOMERS_ENABLED:'1',
  SATORI_ACCOUNT_V2_CUSTOMER_ALLOWLIST_SUBS:'x'.repeat(32769)})).customerRolloutReady,false);
});
test('customer list cannot accept invalid arrays, blank subjects, or wildcard',()=>{
 for(const str of ['"*"', '["*"]', '[""]', '{}', 'null', '[null]']){
  const p=acceptedSubjects(config({SATORI_ACCOUNT_V2_CUSTOMERS_ENABLED:'1',
   SATORI_ACCOUNT_V2_CUSTOMER_ALLOWLIST_SUBS:str}));
  assert.equal(p.allows('random-customer-555'),false,str);
 }
});
