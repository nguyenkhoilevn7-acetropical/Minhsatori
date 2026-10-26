import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {backupKey,sealBackup,openBackup} from '../backup/archive.mjs';
test('encrypted backup preserves exact dump bytes, Vietnamese metadata, and authenticated checksum',()=>{
 const key=randomBytes(32),dump=Buffer.concat([Buffer.from('PGDMP'),randomBytes(1024)]);
 const {archive,receipt}=sealBackup(dump,{label:'dữ liệu giả',tables:[]},key);
 assert.equal(receipt.bytes,archive.length);assert.equal(receipt.sha256.length,64);
 const restored=openBackup(archive,key);assert.deepEqual(restored.dump,dump);assert.equal(restored.manifest.label,'dữ liệu giả');
 assert.equal(archive.includes(Buffer.from('dữ liệu giả')),false);
 assert.notDeepEqual(sealBackup(dump,{},key).archive,sealBackup(dump,{},key).archive);
});
test('tampered, truncated and wrong-key archives never return plaintext',()=>{
 const key=randomBytes(32),{archive}=sealBackup(Buffer.from('PGDMPfake'),{},key);
 for(const index of [0,18,30,archive.length-1]){const changed=Buffer.from(archive);changed[index]^=1;assert.throws(()=>openBackup(changed,key),/AUTHENTICATION_FAILED/)}
 assert.throws(()=>openBackup(archive,randomBytes(32)),/AUTHENTICATION_FAILED/);
 assert.throws(()=>openBackup(archive.subarray(0,-1),key),/AUTHENTICATION_FAILED/);
 assert.throws(()=>backupKey(''),/KEY_REQUIRED/);
 assert.throws(()=>sealBackup(Buffer.from('report only'),{},key),/PG_DUMP_REQUIRED/);
});
