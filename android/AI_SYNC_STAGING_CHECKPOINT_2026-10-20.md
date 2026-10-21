# Minh Satori — unified Website + Gemini AI + Native Android staging checkpoint
Date: 2026-10-20 ICT. **No production migration or customer-data import performed.**

## Architecture and source of truth
- Business ledger: single Google Drive/App Script state revision with `satori_orders_v15`, `satori_catalogue_v15`, customer memory and related payment/restore keys. Website uses Drive state sync and browser cache; browser localStorage alone is **not** proof that a catalogue change was committed to Drive.
- Bot API: authenticated server-side HMAC UTF-8, separate read scopes `orders:read`, `customers:read`, new `catalogue:read` action `catalogue.list` on **GitHub staging only**. The action rejects missing Drive catalogue, duplicate/invalid codes and malformed prices. Returns revision with sanitized product rows. **Not deployed to production Apps Script.**
- Gemini backend sandbox: same customer chat server on Render Free; read-only bridge `satori-readonly.mjs` now permits HMAC `catalogue.list`, admin-only `/api/admin/source-check` returns only revision and counts, never customer rows or secrets. Requires **separately authorized read-only HMAC key**, not configured by code. No production writes.
- Android native v0.3.2 staging: `AiSandboxContract.kt` and `AiSandboxActivity.kt` use pinned HTTPS Gemini sandbox API, existing Satori logo, multi-SKU native picker, quote, explicit TEST confirmation and demo history. Entry from `NativeMainActivity`. **Not a WebView or APK release.** Demo A only, public non-secret fixture, no real invoice writes.
- Website staging: `index.html` adds a strictly **opt-in preview** link shown only with `?satoriAiSandboxPreview=1`, labelled SANDBOX. Default website visitors see nothing; **no production website deploy**.

## Verification and nonnegotiable safeguards
- Latest read-only production Bot status checked: revision **105**, invoices **113**, no mutations performed in this work. Counts may change later; always re-check before migration.
- Bot API CI passed after new scoped catalogue action and test cases.
- Native debug APK build + unit tests passed on development branch, with isolated sandbox AI tests. Final branch head CI/emulator should be checked before any Samsung installation; debug builds are not signed releases.
- Gemini isolated Docker CI passed without touching Render Free live data.
- Gemini currently still quotes using static demo snapshot; neither production customer/discount sync nor real payable VietQR has been enabled. One existing Gemini Free startup probe was previously unverified; don't equate deterministic order rules with proven live AI behavior.
- No secrets in source code, chats, issues or APK. The customer fixture name `demo-a` is explicitly **not** an authentication mechanism. Never expose a live customer list, payment details or history to the public demo link.

## Production integration gates — not completed
1. **Backup and verify** the live Apps Script revision and Drive ledger, including source catalogue, customer history, invoice count and a tested rollback.
2. Stage the updated `api/BotApi.gs` in a separate Apps Script sandbox. Confirm `catalogue.list` with a new `catalogue:read` HMAC-only credential and verify all 20 products against the website, including edits and revision checks. Record and reject divergence, not silently pick the newest looking cache.
3. Setup a durable, secured database for customer web sessions, audit, bill history and customer notification delivery. Render Free ephemeral files cannot be the archive.
4. Customer identity: phone OTP, 1:1 customer-and-delivery-location binding, random/hashed revocable links, server-authoritative discount + VAT + address and action audit. No Gemini Free Tier customer PII without policy/privacy review.
5. Implement a **single idempotent checkout** to existing verified Apps Script order API using expectedRevision, recompute price at commit, and test retry-after-lost-response and simultaneous website/Android updates on sandbox fake state.
6. Validate PDF/VietQR payee, VAT, bank details and customer-visible history; only enable payment QR after owner verifies merchant configuration. Ensure new orders appear on owner Admin/Android with correct state, never duplicated.
7. Register Android Google OAuth with stable release signature, configure staff roles and sandbox Mobile API, run real Samsung acceptance and build release-signed upgrade with verified SHA.
8. Only after owner approval, backup verification and acceptance: merge staging through review, deploy Apps Script and website with after-deploy revision/count comparison, migrate customer portal, release Android. Never let a GitHub merge silently mutate Drive.

## Exact branches
- Bot/Android/website preview: `feature/minhsatori-native-android-v020`, PR #9 **draft**.
- Gemini adapter: `prototype/customer-ai-gemini-free-20261020` (Render service `srv-dbbdjss9v7es73ermjf0` is intentionally **not redeployed** during this staging work).
- Production: `main` and live Apps Script **untouched**.

## Owner-visible meaning
An AI Chat entry may be visible in staged web/native UI before unified customer authorization is approved. That entry is clearly labelled TEST and must never be represented as live synchronization.
