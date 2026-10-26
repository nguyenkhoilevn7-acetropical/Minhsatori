# V2 encrypted backup runner — NOT deployed

`export.mjs` is an operator CLI, not a public HTTP endpoint. It exports only
`public.satori_v2_*` tables, refuses an empty/mixed database, uses a read-only
repeatable-read transaction and passes its exported snapshot to `pg_dump`.
All table counts and ordered, length-framed SHA-256 row digests use that same
snapshot. The custom-format dump and manifest are encrypted together with
AES-256-GCM before writing a mode-0600 file. Random nonce per archive. The
receipt contains only archive byte length/checksum; it does not imply restore.

Required secret/runtime configuration (never commit values):

- `SATORI_ACCOUNT_V2_DATABASE_URL`
- `SATORI_V2_BACKUP_KEY_BASE64`: independent 32-byte key, recoverable in an owner-controlled secret store; never store next to archive
- `SATORI_V2_BACKUP_APPROVED=1`
- `SATORI_V2_BACKUP_SOURCE_HOST`: exact authorized source host
- `SATORI_V2_BACKUP_SOURCE_DATABASE`: exact authorized source database
- `SATORI_V2_BACKUP_OUTPUT`: new encrypted archive path (existing file refused)

Requires `pg_dump` at least the source server major version; source Render is
PG18, so do not run the current PG16 CI wrapper against Render. Archive size is
bounded at 64 MiB; a larger dump fails instead of exhausting the free runner.
No plaintext dump is written by the exporter. Restore tooling must authenticate
before exposing decrypted bytes. Keep warnings/errors private and fail closed.

CI uses only localhost synthetic data: actual snapshot export, encrypted-file
readback, authenticated decryption, pg_restore into a separate DB, and exact
count/hash comparison for every V2 table. This is recovery proof for the tested
PostgreSQL version only, NOT proof of PG18 to PG17 downgrade compatibility.

## Live blocker and next approved execution

2026-10-26: Render source is Free PG18, external IP allowlist empty. Free web
services cannot use Shell/SSH or one-off jobs. Current V2 image has no pg_dump
and no backup endpoint. The connected SQL tool cannot reach the private DB.
Do not open the firewall, upgrade plans, or abuse build commands to read data.
A separately reviewed, owner-approved internal runner/deployment with PG18 tools,
secure encryption key and private Drive upload credentials is still needed.
No production service/image/env change has been made for this runner.

Before cutover: obtain encrypted source archive on owner Drive, download and
verify its exact checksum, restore independently, validate PG18→PG17 schema,
extensions and every table digest. Preserve source. Never promote the Neon test
branch. No scheduled paid cron: scheduling and Drive delivery remain pending
until the first real restore proof and runner authorization exist.
