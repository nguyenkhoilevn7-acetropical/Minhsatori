import test from 'node:test';import assert from 'node:assert/strict';
import {disabledPaymentReader,reconcileSandboxPayment,disabledCanonicalIssuer,disabledDriveReader,dispatchSandboxInvoice,resolveSandboxPdf} from '../canonical-adapters.mjs';
test('unconfigured provider interfaces cannot silently fabricate invoice or PDF',async()=>{
 await assert.rejects(disabledCanonicalIssuer.issue(),/NOT_CONFIGURED/);
 await assert.rejects(disabledCanonicalIssuer.lookup(),/NOT_CONFIGURED/);
 await assert.rejects(disabledDriveReader.read(),/NOT_CONFIGURED/);
 await assert.rejects(disabledPaymentReader.read(),/NOT_CONFIGURED/);
 await assert.rejects(reconcileSandboxPayment(null,{},{}),/ADMIN_REQUIRED/);
 await assert.rejects(reconcileSandboxPayment(null,{},{admin:true}),/NOT_CONFIGURED/);
 await assert.rejects(dispatchSandboxInvoice(null,{},{}),/NOT_CONFIGURED/);
 await assert.rejects(resolveSandboxPdf(null,{},{}),/NOT_CONFIGURED/);
});
