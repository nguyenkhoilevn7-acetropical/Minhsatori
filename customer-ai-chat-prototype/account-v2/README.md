# Minh Satori — Account-Based Ordering V2 (25/10/2026)

**Status: PILOT SOURCE ONLY — NOT DEPLOYED, NOT PRODUCTION READY.**

## Non-negotiable compatibility boundary

- Existing `/real`, `/ctv`, issued link registry and passwords/PINs, `api/BotApi.gs`, `api/AccountingCore.gs`, Apps Script credentials and Drive ledger are **untouched**.
- `/app-v2` and `/api/v2/*` are the only new routes. No migration or mutation of 121+ historical invoices.
- Pilot is **one approved Google subject only**, set server-side through `SATORI_ACCOUNT_V2_PILOT_SUB`. Not open to actual customers.
- `/api/v2/confirm` deliberately returns HTTP 503; creating real invoices must pass a separate signed integration, revision, idempotency and authoritative readback acceptance gate.
- No hardcoded discounts for Hà Minh Nguyệt; the policy tables support every future customer/agency/CTV.

## External models researched (adapted, not cloned)

| Model | Verified ordering behavior | Minh Satori implementation |
| --- | --- | --- |
| Shopee | A logged-in buyer can select many products and maintain shipping addresses | Account -> multiple customer profiles -> saved delivery points -> one unified cart |
| Amazon | Buy Again derives convenience from previous order history and supports filters | Future recent-orders/reorder after authenticated ledger integration. Not fabricated in pilot |
| GrabFood | The host controls checkout; group items are reviewed and tracked from one order | Chat and catalogue append to one cart; customer confirms a priced snapshot; no multiple phantom invoices |
| Google Identity | Backend verifies signed ID token with audience and issuer, not just browser-supplied user IDs | Official google-auth-library, immutable Google `sub`, server sessions, secure HttpOnly cookies |
| OWASP API | Object-level authorization and authentication are key API failure modes | DB-scoped profile/address queries; per-owner policy approval; CSRF and fail-closed checkout |

References:
- https://help.shopee.vn/portal/4/article/79180
- https://help.shopee.vn/portal/4/article/197479
- https://digprjsurvey.amazon.com/csad/help/node/GXULX24SE2RD7EXS
- https://www.grab.com/inside-grab/stories/grabfood-delivery-group-order/
- https://developers.google.com/identity/sign-in/web/backend-auth
- https://firebase.google.com/docs/auth/web/phone-auth
- https://devguide.owasp.org/en/07-training-education/07-api-top-ten/

## Core architecture

```text
Android signed APK / Mobile web /app-v2 (iOS Light, hamburger drawer)
  Google Sign-in [Phase 1] → HTTPS POST credential → verifyIdToken(audience)
  Phone OTP / verified Firebase token [Phase 2, NOT IMPLEMENTED]
                    ↓
Account (Google sub) → Customer profiles: retail | agency | collaborator
                    ↓
Delivery addresses (many per profile, separate id + recipient + phone)
                    ↓
Shared CART (Gemini conversational parser + product catalogue)
                    ↓
Official catalogue revision + server-approved discount policy
  profile / address / SKU specificity, 0–100.00%,
  mode single or pair, configurable CTV discounts
                    ↓
QUOTE SNAPSHOT (single total + optional CTV reference-only amount)
                    ↓
EXPLICIT OWNER/BUYER CONFIRMATION + IDEMPOTENCY (NOT WIRED)
                    ↓
Signed HMAC Apps Script order bridge + expectedRevision + readback
                    ↓
CANONICAL invoice, PDF, payment status, change stream (NOT WIRED)
```

The existing `free-parser.mjs` and `multi-order.mjs` retain the Gemini model, Vietnamese parsing rules, and PII minimization. The new UI uses these existing modules through `/api/v2/interpret`; no second AI provider. The existing `index.html` and `real-gemini-adapter.js` remain the original production chat, unchanged. Full visual/feature parity migration requires a controlled follow-up after account identity and signed checkout pass tests.

## Storage and environment

Apply `account-v2/schema.sql` to a **NEW PostgreSQL database**, not Apps Script storage. Never use a Render ephemeral filesystem for Google accounts, addresses, orders or sessions. Back up this DB separately; Google Drive archival sync requires a tested restore path.

Required env vars (configure in Render dashboard, NEVER commit credentials):
- `SATORI_ACCOUNT_V2_ENABLED=1` (pilot only)
- `SATORI_ACCOUNT_V2_GOOGLE_CLIENT_ID` = Google **Web** OAuth client ID for deployment origin
- `SATORI_ACCOUNT_V2_ORIGIN` = exact HTTPS origin, e.g. production HTTPS domain
- `SATORI_ACCOUNT_V2_DATABASE_URL` = private PostgreSQL connection URI (do not log)
- `SATORI_ACCOUNT_V2_OWNER_SUB` = verified owner's immutable Google sub
- `SATORI_ACCOUNT_V2_PILOT_SUB` = initially same approved owner's sub
- `SATORI_ACCOUNT_V2_PG_SSL=1` only when DB TLS and CA chain are verified

When any mandatory config is absent, login and profile APIs fail closed (503).
A valid web OAuth client ID cannot be replaced with an Android package ID.
`/api/v2/status` exposes only readiness and the **public** Google client ID, never secrets.

## Available API

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/app-v2` | Mobile account UI (independent of old links) |
| GET | `/api/v2/status` | Pilot readiness (no private information) |
| POST | `/api/v2/auth/google` | Google ID-token verification, durable account + session |
| GET | `/api/v2/me` | Scoped profiles and addresses |
| POST | `/api/v2/addresses` | Add delivery point, validated contact |
| GET, PUT | `/api/v2/cart` | One server-side cart, atomic replace by profile |
| GET | `/api/v2/catalogue` | Server-side catalogue (requires approved import) |
| POST | `/api/v2/interpret` | Same Vietnamese Gemini parser → suggested SKU and quantities |
| POST | `/api/v2/quote` | Server-only authorized VND totals from catalogue + policies |
| POST | `/api/v2/confirm` | 503 until signed order bridge and ledger readback pass |
| POST | `/api/v2/admin/profiles` | Owner-only customer/agency/CTV profile |
| POST | `/api/v2/admin/policies` | Owner-only policy version and discount |
| GET | `/api/v2/admin/accounts` | Owner-only account directory |
| POST | `/api/v2/logout` | Revoke active server session |

Important limitations: no live catalogue import adapter; no address edit/delete; no account-to-account customer delegation; no OTP; no PDF; no live order tracking; no account-v2 Android APK switch. These are deliberately **not** claimed complete in this first isolated patch.

## Acceptance gates before any launch

1. Offline CI: domain security (13 tests), old production launch guard, parser and quote preflight tests all pass.
2. New Postgres migration and restore exercise against synthetic data only.
3. Google web ID token: altered signature, wrong audience, expired token, wrong subject, CSRF and cross-account access are rejected.
4. Owner-approved policy 0–100%, per-address/SKU precedence, historical pricing snapshot, CTV pair reference bill excluded from sales totals.
5. Catalogue import from the **authoritative** ledger; price revision mismatch invalidates prior quote.
6. 100 simultaneous sandbox checkouts, same idempotency key ⇒ exactly one order; network retry ⇒ reconcile committed state; no uncertain duplicate.
7. Signed Bot API customer write scopes and Apps Script script lock shared with owner web app; Drive backup + readback + rollback drill.
8. PDF exactly mirrors canonical invoice, Android refresh/event sync and user-facing receipt. Full Gemini layout/UX parity review.
9. Owner completes final acceptance on Samsung, then an explicitly audited staged production rollout.

**Do not merge or deploy simply because the code is on a GitHub branch.**


## Implemented after initial blueprint

- `GET/POST /api/v2/admin/profiles`: admin customer/agency/CTV profiles for registered Google accounts.
- `GET/POST /api/v2/admin/addresses`: admin-managed multiple delivery destinations per customer profile.
- `GET/POST /api/v2/admin/policies`: admin-managed address-specific, SKU-specific and default pricing, versioned.
- `POST /api/v2/admin/catalogue/refresh`: admin-triggered **read-only** HMAC pull from canonical Apps Script catalogue, strict revision validation, atomic isolated PostgreSQL readback; not automatic.
- V2 cart PUT uses `expectedRevision` compare-and-swap to reject cross-device lost updates. iOS Light UI also provides manual refresh and foreground revision polling.
- **No production deployment**. Credentials/database provision, exact original Gemini UI parity, signed ledger order creation, Android V2 build, phone login and Samsung acceptance remain incomplete.

## Owner profile and delivery-point corrections (PR #151)

- The iOS Light Admin V2 panel can correct registered customers'/agency/CTV profile name and phone, and update each saved destination's label, receiver, phone, full address and active status.
- New `PATCH /api/v2/admin/profiles`: `profileId`, `name`, `phone`, `expectedRevision`, `confirmed:true`; owner-only.
- New `PATCH /api/v2/admin/addresses`: `profileId`, `addressId`, full validated address fields, `active` boolean, `expectedRevision`, `confirmed:true`; owner-only.
- Compare-and-swap updates return HTTP 409 on stale revisions. The UI fetches fresh data rather than overwriting concurrent changes. Successful edits write a non-PII owner audit record.
- **No existing issued link, PIN, invoice snapshot or price policy is modified.** Disabling a delivery point blocks new V2 quotes for that address (not retroactive historical edits). Real checkout remains disabled.
- Fresh pilot DB: use updated `schema.sql`. Previously provisioned **separate pilot DB only**: review `migrations/20261025_owner_edits.sql` before applying; it is not an Apps Script migration.
- Pilot readiness now requires `SATORI_ACCOUNT_V2_OWNER_SUB === SATORI_ACCOUNT_V2_PILOT_SUB`; a different Google subject disables the pilot instead of allowing that account in.


## 25 October: interactive iOS V2 preview, staged users and policy lifecycle

**Try the UI without authentication or DB:** \`/app-v2?preview=1\`. This demo is explicitly labeled
**SYNTHETIC**, runs wholly in browser memory, never sends a real API request,
never performs Google login, calls Gemini, changes a real invoice or persists sample
profiles. Use it to verify the ☰ drawer, chat composition, shared cart, profile/address
forms and Admin price-policy controls on a Samsung or desktop. Its deterministic
single-product examples and prices are deliberately fictional. Real Gemini chat
requires configured server-side Gemini and a verified official catalogue.

### Customer access — secure staged rollout

- Default: only the verified owner Google \`sub\` can use the real V2 backend.
- For private customer trials, explicitly set **both** \`SATORI_ACCOUNT_V2_CUSTOMERS_ENABLED=1\`
  and \`SATORI_ACCOUNT_V2_CUSTOMER_ALLOWLIST_SUBS\` to a JSON array of immutable
  Google \`sub\` strings approved by the owner. Never use names, phone numbers,
  emails or a wildcard as the identity authority.
- No self-registration without the backend-verified Google ID token, matching
  Web OAuth audience and trusted HTTPS origin. The allowlist remains private;
  the public \`/api/v2/status\` only returns Boolean rollout readiness.
- Customer \`PATCH /api/v2/addresses\` is tenant-scoped **inside the SQL UPDATE**,
  requires same-origin session, CSRF cookie/header, explicit \`confirmed:true\`,
  immutable address + profile IDs and expected revision. Inactive addresses
  cannot be chosen for future quotes. A concurrent change returns HTTP 409.

### Admin price-policy lifecycle

- Owner policy creation requires \`confirmed:true\`. A new policy disables only
  earlier live revisions of the **same scope** (profile/address/SKU) and logs
  the approval. Historical quote snapshots remain unchanged.
- \`PATCH /api/v2/admin/policies\` allows **deactivation only**, with immutable
  policy ID, profile ID, revision CAS, \`enabled:false\` and explicit owner
  confirmation. Reactivation requires creating a new approved revision.
- The iOS V2 Admin screen lists current/archived policy revisions and allows
  deactivation. A CTV paired quote is still **reference-only**. No two real
  invoices are created until the signed bridge passes acceptance.

### Dedicated PostgreSQL migration and rollbacks

Create a **separate, durable, backed-up PostgreSQL database**. With private
credentials only in the server environment, run:

\`\`\`bash
SATORI_ACCOUNT_V2_MIGRATION_APPROVED=1 \
SATORI_ACCOUNT_V2_DATABASE_URL='postgresql://...' \
node customer-ai-chat-prototype/account-v2/migrate.mjs
\`\`\`

The migrator refuses databases with unrelated application tables, uses an
advisory transaction lock, applies idempotent schema/additive migrations and
checks all 10 V2 tables + policy, customer-profile and address revisions.
It must be exercised on synthetic data first. GitHub CI additionally tests
100 simultaneous revision updates, 100 identical checkout IDs, cross-tenant
address denial, policy deactivation, and \`pg_dump\`/\`pg_restore\` readback.

**Never use Render Free PostgreSQL for long-lived customer or invoice storage:**
free instances expire and do not provide a durable automated backup policy.
A verified restore procedure and accessible encrypted backup are mandatory.

### Still blocking real public rollout

Google Web OAuth client/origin/owner-sub configuration, a durable provisioned
PostgreSQL database with restore drill, official catalogue readback, authenticated
signed HMAC order relay and immutable ledger/PDF reconciliation are not yet
verified. \`/api/v2/confirm\` must stay 503 until all of these pass. Do not
merge this branch into the original production code or migrate any historical
issued link, CTV PIN, accounting invoice or Drive state.
