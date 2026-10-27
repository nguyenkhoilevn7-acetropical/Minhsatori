# Minh Satori — checkpoint Android invoice edit + dual payment (2026-10-27)

**User authorization and scope.** The owner explicitly requested that the Android app support correcting existing invoices and updating two payment statuses independently. This is **not authorization to deploy Google Apps Script production, change actual invoice records, migrate DB, charge Render, or remove owner-safety gates**. Owner previously required visual acceptance before production.

## Sources / branches

- Repo: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori
- Draft functional PR: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/200
- Draft signed Samsung UI candidate PR: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/201
- Base Android 0.4.13: PR #195/#196, signed release branch `release/android-v0.4.13-customer-info-20261027`.
- This source feature branch: `feature/android-owner-invoice-edit-sandbox-20261027`.
- Candidate signed branch: `release/android-v0.4.14-owner-edit-payment-20261027`, package `vn.minhsatori.app`, version `0.4.14`, versionCode `31`.
- Previous infrastructure checkpoint: issue #161, backend payments PR #187, native payments PR #192.

## Exactly what changed

1. `NativeMainActivity.kt`:
   - An explicit Edit affordance is shown for eligible unpaid, unlinked, non-excluded invoices; if `orders.update` is absent, explain owner OAuth/API requirements and open existing settings. Never bypass `canAction`.
   - Add compact `Sửa` action to invoice list preview; detail dialog has `SỬA HÓA ĐƠN`.
   - Show exactly two context-aware independent payment controls: customer paid/unpaid; Satori settlement paid/unpaid. Use existing confirmation/reason and guarded write journal. If offline/read-only, show explicit blocked-permission dialog rather than silently hiding.
   - Existing `NativeOrderEditor.kt` supports customer/phone/address, product lines, quantity/price, shipping, VAT, delivery note, original ID/number and expected revision.
2. `AndroidOwnerMobileApi.gs`: OAuth-verified owner-only `orders.create`, `orders.update` added to allowlist, protected by canonical production ledger proof, nonce/requestId validation and existing guard.
3. `BotApi.gs`: `ownerMobileWrite` allows create/update for OAuth owner, **but do not expose HMAC `orders.update` scope**. `updateUnpaidOrder` exact ID+number+name+original total+revision, unpaid standalone only, no CTV-linked/paid/test/excluded invoices. Server recalculates sum; invoice number, ID, historical date and status retained. RequestId replay is audited in `satori_order_edit_audit_v1`, prewrite Drive backup and canonical readback via existing write path.
4. Payment actions still `payments.markCustomerPaid`, `payments.markCustomerUnpaid`, `payments.markSatoriPaid`, `payments.markSatoriUnpaid`, with independent flags, audit, server request dedupe and protected readback.

## What is and isn't proven

- Offline tests: `node tests/android-owner-mobile-production.test.cjs`, `node tests/android-owner-invoice-edit.test.cjs` with synthetic OAuth and fake Drive; `node tests/satori-bot-api.test.js`; `python3 -m unittest discover -s android/tools -p 'test_*.py'`. Do not interpret a synthetic PASS as Google OAuth/Drive HTTP end-to-end.
- CI workflows are linked in draft PRs #200/#201. Confirm latest final SHA and completed success; a workflow still in progress is **not PASS**.
- **Not yet deployed**: Production Apps Script has not been updated to support create/update/payments. APP UI may show buttons but cannot save actual invoices until real backend is authorized and deployed safely.
- No real invoice was created, edited, deleted, or marked paid in this work.

## Critical next Work-session tasks — strict order

1. Open PR #200 and #201, read latest commit, inspect all CI. Fix any red suites without weakening Owner authorization, canonical ledger checks, paid/CTV locks, request replay or backup semantics. Confirm Kotlin Android tests, Python, Node fake Drive; inspect emulator screenshot artifacts. Verify signed 0.4.14 APK hash, version and certificate; install only for manual UI review.
2. Review `updateUnpaidOrder` carefully: exact original identity, 1..50 product entries, strict quantity/price/VAT and totals, duplicate invoice numbers, test/excluded/paid/CTV, audit retention, original PDF fields/tax identifiers, idempotent same-request replay, conflict/timeout reconciliation, outbox/process death and Drive backup readback. Fix gaps and rerun synthetic tests.
3. Verify all four payment transitions independently in fake ledger: customer paid vs Satori paid; reverse either without affecting other; audit and readback, requestId replay, wrong ID protection; test amount/receipt/exclusion and owner auth.
4. Back up **Apps Script source, Script Properties keys (never secret values in chat), and target ledger** to private Drive with verified readback. Production Drive JSON backup revision must be freshly confirmed at time of deployment. Do not touch V18.3, PDF/BACKUP GAS deployments, PostgreSQL, production invoices.
5. Set up an **isolated fake Google Apps Script deployment** not hardcoded to production ledger, with TEST-specific source and OAuth Owner flow; do not relax productionLedgerProof in live code. Verify real HTTP, owner OAuth, requestId, deny nonowner, write/readback and error handling. Resolve CAPTCHA with explicit user assistance if necessary.
6. After isolated tests and owner preview approval, request explicit, separate permission for Apps Script production deployment and any real invoice status modification. No silent merge/push/deploy to main.
7. Only after production backend is proven: end-to-end Samsung APK ↔ Mobile API ↔ canonical ledger ↔ website/ChatGPT readback. Test with owner-approved nonfinancial dummy data in a safe sandbox first; verify invoice PDF parity and no duplicate write.
8. If any blockers remain, report them with concrete IDs and stop. Avoid repeated Work attempts on CAPTCHA/blocked external PostgreSQL.

## User-facing acceptance checklist

- **Hóa đơn → Sửa** clearly visible; read-only mode explains why disabled.
- Allows editing only eligible unpaid standalone invoices, with preview, total, confirmation and audit.
- **Khách:** đã/chưa thanh toán independently from **Satori:** đã/chưa thanh toán.
- Required reason for reversal/Satori correction, no status changes without verified owner permission.
- After any authorized save, newly fetched revision shows same result in Android, Website and ChatGPT.
- All UI design reviewed on Samsung before main branch merge or production deploy.

## Status reporting contract

Report separately: source coding %, automated tests PASS/FAIL, signed APK availability, Samsung UAT, real OAuth+Drive sandbox, verified pre-deploy backup and production status. Do not call system production-ready from passing mocks.
