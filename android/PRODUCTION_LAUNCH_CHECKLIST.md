# Minh Satori Android — production launch gates (2026-10-20)

**Status:** STAGING ONLY. Never report a debug APK as a usable business release. PR #9 remains draft. Existing website and Bot API serve production; do not overwrite their Apps Script code.

## Safety first

- Check live Bot API `system.status` and read the Drive ledger. Record both revision and invoice count, make a byte-matching backup before any deployment.
- Use a separate Drive **sandbox** file and Apps Script staging deployment for all create/edit/pay/delete/restore tests. Do not use the production ledger for fake invoices.
- Match current website `doGet` access protection and the existing HMAC Bot API `doPost` before and after Apps Script changes. **GitHub merge does not deploy Apps Script.**
- Keep all Google OAuth client IDs, staff role mappings and any other secrets in Google Cloud / Apps Script Script Properties; never send tokens or signing keys to ChatGPT or commit them.
- Verify the app's PDF payee, VietQR amount and bank information against the current **website invoice template** before release. Editing bank details must use a reviewed, synchronized strategy across website and native app.

## Configure the mobile gateway (staging, never blind-copy into production)

1. Back up the live Apps Script project code without exposing credentials. Integrate `api/MobileApi.gs` and matching `api/BotApi.gs` **into the same script project** that implements the existing `readState_()`; merge `doPost` routes rather than declaring duplicate globals.
2. On a sandbox script project, set `STATE_FILE_ID` to its sandbox JSON file and configure the existing Bot API HMAC client records server-side.
3. Configure `SATORI_ANDROID_OWNER_EMAIL` (the actual owner), `SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON` (JSON array of the approved Android OAuth client IDs), and `SATORI_ANDROID_STAFF_PERMISSIONS_JSON` (staff email → explicit scopes). The Android app should be assigned to **staff** with only their authorized scopes. Any unlisted account must receive `FORBIDDEN`.
4. In Google Cloud, register Android OAuth client for package `vn.minhsatori.app` and the **SHA-1 of a stable private release signing key**. A CI debug keystore is insufficient because it may be regenerated and does not constitute a release identity.
5. For mobile API calls use the HTTPS Apps Script `/macros/s/.../exec` endpoint via `?route=android`. The phone sends its short-lived Google access token; it must never contain a server HMAC secret.
6. Deploy sandbox, verify Google token audience/email/expiration and refusal of anonymous/wrong-account/unauthorized-staff access. Confirm approved staff receive exactly their scoped allowedActions.
7. After staging passes, deploy carefully to the existing script with the required approvals and compare live ledger revision/count **before and after**; test read-only first. Never enable production write before this gate.

## Real Samsung device acceptance

- Install a properly **release-signed** APK; launch stays fully native and does not open Chrome/WebView.
- Log in with authorized **staff Google account**; an unlisted account must fail. Confirm revision/count from Android equals website and ChatGPT Bot API.
- On **sandbox only**, create an invoice with two items + delivery note; verify one invoice ID across Android/website/ChatGPT. Edit and add shipping fee, mark actual customer payment, soft-delete an unpaid sample, restore from 30-day trash. Confirm backups and no duplicate IDs.
- Test duplicate-button tap, stale revision when another device edits, Wi-Fi loss **after** server commit, Google token expiry and app resume. The app must never silently resubmit a new order with a new requestId.
- Check Vietnamese accents and multi-page PDF, VietQR payee/amount and that Android share to Zalo/Messenger actually opens the target apps and allows choosing the desired chat/group. Do not claim fully automatic sending to a Zalo group; native Android share needs user selection.
- For supplier reconciliation, test unrelated invoice numbering/branch names, matching quantities/products, multiple deliveries and CSV/XLSX errors.
- Restore sandbox backup as a demonstration. Production JSON must remain unchanged during tests.

## Release

- Fix PR #9 merge conflicts with `main` while preserving every live website and Bot API change. Review diffs and run all tests.
- Sign a release build using the stable private keystore. Distribute the tested APK/release, version and SHA256; ensure upgrades preserve installation identity.
- Only when every gate above passes can the release be called ready to use. A GitHub Actions debug build passing Gradle is **not** proof of login, live writes or Zalo sharing on Samsung.

## Current evidence

- As of the 2026-10-20 read-only check: live Bot API `system.status` reported revision **105**, **113** invoices. This count is a snapshot and should be rechecked before release.
- Native v0.3.1 had passing CI from commit `6b02afb100c8154251e83427f88995914a486a02`; further validation changes are being tested in PR #9.
- Google Cloud OAuth, Apps Script Mobile API staging/production deployment, Samsung signed-release tests and merge conflict resolution remain **unverified**.
