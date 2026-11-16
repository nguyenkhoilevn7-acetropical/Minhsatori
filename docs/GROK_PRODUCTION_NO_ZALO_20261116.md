# Production Grok rollout without Zalo

Owner authorized production rollout on 16 November 2026 and explicitly cancelled Zalo delivery.

Release branch stacks on #431 (which stacks on #430), not the synthetic staging entrypoint from #432. Use the existing V2 production Dockerfile/entrypoint and official ledger `satori_orders_v15`.

Set `GROK_PDF_DELIVERY_ENABLED=0` on the existing production V2 service. With Owner reads/writes enabled, MCP advertises 27 tools: the same tested invoice/read/payment/PDF capabilities without pending-delivery or mark-delivered tools. Calls to cached delivery tools are rejected. Initialization no longer tells Grok to send PDFs; successful creation no longer promises Zalo delivery. Scanning new invoices keeps ordinary Owner push events but stops creating PDF delivery queue rows. Existing queue/audit rows are retained.

Required preflight: capture the current production deploy and database/client-scope backups, verify the actually deployed Apps Script actions and separate reader/writer scopes, apply only approved additive V2 migrations, preserve the existing private connector URL. No real invoice writes are needed to verify tool discovery, signed reads or file downloads. Real invoice modifications always need a separate clear Owner confirmation after the summary.

Workspace resolution: Render reports service `srv-dbeuv50m7kps73f6ac40` belongs to **My Workspace** (`tea-db65rlid0e5s739ghkpg`), while the user's previously confirmed staging workspace was **ACE Tropical Staging** (`tea-dbnusqqjnfac73df60tg`). The provider requires user confirmation of the matching workspace before retrying access. No production access/configuration/deploy mutation was performed while this mismatch remains unresolved.

After workspace confirmation, verify CI, integrate reviewed dependent code into the production branch, set the delivery opt-out flag, deploy and verify 27-tool discovery and read-only operations. Refresh Grok's cached discovery if necessary. Do not enable the independent GitLab OAuth writer or any Zalo sender.

Rollback: disable `GROK_OWNER_WRITES_ENABLED`, restore the recorded V2 deploy and backed-up scopes as needed. Keep `GROK_PDF_DELIVERY_ENABLED=0` during rollback. Retain request/audit rows and additive SQL. Code rollback does not undo a ledger write.
