# Minh Satori Android — website parity & visual quality contract

Updated 2026-10-19. Owner's explicit requirement: **Bring the full current Minh Satori website UI and capabilities into the native Android APK. Make the appearance even more polished where useful, but do not remove features, change financial behavior, or replace the Android APK with a Chrome/PWA shortcut.** Minimize owner testing: consolidate implementation and automated verification before requesting one near-final Samsung acceptance round.

## Canonical source
- Website implementation: `index.html` on `main` in `nguyenkhoilevn7-acetropical/Minhsatori`.
- Brand: original `logo-satori-3394.jpg`; dark slate (#0f172a / #020617) with blue/cyan accents, rounded controls, collapsible panels and distinct navigation.
- Android source: `android/` on development branch `feature/minhsatori-native-android-v020`; **do not merge/release to live without explicit acceptance.**
- The business ledger on Drive and existing website are the single source of truth. Android MUST NOT write directly to Drive JSON. All writes only through owner-authenticated server operations that preserve transaction lock, backup, revision validation and idempotency.

## UI / interaction acceptance
- Reproduce website identity, labels, navigation semantics, iconography and invoice branding on Samsung, not just rough functional equivalents. Native refinements may improve spacing, text hierarchy, readability, foldable layouts and touch targets without hiding website functionality.
- Same invoice/customer, statuses, totals, discount logic, notes and PDF results across website and app. Always distinguish **Đã TT Satori** (supplier settlement), **Đã thanh toán** (customer paid), **Không Tính** (CTV price display), and **Đã hủy**.
- Treat repeated views of the same delivery invoice as one underlying delivery for aggregation; keep different addresses/phones separated.
- Keep invoice PDF A4 template aligned to website (logo, eight columns, QR, payment, signatures). Owner visually accepted v0.3.1, then reported totals table too widely spaced; Android code tightened row pitch **30pt → 19pt** on development branch, NOT yet device-verified. Do not ask owner to reinstall just for this.
- Account/security status should be understandable; never label a previously selected file as live sync. Read-only file picker is a fallback; goal is Google identity and verified sync.
- Respect compact panels and nonintrusive controls already on website; avoid crowded screens on Samsung Fold/phone.

## Required feature parity — current website vs Android
| Feature / website entry | Current Android evidence | Remaining acceptance |
|---|---|---|
| Lên Đơn / order composer | Native editor coded, gated | Match website full form, item list, price overrides, discounts, delivery fee/VAT, notes, review-before-save; test only staging writes |
| Kho HĐ / invoices | Native invoice search/detail coded and owner read 113 invoices on Samsung | Website-like archive, status transitions, PDF, filtered views, restored/trash checks |
| Sổ Kế Toán / accounting | Added searchable **read-only** ledger with paid/unpaid/excluded summary and status filters; new unit test on dev branch (CI pending) | Full website profit/partner transactions, imports, reports, duplicate-pair reconciliation, staging permissions and signed APK tests |
| Đối Chiếu Satori | Not yet present as equivalent top-level Android workflow | Bring complete compare/import/flags and results, test with synthetic Excel/PDF and no production mutations |
| Trí Nhớ AI | Added searchable **read-only** native customer memory and delivery-recipient viewer from synced memory; tests pending CI. Mobile API staging returns memory only to owner or staff with customers:read | Match full website AI training/edit behavior through safe authenticated API; UI/device acceptance |
| Bảng Giá / catalogue | Basic product parsing exists | Full website catalogue, pricing, editing controls behind validated server permissions |
| Khách hàng / Công nợ | Read-only native grouping and debts | Match website grouping, duplicate price-views exclusion, settlement/payment distinction and transaction filters |
| Hóa đơn PDF / Zalo / Messenger | v0.3.1 PDF owner visually approved; Android sharesheet coded | Verify line-by-line totals, 8 cols, QR fallback, multi-page, share recipient on Samsung; tighter totals layout pending final build |
| Drive sync / Restore / Thùng rác 30 ngày | Native Drive-picker read proven; API code staged in GitHub only | Google OAuth Android release signature, server Mobile API staging, manual-to-auto sync, sandbox recovery, revision conflicts, backups |
| Google sign-in and write actions | In source, *not* verified against production; no stable release signing | Validate Google OAuth + owner/role authorization, token expiry, safe write/read-back and dedicated release signing |
| Full-device layout | New development branch has website logo + navy-blue header/navigation, no full parity yet | Phone and Fold size checks, Android keyboard, rotation, accessibility and native performance |

## Engineering order (not a request for owner to test each step)
1. Finish UI and field-by-field parity audit versus website. Update Android UI in coherent batches; run static tests on every commit.
2. Ensure native read-only Google login and foreground refresh do not misreport stale file snapshots. Verify with mocked auth/Drive tests before owner testing.
3. Complete Mobile API **in staging** with isolated Drive copy and dedicated Apps Script deployment; test unauthorized access, duplicate requests, revision mismatch, backups, cancellations, payment and restore. Secrets only server-side.
4. Complete remaining website modules, including import/reconcile, AI memory and catalogue; do not silently omit complex features.
5. Run GitHub Android unit/build checks and broader automated/fixture tests, then one consolidated owner Samsung acceptance cycle.
6. Sign a stable release build with protected keystore after the acceptance gates; never use an ephemeral debug signature as a release.

## Progress evidence
- `c27f5990e70acf33467146d06e66b5af96da42eb`: Android top banner now uses the **same original website logo** and slate→blue branding; nav chips use website-inspired colors. **Code-only change, awaiting CI/device proof.**
- `2d566709c9a2a4d6811458e0baf67ddaa2a4219a`: tighter PDF financial summary block, owner-requested.
- `a8cb96c2a3147485c141ffbb9db42bd7239b9ac9`: Google Drive read-only authorization entry and foreground refresh candidate (requires CI, valid OAuth and device tests).
- Do not claim full parity or 100% completion while missing capabilities remain. No edits to production invoice data.

## 2026-10-19 additional native parity commits
- `cccb64689b705583b68e9847fc1ec4688fbdc1fb` + `d0e96bede9a3b5314892f26b696ee03a090cc906` + `8fc367ffdebbc9506b0d9407f163ea41727f1848`: native ledger formulas, searchable UI and regression tests; **read-only, not full financial parity**.
- `a2e0b2ee8a8cbd95afa20fc16977e04ec24ad4a0` corrected by `3325f2058c28ebc8e827dc78a9291f5c48aaa010` + `285c5b2567c2d8b5ae9a9c8c925cf48b6de127b8`: exact short-number/#/HD invoice lookup to prevent accidental phone/address substring matches; source regex corrected and regression tests added.
- `d8a23121416f8bd6de3191c13268c9f99941f3f5` + `7c0c7390abba87a880bb25dd52a58e7011f4703b` + `8ac7223d621cefadb50a4f4433690826a38fa21c` + `6b8a995dc3d587bc98d90cd91ba68b2644a5a6e8`: read-only memory model/UI; server staging role guard for customers:read; JUnit fixture with distinct receiver locations. **Server source is un-deployed.**
- All new Android CI runs were queued or in_progress when checked; do not claim a finished new APK. Do not ask the owner to test these piecemeal. Production Drive and website unmodified.
