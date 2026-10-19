# Minh Satori Android APK — current work / resume here

Last updated: 2026-10-19, Vietnam time. **This is an active development handoff, not a declaration of completion.**

Detailed handoff: [android/RESUME_HANDOFF_2026-10-19.md](android/RESUME_HANDOFF_2026-10-19.md).

- Repository: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori
- Active native Android branch: `feature/minhsatori-native-android-v020` (Android files are not on `main`).
- PR #9: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/9 — draft, not merged as last inspected.
- Native Android current trial: **v0.3.0** (versionCode 7, package `vn.minhsatori.app`).
- Verified existing successful debug APK build: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/actions/runs/39274433128 . Artifact `MinhSatori-Samsung-Native-v0.3.0-debug`, ID `12197051788`, available until **2026-11-18**.
- Owner received **~70% overall progress estimate**. This is NOT end-to-end verified completion and is NOT production release.
- New work completed after initial handoff, all on this development branch:
  1. Created/read-back recovery checkpoint (`d7c932bdcfd235e150500ebb005eeb5da3c838c9`).
  2. Fixed `SatoriData.customerKey` to normalize phone formatting and `SatoriData.search` to match digit-only telephone queries (`6abf7e42c1408802083f8e212512e4d08f1252a0`).
  3. Added customer grouping and phone-search JUnit tests (`2815b032bba0bf8b9482504ee25ead62da57ad57`, corrected tests `2a842b1e394e8778de4141042dc067a7790a8734`).
  4. Linked checkpoint and updated v0.3.0 artifact name in Android README (`63c035b10b00bd60385d67c6b0723d1874b7f834`).
- **New Android CI validation:** https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/actions/runs/39276809900 (triggered by last README commit). At time of this checkpoint the run was **IN PROGRESS**; do not report success until GitHub confirms it. Check actual logs/artifact.
- Next technical action: verify latest CI passes; if failure, fix only on Android branch and rerun. Then validate Google Android OAuth/server-side Mobile API in *staging*, PDF/Zalo and invoice sync on a physical Samsung, and stable release signing. Existing debug build is suitable only for private testing.
- PRODUCTION INVOICES AND WEBSITE MUST NOT BE ALTERED. Avoid API write tests on live Drive. Do not place credentials/secrets in code, issues or chat. GitHub commits do not deploy Apps Script.
- User requested progress checkpoints after meaningful work and ability to resume after a ChatGPT task stalls.

**New-task prompt:**
`Tiếp tục Android APK Minh Satori từ ANDROID_WORK_STATUS.md trên branch feature/minhsatori-native-android-v020. Đọc android/RESUME_HANDOFF_2026-10-19.md và GitHub Actions. Hoàn tất và test native Samsung APK, Google, PDF, Zalo, đồng bộ; không sửa dữ liệu production. Cập nhật checkpoint sau mốc xác minh.`
