/* Owner-only read-only production lookups: no real Google credentials or PII. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {ownerLiveLookup} from '../owner-live-lookup.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const params=fields=>new URLSearchParams(fields);
const oct=ownerLiveLookup(params({kind:'invoices',month:'2026-10'}));
assert.equal(oct.action,'orders.list');
assert.deepEqual(oct.payload,{limit:100,from:'2026-10-01',to:'2026-10-31'});
const feb=ownerLiveLookup(params({kind:'invoices',month:'2028-02'}));
assert.equal(feb.payload.to,'2028-02-29');
const byInvoice=ownerLiveLookup(params({kind:'invoices',query:'5928'}));
assert.equal(byInvoice.payload.query,'5928');
const byCustomer=ownerLiveLookup(params({kind:'customers',query:'Traky Hair'}));
assert.equal(byCustomer.action,'customers.search');
assert.equal(byCustomer.payload.query,'Traky Hair');
const byPhone=ownerLiveLookup(params({kind:'customers',query:'0912 345 678'}));
assert.equal(byPhone.payload.phone,'0912345678');
assert.equal(byPhone.payload.query,undefined);
for(const invalid of [
 {kind:'invoices'}, {kind:'invoices',month:'2026-00'},
 {kind:'invoices',month:'2026-13'}, {kind:'invoices',month:'2026-10',query:'a'},
 {kind:'customers',query:'x'}, {kind:'unknown',query:'abc'}
])assert.throws(()=>ownerLiveLookup(params(invalid)));

const api=readFileSync(path.join(root,'satori-readonly.mjs'),'utf8');
assert.match(api,/permitted=new Set\(\['system.status','catalogue.list','orders.list','customers.search'\]\)/);
assert.match(api,/BULK_ORDER_EXPORT_DENIED/);
assert.match(api,/from.slice\(0,7\)!==to.slice\(0,7\)/);
const server=readFileSync(path.join(root,'server.mjs'),'utf8');
assert.match(server,/p==='\/api\/admin\/live-search'/);
const start=server.indexOf("p==='/api/admin/live-search'");
const end=server.indexOf('// This route probes source-of-truth',start);
const route=server.slice(start,end);
assert.ok(start>0&&end>start);
assert.ok(route.indexOf('customerLinks.adminAuthorized(req)')>=0);
assert.ok(route.indexOf('customerLinks.adminAuthorized(req)')<route.indexOf("readMinhSatori(search.action"));
assert.match(route,/readOnlyReady\(\)/);
assert.match(route,/readMinhSatori\(search.action,search.payload\)/);
assert.doesNotMatch(route,/orders\.create|payments\.markCustomerPaid|writeState|saveOrdersAtomic/);
const html=readFileSync(path.join(root,'admin.html'),'utf8');
assert.match(html,/data-admin-tab="live"/);
assert.match(html,/\/api\/admin\/live-search/);
assert.match(html,/document\.createElement\('div'\)/);
assert.doesNotMatch(html.slice(html.indexOf('async function lookup(kind)'),html.indexOf('function showAdminTab(name)')),/innerHTML/);
console.log('PASS Gemini owner-only live ledger lookup bounds, auth barrier, privacy rendering');
