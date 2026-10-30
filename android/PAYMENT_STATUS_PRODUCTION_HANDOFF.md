# Minh Satori — Work handoff: bật trạng thái thanh toán Android + ChatGPT

STATUS: Source code / fake CI only. No GAS Production deployment or real payment write performed.

## Current diagnosis (2026-10-31)
- Read-only Production connector: revision 190, 130 bills; this does NOT prove write access.
- Installed ChatGPT tools expose satori_mark_customer_paid only. Three other correction tools are absent in the running integration, though connector/lib/satori.mjs source declares all four.
- Existing Android NativeMainActivity already implements all four owner-only payment confirmation handlers and encrypted pending write readback.
- api/BotApi.gs and api/AndroidOwnerMobileApi.gs source implement ownerMobileWrite for all four; need verify actual deployed Google Apps Script version and OAuth client/properties.
- This branch prevents mobile.snapshot from claiming any financial write permission when Bot owner bridge is missing.

## Work execution steps
1. READ-ONLY: Open active production GAS project/deployment with Cloud Browser. Back up code, manifest and Drive ledger; record revision and count. Inspect Script Property NAMES only. Do not print secrets. Never run setupDrive or replace STATE_FILE_ID.
2. Compare deployed BotApi.gs and AndroidOwnerMobileApi.gs with repository changes; ensure exactly one doPost, intact doGet, original Gemini, CTV, PDF and accounting logic. Use shared LockService, revision, backup, requestId and paymentAudit.
3. Verify owner OAuth: SATORI_ANDROID_OWNER_EMAIL and SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON map to the signed Android production OAuth client and real owner. Do not weaken tokeninfo/email/scope/issuing-client checks.
4. Validate Android mobile.snapshot allowedActions includes payments.markCustomerPaid, payments.markCustomerUnpaid, payments.markSatoriPaid and payments.markSatoriUnpaid ONLY if live ownerMobileWrite exists; otherwise read-only. Ensure app endpoint is correct /exec and read-only fallback is off for owner.
5. Republish/re-register LIVE Minh Satori Bot ChatGPT integration from connector/lib/satori.mjs to surface all four operations. Confirm server-side SATORI_ENABLE_WRITES and Bot API client payments:write only after isolated tests. Code on GitHub by itself does not update installed plugin tool schema.
6. Run fake-only isolated Drive tests of the four transitions, including customer/Satori independence, ID + invoiceNo + name + total checks, reason for correction, duplicate requestId, stale revision, readback after dropped response, wrong actor, wrong OAuth client, canceled / Không Tính / internal CTV restrictions, unchanged original bill.
7. Run Node tests/android-owner-mobile-production.test.cjs, tests/owner-payment-connector-parity.test.cjs and full existing payment CI. Prove no data loss and no duplicate writes.
8. Deploy only after fake PASS and owner approval, back up before new version. Confirm production inventory/revision and all read-only paths. Do not execute a financial write on any real invoice without explicit selected invoice + amount + owner confirmation.
9. Deliver: GAS deployment version, owner allowedActions readback, LIVE ChatGPT tool list, PASS/FAIL evidence, old/new revision when a separately authorized real write occurs, rollback notes, and whether APK rebuild is actually required.

## Acceptance
- Four actions: payments.markCustomerPaid, payments.markCustomerUnpaid, payments.markSatoriPaid, payments.markSatoriUnpaid.
- Android and ChatGPT independently read two flags from one canonical ledger; not conflated.
- Canceled/Không Tính/internal CTV bills cannot be paid or corrected.
- No optimistic success: only confirm after canonical readback and audit; preserve secrets and original order workflows.
- Existing Android signed APK UI already includes payment status buttons; do not rebuild app solely to change server permissions.
