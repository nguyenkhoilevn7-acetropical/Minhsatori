# Grok ↔ Minh Satori: parity draft (11 November 2026)

**Scope:** Existing Minh Satori app/website only, not a new invoice service. This draft does **not** connect the Grok runtime, enable writes, deploy anything, or send Zalo.

## Existing connection
- Canonical invoice ledger is the Google Drive JSON key satori_orders_v15.
- Grok read-only MCP user-minh-satori has six tools: system status, customers, products, orders, debt and canonical PDF retrieval (satori_invoice_pdf with id and invoiceNo). **Preserve all six.**
- Existing ChatGPT action code is connector/lib/satori.mjs; signed HMAC access is behind a server-side write flag.
- Do not claim the production Apps Script revision or Gemini V2 order relay have been verified solely from GitHub or public readiness flags.
- HMAC orders.update is intentionally unavailable; do NOT expose it. The Android Owner Mobile OAuth channel is separate.

## Flow A: Pasted order / voice order / payment commands
1. Grok gets pasted customer message or reviewed voice transcript.
2. Look up the customer and correct delivery branch; resolve product, quantity, price and recipient using existing read tools. Missing or ambiguous values must be confirmed.
3. Prepare a draft. Each write needs an out-of-band, authenticated, per-invocation owner approval, checked by the trusted Grok gateway. A model argument saying "confirmed" alone is insufficient.
4. After authenticated bridge verification and later explicit owner authorization, reuse the existing action tools: create orders, customer-paid, Satori-paid, corresponding corrections, soft deletion and restoration. Keep idempotent requestId; verify exact invoice ID/number after creation.
5. Never conflate customer-paid with paid-to-Satori.
6. Manually entered rows default to no tax. Customer profile determines invoice default for non-manual rows, while an explicit per-line exemption wins. Do not hardcode 8% globally. The current order tool only declares invoice-level vatAmount: real order writes must remain disabled until the per-line tax contract works across app/API/ledger/PDF.

## Flow B: New Gemini V2 order -> canonical PDF -> Zalo
1. Watch verified canonical invoice events, or poll the existing ledger safely; a Grok chat window is not itself a reliable always-on watcher.
2. Identify and deduplicate by official invoice id and invoiceNo; retrieve only official PDF using the installed satori_invoice_pdf tool.
3. Zalo Desktop: the owner reports an existing personal Zalo session under Grok computer control, but independent UI capability, persistent session and recipient match are not verified.
4. Preserve Zalo notification text as EXACTLY two values: the invoice number and recipient name (separate lines). Do not append prices, addresses or status text.
5. Sending a PDF attachment requires verified delivery destination, owner approval, delivery log/acknowledgement and safe retry. The group name Satury Back Office Team remains only a reference; do not assume it is the same as a customer recipient.

## Draft files
- connector/grok-parity.mjs: adds exactly the seven ChatGPT owner write tools, reusing canonical action definitions/executor, with two server-only flags and trusted per-invocation owner authorization.
- connector/tests/grok-parity.test.mjs: offline tests with fake payloads and fake action executor only.
- pendingInvoiceDelivery() only plans canonical PDF lookup metadata and a two-line notification; it DOES NOT download or send anything.

## Unverified / blocked
- The reported local Grok MCP scaffold under /workspace/mcp/minh-satori-grok-mcp is not accessible from this ChatGPT container. The installed Grok gateway has NOT been updated.
- Which Apps Script version/scopes are live; the V2 confirm relay; the canonical PDF backend; the PDF archive scheduler.
- Host-side owner authentication/approval, Grok voice transcript ingress, row-tax persistence, and reliable Zalo Desktop automation.
- No official connector for sending PDF into Zalo group has been verified.

Rollout: offline tests -> Goku review -> fake-backend integration -> isolated staging -> separate explicit owner approval for production write permissions, deployment and Zalo sending. This draft is not merged or deployed.
