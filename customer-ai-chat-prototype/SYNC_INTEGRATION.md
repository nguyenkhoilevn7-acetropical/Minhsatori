# Minh Satori Customer AI Chat — website integration checklist (sandbox)

**Implemented in this branch, staged on separate Render Free service only**
- iMessage-inspired mobile chat with searchable **Tất cả sản phẩm**, filtering Satori / Hikari / Juice.
- Product fallback from the website `main/index.html` `DEFAULT_CATALOGUE`: 20 items. No customer personal data copied into GitHub.
- Server-scoped prices per demo A (20%) / B (35%), no client-side price authority. Original list price and demo price appear in the drawer; checkout server recomputes.
- Premium 450ml `TP-00051`, canned juice `TP-00055/56/58`, Hikari 250/500ml, 19/20L containers, 5L spout/nonspout and carton/bottle/pack distinctions.
- A4 PDF template styled like actual Minh Satori invoice with watermark and **NO live payment details or QR**.
- Product disambiguation and two-turn chat answers; never drop receiver/phone/address-change information when joining messages.
- Existing 47+ rule/PDF, 13 mocked Gemini, new UI and read-only bridge tests gate Docker build. Gemini credentials only in Render environment; real Gemini smoke checks only with fictional data.
- HMAC-only read module `satori-readonly.mjs`, **not invoked**, **not exposed by HTTP**, disabled unless a distinct read-scoped Bot API key is configured privately on Render.

**NOT YET LIVE SYNCHRONIZED WITH PRODUCTION**
- The website's 20-product fallback is a snapshot **not** the authoritative current price after someone edits the website UI. The website `saveCatalogueChanges()` currently writes to browser localStorage. It is not a centrally versioned public API.
- The existing Apps Script Bot API supports `system.status`, `customers.search`, `orders.list` read actions and HMAC; it lacks unrestricted secure paginated `catalogue.list`, `customers.list` read snapshots suitable for customer links. `orders.list` is limited to 100 rows per response.
- NEVER load all real customers or full production orders into public demo-a/demo-b. Those links are publicly guessable.
- Gemini Developer API Free Tier may use submitted data for product improvement; send only sanitized user message, never names, addresses, phones, secrets, bank info or history. For production customer messages or paid deployment, review Google's applicable data terms and consent.

**Remaining protected integration steps before release to real customers**
1. Back up the live Apps Script + Drive state; verify revision and rollback before modifying production.
2. Build an authoritative versioned catalogue on the website backend and a HMAC-authenticated read-only `catalogue.list` endpoint. Do not allow anonymous access to live price policies.
3. Create narrowly scoped read-only Bot credential (`customers:read`, optionally `orders:read`); store endpoint / key ID / HMAC secret **only** in Render Environment. Never reuse a production write key.
4. Design customer portal identities: hashed random opaque URL token per customer+delivery location, mandatory phone OTP on new device, short sessions, rate limits, token revoke/rotate, per-customer and per-location visibility. Link possession alone is not identity verification.
5. Lookup one verified customer/profile and its price policy server-side; never send a complete customer list to the browser, Gemini or GitHub.
6. Revise source-of-truth pricing with version/lastModified, fail closed if stale/unavailable, lock checkout and revalidate profile and unit price at confirmation; prepare idempotent production writes only after explicit safety review.
7. Use permanent storage, audit trail, backups and secure recovery; current Render Free local order storage is ephemeral.
8. Test Samsung Chrome, PDF rendering, multiple deliveries, discount edge cases, network failure and rollback. Do not enable real checkout/payment until every gate passes.

## Safe existing service and branch
Render: `srv-dbbdjss9v7es73ermjf0`
Branch: `prototype/customer-ai-gemini-free-20261020`
Production `main` and live Apps Script/Drive remain unchanged.
Work OpenAI and Cloudflare experiments remain untouched.
