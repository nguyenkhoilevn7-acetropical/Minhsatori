// Public tool registration contract only. NEVER calls HMAC or production ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tools,configuration} from '../lib/satori.mjs';

const manifest=JSON.parse(readFileSync(new URL('../chatgpt-three-payment-tools.registration.json',import.meta.url),'utf8'));
const enabled=tools({SATORI_ENABLE_WRITES:'true'});
const disabled=tools({SATORI_ENABLE_WRITES:'false'});
const expected=[
 ['satori_mark_customer_unpaid','payments.markCustomerUnpaid'],
 ['satori_mark_satori_paid','payments.markSatoriPaid'],
 ['satori_mark_satori_unpaid','payments.markSatoriUnpaid']
];
test('exact three missing tool registration definitions match the real connector runtime',()=>{
 assert.equal(manifest.tools.length,3);
 assert.equal(manifest.publishMode,'UPDATE_EXISTING_PLUGIN_TOOLS_NOT_NEW_PLUGIN');
 for(const [name,action] of expected){
  const published=manifest.tools.find(t=>t.name===name);
  const source=enabled.find(t=>t.name===name);
  assert.ok(published,'Missing publication declaration '+name);
  assert.ok(source,'Missing source tool '+name);
  assert.equal(published.action,action);
  assert.equal(published.description,source.description);
  assert.deepEqual(published.inputSchema,source.inputSchema);
  assert.equal(source.annotations.readOnlyHint,false);
  assert.ok(!disabled.some(t=>t.name===name),'No payment writes when disabled');
  for(const required of ['confirmed','requestId','expectedRevision','invoiceNo',
     'id','expectedName','expectedTotal','reason']){
   assert.ok(source.inputSchema.required.includes(required),name+': missing '+required);
  }
 }
});
test('backend has exactly guarded supported actions + separate paid flags',()=>{
 const core=readFileSync(new URL('../../api/BotApi.gs',import.meta.url),'utf8');
 for(const [,action] of expected){
  assert.ok(core.includes("'"+action+"'"),'Backend lacks '+action);
  assert.ok(core.includes("'"+action+"':'payments:write'"),'Missing required scope '+action);
 }
 assert.ok(core.includes('function changePaymentFlag('));
 assert.ok(core.includes('paymentAudit'));
 assert.ok(core.includes('requestId'));
 assert.ok(core.includes('expectedRevision'));
 assert.ok(core.includes('LockService.getScriptLock()'));
});
test('registration never contains actual credentials or a new invented endpoint',()=>{
 const text=JSON.stringify(manifest);
 assert.ok(!/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{15,}\/exec/.test(text));
 assert.ok(!/SATORI_BOT_SECRET\s*[:=]\s*[A-Za-z0-9]/.test(text));
 assert.equal(configuration({SATORI_ENABLE_WRITES:'false'}).writesEnabled,false);
});
