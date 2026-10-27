# Minh Satori visual parity — Android + Websites + Gemini (27/10/2026)

## Owner’s instruction
- Use the approved modern Minh Satori reference design **consistently everywhere**: native Android, original accounting site V18.3, customer website V2, backend owner/admin, and BOTH the original Gemini web shell and V2 customer Gemini chat.
- User prefers **ICON FIRST**, less text, concise readable labels, color instead of excess white. Debt / Công nợ icon must be a dollar banknote.
- Protect **ALL pre-existing functions** rather than redesigning or rebuilding them. Maintain QR/receipt/PDF, orders, editing, payments (independent customer and Satori), customer history, CTV, settings, Gemini natural language, OAuth, backup/Drive and real-time sync.
- The owner must **inspect real browser and Samsung screenshot preview, then authorize production separately**. Do not merge or deploy without that acceptance.

## Active draft PRs (work already begun)
- [#200](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/200) Android invoice create/edit + independent owner payment buttons — backend source, synthetic tests; no production GAS.
- [#201](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/201) signed Android 0.4.14 owner-edit/payment UAT candidate (verify latest CI/certificate before distributing).
- [#202](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/202) Android global pale-blue palette, colored KPI/card surfaces, outlined dollar-note Công nợ icon. Based on PR #200. **Does not have a release candidate yet; do not claim 0.4.14 APK contains PR #202 changes.**
- [#198](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/198) V2 preliminary visual compatibility and synthetic Render preview.
- [#203](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/203) V2 customer site + admin + owner catalogue + old Gemini original shell styling, actual code includes SVG icons in navigation, additive CSS with unchanged scripts.
- [#199](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/199) V18.3 legacy accounting website **opt-in** `?satoriUiPreview=1` without changing business body/scripts.
- Existing UI preview: https://minh-satori-unified-ui-review.onrender.com/?v=2 — **synthetic visual-only**, not E2E; never infer production capability.

## Scope completed in source (not a production claim)
- Android: keep all six native tabs, hamburger navigation and existing owner actions, use shared blue/slate/green/amber colors and icon banknote. Payment/edit functionality is in separate PR #200.
- V2 Customer Gemini chat: new shared backgrounds and buttons, Gemini messages iOS-like blue owner/outgoing and pale-grey assistant, invoice preview/cart/contact cards and inline SVG navigation while leaving route IDs and JS unchanged.
- V2 admin: blue owner navigation with inline outline icons and familiar tabs; all `data-admin-tab` values preserved.
- V2 catalogue: consistent metric and cards.
- Original Gemini chat: same palette on old Gemini shell / invoice quotation / chat. Original Gemini assistant, API adapter, order parsing and checkout unchanged.
- Automated tests added `android/tools/test_satori_reference_style.py` and `account-v2/tests/reference-ui-parity.test.mjs`. Check CI on latest PR head; do not assume PASS while jobs still running.

## NEXT Work session
1. Open this checkpoint and PR #200, #201, #202, #198, #199, #203. Read latest commit and CI statuses first. Do not duplicate work or treat a previous green workflow as latest.
2. Inspect the user screenshot/reference side by side with **real rendered staging screenshots** of each page and target Android phone size. Create a visual inventory of every screen: Tổng quan, Sổ kế toán, Hóa đơn/chi tiết/PDF, Khách, Công nợ, Lên/sửa đơn, thanh toán Khách/Satori, thùng rác, Gemini/chat/cart/receipt, Quản trị V2, CTV/link, Đăng nhập/Settings. Flag any UI regressions.
3. Keep function contracts: all route IDs / DOM event listeners / API paths / price rules / state transitions / permissions; no hidden untested removal. Review colored buttons for contrast and touch target size (>= 44dp recommended), mobile keyboard, Samsung Browser, refresh after writes, iPad responsive.
4. Validate Gemini ENGINE stays REAL (not a mock) in a safe staging with fake ledger. Cover text intent "5 thùng", multi-line products, real catalogue/discount/receiver selection, iMessage blue sent bubbles, cart quantity, checkout, PDF, Gemini fallback and OAuth.
5. Validate invoice editing and payment actions in **fake GAS/Drive sandbox with real HTTP + isolated OAuth test**, and fake Postgres where needed. Keep paid/CTV locks, exact invoice guard, optimistic revision, idempotency and backup-before-write. No actual money/ledger edits.
6. Review potential regressions in CSS overrides, source-only checks; run all native Android Kotlin/UI screenshot instrumentation, V2 node tests, legacy V18.3 read-only/print PDF and Gemini current tests. Produce original-vs-new screenshots and feature checklist with PASS/FAIL/BLOCKED.
7. Prepare isolated **functional** staging URL only if safe; never point fake preview at live API. Keep Render auto-deploy OFF, no env/DB modifications, no paid service.
8. Before any production request, back up production Apps Script source/properties and ledger with verified Drive readback, show signed APK version and certificate, then get OWNER approval separately for APK acceptance and GAS/website production.
9. Report progress by stage with exact PRs, commits, CI runs, APK link if signed. If blocked by Google CAPTCHA/OAuth or missing staging, tell the user exactly what access is needed and continue safe independent testing.

**Never merge these draft PRs directly across incompatible base branches without resolving them carefully.** The web code is based on account-V2 feature branch, while Android is based on 0.4.13 release/edit branch. Legacy V18.3 is separate. For final production construct a clean integration branch after tests.

## No false completion
Design source edits and a synthetic Render preview DO NOT mean the real Gemini/website/app functions are verified live. Keep this qualification in handoffs.
