# V2 backend checkpoint — 26 October 2026

This branch is NOT production-complete. UI, Android and legacy accounting are unchanged.

## Implemented

- Legacy `pair` policy remains accepted as input for Android compatibility, but all newly calculated quotes have `invoiceMode: single`. Settlement is internal reference only, never a second invoice.
- `PUT /api/v2/admin/commission-grants`: Admin assigns a registered active CTV to a customer profile, sets CTV discount and customer min/max/actual discount, enables/disables the grant. Requires confirmed + expectedRevision (0 for create).
- `GET /api/v2/admin/commission-grants` and `/api/v2/ctv/commission-grants`: owner-wide versus authenticated CTV-only scope.
- `PATCH /api/v2/ctv/customer-discount`: only profileId, expectedRevision, customerBps, confirmed accepted. CTV cannot change their own Admin-granted rate, assignment, enablement or limits.
- Active grant explicitly overrides the assigned profile's customer item discount. Disabled grant falls back to existing approved profile/SKU/address policies. Historical snapshots are immutable.
- Existing test checkout records one `satori_v2_test_invoices` row per order in the same transaction, with unique order constraint, snapshot prices/rates/grant version/CTV attribution.
- `GET /api/v2/test-invoices?id=...&month=YYYY-MM`: customer and assigned CTV scoped at SQL level; retail projection contains savings but no internal financial data. Owner route: `/api/v2/admin/test-invoices`.
- `/api/v2/ctv/test-report?month=YYYY-MM` and owner `/api/v2/admin/test-report`: full monthly aggregates, goods revenue, commission, settled/unsettled commission; companyProfitVnd is explicitly null.
- `POST /api/v2/admin/test-settlements`: invoiceId + confirmedTest; idempotent test settlement and audit. No actual payment is recorded.
- All these invoice/report/settlement routes are explicitly TEST data. Real invoices, real debt/payment history, PDF and signed ledger confirmation are not implemented by this patch.

## Live evidence

Service: srv-dbeuv50m7kps73f6ac40, branch feature/account-based-ordering-v2-20261025.
Render live commit at inspection: 2401fb999d277d166bc2c21638f23a5eff9b2a96, auto deploy OFF.
Status: enabled=false, geminiConfigured=false, realInvoicesEnabled=false.
Storage: connected=true, schemaReady=true, tableCount=12 (before this new migration).
Existing database: minh-satori-v2-pilot-isolated, Free, expires 2026-11-24. Not suitable as durable production storage without a retention/backup decision.
Render UI requires sign-in; Google Cloud browser reports Site Unavailable. No config mutation or secret export was attempted. No production migration/deploy/ledger write performed.

## Verification and rollout

121 local node tests passed. GitHub CI runs PostgreSQL 16 with synthetic accounts, actual HTTP, 100 concurrent same-request submits, authorization denials, monthly settlement totals, process restart and pg_dump/pg_restore. Google and Gemini are NOT mocked as proof of live success; authentication sessions in CI are explicitly synthetic.

Before deploy: securely back up V2 config/database to owner's Drive archive, gain Render/Google Cloud access, inspect actual env and OAuth client origin/audience, verify owner sub and CTV login. Decide durable DB retention. Apply additive migration 20261026_commissions.sql through the dedicated migrator; keep real checkout disabled. Preserve all UI/Android changes from the current V2 base. Verify actual Gemini response provenance with non-accounting test dialogue. Then implement/verify account-to-ledger identity mapping, signed one-invoice relay/readback, account-scoped PDF/payment/debt API without rewriting issued invoices.
