# WORK HANDOFF — LIVE CHATGPT PAYMENT TOOLS (PRIORITY 1)

## Ground truth (2026-10-31)
- Current installed ChatGPT app Minh Satori Bot exposes only satori_mark_customer_paid. Its other 3 payment correction tools are absent from this session.
- Source connector/lib/satori.mjs already declares all three; api/BotApi.gs already implements payments.markCustomerUnpaid, payments.markSatoriPaid, payments.markSatoriUnpaid.
- The current plugin's ability to read Production ledger (revision 190, 130 invoices) and its permissive plugin setting are NOT proof the three corrections can be invoked.
- Repository edits are not equivalent to republishing/re-registering the running ChatGPT app tool schema. Nothing here changes a real payment.

## The ONLY 3 new exposed ChatGPT tools
1. satori_mark_customer_unpaid -> payments.markCustomerUnpaid
2. satori_mark_satori_paid -> payments.markSatoriPaid
3. satori_mark_satori_unpaid -> payments.markSatoriUnpaid

Existing satori_mark_customer_paid must stay unchanged. Registration definition is connector/chatgpt-three-payment-tools.registration.json. It matches the exact source schemas and descriptions; do not add another plugin or alternate ledger.

## Exact instructions for ChatGPT Work Cloud Browser
1. Open the current owner-managed installed Minh Satori Bot connector/plugin configuration, not a new bot. Inspect existing published tool inventory, publishing revision and server endpoint. Never export live HMAC secret or OAuth token into logs, screenshots or chat.
2. Read connector/chatgpt-three-payment-tools.registration.json from the PR branch. Add the THREE missing tools to the existing published connector. Preserve all nine existing tool definitions, especially satori_mark_customer_paid, satori_orders_list and satori_system_status.
3. Each correction must require expectedRevision, requestId, invoiceNo, id, expectedName, expectedTotal, confirmed:true and reason, with no extra properties. The connected backend must reuse the existing signed HMAC Bot API. Do not invent endpoint, client, secrets or roles.
4. Verify Bot client's server-side payments:write scope, write-enable flag if applicable, and current API deployment. Existing paid tool visibility means investigate stale tool registration before changing credentials or permissions.
5. Run sandbox/fake CI from branch first: node --test connector/tests/payment-chain.mjs connector/tests/three-payment-publication.mjs, and existing bot/payment tests. Verify transitions and requestId retry, wrong invoice ID, stale revision, wrong scope, CTV internal, Không Tính, Đã hủy, audit.
6. Publish/update current ChatGPT app tool schema (including any necessary re-sync). Confirm exact three tool names appear in the LIVE connected ChatGPT tool list, not only in source code. If the app requires owner connection refresh, request explicit owner action; do not silently uninstall/reconnect plugin.
7. Make only READ calls to Production to check system.status and orders.list. Confirm revision and selected bill details. NEVER issue a real payment write just to test. To verify an actual payment change, obtain a later explicit invoice-level owner instruction with total and justification, then readback and cross-check Android/website.
8. Final proof: list the 12 live tools, plugin publishing version, status of payments:write, fake PASS evidence, and a precise PASS/FAIL for all 3 new live tools. Distinguish 'registered', 'authorized', and 'real write verified'. If publishing access is unavailable, clearly report blocker and leave untouched.

## Safety constraints
- Two independent flags: customer payment never implies Satori settlement, and vice versa.
- No paid/unpaid corrections for cancelled or Không Tính invoices or internal CTV mirror bills.
- Do not change invoice IDs, discount logic, Gemini V2, PDF, 30-day trash, Google Owner or other clients.
- Keep original payment proof and append audit history. No optimistic 'success' after transport errors; use revision and readback.
- Do not claim Production enabled based only on Github CI.

## Commands (fake, repo only)
node --test connector/tests/payment-chain.mjs connector/tests/three-payment-publication.mjs
node --test tests/payment-http-sandbox.test.mjs
node tests/android-owner-mobile-production.test.cjs

Live status: publication NOT YET CONFIRMED. No Production writes performed.
