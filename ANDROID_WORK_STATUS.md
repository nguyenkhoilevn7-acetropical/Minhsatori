# Minh Satori Android APK — current work / resume here

Last updated: 2026-10-19, Vietnam time. **This is an active development handoff, not a declaration of completion.**

Detailed handoff: [android/RESUME_HANDOFF_2026-10-19.md](android/RESUME_HANDOFF_2026-10-19.md).

- Repository: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori
- Active native Android branch: `feature/minhsatori-native-android-v020` (Android files are not on `main`).
- PR #9: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/9 — draft, not merged as last inspected.
- Native Android currently installed owner trial: **v0.3.0** (versionCode 7). **v0.3.1 (versionCode 8)** is new development source with website-style PDF, awaiting CI and Samsung validation. Package `vn.minhsatori.app`.
- Verified existing successful debug APK build: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/actions/runs/39274433128 . Artifact `MinhSatori-Samsung-Native-v0.3.0-debug`, ID `12197051788`, available until **2026-11-18**.
- Owner received **~70% overall progress estimate**. This is NOT end-to-end verified completion and is NOT production release.
- New work completed after initial handoff, all on this development branch:
  1. Created/read-back recovery checkpoint (`d7c932bdcfd235e150500ebb005eeb5da3c838c9`).
  2. Fixed `SatoriData.customerKey` to normalize phone formatting and `SatoriData.search` to match digit-only telephone queries (`6abf7e42c1408802083f8e212512e4d08f1252a0`).
  3. Added customer grouping and phone-search JUnit tests (`2815b032bba0bf8b9482504ee25ead62da57ad57`, corrected tests `2a842b1e394e8778de4141042dc067a7790a8734`).
  4. Linked checkpoint and updated v0.3.0 artifact name in Android README (`63c035b10b00bd60385d67c6b0723d1874b7f834`).
- **Latest Android CI validation VERIFIED SUCCESS:** https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/actions/runs/39276809900 ; Android JUnit tests, Gradle APK build, version/package verification and artifact upload all PASSED for code commit `63c035b10b00bd60385d67c6b0723d1874b7f834`. New debug artifact `MinhSatori-Samsung-Native-v0.3.0-debug`, ID `12197393716`, ZIP SHA256 `a3334483050f260234b52d804fd568d73e4c97421c40e450af7eee9ab25a3b4b`, APK SHA256 `38a904dc6fd28cbe26ffab1616a4246cc908c7081f17bfc421bb365a9e6c94e4`, artifact expires 2026-11-18. Download artifact ZIP via run's Artifacts section. DO NOT confuse with older ID `12197051788`.
- Next technical action: install the **new** debug APK on Samsung and validate non-destructive read-only flows (native UI, file picker, count/revision, PDF and Zalo). Then configure Google Android OAuth/server-side Mobile API in *staging*, test permissions/safe writes, cross-device sync and stable release signing. Current debug build is suitable only for private testing; do NOT attempt live writes until protections are validated.
- PRODUCTION INVOICES AND WEBSITE MUST NOT BE ALTERED. Avoid API write tests on live Drive. Do not place credentials/secrets in code, issues or chat. GitHub commits do not deploy Apps Script.
- User requested progress checkpoints after meaningful work and ability to resume after a ChatGPT task stalls.

**New-task prompt:**
`Tiếp tục Android APK Minh Satori từ ANDROID_WORK_STATUS.md trên branch feature/minhsatori-native-android-v020. Đọc android/RESUME_HANDOFF_2026-10-19.md và GitHub Actions. Hoàn tất và test native Samsung APK, Google, PDF, Zalo, đồng bộ; không sửa dữ liệu production. Cập nhật checkpoint sau mốc xác minh.`

## Samsung owner acceptance checkpoint — 2026-10-19 around 22:29 ICT

**Verified by owner-supplied Samsung screenshot**, not by automated CI:
- Minh Satori Native **v0.3.0** launches without Chrome.
- Native Android document picker opens Google Drive; owner selected the live JSON.
- Read-only dashboard rendered **revision 105, 113 invoices**, of which **107** counted for revenue, **24** customer-unpaid invoices, total estimated outstanding **23,711,911 VND**.
- Snapshot displays `updatedAt=2026-10-19T14:16:55.465Z` (21:16:55 ICT), read around 22:29 ICT. File-picker read is a snapshot, **not confirmed live syncing**.
- Current screenshot still shows **KÍCH HOẠT KẾT NỐI LÊN ĐƠN** and **CÀI ĐẶT LIÊN KẾT API**. This does **not** verify Google OAuth, Mobile API permissions, write operations, automatic sync, PDF, Zalo, or release signing.
- Two source invoice dates visibly malformed in the recent-orders display: `22/0802026` and `20/19/2026`. Do NOT guess corrected dates or mutate production invoice records.
- Android development branch commits through `b4da32618c3649a0fead3308068306abe63a91d6` validate sortable dates (Vietnamese and ISO), sort invalid dates last, warn visibly while preserving original values; add regression tests for invalid dates and leap days. This change **has not yet passed CI nor been installed on Samsung**.
- Latest CI run as checked: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/actions/runs/39278976211 — **QUEUED** when recorded. Wait for final result before claiming new APK built.
- NEXT: verify CI passes, download/install newly built test APK, compare revision/count with website and test PDF + Android Zalo share read-only. Then stage server-side OAuth/Mobile API, simulate safe writes in sandbox. Do not modify production.
- Engineering completion remains about **70%** until Google authorization, API connection, multi-device sync, PDF, Zalo, signing, and safety acceptance tests pass.

## Website-style Android PDF v0.3.1 — 2026-10-19 evening (implementation checkpoint)
- Owner tested direct PDF→Zalo from v0.3.0: **PDF sharing works** but PDF layout **does not match website**. Screenshot of `MinhSatori_HD_9_2.pdf` shows plain text, no website logo, table/discounts or QR. Do not call v0.3.0 PDF acceptance complete.
- Owner explicitly requested the native PDF be **the same as the website PDF**.
- Website canonical source: `index.html` on `main`, function `invoicePdfDefinition()` (logo+branding, customer tax code, 8-column product table, list price/discount, bank VietQR, totals, Vietnamese amount-in-words, two signatures, page number). Source logo: `logo-satori-3394.jpg`.
- Changes on **development branch only**, not production:
  * Imported the exact website logo as `android/app/src/main/res/drawable/satori_invoice_logo.jpg` using original Git blob.
  * Updated `SatoriModels.kt` to preserve order taxCode and line discountPercent from snapshot; added regression test.
  * New `WebsiteInvoicePdf.kt` reproduces website A4 sections natively, uses actual source total, 8-column table, website bank QR URL, notes, signatures and page counts. On QR network failure, prints a visible warning instead of inventing a QR.
  * Replaced `NativeInvoicePdf.kt` share renderer to use that template, render in a worker thread so the Samsung UI does not stall, and append website-matched bank/message details.
  * Bumped trial version to **0.3.1 / versionCode 8**, aligned GitHub Actions artifact name/metadata.
- **Latest code commit:** `7a7838a4bf95b6eb9913cebfcab898a67af40151`.
- **Latest GitHub Actions run:** https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/actions/runs/39280903525 — **QUEUED** as last checked. Do NOT claim APK build success, exact visual parity or Samsung PDF acceptance until CI passes and owner compares v0.3.1 PDF.
- **NEXT:** read workflow result, resolve build/test errors, download new debug artifact when success; owner installs v0.3.1 and compares an invoice against website PDF including logo/table/bank QR and multisheet layout. If not matching, iterate. Keep production invoices and website unmodified.

## CI queue diagnosis — 2026-10-19 late evening
- Owner reported ChatGPT task looked stalled after PDF template rewrite.
- GitHub CI run **39280903525** for Android v0.3.1 commit `7a7838a4` was confirmed **QUEUED**; its job 118154581591 also QUEUED, with no build result at last observation.
- Multiple earlier development-branch runs were pending concurrently. In earlier runs 39278976211 and 39278949247, unit tests, Gradle APK build, metadata verification and artifact upload all showed SUCCESS, but jobs were still in the post-Gradle cleanup step, hence status in_progress.
- This is consistent with GitHub Actions queue and cleanup delays. It is NOT proof that latest v0.3.1 compiles and NOT a Samsung device freeze. Do not promise APK installation yet.
- Resume: inspect https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/actions/runs/39280903525 and fetch its job logs when it actually runs. Fix any compilation issues on the development branch, and verify the artifact. Then Samsung compare PDF to website.
- Avoid producing more redundant commits/runs while CI backlog exists. No production data writes occurred.

## Downloaded native APK artifact v0.3.1 — owner ready for read-only Samsung trial
- GitHub Actions run: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/actions/runs/39280903525 (commit `7a7838a4bf95b6eb9913cebfcab898a67af40151`).
- GitHub output artifact **EXISTS** even though workflow status endpoint still said QUEUED at last checked: `MinhSatori-Samsung-Native-v0.3.1-debug`, ID **12199838339**, archived size 3,872,338 bytes, expires **2026-11-18**.
- Artifact ZIP SHA256 (verified after connector download): `301922109c07d0c4facf6062a809b5cd3455636682b48edfd92365e4f5ee0fd3`.
- ZIP contains `app-debug.apk`, extracted as `MinhSatori-v0.3.1-Samsung-debug.apk`, **4,294,827 bytes**, SHA256 `8178da0c7d2c8394be99e2fc30769f2a0f024c4054709fe96b41ba6eecedadc6`. Container ZIP CRC check passed, APK has AndroidManifest.xml, DEX, bundled `satori_invoice_logo` and APK signing block.
- Artifact existence and ZIP checksum prove a real native APK was produced and downloaded. The GitHub workflow overall has **not** reported completed/success yet; do not claim overall workflow green or on-device visual identity.
- App v0.3.1 needs Samsung read-only acceptance test: PDF same as website incl 8-col discounts, QR, logo, text, multi-page, sharing. Owner should not use native writes on live invoices; OAuth/Mobile API still unverified.
- Debug signatures can differ between CI runs: if Android says update incompatible, owner may need to uninstall the previous *debug app only* then install v0.3.1; this does not delete data on Drive, but locally chosen file/URL may need re-selection.

## Owner confirms Samsung invoice PDF visually accepted — 2026-10-19
- On Samsung with the installed **v0.3.1 trial APK**, owner opened the invoice/PDF following Drive file read and said **"Mẫu lên ... thấy đúng rồi đó. Thấy ok rồi đó"**.
- Record **PASS: owner's visual review of v0.3.1 invoice PDF versus website layout**. This resolves the owner-reported v0.3.0 visual mismatch.
- Still NOT verified separately: multi-page overflow, all product configurations, every QR under offline mode, exact numeric/discount reconciliation across distinct invoices, Messenger/Zalo handoff on this specific v0.3.1 run, auto Google sign-in or sync, production write permissions, final release signing.
- User wants engineering to continue on GitHub without needing a new APK for each incremental change. Next owner interaction should be a consolidated near-final Samsung acceptance test. Do not request re-testing this PDF layout as if still unreviewed.
- Continue Google identity, server-side Mobile API staging security, automatic read-only sync and regression tests. Production Drive state and website unchanged.

## Work resumed — 2026-10-19 late night: native catalogue parity
- Owner asked whether engineering work was actually underway. Verified GitHub code branch and resumed active modifications; no claim of background work between chat turns.
- Implemented `BẢNG GIÁ SATORI` read-only searchable viewer from Overview using the same `satori_catalogue_v15` snapshot as website. Displays product name, code, unit, list price, unit price and explicit discount percentage; does not write pricing or Drive data. It is a **partial** website parity implementation, not full catalogue editor.
- Preserved the `discountPercent` field of `SatoriProduct` when decoding Drive, with added JUnit regression test confirming two product records, exact prices, optional discount and unchanged input JSON.
- Latest source change commit `53849cfe6524186c635409da84cec79b2867f07b`, dev branch `feature/minhsatori-native-android-v020`. Check GitHub Actions and fix any errors before treating it as compiled or requesting device tests.
- Remaining: website module parity (reconciliation, AI memory, accounting ledger), server/mobile OAuth, staging-backed write workflow and stable release signing. Production untouched. Avoid requesting another owner APK install for this incremental change.

## Current resumed engineering: ledger + memory (2026-10-19)
- Owner requested to continue until Minh Satori Android matches the entire website; no more per-feature Samsung APK tests. Continue only on `feature/minhsatori-native-android-v020`, keep `main` and production Drive untouched.
- Delivered new code (not yet CI/device-accepted):
  * `SatoriLedger.kt`: read-only financial status summaries, paid/unpaid/excluded, invalid-date count, search/filter. No profit guessed; website has a much richer AccountingCore duplicate-pair model still to port.
  * `NativeMainActivity.kt`: native searchable **SỔ KẾ TOÁN** with status selector and figures, and **TRÍ NHỚ AI** native read-only profiles/recipients. Both entered from Overview and share existing website-aligned branding.
  * `SatoriModels.kt`: parse AI customer memory (aliases, saved delivery recipients, discount) directly from authorized data; include it only when present, no fabricated local defaults. Invoice search short IDs `#9`, `HD 5918`, `5914` exact rather than matching phone digits.
  * `api/MobileApi.gs`: staging source only, conditionally supplies memory if user is owner or has `customers:read`, never with only `orders:read`. Not deployed. Production API remains unchanged.
  * `SatoriModelsTest.kt`: fixture regression coverage for accounting status/totals/date, invoice number matching and distinct memory delivery points.
- Key most recent test-source commit: `6b8a995dc3d587bc98d90cd91ba68b2644a5a6e8`. Roadmap synchronized in `android/WEBSITE_PARITY_ROADMAP.md`.
- **No new APK asserted complete:** need verify GitHub Actions run https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/actions/runs/39287800595, inspect failed logs if needed and run broader tests. Last known owner-installed APK v0.3.1 still lacks these features.
- Remaining blockers to fully meeting owner’s target: full worksheet/partner reconciliation and profit logic parity, AI memory training/edit API, signed Android OAuth, staged deployment of Mobile API, safe write flows + end-to-end verification, stable release signing and Samsung acceptance.

## Verified Android CI — 2026-10-19 late night
- GitHub Actions source commit `6b8a995dc3d587bc98d90cd91ba68b2644a5a6e8`, [workflow 39287800595](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/actions/runs/39287800595) — **completed / success**, confirming Android Gradle unit test + debug APK build for read-only AI memory and prior ledger changes.
- [Workflow 39287905714](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/actions/runs/39287905714), source commit `cd29c808a75736f5122954cbcf1d35bd04b8be82` — **completed / success**.
- All 15 branch workflow runs returned in latest CI status query were `completed/success`. Current HEAD may be documentation-only later commit `38c125f2f7774e8988dea69fed0250326f230c28` not separately compiled; latest successful source commit is unchanged.
- Verified tests/build success **does not validate Samsung Google OAuth**, Apps Script staging deployment, mobile write authorization or full website parity.
- Already implemented and unit-tested: improved PDF, tighter totals, read-only Drive foreground sync candidate, website-styled brand header, read-only catalogue/ledger/customer memory, exact bill search, role-scoped memory API source. Owner should not be asked to reinstall for a partial stage.
- Immediate next focus: entire website accounting/partner matching and Excel comparison, Android staging OAuth/API; preserve production and keep development branch isolated.
