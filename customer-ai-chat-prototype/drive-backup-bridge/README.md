# Minh Satori Gemini SANDBOX — Google Drive encrypted backup bridge

This is **test-only**, separate from all live invoices and existing Apps Script projects.

## Dedicated owner folder

https://drive.google.com/drive/folders/1HCt-2k_Yco2MsZyG7uflkhEpudJyoomo

Folder ID: `1HCt-2k_Yco2MsZyG7uflkhEpudJyoomo` (folder identifier, not a credential). The folder was created for this service; **no Render snapshot has been uploaded yet**.

## Why a bridge?

ChatGPT's personal Google Drive connection does not automatically give Render credentials.
The existing Gemini service writes `orders.json`, `customer-links-SANDBOX.json`, and `customer-change-requests-SANDBOX.json` to ephemeral `/tmp`.
All three are needed to restore saved unpaid TEST invoices, per-customer discounts/tax/shipping,
existing hashed customer links and pending customer data change requests.

The server now builds `createSandboxBackup(...)`, encrypts it using AES-256-GCM, authenticates a request with HMAC and sends encrypted JSON to a dedicated **Google Apps Script Web App**.
It uploads automatically shortly after mutation, upon server start and periodically
(every 5 minutes if configured; unchanged state is skipped). It also exposes
admin-only `/api/admin/drive-backup/status`, `/now` and `/restore`.
Restore requires an empty sandbox, explicit `RESTORE_DRIVE_TEST_ONLY` confirmation
and successful decrypt + backup checksum/format validation.

## One-time owner-authorized deployment (NOT YET COMPLETED)

1. Create a NEW Google Apps Script standalone project exclusively for Gemini Sandbox.
   Paste reviewed `drive-backup-bridge/Code.gs`. **Never change** production Apps Script.
2. In **Project Settings → Script Properties** (never chat/GitHub):
   - `GEMINI_SANDBOX_BACKUP_FOLDER_ID`: `1HCt-2k_Yco2MsZyG7uflkhEpudJyoomo`.
   - `GEMINI_SANDBOX_BACKUP_HMAC_KEY`: private random 32+ character value.
3. Review Apps Script access: `DriveApp` requests broad Google Drive permissions despite being coded to operate only in the dedicated folder. Prefer a separate backup-only Google account for stronger isolation. Do not authorize on a production data-bearing account without accepting this tradeoff.
4. Deploy Web App as owner with URL ending `/exec`; allow external POSTs solely because the handler independently verifies HMAC, timestamp and replay nonce.
5. Store the following as server-side Render secrets on Gemini SANDBOX ONLY:
   - `GEMINI_SANDBOX_DRIVE_BRIDGE_URL`: new Apps Script `/exec` URL.
   - `GEMINI_SANDBOX_DRIVE_HMAC_KEY`: identical private HMAC key from step 2.
   - `GEMINI_SANDBOX_DRIVE_ENCRYPTION_KEY_B64`: 32 random bytes base64-encoded.
   Generate the AES key locally; also store a backup in an OFFLINE password manager/recovery vault independent of Render and Drive. Without this key **you cannot decrypt** stored archives. Never paste it in the chat or commit it to GitHub.
6. **Before any redeploy or restart**, export the full CURRENT sandbox snapshot from its admin-only `GET /api/admin/sandbox-backup` endpoint. Verify the checksum and securely save this original snapshot separately (or upload it encrypted under the new private folder). This step cannot be skipped just because future automated backups are implemented.
7. Only after step 6 is verified, deploy a new sandbox build; run authenticated `POST /api/admin/drive-backup/now`, check `status.lastVerifiedUploadAt`, locate the encrypted Drive file, and test restore into a separate EMPTY fake-data environment.
8. Keep production read-only. No production data, Google OAuth access token or real customer message may enter the Gemini Free Tier.

**Important:** Google Drive here is backup storage, **not** a fully transactional live database; it does not guarantee against every concurrent write or lost order within the pending backup window. A go-live ordering system needs durable transactional persistence, point-in-time recovery monitoring and post-deploy validation.

No snapshots are claimed complete or durable until a real remote upload plus restore both PASS.
