# Minh Satori Android (Samsung) — Safe trial APK

## Purpose
Native Android launcher with **Chrome Custom Tabs** to open the **existing owner-only
Google Apps Script Drive Sync website**. This approach shares Chrome Google sign-in,
preserves the original website's PDF/sharing UX and avoids duplicating invoice storage.

Important distinctions:
- This is a **trial APK**, not yet a fully native accounting client.
- It contains **NO production HMAC keys**, access tokens, private invoice JSON, or offline invoice database.
- Chrome Custom Tabs are intentionally used instead of WebView because Google's sign-in
  can reject embedded WebViews. The app never opens the raw GitHub Pages site as its primary
  entrypoint, because that could create a misleading local-only invoice view.
- This APK never directly writes an invoice; writes remain inside the owner's existing
  authenticated website and its Script Properties state, with its existing authorization logic.
- The separate Bot API deployment and HMAC secrets are not needed on the phone.

## Configuration
Default portal entrypoint: existing Drive Sync owner web app,
`https://script.google.com/macros/s/AKfycbwJjiajW-gbCwCISrGjvLy5L5ETdmfAGV1zHpUWoeszRUXNgQ6vGHOs3DVABSAcEtV1/exec`.

**Verify** this deployment URL against the latest Apps Script Manage Deployments before
accepting the trial APK. It may be updated without rebuilding through
**Cài đặt liên kết** in the installed Android app, and build systems can set
`-PsatoriWebAppUrl=https://script.google.com/macros/s/.../exec`.
Only HTTPS script.google.com owner /exec URLs are accepted. NEVER paste Bot API /exec here.

## Build
Requirements: JDK 17, Android SDK platform 35, Gradle 8.9.
```sh
gradle -p android :app:testDebugUnitTest :app:assembleDebug --no-daemon
```
Output: `android/app/build/outputs/apk/debug/app-debug.apk`.
GitHub Actions workflow: `.github/workflows/android-apk.yml` on branch
`feature/minhsatori-android-apk`; downloadable artifact
`MinhSatori-Samsung-APK-debug`.

**Debug builds are only for private device testing**. Android debug signing
is not suitable for releases and may not allow a clean update when built on
different CI machines. Before production release, store a permanent release
signing key in protected secrets, build an AAB/APK with a stable keystore,
and design a safe update path. Never commit signing keys.

## Non-destructive test checklist
1. Backup current Drive live JSON; independently verify size, invoice count and revision.
2. Test login using owner Google account in Chrome Custom Tab.
3. Read invoice count in app vs existing website on Samsung and a second device.
4. Validate PDF share via Chrome → Android Sharesheet to Zalo/Messenger.
5. Test airplane mode: app must NOT silently display stale local invoices.
6. Create/edit/delete on a SEPARATE copied test Drive document and test deployment.
7. Production writes only after API, backup, and multi-device conflict tests pass.

## Future native iteration
After Bot API HMAC connector is fully verified and user authentication strategy
is designed (no bearer/HMAC secret in APK), replace Custom Tab routes incrementally
with native customers/debts/orders screens. The Android app should call a token-authenticated
backend proxy, which signs requests to GAS server-side. Native write actions must
require user review and protect double submissions, revisions, and soft delete.
