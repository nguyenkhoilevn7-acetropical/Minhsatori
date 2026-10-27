# Minh Satori — separate payment HTTP sandbox deployment ONLY

**Purpose:** Real Apps Script Web App HTTP endpoint for payment tests with **fake invoices only**. This is a *separate, new Apps Script project*, not the existing `MinhSatori_Bot_Write_Sandbox_ONLY` and not owner-only V18.3.

**Status:** Source and isolated in-process Node tests only. Not deployed. Do not claim live ChatGPT can mark Satori paid until its plugin tool schema is refreshed and production integration separately approved.

## Minimal steps for Work / authorized operator

1. Create a **NEW** Apps Script project named `MinhSatori_Payment_HTTP_SANDBOX_ONLY`. Do not reuse any existing project, properties or deployment.
2. In this NEW project, create `BotApi.gs` by copying the exact pinned code from:
   https://raw.githubusercontent.com/nguyenkhoilevn7-acetropical/Minhsatori/39b63f46e8c4ec76365db00abb0fcdae97f4cb6b/api/BotApi.gs
   It already supplies the `doPost` handler, and may reference optional modules for denied commands. Do **not** paste a second `doPost`.
3. Create `PaymentHttpSandboxEnv.gs` from this repository's matching `api/sandbox/PaymentHttpSandboxEnv.gs` file. It defines fake-only `readState_()`, two strictly marked sample invoices with intentionally duplicated invoiceNo, a native setup guard, and the HTTP smoke test.
4. Run `setupIsolatedPaymentHttpSandbox` **once only** from editor. Confirm it returns `ok:true, sandboxOnly:true, fakeInvoiceCount:2, initialBackupMatches:true`. It refuses any project with an existing `STATE_FILE_ID` or `SATORI_BOT_CLIENTS_JSON`. It generates and privately stores a dedicated random HMAC secret; **never display or copy that secret to chat**.
5. Create a **new** Web App deployment inside only this NEW sandbox project. Execute as owner; permit HTTP external access only if the caller needs unauthenticated Google routing. The API itself requires HMAC on every call; use no real production data. Record its version and test-only deployment link privately. No change to V18.3 deployments.
6. Run `runIsolatedPaymentHttpSmokeTest` from that NEW project. It signs real HTTP POST requests via `UrlFetchApp` with the sandbox's private key, uses real Google Drive **fake** file, changes four payment states, reads back exact flags, checks duplicate numbers, and restores bytes. PASS criteria: `ok:true`, `failed:0`, `passed:20`, `successfulHttpWrites:4`, `lastFakeRevision:5`, `restoredExactly:true`, `productionAccess:false`. Independently read `SATORI_PAYMENT_HTTP_E2E_REPORT.json` in its new Drive sandbox folder.
7. Disable/limit public sandbox endpoint after the test if no further test traffic is planned. Do not promote or copy its fixture HMAC credentials to production. Update GitHub #161 with actual execution evidence and endpoint version **without secrets**.

If native execution or signed HTTP fails, stop and report FAIL, do not repeat blind deploys.

## Explicit non-goals

- No changes to legacy accounting V18.3 or any of the 123 historical invoices.
- No production `STATE_FILE_ID`, App Script deployment, HMAC key, Android or Render service changes.
- No connector schema refresh is done by this source; a separate deployment of `connector/lib/satori.mjs` is required to register the three missing ChatGPT payment commands.
- Before any production payment tools are enabled: independent prewrite production backup and owner approval, HMAC permissions, invoice identity, audit, readback and rollback.
