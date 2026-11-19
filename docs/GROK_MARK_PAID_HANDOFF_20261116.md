# Grok payment flags — continuation of PR #431

No merge, deploy, live ledger write, credential access or permission grant performed.
Continue on existing feat/grok-chatgpt-parity-20261116; PR #431 is stacked on #430,
which targets feature/account-based-ordering-v2-20261025. Do not retarget or merge dependencies automatically.

## Contract

`satori_order_mark_paid_request`: invoiceNo + expectedName + expectedTotal required;
optional exact ledger id, customerPaid/satoriPaid booleans (omitted means unchanged),
proofNote (required, 3–300 chars when marking paid), paidAt (optional ISO date).
Request reads authoritative orders.list and stores a 30-minute V2 request; no ledger write.
Both flags already correct => ALREADY_SET. Cancelled/noncounted and internal CTV bills refused.

`satori_order_mark_paid_confirm({requestId})`: typed, row-locked dispatch, gate checked
on every call, fresh identity/name/total and revision check before each flag, readback.
Customer then Satori. Partial failures report completed flags and never claim rollback.
Retry same requestId within TTL skips flags already correct; completed requests replay without writes.
Audit in V2 request row: requested_by/confirmed_by, timestamps, reason=proofNote,
payload.before/desired/after, requested paidAt and lastVerifiedAt. Connector actor uses existing
owner-authenticated Grok connector identity. paidAt is evidence metadata only: existing GAS
payment actions set server time; no invented field sent upstream.

Uses only V2 WRITER relay + existing payments.markCustomerPaid/Unpaid and
payments.markSatoriPaid/Unpaid. CustomerPaid payload has amount=total, exact identity,
confirmed and revision, no unsupported reason. Other actions include reason, revision,
and stable per-flag requestId. No receiptUrl inferred from proofNote.
Contract checked against main api/BotApi.gs changePaymentFlag and production snapshot;
the three changePaymentFlag actions require expectedRevision via version(s,p).

**Owner setup, not performed:** V2 WRITER key needs scope `payments:write` in Apps Script.
Apply additive 20261116_grok_mark_paid.sql through existing schema bootstrap after approval.
No new ledger/table of invoices. Canonical ledger remains satori_orders_v15.

## B — read-only bridge investigation (no changes)

Render srv-dbok11e417fc738gg8b0 points to GitLab nguyenkhoilevn7/minh-satori-grok-mcp,
branch feat/minh-satori-read-bridge-20261109, start node bridge/server.mjs.

- bridge/server.mjs: createBridgeServer rejects a method absent from readActions with METHOD_DISABLED,
  before ledger transport. fieldRules/validate also needs an orders.get argument contract.
- bridge/ledger.mjs: exported frozen readActions lacks orders.get. ledgerReader independently rejects
  actions outside Object.values(readActions), also with METHOD_DISABLED.
- There is NO environment flag enabling orders.get. A future reviewed code change must add its
  readActions mapping and fieldRules validation, not enable order write/update flags.
- Credential selector name: SATORI_V1_KEY_ID. Apps Script client configuration:
  SATORI_BOT_CLIENTS_JSON, selected client role (owner/admin) and scopes (orders:read).
  As supplied in the task, bridge client currently has no role; after the code allowlist is fixed,
  missing owner/admin role will be a separate upstream authorization blocker.
- Secret configuration names only: SATORI_V1_READ_SECRET, SATORI_V1_URL; no values read or changed.
