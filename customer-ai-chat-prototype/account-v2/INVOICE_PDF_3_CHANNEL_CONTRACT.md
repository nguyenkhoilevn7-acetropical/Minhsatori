# Minh Satori V2 — one canonical invoice PDF, three clients (draft)

## Non-negotiable invariants
- One accepted buyer order -> **one** officially issued canonical invoice. Internal CTV commission is a ledger entry, NEVER a second buyer invoice.
- The issuer's permanent `canonicalId`, invoice number, quote snapshot (SKU, unit, quantity, customer price, discount, shipping, VAT, total VND), owner-verified buyer account, and archival PDF SHA-256 are saved once.
- Google Drive is the authoritative PDF byte source after the issuer's signed readback; clients do not run independent Android PdfDocument, pdfmake, Gemini-generated PDFs, HTML-to-PDF or text summaries as substitutes.
- Web, Android, and *Gemini inside the authenticated Minh Satori app* download **the same bytes** from one authenticated HTTPS endpoint, with the same `invoiceId`, SHA-256, revision and PDF media type. Clients compare `X-Content-SHA256` with SHA-256 of the downloaded bytes; mismatches fail visibly.
- A customer sees only their own verified invoice bindings; a permitted CTV sees assigned invoices but retail PDFs must NEVER reveal the commission/wholesale cost. Never infer ownership from phone/name.
- Do not create an invoice/PDF on refresh, repeated submit, chat replay or timeout. A durable idempotency key and issuer readback are mandatory. Uncertain state is `PENDING_RECONCILIATION`, not a second issuance.
- PDF missing or not yet verified => `PDF_PENDING` / unavailable. Do not fabricate. Later payments are separate immutable events; amendment/reissue creates a **new explicit revision**, not silent mutation of an earlier PDF.
- Historical legacy invoices are shown only after verified account binding to an exact canonical ledger ID and invoice number. Never auto-link by approximate name, delivery address or phone.
- Retain VAT/legal invoice documents unmodified; don't imply a test-order PDF is a tax invoice.

## Backend scaffold committed here
`invoice-document.mjs` implements the single verified-byte response writer with Content-Type application/pdf, no-store, SHA-256 header and reproducible filename. It delegates account authorization, readback and double-check of receipt revision to `resolveSandboxPdf` (including the pending PR #175 race fix).
`GET /api/v2/sandbox-invoice-document?invoiceId=<UUID>` exists as a common **sandbox-only** endpoint after V2 session/tenant verification. It deliberately returns `CANONICAL_PDF_NOT_CONFIGURED` (503) because there is NO verified Drive adapter. It cannot issue or write to real accounting.
`GET /api/v2/invoices` and `GET /api/v2/invoices?id=<binding UUID>` are already account-scoped for owner-bound legacy history; their `pdf.available=false` is truthful.
No live Android or web client is reconfigured by this backend PR.

## Production API acceptance contract (NOT activated)
1. `POST /api/v2/confirm` -> one durable order ID; when issuer readback matches immutable quote, returns one `invoiceId,canonicalId,invoiceNumber,invoiceRevision,pdfStatus`, never a locally generated PDF.
2. `GET /api/v2/invoices` -> authenticated/paginated customer history of verified invoice identities and final status. No unrelated account invoices and no double counting CTV legacy counterpart invoices.
3. `GET /api/v2/invoices?id=<UUID>` -> read-only canonical line items and payment status, `pdf: {available,sha256,revision,downloadPath}` only after archival verification.
4. `GET /api/v2/invoice-document?id=<UUID>` -> the original verified bytes (not a renderer), authorized again immediately before and after the Drive read. No public arbitrary file ID/URL; return 503/409 on source missing, 403/404 on wrong owner.
5. Gemini intent `xem hóa đơn 5903` resolves only if the account has a verified binding; it returns the same verified invoice document handle. An external Gemini chat with no authenticated Minh Satori session must not access any private PDF.
6. Android streams original response to private app storage and opens/shares via FileProvider. Web previews/downloads that response. Gemini's UI uses the SAME endpoint; none may generate a separate PDF.

## Tests required before owner-approved release
- 100 identical submit retries -> exactly one invoice ID, one signed source PDF and one commission ledger entry.
- Three authenticated clients download identical bytes; SHA-256 equality, content-length and invoice revision equality; PDF renders on Samsung and browser.
- Account A cannot fetch account B's invoice (including guessed UUID, revoked role or cross-CTV).
- Tampered/changed Drive file, wrong invoice number, stale metadata, missing PDF, mid-flight revocation, oversized/corrupt PDF -> fail closed.
- Historical account binding, duplicate legacy pairs, payment partial/undo, VAT/shipping discounts and immutable order pricing are verified.
- Backup/restore of real Render PG18 before any live catalogue import, OAuth/Gemini/Drive signed source acceptance, and official issuer acknowledgement remain separate release blockers.

**Status:** sandbox code/tests only; real Render PostgreSQL backup, live official PDF access and production /confirm remain intentionally blocked.
