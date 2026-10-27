# Live V2 recovery proposal — not executed

Verified 27 October 2026 (Vietnam): PR176 merged as 4c66b4a9c1024f5325b42749f48e750dbc9f5150. PG18 synthetic recovery workflow 40423181388 succeeded. This is not a live backup. PR175 remains open; its PDF revision fix is not yet in PR162.

## Proposed infrastructure requiring owner spending approval

Create a dedicated Render background worker `minh-satori-v2-recovery-operator`, workspace `tea-db65rlid0e5s739ghkpg`, Singapore, auto-deploy OFF, one instance, plan `0.5c-512mb` (Starter). No inbound port, HTTP backup route, public backup URL, schedule, migration, or live app image change. Current advertised compute rate is $7/month prorated to seconds, excluding possible build/bandwidth charges. Confirm displayed total before creation. Suspend after encrypted archive delivery and independent recovery verification; do not leave it running indefinitely. A 512MB resource limit may require a larger reviewed plan; do not upgrade automatically.

All existing workspace services inspected are Free. Free web services can initiate internal traffic, but have no Shell or one-off jobs. Do not use build commands, deployment hooks or HTTP handlers as a substitute operator channel. This proposal is not permission to purchase resources.

### Required access and exact configuration locations

1. Render Dashboard > New > Background Worker: owner approval for the separate billable runner. Do not upgrade the V2 web service or database.
2. Runner Environment / Secret Files: internal source URL from database `dpg-dbevfkm7bikc73bl2v80-a` > Connect > Internal. Only this isolated V2 database. Pin source host/database in exporter. No external firewall edits.
3. Owner-controlled password manager or Secret Manager: independently generated 32-byte backup key; confirm owner can recover it before exporting. Provide it to runner through secret configuration only. Do not place it in Drive beside archive, GitHub, shell arguments or logs. Key export/entry may require owner handoff.
4. Runner Shell/SSH: authenticated operator access. Build a reviewed image with matching pg_dump/pg_restore 18 and Node22. Validate its tool versions without database credentials. Do not supply production secrets at build time. Existing source exporter is approved code, but a deployment image and secure transfer implementation remain to be built/validated after runner method approval.
5. Drive archive folder `1793gUzeNFzOnZOZ1AOmF_7AdJU-guKCs`: verify private ACL at execution. Transfer only encrypted bytes by authenticated SSH download followed by connected Drive upload, or a separately reviewed Drive OAuth upload scoped to the archive destination. Existing ChatGPT connector authorization is not a credential available inside a worker. Never assume it is.
6. Independent PG18 restore host: local disposable PostgreSQL 18 under an operator-controlled environment is acceptable. It must not be another logical database on the live source server. No public SQL listener. A second Free Render database in the same workspace is not available; Neon17 is not interchangeable with PG18.

## Execute only after all prerequisites are supplied

- Pin reviewed source commit and record tool versions, runner ID, source identity and UTC/Vietnam timestamps. Confirm source database is `minh_satori_v2_pilot_isolated`.
- Call existing `backup/export.mjs` with explicit host/database approval. It uses read-only repeatable-read/exported snapshot, AES-256-GCM and new 0600 archive, without source writes. Record archive size and SHA256, never key/rows.
- Upload encrypted archive privately, download independently, compare whole-file SHA256, then authenticate/decrypt. Refuse wrong key, corruption, nonempty target, source/target collision, or restore errors.
- Restore into independent empty PG18 using pg_restore --exit-on-error --single-transaction --no-owner --no-acl. Never apply restore to the source URL. Keep decrypted material on restricted transient storage and remove it after verification.
- Compare every expected table's rows and SHA256 from the archive manifest. Also compare schema columns/defaults/constraints/indexes/sequences/RLS and extensions. Current exporter manifests row hashes and extension metadata; existing CI does NOT independently assert every schema definition. That schema comparison must be implemented/validated before live recovery is declared PASS. Source ownership/ACL is deliberately omitted by --no-owner/--no-acl; document approved replacement grants instead of claiming byte-identical ACL recovery.
- Persist redacted receipt and restore report on Drive. Mark restoreVerified only after all checks succeed. Preserve source and do not cut over.
- Only then re-read catalogue revision, validate all SKU/unit/prices and use authorized Admin refresh. Follow with exact count/revision/price readback and real OAuth/Gemini acceptance. No catalogue import has run in this checkpoint.

## Current status

BLOCKED: no approved funded runner, no recoverable independent backup-key delivery, no authenticated runner-to-Drive transfer, and no real archive/restore. Do not classify the 20-product catalogue read, configuration backup or synthetic CI as completion of this gate.

References verified 27 October 2026:
- https://render.com/docs/private-network
- https://render.com/docs/free
- https://render.com/docs/one-off-jobs
- https://render.com/docs/background-workers
- https://render.com/docs/compute-plans
- https://render.com/pricing
