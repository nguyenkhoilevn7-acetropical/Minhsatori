# Minh Satori — Gemini website / Android real-invoice cutover (NOT LIVE YET)

Date: 2026-10-22. Source merge: [PR #77](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/77).
This file is an operator handoff; it is NOT deployment authorization or proof of a working checkout.

## Confirmed state at preparation
- GitHub `main/api/BotApi.gs` has read-only `catalogue.list`, owner-scoped `pricing.approve` and separately scoped `orders.create.ai`.
- The code rejects changed-basket reuse of a previous `requestId`, checks exact source invoice/customer destination, and recalculates list price, discount, VAT, shipping, and totals while the shared ledger lock is held. It preserves the latest receipt URL/time/note payment fixes.
- CI `Satori Server Bot API Tests` and `Satori AI Bot main compatibility (FAKE Drive only)` passed on PR #77. Their simulated invoices are isolated in memory; no production write test was run.
- A separate read-only Bot API check returned revision **112**, **115 production invoices** on 2026-10-22. Counts must be freshly rechecked before any deployment.
- Render `minh-satori-customer-ai-gemini` is pinned to `prototype/customer-ai-gemini-free-20261020` with autoDeploy **off**. Last reported deployed commit `39f26523933d9124cbdb1e56ac95bf7c5a669172`. Logs show `STALE_BOOTSTRAP` rescue preview, with orders/admin writes disabled. This is **not** real checkout. The special rescue child reporting `url=0 hmac=0` is intentionally disabled by design; do not treat it as missing credentials or rotate secrets to "fix" it.
- Android signed v0.3.8 is a read-only live-ledger release candidate [PR #75](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/75), not a verified production-write release.

## Mandatory gate A — Apps Script compatibility (owner Work / UI needed)
1. Open the existing owner's **correct** Minh Satori Apps Script project; locate the currently deployed web-app version, project files, and existing `doGet`, `doPost`, `SatoriMobileApi`, lock and Drive state functions.
2. Record deployment IDs and versions privately. Back up the **entire current** Drive ledger and script source, read back and verify exact byte-consistent snapshot and revision. Do not rely on a backup name alone.
3. Diff the live source against `main/api/BotApi.gs`. Add only compatibility-verified AI action handlers and required functions. **Do not replace existing `doPost` routing, Android path, `doGet` or receipt/payment protections**. Shared-lock discipline must remain intact.
4. First deploy against an **isolated sandbox Apps Script project and fake Drive ledger**, never `STATE_FILE_ID` from production. Demonstrate read catalogue, owner-scoped price approval, AI-created multi-product invoice, same `requestId` response-loss replay, changed-intent rejection, cross-customer denial, stale revision denial, backup/readback, and invoice visible to both fake web and fake Android consumers.
5. Only after the sandbox E2E passes, prepare an Apps Script production revision with writes **disabled by default**. No credentials in GitHub, chats, logs, issue comments, query strings or client HTML/APK.

## Mandatory gate B — customer identity, pricing and durable checkout
1. Real customer profiles need server-side verification, location-specific authenticated sessions and OTP (new device / fresh sign-in), rate limiting, revoke/rotate, and a privacy boundary for public links. A bearer URL by itself and a client-side `verifiedByServer` boolean are insufficient.
2. Each name + phone + delivery location must have an exact historical customer invoice reference and a separately owner-approved, revisioned pricing decision. Learnt AI discounts or assumed 45% are **not** approvals.
3. Read the current `satori_catalogue_v15` from the authenticated shared ledger for each binding quote. Recompute SKU/unit/list price/discount/VAT/freight server-side. Expired quote or changed revision means re-confirm with the customer.
4. Keep the checkout-intent and `requestId` durable across Render restarts and all web/Android devices. On an uncertain signed POST, reconcile the **same** request ID; never mint a second bill.
5. The Gemini server currently advertises `productionCheckoutWired:false`. A toggle or Render environment flag **cannot** convert the demo code to real production. Add the verified route on server, then use Android/WebView through the same authenticated server. Keep write HMAC strictly server-side.

## Mandatory gate C — deliberate launch acceptance
1. After gates A and B pass, privately provision distinct least-privilege HMAC keys for `catalogue:read`, `orders:ai:write` and `pricing:approve` (approval key admin-side only). Do not overwrite the old working read/payment keys.
2. Validate that Gemini and Android clients show truthful TEST vs REAL states and PDF share/QR uses the authoritative invoice only. Verify Samsung signed APK release separately. No fake or placeholder order may be inserted into the live ledger.
3. Owner identifies and explicitly confirms **one genuine customer order** (correct address, consent, quantities, approved prices). Commit it once; independently check exact invoice ID/number, money, notes, customer identity, revision/backup, and one invoice visible from both website and Android. Replay the **same** ID once to prove idempotency.
4. Compare production order count and revision with freshly captured prelaunch snapshot. Halt/revert the deployment on any mismatch, ambiguous customer, price change, uncertain response, missing backup, stale bootstrap, or unsupported mobile route. Preserve existing ledger bytes and audit trail.
5. Only after live acceptance, issue real customer links in small batches, monitor errors/duplicate rejection, then expand.

## Blockers that must not be hidden
- Direct Apps Script editor/deployment and customer OTP/SMS provider management are not available through the present GitHub/Render/Drive connector actions. Use the owner's Work browser only for those GUI-only operations.
- Current Render sandbox is in rescue preview. Do not call a "live" Render deploy a working production checkout.
- `orders.create.ai` in GitHub is **source only** until verified deployed, authenticated end-to-end and confirmed by the owner. The source PR merge does not create any invoice or update an APK.
