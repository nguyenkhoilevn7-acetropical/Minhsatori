# Minh Satori Grok staging review — 16 November 2026

## Connection decision

Live Grok settings were inspected, without changing connectors or sending messages. The connected custom app was **Minh Satori PDF Zalo**, pointing to the V2 host and `/mcp/grok/<private-token>`. Grok displayed six legacy tools. This is evidence of Grok's configured/cached discovery, not proof of the running server commit.

Keep **V2 as the single Grok invoice-writing path**. Do not enable a second OAuth invoice writer. The GitLab OAuth service and bridge remain separate readers; MR !11 was reviewed but not deployed to production. Its 34 synthetic tests and pipeline 3071608530 pass. It fixes the hardcoded `orders.get` allowlist/validation gap; no environment switch alone fixes METHOD_DISABLED.

ChatGPT, Android, website and Grok must use the same official Apps Script ledger `satori_orders_v15`. PostgreSQL stores V2 account, request, audit and outbox state; it is not a replacement invoice ledger.

## Deployed staging

- Workspace: ACE Tropical Staging (`tea-dbnusqqjnfac73df60tg`).
- Service: `srv-dbt6rse7bikc73d7htq0`, free plan, Singapore, auto-deploy OFF.
- URL: https://minh-satori-grok-synthetic-staging.onrender.com/
- Verified live deploy: `dep-dbt6tn5g1s2s738up1rg`, application commit `f2f7c5fb77b87bad5e6579bf8988715d5ad79752`.
- Actual V2 MCP handlers, real HMAC transports and production-snapshot BotApi execute against synthetic in-memory Drive state. PostgreSQL is disposable, localhost-only and contains fake test/request data. No real invoice or real customer was copied.
- Public fake-data playground: 29 MCP tools, explicit manual request/confirm examples. The public synthetic endpoint is not a production credential or an authenticated Owner account. Never use its identity or configuration for live data.
- No live Apps Script transport, production secrets, FCM sender or Zalo sender. Incoming live transport configuration is rejected at startup. Restart resets the environment.

## Verification

- Full local account-v2 suite: **482 PASS, 0 fail, 0 skipped**.
- Commit f2f7c5f: all **4 GitHub workflows PASS**, including Account V2 domain/browser/PostgreSQL tests. Account run: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/actions/runs/43794320126
- Staging container: 481 PASS, 0 fail, 1 skip. The omitted `api/OwnerPushWake.gs` signature test is covered by full-repository local/CI runs; it is not claimed as a container pass.
- Migration executed twice on disposable PostgreSQL; both readbacks pass. Grok additive request migrations and JSONB audit also pass real PostgreSQL tests.
- Production-snapshot creation suite: 11 scenarios PASS, including per-line VAT, immutable requestId readback, lost replies, expiry and recovery.
- Real PostgreSQL: five concurrent confirms plus retry cause one payment write; JSONB audit round-trip, trash/restore and disabled-write gate pass.
- PDF delivery MCP: 6 scenarios PASS, including queue uniqueness, failed retry, sent finality, authorization and filename checks. These use fake delivery results; no Zalo transmission occurs.
- Focused independent code review found and verified fixes for shared-reader concurrency, health checks queued behind bodies, restart directory reuse and missing PDF logo.

Direct HTTPS MCP smoke run completed successfully against live staging, synthetic invoice #508:

| Requested function | Result |
|---|---|
| Discover tools / find products / exact invoice read / search | PASS, 29 tools |
| Create / per-line VAT / duplicate confirm | PASS, one synthetic invoice |
| Preview / edit / audit / undo | PASS, exact prior total restored |
| Customer paid/unpaid; Satori paid/unpaid | PASS, all four directions |
| Two flags in one approved request / confirm replay | PASS |
| Debt totals / debt PDF / invoice PDF | PASS |
| Trash / list trash / restore | PASS |
| New-invoice PDF queue | PASS, queued only; nothing sent |
| Signed invoice PDF download / canonical filename | PASS, PDF bytes verified |
| Concurrent MCP batch reads | PASS |
| Wrong MCP token | HTTP 404 |
| Readiness | HTTP 200, syntheticOnly=true, officialLedgerConnected=false, zaloSender=false |

Reproduce with `python customer-ai-chat-prototype/account-v2/staging/smoke.py`. This command targets only the fixed fake-data staging host and checks its synthetic-only health marker before making changes. The playground uses explicit manual confirms; the automated smoke script confirms synthetic requests under the user's test authorization. It is not an approval mechanism for production.

## Permissions and configuration required before production

These are required names/contracts, **not claims that their current live values were verified**:

| Layer | Required configuration |
|---|---|
| V2 connector | `SATORI_GROK_MCP_ENABLED`, existing private `SATORI_GROK_MCP_TOKEN`, `GROK_OWNER_READS_ENABLED`, `GROK_OWNER_WRITES_ENABLED` |
| V2 reader | `SATORI_READ_ENDPOINT`, `SATORI_READ_KEY_ID`, `SATORI_READ_HMAC_SECRET`; role owner; `orders:read`, `debt:read`, `catalogue:read` as needed |
| V2 writer | `SATORI_V2_CANONICAL_WRITES_ENABLED`, `SATORI_V2_CANONICAL_WRITE_ENDPOINT`, `SATORI_V2_CANONICAL_WRITE_KEY_ID`, `SATORI_V2_CANONICAL_WRITE_SECRET`; role owner; existing creation/read scopes plus `orders:update`, `orders:delete`, `payments:write` |
| Apps Script clients | `SATORI_BOT_CLIENTS_JSON`; separate reader/writer identities; never grant writer scopes to reader |
| Optional GitLab reader | `SATORI_V1_KEY_ID`, selected client owner/admin role and `orders:read`; keep `ENABLE_ORDER_WRITES`, `ENABLE_ORDER_UPDATES`, `ENABLE_ZALO_SEND` disabled |

Still blocked from claiming live feature availability: compare the actually deployed Apps Script version with snapshot #430 (snapshot is editor HEAD); verify live reader/writer roles/scopes privately; deploy approved V2 code; refresh Grok discovery and inspect the resulting tools. No live scope grants or production configuration changes were made in this task.

## Production sequence — approval required, not executed

1. Owner reviews #430, #431 and this staging PR. Preserve stacked dependencies; do not blindly merge or retarget.
2. Record current V2 deploy/commit, database backup and client-scope backup. Verify the actual deployed Apps Script actions match the tested existing contracts. Do not introduce orders.cancel or a second invoice system.
3. Apply only approved additive V2 request migrations, verify JSONB/kind constraints and old-row compatibility. Verify reader/writer isolation and add missing scopes only after approval.
4. Deploy the existing production V2 entrypoint, **never** the synthetic Docker entrypoint. Preserve the existing private connector URL. Leave GitLab invoice writes off.
5. Refresh Grok tools; read-only checks first. Any real invoice create/edit/payment/trash/restore needs a separate clear Owner confirmation after its summary. Do not send Zalo without explicit approval for the exact PDF/destination.

## Rollback

Set `GROK_OWNER_WRITES_ENABLED=0` to stop new Grok writes, retain reader availability if configured, then roll the V2 service back to its recorded prior deploy. Restore the backed-up Apps Script client roles/scopes if they were changed. Keep additive SQL columns and request/audit records; do not run destructive down-migrations. A code rollback does **not** undo ledger mutations or messages: reconcile any uncertain request by its original requestId, never retry with a new ID. Staging can be suspended independently without affecting the official system.
