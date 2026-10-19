# Minh Satori Bot activation checkpoint — 2026-10-19

## Verified
- Opened existing Apps Script project `1eNEyHXe891ziuT4UY9ij-FellKSZ7Psi8y-5q0O2aiRaOsTA5x-eXOZg` (Minh Satori Drive Sync).
- Backed up current Code.gs, appsscript.json and non-secret Script Properties on the owner's private Drive. Code.gs was compared with its pre-change copy and is unchanged. Never ran setupDrive or replaced STATE_FILE_ID.
- Independently compared complete production bytes with a new pre-deployment backup and a separate restore drill. Revision 96, 111 orders, all state fields retained. SHA256: `429c75b41c26d36a3ada0ab6ed45ba2f62e5cdb8f1dcce7e76eeff607d966582`.
- Native owner-run Apps Script tests exercised real sandbox Drive files: HMAC, scopes, replay, create/idempotency/stale revision, prewrite backups, soft-delete/trash, payment protection, merge conflicts and restoration. No production invoice was created, paid or deleted by these tests.
- Owner-runtime signed handlers for system.status, customers.search, orders.list and debt.summary read production successfully. This is **not** an external HTTP end-to-end test.
- Two existing low CTV reference bills were discovered. API debt.summary now shares the website's accounting core and excludes reference bills using the full state before applying filters. Ambiguous groups remain visible with reviewCount. Payment modeling remains full-paid/unpaid only.

## Deployment boundaries
- Website deployment was not changed.
- Separate API deployment created with access **Only myself**, Execute as owner. External machine access and production HMAC client are not activated.
- Private ChatGPT plugin host: https://minh-satori-bot-connector.earlygoby8.chatgpt.site
- Plugin ID: `plugin_asdk_app_sites_6d9999a280548191bca504ecc83945ac` (platform reports installed). Host published successfully with MCP capability; tests verify request signing, validation, write gating and no automatic mutation retries.
- Host has no production HMAC secret configured. Writes remain disabled. A service-token probe of /mcp returned HTTP 401; installed-plugin OAuth/tool availability must be verified separately. Do not claim a live ChatGPT-to-Drive connection yet.

## Remaining activation
1. Action-time approval for a dedicated internet-callable POST deployment protected by HMAC, preserving owner checks and the original website deployment.
2. Provision a random production client through Script Properties; transfer the same secret through protected runtime settings to the private plugin server. Never place it in source, GitHub, HTML, localStorage, logs, URLs or conversation output.
3. Start with read scopes, configure the exact /exec endpoint, call an externally signed system.status and compare revision/count with Drive. Verify owner-only doGet and unsigned/invalid POST rejection.
4. Verify tool call from the installed ChatGPT plugin. Only then enable requested write scopes after the sandbox/restore evidence is rechecked. No real invoice deletion for testing.

## Files to add to the existing Apps Script project
- BotApi.gs
- AccountingCore.gs (must match repository accounting-core.js)
- BotApiSandbox.gs (owner-protected manual test helpers; never run setupDrive)

All writes from website and API must continue using the same script lock in this project. GitHub updates are only for code changes; normal bot operations use the API.
