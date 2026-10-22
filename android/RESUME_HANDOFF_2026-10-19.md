# Minh Satori native APK — verified handoff, 2026-10-20

**Status:** Engineering improvements complete for current iteration; **NOT production live / NOT 100%**. No silent background coding after chat. PR #9 remains **DRAFT**.

Repository: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori
Branch: `feature/minhsatori-native-android-v020`
Pull request: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/9
Version: `0.3.1`, versionCode `8`, package `vn.minhsatori.app`.

## Implemented and verified by CI

- Native Android screens, order create/edit, bill and customer search, debts, PDF share via Zalo/Messenger Android sharesheet, trash restore, supplier CSV/XLSX reconciliation, foregound refresh (2 minutes).
- Server-side scoped Google staff/owner authentication, idempotent write IDs, Drive backup/revision checks. All write buttons disabled without server-approved actions; **no HMAC secret embedded in APK**.
- Guard against malformed number/date and 64-bit integer overflow in Android invoice editor, backed by dedicated JVM tests.
- Preserved main branch changes: website invoice notes, `trash.list` and `orders.restore` ChatGPT API semantics, plus main connector restore tests. PR #9 previously conflicted with `main`; the staging branch now contains a verified merge commit and GitHub reported `mergeable=true` on 2026-10-20. **Main was not changed by this staging merge.**
- `.github/workflows/android-release-apk.yml` is a **manual** signed-release workflow requiring protected GitHub Secrets; no key is in the code or chat. Signing secrets are not yet provisioned here.
- Latest confirmed safe read of live Bot API: revision `105`, `113` invoices; no production writes performed during the Android work.
- Node Bot API CI PASS after merge. Android CI PASS on previous v0.3.1 commits, with final post-merge head CI to be checked before claiming latest APK artifact.

## Mandatory blockers before true live release

1. Open the actual Google Apps Script project in Work Cloud Browser, back up all code and verify the correct Drive `STATE_FILE_ID`. Integrate/update `api/MobileApi.gs` plus merged `api/BotApi.gs` while preserving website `doGet` and signed Bot `doPost`, first on staging.
2. Register Android OAuth for `vn.minhsatori.app`, SHA-1 of the stable signed APK. Configure `SATORI_ANDROID_OWNER_EMAIL`, `SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON` and staff-scoped `SATORI_ANDROID_STAFF_PERMISSIONS_JSON` **server side**.
3. Add private release keystore as protected GitHub Action Secrets. Use manual workflow to build/safely verify a release-signed APK; do not use debug APK for production.
4. Complete staging E2E and Samsung tests: approved staff account login, create/edit/save/payment/delete/restore, multiple device sync with website and ChatGPT Bot, PDF Vietnamese QR/receiver, Zalo/Messenger, network loss and expired token. Recheck all live invoice counts. Never test by writing fake invoices to production.
5. After success, review/merge PR and safely deploy API to production with explicit authorization and rollback path.

See [PRODUCTION_LAUNCH_CHECKLIST.md](PRODUCTION_LAUNCH_CHECKLIST.md). Do not mark 100% complete until all live/on-device checks pass. Do not ask the owner to paste secrets into chat.
