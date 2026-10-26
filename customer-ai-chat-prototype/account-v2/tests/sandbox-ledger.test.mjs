import test from 'node:test';import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';import {verifyEnvelope,digest} from '../sandbox-ledger.mjs';
const key='fixture-only-not-a-real-key-123456789';
const sorted=v=>JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])));
test('receipt verifies audience/test marker, expiry, signature and configuration',()=>{
 const payload={version:1,testOnly:true,invoiceId:randomUUID(),expiresAt:Date.now()+60000};
 const signature=createHmac('sha256',key).update(sorted(payload)).digest('hex');
 assert.deepEqual(verifyEnvelope({payload,signature},key),payload);
 assert.throws(()=>verifyEnvelope({payload,signature},''),/NOT_CONFIGURED/);
 assert.throws(()=>verifyEnvelope({payload:{...payload,testOnly:false},signature},key),/SANDBOX_RECEIPT_REQUIRED/);
 assert.throws(()=>verifyEnvelope({payload:{...payload,invoiceId:randomUUID()},signature},key),/SIGNATURE_INVALID/);
 assert.throws(()=>verifyEnvelope({payload,signature},key,payload.expiresAt),/EXPIRED/);
});
test('quote digest is stable across object key order but binds all prices and quantities',()=>{
 assert.equal(digest({a:1,b:{x:3,y:4}}),digest({b:{y:4,x:3},a:1}));
 assert.notEqual(digest({qty:10,totalVnd:800000}),digest({qty:1,totalVnd:800000}));
});
