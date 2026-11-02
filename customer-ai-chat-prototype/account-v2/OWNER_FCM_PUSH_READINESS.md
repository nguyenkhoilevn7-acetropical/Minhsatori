# Owner new-invoice push — readiness and acceptance (2026-11-02)

**Status: STAGING, NOT LIVE.** A Firebase project/service-account and an owner
device registration are prerequisites. The app can display in-app alerts during
foreground polling without them, but it cannot provide immediate background push.

## Architecture
1. The signed owner Android build is configured only with **public**
   `SATORI_FCM_APP_ID`, `SATORI_FCM_API_KEY`, `SATORI_FCM_PROJECT_ID`.
   No Firebase service-account private key is included in an APK or repository.
2. Android obtains an FCM token after owner opt-in and Owner V2 login. It sends
   it over HTTPS to `POST /api/v2/admin/push/device` with the authenticated
   owner session, same-origin header and CSRF. Server refuses non-owner accounts.
3. Server stores an owner-scoped token and only sends a minimal data payload
   `{type:"verified_new_invoice",invoiceNo:"5969"}` after a canonical
   **COMMITTED** invoice. Receipt content, customer names, numbers and
   addresses are not pushed.
4. Android receives in the foreground/background through
   `FirebaseMessagingService` and opens the verified invoice by numeric ID.
   Notification is not an authorization to read or mutate accounting data.

## Before deploying
- Set Render secret `SATORI_FCM_SERVICE_ACCOUNT_JSON` with an appropriately
  scoped service account, private to Render; set `SATORI_FCM_PROJECT_ID` and
  `SATORI_OWNER_PUSH_ENABLED=1` **only after migration+testing**.
- Configure GitHub Actions public variables `SATORI_FCM_APP_ID`,
  `SATORI_FCM_API_KEY`, `SATORI_FCM_PROJECT_ID`, then generate a newly
  signed Android release with the original pinned signing certificate.
- Run the reviewed, target-pinned SQL migration for the **dedicated V2 database**
  and read back both owner push tables. The normal service does not auto-run
  arbitrary migrations.
- Verify owner cookies/CSRF and device registration, reject non-owner attempts,
  and test FCM with a **synthetic canonical invoice number**, without creating,
  editing or marking any real invoice.
- Verify app foreground, background, screen-locked, Fold open/close and push tap.
- Existing `/api/v2/confirm` hook covers **V2 orders only**. A separate
  authenticated, idempotent Bot API event hook is required for legacy
  ChatGPT/Gemini/Android orders; do NOT call all-source notifications live until
  that hook is completed and verified.
- FCM is best effort; OS battery/data restrictions and offline devices can
  delay delivery. Avoid any claim of an absolute arrival-time SLA.
- Disable with `SATORI_OWNER_PUSH_ENABLED=0` for instant server rollback,
  without rolling back customer invoices or altering accounting records.
