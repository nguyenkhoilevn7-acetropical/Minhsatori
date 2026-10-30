
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const owner=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const backend=readFileSync(new URL('../customer-backend.mjs',import.meta.url),'utf8');
const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
const script=owner.match(/<script>([\s\S]*?)<\/script>/)?.[1]||'';

test('Admin has one reversible archive control for old imported duplicate records',()=>{
 assert.match(script,/async function archiveImportedDuplicateLeads\(/);
 assert.match(script,/\/api\/v2\/admin\/customer-leads\/archive-imported/);
 assert.match(script,/Xóa hồ sơ trùng đã nhập/);
 assert.match(script,/items:oldItems\.filter\(x=>x\.active!==false\)/);
 assert.match(script,/\{value:'paused',label:'Đã lưu trữ'/);
 assert.match(script,/expectedRevision:x\.revision/);
 assert.doesNotThrow(()=>new vm.Script(script));
});

test('Server archives only same-Gmail exact imported address; never hard-deletes records',()=>{
 assert.match(router,/pathname==='\/api\/v2\/admin\/customer-leads\/archive-imported'/);
 assert.match(backend,/export async function ownerArchiveImportedDuplicateLeads\(/);
 assert.match(backend,/normalizedDeliveryAddress\(lead\.address\)/);
 assert.match(backend,/LEAD_GMAIL_ACCOUNT_MISMATCH/);
 assert.match(backend,/CANONICAL_LEAD_PROTECTED/);
 assert.match(backend,/DELIVERY_ADDRESS_NOT_IMPORTED/);
 const start=backend.indexOf('export async function ownerArchiveImportedDuplicateLeads(');
 const end=backend.indexOf('async function applyGeneralDiscount(',start);
 const fn=backend.slice(start,end);
 assert.doesNotMatch(fn,/DELETE FROM/);
 assert.doesNotMatch(fn,/UPDATE satori_v2_accounts SET/);
 assert.doesNotMatch(fn,/UPDATE satori_v2_addresses SET/);
 assert.match(fn,/SET active=false,revision=revision\+1/);
 assert.match(fn,/CUSTOMER_LEAD_IMPORTED_DUPLICATE_ARCHIVED/);
});
