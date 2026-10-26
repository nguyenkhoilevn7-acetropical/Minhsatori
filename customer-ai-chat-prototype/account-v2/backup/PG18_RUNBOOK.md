# PostgreSQL 18 recovery gate — Minh Satori V2

## Proof states (never conflate these)

| State | Evidence | What it means |
|---|---|---|
| Signed source catalogue readable | dedicated `catalogue:read` client, live revision and item count | Safe to *inspect* canonical products, not to import |
| Synthetic PG18 backup/restore PASS | `account-v2-pg18-backup-sandbox.yml` with Postgres 18, AES-256-GCM archive, independent restore and all table hashes | The **code path** works with PG18, not proof of a real Render backup |
| Source Render PG18 backup verified | Owner-controlled encrypted archive from the live isolated service + size/SHA-256 + independent full restore with exact schema/count/hash readback | Permission to consider owner-approved V2 catalogue refresh |
| Cross-major PG18→PG17 recovery proved | Independent restore into isolated Neon PG17, compare all table hashes and extensions | **Only** prerequisite for any future downgrade/cutover proposal; not assumed compatible |
| Approved V2 import | Owner authorizes existing `/api/v2/admin/catalogue/refresh` from verified, read-only Apps Script source, followed by revision/item/price readback | Catalogue becomes active only after backup gate |

## Operator-safe live backup plan

1. Keep the source Render PG18 database online and preserve the existing firewall. Never assume an empty external IP allowlist grants outside SQL access.
2. Review and explicitly approve a dedicated *internal-network* one-off backup runner with PostgreSQL **18** CLI tools. Free Render web-service plans may not provide Shell/SSH or one-off jobs, so do not misuse a web request, public backup endpoint, GitHub CI, Docker build or deployment hook to exfiltrate data.
3. Use the existing read-only `backup/export.mjs` operator CLI: pin the exact host/database, set `SATORI_V2_BACKUP_APPROVED=1` only for the run, and provide an independent 32-byte backup encryption key from an owner-held secret store. Never log a connection URI, secret, decrypted dump or backup key.
4. The backup must be written as a **new** 0600 encrypted archive, not an unencrypted PG dump, and delivered to an owner-controlled private Google Drive folder. Record the SHA-256, size and timestamp. The key must be stored *separately* from the archive, recoverably.
5. Download the archive independently, authenticate the encryption and restore to a **different**, disposable PG18 database. Compare revision, every expected V2 table, count and SHA-256 manifest. A successful CI run does not replace this step.
6. Before importing catalogue, verify the official `catalogue.list` revision and 20 products against the current source again. Check SKU/units/prices and perform an authorized, revision-safe import only after backup readback.
7. Do **not** change Neon, publish Android, modify real invoices/ledger, rotate unrelated credentials unilaterally, or convert the backup to an external URL. For any exposed Apps Script secrets, plan coordinated rotation after consumer inventory and rollback preparedness.

### Blockers at 2026-10-27 checkpoint

- No verified archive or restore of **live** Render PostgreSQL 18.
- No tested service-to-Neon TLS or PG18-to-PG17 readback.
- Canonical Apps Script `catalogue.list` probe passed with 20 products at revision 169, but Render database reports zero active V2 products.
- A separate controlled legacy-secret rotation is pending due to a Work observation incident; do not copy exposed secret values.

This runbook is **documentation only**; no production database operation is authorized by creating or merging it.
