# Render V2 pilot PostgreSQL connection — owner/Work runbook (25 Oct 2026)

**Safety:** Separate V2 service and empty Free pilot database only. No real customer profiles, passwords, invoice records or production connections. Never paste/commit URL or credentials. Render Free Postgres expires **24 Nov 2026**, has no managed backups; leave public sign-up and real checkout disabled.

## Resources already created

- V2-only web service: `srv-dbeuv50m7kps73f6ac40` — `minh-satori-v2-customer-admin`
- Empty V2 pilot PostgreSQL: `dpg-dbevfkm7bikc73bl2v80-a` — `minh-satori-v2-pilot-isolated` (`minh_satori_v2_pilot_isolated` database), Singapore.
- `/api/v2/confirm` must remain HTTP 503. DO NOT touch original `minh-satori-customer-ai-gemini` service, Apps Script, issued CTV links or Production invoice ledger.

## Why this boot helper exists

Render Free web services have **no SSH/Shell or one-off jobs**, and this database's external IP allowlist is empty. Do **not** open external networking. A V2-only container may connect internally to the V2 database in the same workspace/region. The migration process is guarded by an explicit one-time flag and pinned database name/host; if the target check or migrator fails, the new deployment fails closed and cannot run the app with a partially applied schema.

## Steps in Render Cloud Browser (Work)

1. Review PR with `boot.mjs`, `migration-bootstrap.mjs`, tests and Dockerfile. Run green CI; merge into **V2 pilot feature branch only** after review. Do NOT merge to main. Auto-deploy of V2 service is OFF.
2. Open the V2 PostgreSQL dashboard, **Connect** and copy its **Internal Database URL**, not External. Both resources must remain in Singapore. Do not show the URI in chat, screenshots, GitHub, tool logs, or PR.
3. Open the V2-only web service **Environment**, add/update privately:
   - `SATORI_ACCOUNT_V2_DATABASE_URL`: complete *internal* database URL copied from that exact pilot database.
   - `SATORI_ACCOUNT_V2_MIGRATION_TARGET_DATABASE`: `minh_satori_v2_pilot_isolated` (non-secret).
   - `SATORI_ACCOUNT_V2_MIGRATION_APPROVED`: `1` for the **one-time migration rollout only**.
   - `SATORI_ACCOUNT_V2_ENABLED`: `0` until Google owner OAuth and remaining readiness prerequisites have been verified.
   - `SATORI_ACCOUNT_V2_PG_SSL`: do not force `1` for internal DB unless its TLS CA verification is configured and proven; this is not an external URL.
4. Trigger **manual deploy of V2-only service** from reviewed feature branch. Verify the exact commit in deploy view. Private service logs must include `V2_MIGRATION_SCHEMA_READBACK_PASSED` and `SATORI_ACCOUNT_V2_STANDALONE_LISTENING`. A failure is not success; do not enable registrations.
5. Remove `SATORI_ACCOUNT_V2_MIGRATION_APPROVED` (or set `0`) immediately; redeploy/restart V2-only service. This makes subsequent boots **serve only**, not migrate.
6. Verify `/healthz`, `/api/v2/status` and `/app-v2?preview=1` independently. `enabled` must still be false without verified owner OAuth. Use a **private** one-shot read-only query within the V2 service context, when available, to confirm exactly the 12 schema tables and CRM revisions without exposing contacts or credentials.
7. Run isolated synthetic registration/restore drills before considering actual records. Free Postgres has no managed backups and expires; do not admit public customers or any real orders until durable database and tested backup/restore are set up.

## Rollback

Set `SATORI_ACCOUNT_V2_MIGRATION_APPROVED=0`, set `SATORI_ACCOUNT_V2_ENABLED=0`, keep `/api/v2/confirm` disabled, and roll back the **isolated V2** web service if necessary. Never delete or mutate historical accounting data. The migrator uses one SQL transaction and schema readback; failed deployments must not claim completed migration.

**Work checkpoint:** Record PR, source SHA, reviewed Docker image SHA, actual V2 deploy ID/state, target DB ID, migration success indicator (not URL), schema count and confirmed OAuth/registration status. Do not claim "PostgreSQL connected" from a green deploy alone.
