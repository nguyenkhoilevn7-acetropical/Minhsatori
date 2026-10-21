# Minh Satori Android Native v0.3.3 (development)

Package `vn.minhsatori.app`, versionCode `10`. Work in `feature/minhsatori-native-android-v020`, draft PR #9. This is a native Android app, not the retired Chrome launcher described in v0.1.x history.

The native UI supports invoice/customer/debt browsing, creating/editing orders, delivery notes, PDF and separate Zalo/Messenger sharing, 30-day trash restore and supplier CSV/XLSX reconciliation. These features are implemented in code; real Google OAuth, staff permissions and complete Samsung release acceptance still require isolated sandbox testing.

## AI customer demo and Satori launcher icon (sandbox only)

Version 0.3.3 reuses the exact invoice image `satori_invoice_logo.jpg` as the Android launcher logo with a white adaptive-icon background. Gemini demo-A displays a structured quote/invoice card with line items, discount, VAT and total; TEST history can reopen bills and the app downloads server-generated A4 sandbox PDFs for viewing, saving and sharing via Android/Zalo/Messenger. No payment link or production invoice is enabled. Signed release uses the same pinned certificate to support in-place Samsung updates.

## Recovery after closing the app or losing a reply

Before a write reaches the network, the app flushes one encrypted pending operation to private no-backup storage, protected by an Android Keystore AES-GCM key. The exact action, request ID, revision and payload are bound to the server endpoint and server-verified Google subject. No OAuth token or server HMAC signing key is saved.

An unresolved pending operation blocks new writes across restarts. Reconnecting first checks authoritative invoice/trash state for the original request; if needed the user may explicitly resend the unchanged original operation. A rejection of a retry does not erase the earlier uncertain operation. Missing keys, corrupted journals or failed disk writes block sending instead of silently discarding the record. Changing account/server never replays another account's pending operation.

The updated staging `api/MobileApi.gs` must return `actorId` in `mobile.snapshot` and `deleteRequestId` in `mobile.trash`. Older Mobile API deployments without a verified actor ID fail closed. Do not deploy these files blindly to the live Apps Script project.

## Build and verification

Requirements: JDK 17, Android SDK 35, Gradle 8.9.

```sh
gradle -p android :app:testDebugUnitTest :app:assembleDebug --no-daemon
python3 -m unittest discover -s android/tools -p 'test_*.py' -v
node tests/satori-bot-api.test.js
node tests/bot-api-restore.cjs
```

GitHub Actions `.github/workflows/android-apk.yml` builds the debug APK and runs the protected-outbox instrumentation tests on an isolated Android 30 emulator. Instrumentation tests use unique fake journal/key names, never a real phone's business outbox. Reports are uploaded as evidence. Emulator success does not establish Samsung/Google sign-in or production write readiness.

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. Debug builds are private tests only; their signing identity may differ from earlier installs.

## Permanent release signing from a phone

Owner-run helper: `android/tools/provision_release_signing.py`. It is prepared for the owner's own Linux x86_64 Cloud Shell, not for routing Work's blocked network requests through another host.

1. Open Google Cloud Shell on the phone (Google Cloud also offers Cloud Shell in its mobile app). Use the persistent home environment, not ephemeral mode.
2. Run the reviewed helper from a pinned commit. It checks JDK/keytool, obtains official GitHub CLI if needed with a pinned archive checksum, and opens GitHub authentication in the owner's environment.
3. It creates/reuses one encrypted private keystore outside Git repositories under `~/.local/share/minhsatori-release-signing/`, with restrictive directory/file permissions. It refuses to replace an existing certificate or signing Secrets without matching identity. Passwords are passed to keytool through environment variables and to GitHub CLI through stdin, never command-line arguments or logs.
4. It writes only four Actions Secrets in `nguyenkhoilevn7-acetropical/Minhsatori` and the public variable `SATORI_ANDROID_SIGNING_CERT_SHA256`; verifies their names and certificate pin; prints only public certificate SHA-1/SHA-256. Locally created CLI authentication is logged out when done; this removes local credentials, not the account's OAuth grant.
5. Keep a private backup of both `minhsatori-release.jks` and `signing-credentials.json`. Cloud Shell home storage alone is not an indefinite backup. Do not put these files in chat, GitHub source, public artifacts or shared folders.

The helper's key-protection tests run without network or credentials. Two integration cases use real temporary JDK signing keys with a mocked GitHub interface, verifying reruns and interrupted uploads retain the same key and do not print private values. Owner execution, actual Secrets writes and recovery of the resulting signing key still require verification; do not claim those operations have already happened.

The helper does not modify main, deploy Apps Script, create a release or write invoices. Configure Android OAuth for the public signing SHA-1/package and complete sandbox gates before a production launch. The manual release workflow validates the pinned signer, rejects debug APKs and emits `release-verification.json` with public certificates and APK SHA-256.

See `PRODUCTION_LAUNCH_CHECKLIST.md` and `WORK_CHECKPOINT_2026-10-20.md`. Existing website/Bot API and production invoices must remain unchanged until backups, sandbox acceptance and deployment approval are complete.
