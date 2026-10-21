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

## Follow-up after owner login and CLI approval

- Owner successfully signed into GitHub browser; repository Actions Secrets UI explicitly shows no repository secrets. Owner approved GitHub CLI default scopes and reported completing device authorization from their phone.
- CLI still cannot complete login: Work execution policy blocks `https://api.github.com:443`. No CLI credential file was saved; `gh auth status` reports no logged-in hosts. Do not ask the owner to repeat authorization to fix an execution-network restriction. Source connector remains usable; it does not expose Secrets administration.
- Apps Script project listing is accessible and signed in. Identified live project `Minh Satori Drive Sync`; no project code, properties, deployments or invoice data changed. Google Cloud credentials page remains unavailable after one reload.
- Found an actual write-recovery flaw: `COMMIT_UNVERIFIED` is raised AFTER Drive setContent; generic `ERROR` and `INVALID_STATE` can also follow a commit. Native app now treats every server error except a limited known-before-commit rejection list as uncertain, uses authoritative snapshot recovery and retains the existing write lock if outcome remains unknown. Four Android regression tests cover post-commit errors, replay/unknown errors, lost replies and definite rejections. This does not yet provide a durable encrypted outbox across process death; that remains a release limitation requiring further work and device tests.
- Previous commit `2d34b1a` Android CI `39350834844` and API CI `39350834823` PASS. New Android write-recovery tests require CI verification for the follow-up commit.

## v0.3.2 implementation — pending CI and real device acceptance

- Native version advances to 0.3.2 / versionCode 9; release metadata checks and artifact names updated.
- Added immutable, encrypted pending-write journal flushed/read-back-verified before network sends. AES-GCM with Android Keystore key, AtomicFile storage under noBackupFilesDir, single global journal lock. No token/HMAC credential persisted. Failed storage or decryption keeps writes locked.
- Journal binds exact payload/request/revision to endpoint and server-verified Google subject. Snapshot recovery proves original create/update/restore/payment or exact trash deletion. New writes remain blocked after app restart until outcome is proved; explicit retry resends the original operation. Rejected retries retain the earlier unknown operation, including expired-token errors.
- Staging Mobile API now supplies actorId from Google userinfo and deleteRequestId from trash. Old servers without actorId cannot enable writes in this APK. Local API/restore tests pass; real OAuth and Apps Script staging deployment remain pending.
- Added 8 pure pending-write/encryption unit tests, a retry-discard regression, 4 isolated emulator tests of actual Android Keystore and AtomicFile persistence/corruption/missing-key protections. CI now includes emulator evidence. These tests have NOT yet run successfully as of this checkpoint; read current Actions result.
- Prepared owner-run Cloud Shell signing helper plus 6 identity-protection tests. Local Python helper/release validation: 15/15 PASS. Helper can configure the four Secrets and public pin from the owner's own environment, with stable-key protection and no secret output. It has NOT been run against a live GitHub account and does not establish that signing is configured.
- Official Google documentation confirms Cloud Shell/mobile access and free Cloud Shell service; the owner's actual phone access is untested. Do not turn this into an agent-operated proxy around Work's restricted network. No production data or deployment was changed.

Signing-helper validation now totals 17/17 local tests, including two real-temporary-keystore/mocked-GitHub integration tests (stable rerun and interrupted upload) with private permissions and no secret output. Added a process lock to prevent two owner terminal sessions generating competing keys. Android CI concurrency cancels duplicate branch/PR builds and superseded commits. Runtime/encryption/emulator results must be checked for the final branch head.

## Chat takeover on 2026-10-20 (after Work quota)

- The connected GitHub PR #9 is still draft at v0.3.2. CI head before new changes `4ac8a84c86a4f25e0aa5f15b412fa9ae0e9bc544` passed Android emulator and Bot API tests. Live Bot API read-only status is still revision **105**, **113** invoices; no live production writes.
- Fixed a reconciliation ambiguity on the staging branch: when two phones mark the **same invoice/amount** paid, a timed-out phone must not claim that its own operation committed just because it sees a paid status. Staging `api/BotApi.gs` now persists optional `apiPaymentRequestId` on a new customer-payment write (legacy ChatGPT Bot calls without a request ID remain supported), and exposes it read-only. `SatoriModels.kt` parses it; `PendingMobileWrite.kt` only confirms a timed-out payment if the invoice ID, invoice number, amount **and original request ID** all match.
- Kotlin regression tests reject missing/wrong payment request IDs and payments attributed to another device. Bot API tests ensure payment retries/another device never rewrite the original ID. These are **staging-only** changes; production Apps Script does not yet include this protocol. The release must deploy the matching staging API before enabling Android write access.
- Do not clear an unresolved payment journal merely on seeing `alreadyPaid` from another device. Keep the exact request ID and review the authoritative payment status. Do not perform any test writes against the production ledger.
- As in previous checkpoint, Android stable release keystore, GitHub signing Secrets, Google OAuth client, Apps Script mobile sandbox/production deployment and physical Samsung acceptance are **not** completed. CI success is not real phone acceptance.
