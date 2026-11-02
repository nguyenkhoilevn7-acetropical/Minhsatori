import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const files=[
 ['account-v2/app.html','fcac7dbd','mm-bottom-nav'],
 ['admin.html','f050de35','mm-admin-bottom']
];
const fnv32=s=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),0x01000193);return (h>>>0).toString(16).padStart(8,'0')};
function businessOnly(html){
 return html.replace(/<style>[\s\S]*?<\/style>/,'<style/>')
  .replace(/<nav class="mm-(?:bottom-nav|admin-bottom)"[\s\S]*?<\/nav>\n/,'');
}
test('MoneyMind visual shell keeps the reviewed V2 unified-cart and delivery-note delta',()=>{
 // Reviewed 29/10: pending-session Gmail reconciliation changes ONLY the login\n // path in the existing V2 app, preserving all pricing and invoice regressions.\n // Reviewed 29/10: address/phone typography parity, catalogue direct quantity
 // selector and stable queued cart controls. Hashes intentionally updated after
 // verifying existing invoice/checkout security tests and isolated regression suite.
 // Reviewed customer sheet HTML deliberately changes the non-script business snapshot; the new hash locks it.\n // The current V2 build intentionally adds one accessible delivery-note field
 // and one delivery-note style to the original MoneyMind layout; freeze the
 // reviewed full-page business, CSS and non-script hashes to catch regressions.
 // Oct 29 reviewed CTV delivery customer pricing controls: two tabs,
 // address-scoped discount input and guarded client policy API.
 // Oct 29 reviewed CTV bottom sheet reuses saved-client writer and validates both rate tiers.\n // Oct 29 reviewed typography-only delta: 16px onboarding/body and 20px headings.\n // Oct 30 reviewed delivery modal: compact spacing and neutral phone/address rows.
 // Oct 30 reviewed invoice controls: compact padding, smaller sums and customer fields,\n // compact date fields and consistent teal detail action. Receipt behavior unchanged.\n // Nov 1 reviewed CTV charge selection: only entered VAT 8% or Shipping 8%, other input omitted.
 // Updated reviewed hashes cover new CTV-only UI, while all original navigation,
 // cart, checkout, Gemini delivery-note and invoice assertions remain intact.
 // Nov 1 reviewed PDF+canonical invoice read-only customer screen on top of current 8% CTV VAT/shipping UI.\n // Preserve full-page hashes after this scoped UX/API review.
 // Nov 2 checkout Location bottom navigation and direct inline customer delivery editor;
 // verified no change to submitted invoices, signed checkout or admin menu.
 // Nov 2 customer delivery self-service: per-address edit card, next-order-only notice,
 // quote invalidation and account-scoped optimistic concurrency. Existing submitted
 // invoice bytes and payment/order logic are not modified.
 // Nov 1 reviewed Samsung Vietnamese STT product homophone correction (microphone only).
 // Nov 1 voice-only composer review: one mic control and live status, unchanged
 // Gemini submit/cart/API flow. Lock new CSS, non-script and business snapshots.
 // Nov 1 mic placement: textarea → mic → send/cart, without changing event handlers.
 // Nov 1 reviewed: after COMMITTED checkout, refresh invoice history/PDF
 // asynchronously without changing write/idempotency or pricing semantics.
 // Nov 1 reviewed optional read-only reorder suggestion scoped to confirmed V2
 // account+delivery address, with explicit cart draft consent. No checkout change.
 // Nov 2 reviewed visual-only fly-to-cart effect and count badge, using the
 // existing bottom navigation cart, only after confirmed server-side cart save.
 // Includes reduced-motion handling; no pricing, Gemini or checkout changes.
 // Nov 2 reviewed a second motion-only Gemini Send confirmation entrypoint; applies
 // strictly after authenticated positive cart deltas. No API, quote or order changes.
 const v2=fs.readFileSync(path.join(root,'account-v2/app.html'),'utf8');
 const fnvPart=x=>fnv32(x);
 assert.equal(fnvPart(v2.match(/<style>[\s\S]*?<\/style>/)?.[0]||''),'62df041d');
 assert.equal(fnvPart(v2.replace(/<script>[\s\S]*?<\/script>/,'<script/>')),'d7c3f789');
 const composer=v2.match(/<div class="composer">([\s\S]*?)<\/div>/)?.[1]||'';
 assert.match(composer,/<textarea id="message"[\s\S]*?<button id="voiceInput"[\s\S]*?<button id="send"/);
 assert.equal((composer.match(/id="voiceInput"/g)||[]).length,1);
 assert.equal((composer.match(/id="send"/g)||[]).length,1);
 assert.match(composer,/aria-pressed="false"/);
 assert.match(v2,/\.delivery-dialog #agentAddressChoices \.agent-address-choice \.address-subtitle,/);
 assert.match(v2,/\.delivery-dialog #agentAddressChoices \.agent-address-choice \.address-phone \{/);
 assert.match(v2,/background:#eaf4f3;\s*color:#205e61;/);
 assert.match(v2,/result\.baseCartRevision!==cartRev/);
 for(const [file,expected,nav] of files){
  const html=fs.readFileSync(path.join(root,file),'utf8');
  assert.equal(fnv32(businessOnly(html)),expected,file+' existing business source unexpectedly changed');
  assert.equal((html.match(new RegExp('<nav class="'+nav+'"','g'))||[]).length,1);
  assert.match(html,/prefers-reduced-motion:reduce/);
  assert.match(html,/MONEY-MIND FLAT DESIGN/);
 }
});
test('V2 navigation only targets original authorized views and never bypasses login gate',()=>{
 const html=fs.readFileSync(path.join(root,'account-v2/app.html'),'utf8');
 const nav=html.match(/<nav class="mm-bottom-nav"[\s\S]*?<\/nav>/)?.[0]||'';
 assert.deepEqual([...nav.matchAll(/data-view="([^"]+)"/g)].map(m=>m[1]),
   ['chat','catalogue','cart','orders']);
 assert.match(nav,/id="bottomDelivery"/);
 assert.match(nav,/aria-label="Chọn hoặc sửa địa chỉ giao hàng"/);
 assert.doesNotMatch(nav,/data-view="account"/);
 assert.match(html,/data-view="account">👤 Tài khoản/);
 assert.match(html,/#app:has\(#gate:not\(\.hidden\)\) \.mm-bottom-nav\{display:none\}/);
 assert.match(html,/document\.querySelectorAll\('\[data-view\]'\)/);
});
test('Admin navigation uses existing tab authorizations and hides with unauthenticated workspace',()=>{
 const html=fs.readFileSync(path.join(root,'admin.html'),'utf8');
 const nav=html.match(/<nav class="mm-admin-bottom"[\s\S]*?<\/nav>/)?.[0]||'';
 assert.deepEqual([...nav.matchAll(/data-admin-tab="([^"]+)"/g)].map(m=>m[1]),
   ['live','customers','issued-links','ctv-ledger','settings']);
 assert.ok(html.indexOf('<nav class="mm-admin-bottom"')>html.indexOf('<div id="workspace" hidden>'));
 assert.match(html,/function showAdminTab\(name\)/);
});
