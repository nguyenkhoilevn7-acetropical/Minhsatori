# Apps Script production snapshot — "Minh Satori Drive Sync" (2026-11-15)

Read-only mirror of the code in the live Apps Script project, so GitHub finally matches what runs.
**Reference only. Do not paste these files back into Apps Script, and do not deploy from here.**

## Source
- Project: "Minh Satori Drive Sync" (script ID already referenced in this repo by `Runcheck.gs` / `CTVProductionSetup.gs`).
- Exported read-only via the Google Drive API (`application/vnd.google-apps.script+json`) on 2026-11-15 ~23:45 (UTC+7).
- Project last modified in the editor: 2026-11-14 03:55 UTC.
- This is the **editor HEAD**, not necessarily the exact deployed version. If the editor has unsaved/undeployed edits,
  they appear here; compare with **Deploy → Manage deployments** before relying on it for a production fix.
- 22 `.gs` files + `appsscript.json`, content unchanged except the redactions below. One file name had a stray quote/space
  in the editor (`"Gemini V2 Writer Onboarding`); it is saved here as `GeminiV2WriterOnboarding.gs`.
  The irregular indentation in `BotApi.gs` is exactly as in the editor.

## Redacted (this repository is public)
| File | Replaced with | What it was |
|---|---|---|
| `Code.gs` | `REDACTED_SEED_BACKUP_FILE_ID` | Drive file ID of the seed backup |
| `Code.gs` | `REDACTED_OWNER_EMAIL@example.invalid` | owner e-mail used for the owner check |
| `V2ConfigBackup20261027.gs` | `REDACTED_CONFIG_BACKUP_FOLDER_ID` | Drive folder that holds the 2026-10-27 config backup (that backup file contains Script Properties, i.e. secrets — keep that folder private) |
| `CTVProductionSetup.gs`, `V2ConfigBackup20261027.gs` | `REDACTED_DEPLOYMENT_ID` | web app `/exec` deployment URL |

No secret is written in this code: every HMAC/API secret is read from Script Properties at run time
(`SATORI_BOT_CLIENTS_JSON`, `SATORI_OWNER_PUSH_WAKE_SECRET`, `SATORI_PDF_RENDER_SECRET`, …). Script Properties were NOT exported.
Scanned before commit for hex/base64 keys, API key prefixes and literal secrets: none found.
Phone numbers in `BotApiSandbox.gs` are fake test numbers (0900000001/02).

## Main differences from `api/` in GitHub (why this matters)
`api/BotApi.gs` on `main` and on `feature/account-based-ordering-v2-20261025` are both older/different. Production `BotApi.gs` also has:
- `orders.get`, `orders.auditHistory` (reads `satori_order_edit_audit_v1`), `orders.capabilities`, `orders.previewUpdate`,
  `orders.update`, `orders.undoUpdate` — all require `client.role` `owner` or `admin`; update/preview/undo need scope `orders:update`.
- `orders.getExactBatch`, `pdf.get`, `write(s,action,p,actor)` with `actor = 'hmac:' + keyId`.
- No `orders.cancel` yet.

Any change to production BotApi must start from THIS file, not from `api/BotApi.gs`.
