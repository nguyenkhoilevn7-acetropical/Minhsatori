# V2 free database checkpoint — 2026-10-26

Scope: backend only; no frontend, icons, cart UI, Android or issued invoice changes.

## Verified infrastructure

- Connected Neon organization `org-raspy-resonance-25911470`, plan `free`.
- Created project `spring-dust-74906865` / `minh-satori-v2`, AWS Singapore, PostgreSQL 17, compute bounded to 0.25 CU.
- Production branch `br-dawn-silence-azzl77gs` / database `satori_v2_isolated` remains empty. No Render URL switch or accounting migration.
- Isolated test branch `br-winter-base-az9654oj` / `pr162-synthetic-tests`: all 17 V2 tables created using repository schema/migrations in a transaction; repeated successfully.
- API reports 1 GiB branch size limit and 21600 second history retention. Free organization verified, no paid upgrade requested.
- API refused explicit 300-second suspension setting. Default endpoint reports zero; automatic suspension behavior has NOT been verified. Do not claim this setting is five minutes.
- SQL through Neon connector works. Local direct PostgreSQL test failed DNS (`EAI_AGAIN`); application-to-Neon TLS and connectivity remain unverified. Connector-side `pg_stat_ssl` reports false and does not prove the client-to-proxy TLS path. Application configuration requires certificate validation.

## Code and tests

- Neon direct migration endpoint requires explicit provider, host and isolated database match. TLS validation cannot be weakened by connection URL options.
- V2 Gemini inference uses real generateContent only when configured; validated catalogue proposals cannot supply prices or authorization. Daily budgets persist in PostgreSQL. Legacy fallback is explicitly rules-only, preventing a second unbudgeted call.
- Canonical invoice access requires explicit owner-verified account binding, exact legacy ID and invoice number, and ledger revision validation. Customer queries scope by authenticated account before any ledger read. No payment amounts are invented from paid status. PDF and payment-history adapters remain unavailable.
- Storage readiness now checks 17 tables including commissions, invoice bindings and Gemini budgets.
- Local unit suite: 132 passing. All AI transport unit tests use fixtures; this is NOT evidence of live Gemini operation.
- Added isolated PostgreSQL integration test for invoice access, duplicate binding, private-field filtering, 100 budget races, and persistence after reconnect. CI result must be checked on the new commit.

## Gates still blocking production

1. Verified encrypted backup of existing Render V2 data to Drive, counts/revisions/checksum, restore/readback before migration or URL change.
2. Least-privilege runtime role and verified application TLS connection to Neon.
3. Google OAuth client, owner/pilot immutable subjects and successful real sign-ins.
4. Real Gemini credential, verified free project/quota and live Vietnamese dialogue test.
5. Signed one-invoice production bridge, reconciliation, canonical PDF/payment-history adapters, and full owner/CTV/customer end-to-end acceptance.
6. Render remains on its existing deployment with real writes disabled. Do not enable customer writes based on these unit/schema tests.
