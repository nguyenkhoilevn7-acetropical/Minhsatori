# V2 single-ledger / original-website-PDF contract — 28 October 2026

Owner decision: **Gemini, Website V2 and Android must use the same customer profile, item prices, approved discounts, canonical invoice, payment statuses and one original website-template PDF.** Do not build a Gemini-specific admin, customer database, invoice or PDF layout.

## What exists (code inspected)
- V2 PostgreSQL already persists Google-sub accounts, customer registrations PENDING/ACTIVE, owner CRM leads, profiles (retail/agency/collaborator), addresses, versioned profile/address/SKU discounts, catalogue, cart, quote and non-live order request. Do not create a second registry.
- V2 Gemini uses the same `pricedCart` and `calculateQuote` as website V2 and never chooses discounts independently.
- `GET /api/v2/orders` is account scoped and returns only V2 requests; `POST /api/v2/confirm` returns 503. **There is no live V2 invoice bridge.**
- Android native app currently reads the canonical Drive/Apps Script ledger but **renders its own PDF locally** with `WebsiteInvoicePdf.render` / `NativeInvoicePdf`. This does not satisfy one-file parity.
- The original website (`index.html`) renders the official PDF with `prepareInvoicePdf`/pdfmake. The source branches `api/InvoicePdfArchive.gs`, `api/PdfHeadlessSchedule.gs`, `customer-ai-chat-prototype/original-website-pdf.mjs` and `original-pdf-gateway.mjs` support archiving the original template on private Google Drive. The runbook explicitly says **not confirmed deployed**. Never invent a Drive fileId or file link.

## Target workflow
1. Owner approves a customer registration or verified old-customer binding. Their account/profile, all addresses, email, tax details and effective policy are stored by V2. Passwords / Google credentials are NEVER collected by owner.
2. Every channel (Gemini chat, V2 UI, authorized Android) selects the same stable verified account/profile/address ID and reads the same active catalogue revision and approved discount policy through V2 backend. Price calculations are **server-side**, never model generated. A quote contains the price, discount, policy-version, recipient and shipping note snapshot.
3. On explicit confirmation, V2 creates a durable order request with a stable requestId and a unique quote binding. Before requesting a signed `orders.create` on canonical Apps Script, revalidate quote freshness, auth, address, policy, remaining catalogue and customer identity. **No live writes before isolated backup/restore and signed HMAC sandbox acceptance.**
4. Signed Bot API performs a single idempotent write under the existing ledger lock, with before-write Drive backup, expectedRevision and exact requestId. V2 reads the canonical order back (exact stable ID + invoiceNo + amount + item lines; never fuzzy name/phone) before marking COMMITTED. An ambiguous/timeout result is UNCERTAIN and reconciled by same requestId; do not retry with a new requestId or create a second bill.
5. Existing original-website PDF renderer generates **one PDF for the exact committed invoice version**, uses the private archive mechanism and verifies %PDF header + SHA-256, invoice id/no, current versionKey, price and canonical order before storing it. Repeated renders of same version return the same Drive file. A changed invoice creates a new version; old version remains for audit.
6. All three clients use one authenticated PDF reference/bytes by exact canonical invoice ID and version, **not a public all-customer Drive link**. The server verifies ownership and/or owner role before streaming or issuing an expiring scoped access token. No URL is fabricated from invoiceNo; a missing file is displayed as **PDF chờ lưu**, not as a generated substitute. Files should not be auto-downloaded to the Samsung phone.
7. Android must consume this verified original PDF from the unified backend instead of `WebsiteInvoicePdf.render` for new canonical invoices; the existing local generator is legacy-only until removed after migration. Native app and Website administration fetch/update the **same canonical ledger revisions** and keep customer-paid vs Satori-paid independent.

## Acceptance gates
- 20 products and exact assigned discounts on Website, Gemini, Android (including address/SKU overrides) produce identical VND.
- New customer and agency registration; owner approval; saved addresses; verified identity; account-scoped access. Old CRM leads do not inherit privileges without verified binding.
- Five cases: one item, multiple items, more added, note “giao sau 2h”, special CTV profit/discount. One confirmed order = one canonical invoice and same canonical PDF fileId/SHA256 on all channels.
- 100 concurrent/retried identical request IDs -> one ledger order. Failed network, timeout and payment correction never duplicate order.
- PDF archive absent/stale, wrong SHA, wrong ledger ID/No, wrong owner, stale version or wrong MIME -> access rejected or pending; never a made-up PDF.
- Website open, Android preview/share, Gemini attach/download of the same verified PDF bytes; identical fileId, versionKey, SHA256 and latest price. Verify Drive backup and recovery.
- Full isolated PostgreSQL backup/restore and fake GAS HTTP sandbox PASS; owner explicitly approves each live writer and Apps Script production trigger deployment after source review.

## This PR
Adds `canonical-invoice-sync.mjs` (pure, fail-closed binding contract) and a truthful PDF availability status on the existing authenticated V2 orders list. No PDF archive is claimed ready; no secret/env, financial write, Android binary, Google Drive or deployment is changed. This must remain a DRAFT until the actual signed invoice bridge, PDF access endpoint and native Android PDF-consumer are added and acceptance-tested.
