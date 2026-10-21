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

## Installation checkpoint as of 2026-10-21 (SANDBOX ONLY)

- Standalone Google Apps Script was created by the owner and a Web App URL was provided: `https://script.google.com/macros/s/AKfycbzB-NNlJ7Zeq9t9WuWCWnoEUK79oRc50Zv4JaiZNFaMS_o-TOTapGtEialZlrOb6fT55A/exec`. Its live GET response, HMAC properties, and POST behavior remain **unverified from the current connector**.
- The owner saved two Script Properties in the Apps Script UI. **Do not read, recreate or disclose the existing HMAC secret.**
- A real standalone Sandbox JSON export from 2026-10-21T03:25:03.807Z was found in authorized Project files: format v1, 0 profiles, 0 change requests and 0 TEST orders; SHA-256 matches checksum `9ee9cfd0428593925eaec43677e210bd09faa085d729a62e6bb87b1a812d5975`. It is NOT proof that the currently running sandbox is still empty.
- Google Drive folder was verified EMPTY again. Render auto-deploy is OFF and latest live deployment is `b5298283c8b26a9d4782adcaea4ddb35d7a3c43e`, without the newer backup code. Render secret setup was begun in Work but `Save only` and all three variables are **not verified**.
- Staging Admin now has owner-only **Kiểm tra Drive** and **Sao lưu lên Drive** buttons, not yet live on Render. GitHub integration tests have passed.
- **No Render restart/deploy until current state comparison, correct secrets, and recovery plan are verified.**

## One-time owner-authorized setup checklist (partly completed)

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
