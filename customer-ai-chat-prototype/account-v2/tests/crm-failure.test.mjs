import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCrmFailure,crmFailureLog} from '../crm-failure.mjs';
test('missing delivery-lead migration is specific, unrelated constraints stay generic',()=>{
 assert.equal(classifyCrmFailure({code:'23505',constraint:'satori_v2_customer_leads_linked_account_id_key'}).code,'LEGACY_LINK_MIGRATION_REQUIRED');
 assert.equal(classifyCrmFailure({code:'23505',constraint:'other'}).code,'ACCOUNT_V2_UNAVAILABLE');
});
test('ledger and concurrency failures do not pretend account is unavailable or inactive',()=>{
 assert.equal(classifyCrmFailure(Error('READ_ONLY_UPSTREAM_ERROR')).code,'LEGACY_SOURCE_UNAVAILABLE');
 assert.equal(classifyCrmFailure({name:'AbortError'}).code,'LEGACY_SOURCE_UNAVAILABLE');
 assert.equal(classifyCrmFailure({code:'40001'}).status,409);
});
test('diagnostics discard raw driver messages, details, SQL and query strings',()=>{
 const secret='private-customer-and-password';
 const error={code:'23505',message:secret,detail:secret,query:secret};
 const failure=classifyCrmFailure(error);
 const log=crmFailureLog(error,{requestId:'test-id',route:'/unknown?secret='+secret,code:failure.code});
 assert.equal(log.route,'other');assert.equal(log.sqlState,'23505');
 assert.ok(!JSON.stringify({failure,log}).includes(secret));
});
