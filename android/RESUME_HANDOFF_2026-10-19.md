# Android APK checkpoint — 2026-10-19

Status: IN PROGRESS, ~70% engineering estimate; NOT verified on real Samsung, NOT ready for production.

Repository: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori
Branch: feature/minhsatori-native-android-v020
PR #9: OPEN DRAFT, not merged into main.
Version: 0.3.0, versionCode 7, package vn.minhsatori.app.
Android native code: android/ on feature branch, not main.
Build run: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/actions/runs/39274433128 — SUCCESS.
Artifact: MinhSatori-Samsung-Native-v0.3.0-debug, ID 12197051788, expires 2026-11-18.
CI completed Gradle unit tests, APK packaging, version check and artifact upload.
Native screens coded: Overview, Invoices, Customers, Debts, Orders. PDF Android sharesheet, Google authorization and mobile API logic coded, not proven on device.

Still required:
- Configure and validate Android Google OAuth and safe server-side Mobile API.
- Validate read-only sync and revision comparisons; do not directly write Drive from APK.
- Sandbox tests: authentication, permission gates, revisions, idempotency, backups, create/edit/payment/trash/restore and offline handling.
- Samsung real-device tests: sign-in, invoice count, PDF Vietnamese, Zalo/Messenger share, reconnection and cross-device sync.
- Stable release signing and business release. Current APK is DEBUG only.

Do not modify real invoices or existing production website during tests; do not merge PR or deploy API merely to test. Use staging data. Do not include credentials in source code or APK.
Update this checkpoint after each verified milestone. Do not claim 100% until end-to-end Samsung acceptance tests pass.

Resume: read this file, android/README_NATIVE.md, android/app/build.gradle.kts, .github/workflows/android-apk.yml and PR #9; inspect latest GitHub state, continue from the next unresolved test.
