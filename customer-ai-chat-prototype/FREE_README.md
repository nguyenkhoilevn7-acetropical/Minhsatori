# Minh Satori Customer AI Chat — Gemini Free sandbox

**Sandbox only.** This branch is a fork of `prototype/customer-ai-cloudflare-free-20261020`; Work's OpenAI branch `prototype/customer-ai-chat-sandbox-20261020` and its Render service are untouched. No deployments to `main`, no Apps Script, no Google Drive or real invoices used.

## Design

- Rule-first, Vietnamese natural-language parser for familiar Satori SKUs. Only complex/unclear inputs call Gemini, when API Free Tier is enabled.
- Google Gemini model: `gemini-3.5-flash-lite`, via `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`. Structured JSON intent only; **never** prices or discounts.
- Trusted sandbox fixtures: fake customers A (20%) and B (35%). Server computes shipping/total; supports one-time confirmation and PDF, protects cross-profile access. No production data integration.
- When Gemini key is absent, daily local cap is reached, API returns 429, or Google is unavailable, system uses deterministic rules and requests clarification instead of guessing.
- Key kept in Render server environment only; no API key exposed in browser or URL. `GEMINI_FREE_TIER_ONLY=true` is an **operator assertion**, NOT a verification of Google Cloud billing status. A key itself cannot reveal if the project has billing enabled.
- **No automatic paid tier or fallback**. Keep Google AI Studio / Google Cloud project unlinked from billing, verify the project is explicitly **Free Tier**, and use an account-specific daily API cap. When quota is exhausted the model becomes unavailable; rules continue. Never assume subscription to Gemini consumer app covers Developer API calls.
- Google says Free Tier submitted data may be used to improve its products. **Use invented profiles and messages in this sandbox only.** Do not send actual customer personal information or real orders to the free-tier AI.

## Server env

```txt
GEMINI_API_KEY=<configure directly as Render secret; NEVER commit/share in chat>
GEMINI_FREE_TIER_ONLY=true
GEMINI_DAILY_CALL_LIMIT=50
DEMO_BIND=0.0.0.0
NODE_ENV=production
```

Without all of `GEMINI_API_KEY` and `GEMINI_FREE_TIER_ONLY=true`, the app still works by free rules. No need to configure an OpenAI key, and Cloudflare is never contacted on this branch.

## Test and deployment

Dockerfile: `customer-ai-chat-prototype/Dockerfile` with repository root as build context; Render Free, Singapore, separate new service, autodeploy OFF. Docker runs `tests/free-test.mjs` and `tests/free-ai-test.mjs` without real external calls before releasing image. Verify no true Gemini API test occurred until key installed.

Demo URL paths: `/c/demo-a`, `/c/demo-b`. Test quoting 950,400 and 772,200 VND; changing identity/address should not apply discount; double confirmation must not create two orders; PDF is watermarked SANDBOX and should never be interpreted as paid. Files in the Free Render instance are ephemeral, so never use for real orders.

**Before real release:** persistent storage, verified OTP on new device, admin-authorized immutable customer discount policies, careful auditing, true PDF statement-of-order vs tax invoice, replay protection across instances, proper concurrency/lock and production isolation checks, real Gemini latency and accuracy tests.

## Preserved builds

- Work OpenAI: branch `prototype/customer-ai-chat-sandbox-20261020` / Render `srv-dbbca5uq1p3s73c31910`
- Cloudflare Free: branch `prototype/customer-ai-cloudflare-free-20261020` / Render `srv-dbbd69vf3r2c738f3afg`
- Minh Satori production: GitHub `main` and live Apps Script/Drive: **not modified**.
