# Minh Satori Bot API — source package (server-side)

**Activation status (19/10/2026):** API source has been added to the existing Apps Script project and exercised with isolated native Drive tests. A separate owner-only deployment and a private ChatGPT plugin host exist. Production HMAC credentials and external API access are NOT activated; ChatGPT-to-Drive end-to-end operation is NOT verified. See [activation checkpoint](WORK_STATUS_2026-10-19.md). GitHub Pages does not deploy Apps Script.

## Verified topology

- Website: GitHub Pages at https://nguyenkhoilevn7-acetropical.github.io/Minhsatori/ (documented in existing Drive sync script).
- Cloud sync UI: owner-only Google Apps Script web app that embeds the GitHub Pages site.
- Storage: Drive file selected via Apps Script Property \`STATE_FILE_ID\`, JSON state with \`revision\`, \`updatedAt\`, and \`values.satori_orders_v15\`.
- Live snapshot count checked 2026-10-19: revision 96, 111 orders (after deletion of test invoice #5925). Before-API backup: `MinhSatori_PreBotAPI_2026-10-19_rev96_READONLY`, Drive ID `1MEyCuuE1VPo9mUrVxYL2jlwS79KvahAV`. Historical readable backups: 2026-10-18: 110; 2026-10-17: 109; 2026-10-16: 102. Counts do **not** prove full restore safety.

## Critical safety steps BEFORE enabling the API

1. Export the current Apps Script project's source (not just its older Drive copy) and reconcile its actual \`driveCommit\` and \`readState_\` implementations.
2. Create and independently validate an immutable point-in-time backup of \`MinhSatori_Live_Data.json\`; verify restore against a *separate test file*, **never** overwrite live data during tests.
3. Add \`api/BotApi.gs\` to the **same existing Apps Script project**, not to a different project. This is mandatory so \`LockService.getScriptLock()\` serializes writes from the website and bots. The GitHub branch alone does not activate anything.
4. In Apps Script **Script Properties**, add \`SATORI_BOT_CLIENTS_JSON\`, generated with random 32+ character secrets, one key per bot. Start with read-only scopes. **Never** put real API secrets in GitHub, HTML, browser localStorage, chat logs, or URLs.
5. Only after independent review, create a **separate Web App deployment** for bot POST requests, set Execute as Owner, Access Anyone **only when needed**. Existing \`doGet()\` must stay owner-protected. Do not change or redeploy the current owner-only deployment.
6. Connect bots through a trusted server-side custom connector that securely stores credentials and uses HMAC signing. Connecting ChatGPT itself to a generic URL requires such a connector; simply adding an API URL is not enough.
7. Run concurrency, authentication, backup/restore, idempotency, and multi-device synchronization tests on test data before any real write access.
8. Disable a bot by setting \`enabled:false\` or revoking its secret in Script Properties. For incidents, disable the bot deployment entirely.

## HTTP envelope

POST a JSON body to the *future dedicated deployment*:

\`\`\`json
{
  "keyId": "bot-01",
  "timestamp": 1792370000000,
  "nonce": "uniqueRandomNonce12345",
  "action": "orders.list",
  "payload": {"query": "Nguyen", "limit": 20},
  "signature": "<lowercase hex HMAC-SHA256>"
}
\`\`\`

Signature bytes: HMAC SHA-256 over UTF-8 \`keyId + "\\n" + timestamp + "\\n" + nonce + "\\n" + action + "\\n" + JSON.stringify(payload)\`.

Valid timestamps are within five minutes. Nonces cannot be replayed for ten minutes. For mutations send the last observed \`expectedRevision\`, and a unique \`requestId\` for order creation. Read responses include a \`revision\` field. Always check JSON \`ok\`; Apps Script ContentService error envelopes may still use HTTP 200.

## Current actions

The backend API has these additional safeguards:
- `customers.search` groups records by normalized customer name + full delivery address + phone suffix, returning each delivery location separately. It never silently selects one of several candidates.
- `orders.create` requires either `customerRef:{id,invoiceNo}` matching name/address/phone, or `confirmedNewCustomer:true` with complete name and address.
- `orders.delete` is a **reversible soft delete**: it archives a full order in `satori_trash_bin_v15` for 30 days, adds its invoice number to `satori_deleted_invoice_nos`, and checks customer, amount, invoiceNo, unique ID, explicit confirmation, revision and request ID before writing. Paid invoices cannot be deleted through this API.
- All writes take the existing Apps Script script lock, create a backup before file replacement, and verify the Drive readback. The same lock must be shared with `driveCommit` in the live project.

`AccountingCore.gs` is required and must match `accounting-core.js`. `debt.summary` excludes low CTV reference bills according to the ledger rules and reports ambiguous groups in `reviewCount`.

## Action list

| Action | Required scope | Payload summary |
| --- | --- | --- |
| \`system.status\` | \`orders:read\` | \`{}\` returns revision, updatedAt, count |
| \`orders.list\` | \`orders:read\` | \`{query?, status?, from?, to?, limit?}\` (max 100) |
| \`debt.summary\` | \`debt:read\` | \`{query?, from?, to?}\` ; full-unpaid totals, no partial payment modeling |
| \`orders.create\` | \`orders:write\` | \`{expectedRevision, requestId, order:{name,phone?,location?,items:[{product,qty,unitPrice,listPrice?,unit?,code?}],shippingAmount?,vatAmount?,total?}}\` |
| \`payments.markCustomerPaid\` | \`payments:write\` | \`{expectedRevision, invoiceNo, confirmed:true, amount?}\` only full payment |

Money is VND, \`from/to\` are ISO dates \`YYYY-MM-DD\`. Never assert that a cloud write succeeded until the API reports \`ok:true\` and the post-write Drive readback is verified.

## Current limitations

The dedicated deployment is still owner-only, with no production client secret. Native sandbox and owner-runtime production reads passed, but externally signed HTTP and direct ChatGPT tool calls are not verified. Writes remain disabled. Review [activation checkpoint](WORK_STATUS_2026-10-19.md) before activation.
## Server-side client and smoke test

Once the SAME Apps Script project hosts this API as a dedicated Web App deployment and the bot account has read scopes, put all secrets in the trusted connector/server environment (`SATORI_BOT_API_URL`, `SATORI_BOT_KEY_ID`, `SATORI_BOT_SECRET`). Run `node api/bot-client.mjs system.status '{}'` and `node api/bot-client.mjs customers.search '{"query":"Traky Hair"}'`. Do not run a mutation against live data for smoke tests; use a test copy first. **Never** load `api/bot-client.mjs` into browser source or publish its environment variables.
