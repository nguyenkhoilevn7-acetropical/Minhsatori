# Android release checkpoint — 2026-10-20

Continue branch `feature/minhsatori-native-android-v020`, draft PR #9. Native version remains 0.3.1 (8); no production deployment authorized or performed.

## Verified this session

- Starting head `bca1c00ba310ed114dc8aa2d83360b35704ed5ea`: Android CI `39347658955` and API CI `39347659025` successful.
- Live read-only Bot API: revision 105, 113 orders, updatedAt 2026-10-19T14:16:55.465Z.
- Remote sandbox security: 5/5 checks pass (signature, scope, replay, tampering, environment).
- Local `node tests/satori-bot-api.test.js`: pass, including Mobile API mocked Google verification, scoped staff and writes with backups/revision/idempotency.
- Local `node tests/bot-api-restore.cjs`: 14 pass, 0 fail.
- New release-verifier tests: 9 pass. Both edited workflow YAML files parse and `git diff --check` passes. These tests do not prove a real release APK or Google sign-in works.

## Changes

Release pipeline now verifies the pinned public certificate SHA-256, rejects debuggable APKs, debug signing certificates, wrong versions/packages and multiple/unexpected signers. It runs both debug and release unit suites. Artifact includes `release-verification.json` with APK checksum, size and public certificate SHA-1/SHA-256. Signing secrets are limited to the steps that need them and private file permissions apply before decoding the keystore. Android ignore rules protect usual local signing/build files.

## Concrete blockers

- No release key or its secure durable custody has been verified. Do not generate a transient key and call it stable. Four signing secrets in launch checklist plus public Actions variable `SATORI_ANDROID_SIGNING_CERT_SHA256` must be provisioned through authorized account administration, never in chat/repository.
- GitHub browser is signed out; repository Actions Secrets page returns logged-out 404. Connector can modify development source but does not expose secrets administration or manual workflow dispatch. Browser login is required for account settings.
- Google Cloud credentials page returns "Site Unavailable" in this Work browser, before sign-in. No Cloud OAuth or Apps Script configuration has been verified or changed.
- This session has no local Android SDK/Gradle; Android builds must use GitHub Actions. Verify latest CI for this checkpoint's eventual commit.
- Mobile API real OAuth, isolated Apps Script deployment, sandbox end-to-end mobile writes and signed APK Samsung acceptance remain outstanding. Remote sandbox HMAC tests are not evidence for Android OAuth.
- Manual release workflow must be available through an authorized workflow entry before dispatch; do not merge main solely to activate it without the owner's production safeguards.

Next: verify development CI, authenticate GitHub administration, establish durable signing custody and register matching Android OAuth identity in Google Cloud, deploy isolated Mobile API sandbox and test all writes/recovery. Request production approval only after backups, revision/count and staging evidence are complete.
