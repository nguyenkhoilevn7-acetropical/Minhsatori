# Shared invoice update implementation

Goal: expose the existing Owner invoice editor through the canonical HMAC API to ChatGPT and Grok. The sole invoice ledger remains `satori_orders_v15`.

Use the current Android release branch, which already contains the optional VAT integration. Preserve legacy Android requests. Add exact get, side-effect-free preview, edit audit and guarded undo. New HMAC edit operations require a dedicated `orders:update` scope and server-configured Owner/Admin role; payload role claims confer no authority.

1. Write synthetic HMAC tests for exact lookup, preview without writes, gross/exclusive prices, mixed VAT, payment protection, CAS, replay conflict, backup failure, before/after audit, target-only undo.
2. Extend `api/BotApi.gs` around the existing `updateUnpaidOrder` and shared backup/lock/readback writer. Store full audit snapshots atomically with the invoice edit; preserve identity and payment fields. Gross pricing rounds the extended line once, then derives tax as gross minus rounded net.
3. Add matching tool schemas to `connector/lib/satori.mjs` and the GitLab OAuth gateway. Grok delegates to the same upstream API; it owns no ledger or financial calculations. Keep write flags disabled until staging and live-source review succeed.
4. Run existing Bot API, Android editor, VAT and connector suites. Commit and open reviewable PR/MR.
5. Read live Apps Script source and preserve live-only actions before deployment. Test on an isolated staging ledger, then deploy API/MCP and verify OAuth discovery. Fetch #5993 again, verify identity/revision/payment, preview 1,370,370 + 109,630 = 1,480,000, commit once, inspect new PDF and compare other invoices.

Deployment blockers must be reported honestly. Source tests do not establish production success. No live invoice is a test fixture; no PDF or message is sent to any recipient.
