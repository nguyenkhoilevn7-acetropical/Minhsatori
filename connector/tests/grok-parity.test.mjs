import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROK_OWNER_WRITE_NAMES, grokAdditionalTools,
  executeGrokOwnerWrite, pendingInvoiceDelivery,
} from '../grok-parity.mjs';

const toolDefinitions = GROK_OWNER_WRITE_NAMES.map(name => ({
  name, annotations: {readOnlyHint:false}, inputSchema: {type:'object'},
}));
const enabled = {SATORI_ENABLE_WRITES:'true', GROK_OWNER_WRITES_ENABLED:'true'};

test('writes fail closed unless BOTH server flags are enabled', () => {
  for (const env of [{}, {SATORI_ENABLE_WRITES:'true'}, {GROK_OWNER_WRITES_ENABLED:'true'}]) {
    assert.deepEqual(grokAdditionalTools({canonicalTools:toolDefinitions,env}),[]);
  }
});

test('exact seven owner write tools, without HMAC orders.update or Zalo sending', () => {
  const names = grokAdditionalTools({canonicalTools:toolDefinitions,env:enabled}).map(t=>t.name);
  assert.deepEqual(names,[...GROK_OWNER_WRITE_NAMES]);
  assert.equal(names.length,7);
  assert.ok(!names.includes('satori_orders_update'));
  assert.ok(!names.some(x=>x.startsWith('satori_zalo')));
});

test('missing canonical tool prevents unsafe partial rollout', () => {
  assert.throws(()=>grokAdditionalTools({canonicalTools:toolDefinitions.slice(1),env:enabled}),
    /Canonical write tool not available/);
});

test('a trusted per-call owner approval is mandatory', async () => {
  let writes=0;
  const canonicalCallTool=async()=>{writes++;return {ok:true}};
  const args={name:'satori_orders_create',payload:{requestId:'fake-001'},env:enabled,
    canonicalTools:toolDefinitions,canonicalCallTool};
  await assert.rejects(executeGrokOwnerWrite(args),/callback missing/);
  await assert.rejects(executeGrokOwnerWrite({...args,authorizeWrite:async()=>false}),
    /did not authorize/);
  await assert.rejects(executeGrokOwnerWrite({...args,name:'satori_orders_update',
    authorizeWrite:async()=>true}),/Unsupported/);
  assert.equal(writes,0);
  const result=await executeGrokOwnerWrite({...args,
    authorizeWrite:async({name,payload})=>
      name==='satori_orders_create' && payload.requestId==='fake-001'});
  assert.deepEqual(result,{ok:true});
  assert.equal(writes,1);
});

test('PDF/Zalo preparation is metadata-only; notification has two fields', () => {
  const plan=pendingInvoiceDelivery({id:'fake-id-1',invoiceNo:9101,
    recipientName:'Người nhận giả'});
  assert.equal(plan.notificationText,'9101\nNgười nhận giả');
  assert.deepEqual(plan.pdfArgs,{id:'fake-id-1',invoiceNo:9101});
  assert.equal(plan.state,'AWAITING_VERIFIED_PDF_AND_ZALO_SEND');
  assert.throws(()=>pendingInvoiceDelivery({id:'',invoiceNo:9101,recipientName:'A'}),/ID/);
  assert.throws(()=>pendingInvoiceDelivery({id:'x',invoiceNo:9101,recipientName:''}),/Recipient/);
});
