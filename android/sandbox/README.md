# Minh Satori Android Mobile API — SANDBOX ONLY

Test Apps Script editor: https://script.google.com/home/projects/1HsFrHUyWava8fbpM5el8f1uFiAIG2yZbE4lVgJrtbBsC1NiEXgnS6A3D/edit

Source: `MinhSatori_Mobile_API_Sandbox_Code.gs` (standalone combined script).
It is hard-pinned to a private Drive file containing only **3 fake invoices**.
There is no route to the real invoice Drive file.

## Owner activation from Samsung Chrome desktop mode

1. Open the script project editor above.
2. Open the sandbox source file in GitHub, tap **Raw**, select/copy entire file.
3. Replace the default `myFunction()` contents in `Code.gs` with the full source and save.
4. From the function dropdown select `setupMobileSandbox`, press **Run**, and authorize as the owner. This sets `STATE_FILE_ID` to the fake-only file and sets `SATORI_ANDROID_OWNER_EMAIL` from the authorized account. If a non-sandbox ID already exists, it refuses to overwrite it.
5. Open **Project Settings > Script properties**. Add **one** property:
   `SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON` = `["<exact Android OAuth Client ID>.apps.googleusercontent.com"]`.
   The Android OAuth client ID can be copied from Google Cloud > Google Auth Platform > Clients. It is not a secret. No HMAC credentials in the APK.
6. Deploy > New deployment > Web app. Execute as **Me**, access **Anyone** (the endpoint verifies Google's access token, allowlisted Android client and owner's Google identity itself). Authorize and copy the new `https://script.google.com/macros/s/<ID>/exec` URL.
7. In a browser visit the `/exec` URL. It should report `environment:SANDBOX_FAKE_ONLY` and booleans `stateConfigured`, `ownerConfigured`, `oauthConfigured` = true. No customer records are returned.
8. In the signed v0.3.2 APK, open the gear > Mobile API > paste the exact `/exec` URL > sign in with the same Google account. Confirm only fake invoices before testing create/update/delete/payment/restore.
9. Never paste the `/exec` URL from the real production project during this stage.

Safety: The script rejects ALL other state file IDs on read and BEFORE write. This bundle is NOT suitable for production and must never be copied into the production Apps Script project. A separate audited production API deployment, read/write tests and renewed backup are required for business go-live.

If Chrome refuses pasting ~49 KB into the script editor, use GitHub raw source via the same Samsung phone, or switch to ChatGPT Work cloud browser for interactive code insertion. Do not use a runtime eval/bootstrap script that loads remote executable code.

CI test: `node tests/mobile-api-sandbox.test.cjs`; workflow Satori Server Bot API Tests checks its OAuth allowlist and fail-closed Drive isolation.
