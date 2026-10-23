# Android Minh Satori — Live Sync + Thung rac Production (owner only)

Status: CODE STAGED; NO LIVE APPS SCRIPT DEPLOYMENT YET. No real invoice was deleted or restored.

## Features

Android checks a lightweight Google Drive file version approximately every 20 seconds while foreground. A changed version triggers refresh from the canonical Drive ledger. In Mobile API mode the app polls canonical server revision every 20 seconds. Resume checks promptly. Unchanged data is not downloaded repeatedly. A failure shows a visible stale-data warning and does not silently discard or roll back the last verified ledger.

Invoice detail already has a confirmed soft-delete action, and invoices screen already has Trash/Restore UI. These are available only when the signed-in OWNER Production Mobile API explicitly lists actions orders.delete, orders.restore and mobile.trash. A read-only Drive source is never allowed to write.

## One-time owner Work Cloud Browser production activation

1. Back up the CURRENT active Apps Script project Minh Satori Drive Sync, deployed version, existing BotApi.gs, and Drive ledger revision. DO NOT run setupDrive or replace live Code.gs or STATE_FILE_ID.
2. Add the NEW api/AndroidOwnerMobileApi.gs file from PR #115. Merge the guarded doPost Android route and SatoriBotApi.ownerMobileWrite method from api/BotApi.gs into CURRENT live BotApi.gs, without overwriting newer owner/CTV/PDF functionality. Keep only one doPost handler. All existing Bot HMAC actions continue unmodified.
3. Private Script Properties: SATORI_ANDROID_OWNER_EMAIL must match OWNER_EMAIL and the executing owner; SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON must contain actual signed app OAuth client IDs from Google Cloud. Never paste secrets or OAuth access tokens in chat, GitHub or screenshots. Authorize UrlFetch scopes in Apps Script.
4. Deploy a new version of existing Apps Script Web App without disturbing old deployment and verify live Bot API, Drive revision and invoice count.
5. On Samsung use Settings -> Configure Mobile API (once) with the verified /exec deployment address, then choose Google login / Mobile API. Mobile API checks OAuth token issuing client, verified owner email, role and expiry. No Bot HMAC secret goes into APK.
6. Zero-write acceptance: same revision for website and app, changed order appears without restarting while app is foreground; check trash listing without restoring. Check a different Google account is rejected.
7. Only with a separate explicit owner approval: test soft-delete and restore on one authorized unpaid non-CTV invoice; confirm exact original id and invoice number and 30-day trash. Do not create test or real invoices just to check sync.

## Limitations

This is foreground polling, not FCM realtime push while app force-closed. Native App will check again on resume. Signed APK update with the same pinned certificate is required; repository commits do not update the installed APK. App cannot perform delete/restore until the production owner Mobile API has been deployed and authorized.

## Files

- NativeMainActivity.kt, DriveReadClient.kt, MobileApiClient.kt, LiveSyncPolicy.kt, LiveSyncPolicyTest.kt
- api/AndroidOwnerMobileApi.gs, api/BotApi.gs
- tests/android-owner-mobile-production.test.cjs
