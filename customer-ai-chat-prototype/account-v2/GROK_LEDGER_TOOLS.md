# Grok connector "Minh Satori PDF Zalo-xai": ledger tools + soft cancel

Same MCP endpoint (`/mcp/grok/<SATORI_GROK_MCP_TOKEN>`). Every read goes through the signed
read transport (`satori-readonly.mjs`) to the SAME Apps Script actions as the ChatGPT connector.

## Tools

| Tool | Input | Writes? | Apps Script action (key scope) |
|---|---|---|---|
| satori_system_status | – | no | system.status (orders:read) |
| satori_find_customer (upgraded) | query | no | orders.list (orders:read) |
| satori_orders_list | customer?, days?/from?/to?, status? (all/unpaid/paid/cancelled), limit? | no | orders.list |
| satori_order_get | invoiceNo / orderId | no | orders.list (exact number + id) |
| satori_invoice_pdf | invoiceNo | no | orders.list + V2 pdfmake (official template) |
| satori_products_search | q | no | catalogue.list (catalogue:read) |
| satori_debt_summary | days?/from?/to? (none = all time) | no | **debt.summary (debt:read)** |
| satori_customer_debt | customer or customerRef, days=30 | no | **debt.summary** + orders.list |
| satori_debt_statement_pdf | customer?/customerRef?, days=30 | no | **debt.summary** + orders.list |
| satori_order_audit_history | invoiceNo | no | **orders.auditHistory (orders:read + owner/admin role)** |
| satori_order_preview_update | invoiceNo, reason, order | no (preview on a copy) | **orders.previewUpdate (orders:update + owner/admin)** |
| satori_trash_list | query | no | trash.list (orders:read) |
| satori_order_cancel_request / _restore_request / _trash_request | invoiceNo/orderId, reason | no (PostgreSQL request only) | orders.list / trash.list |
| satori_order_cancel_confirm | requestId | **yes: status "Đã hủy"** | **orders.cancel (orders:cancel) via V2 WRITER key** — new |
| satori_order_trash_confirm | requestId | **yes: into 30-day trash bin** | **orders.delete (orders:delete) via V2 WRITER key** — existing |
| satori_order_restore_confirm | requestId | **yes: out of trash bin** | orders.restore (orders:write) via V2 WRITER key — existing |

Listing: reads appear when `GROK_OWNER_WRITES_ENABLED=1` (or `GROK_OWNER_READS_ENABLED=1` for
reads only). Cancel tools only with `GROK_OWNER_WRITES_ENABLED=1`; confirm re-checks it at call time.
`satori_order_draft` / `satori_order_confirm` are unchanged (legacy `approvalCode` still ignored).

## PDF delivery to Grok
Each PDF tool returns (1) an embedded MCP resource `application/pdf` (base64, ≤1.5 MB) and
(2) `downloadUrl` = `/mcp/grok-files/<payload>.<HMAC>`: expires in 15 minutes, signed with a sub-key
derived from `SATORI_GROK_MCP_TOKEN`, carries only kind + invoice number/ledger id + day window
(no names/phones), re-renders from the ledger on download, stores nothing. Origin =
`SATORI_PUBLIC_BASE_URL` if set, else the request Host (https).

## HỦY ≠ XÓA (owner rule)
- **HỦY** (`satori_order_cancel_*`): same as the app's status "Đã hủy". The invoice stays in the
  system (list, PDF archive, history); its effective amount is 0 đ: the app, BotApi `active()` and
  AccountingCore already exclude "Đã hủy" from debt, bill totals, revenue and profit. Lines and the
  original total are NOT changed (traceability); outputs show `total` (original) and `effectiveTotal: 0`.
  The cancel audit (`satori_order_cancel_audit_v1`) stores previous status, originalTotal, who, when, why.
- **XÓA** (`satori_order_trash_*`): the app's existing Thùng Rác: BotApi `orders.delete` moves the row
  into `satori_trash_bin_v15` for 30 days (gone from list and debt, exactly like the app's Xóa button).
  **KHÔI PHỤC** (`satori_order_restore_*`) = existing `orders.restore`. Never a hard delete.
- All three: request (nothing written to the ledger) → owner "ok" → confirm. Row lock = one dispatcher;
  fixed requestId per request (BotApi replays it, a second confirm never acts twice); 30-minute TTL;
  blocked when `GROK_OWNER_WRITES_ENABLED` is off; local audit in `satori_v2_grok_write_requests`
  (kind, reason, requested_by, confirmed_by, confirmed_at, done_at, ledger_revision).
- **Paid invoices: still refused** for cancel and delete. The app's status menu can mark a paid invoice
  "Đã hủy", but the system has no credit-balance ("dư có") or refund mechanism, so the paid amount would
  silently disappear from all reports; BotApi `orders.delete` itself refuses paid invoices. Grok explains
  this; the owner can still decide in the app. CTV-pair invoices are refused too (same as orders.delete).

## Owner steps before it works in production (NOT done by this PR)
**Superseded by the safer add-on route:** step-by-step for the Apps Script Editor is in `docs/APPS_SCRIPT_DEPLOY_GROK_LEDGER.md`. `SatoriBotApi` is NOT edited; `api/BotApiGrokLedger.gs` answers only `orders.cancel` / `orders.auditHistory` behind the Script Property switch `SATORI_GROK_LEDGER_ENABLED=1`, via one line at the top of `doPost(e)`. The 3 in-BotApi edits listed in step 1 below are no longer needed.
`orders.auditHistory` is implemented in `api/BotApiOrderAuditHistory.gs` and requires `orders:read` **and** `"role":"owner"` on the key (admin is not accepted).
1. Apps Script (cancel only; delete/restore already exist): add `api/BotApiOrderCancel.gs` to the BotApi project, then in `BotApi.gs`:
   - `SCOPES`: `'orders.cancel':'orders:cancel'`
   - `write()`: `action==='orders.cancel'?SatoriOrderCancel.cancel(s,all,p,actor):` before the payment fallbacks
   - `handle()`: add `identity.action==='orders.cancel'` to `isWrite`
   Deploy a new version after review.
2. Grant `orders:cancel` and `orders:delete` to the **V2 writer key only** (`SATORI_V2_CANONICAL_WRITE_KEY_ID`);
   it already has `orders:write` (create, restore).
3. Grant the **V2 read key** `debt:read` (debt tools) and owner/admin role (audit history).
   `orders.previewUpdate` needs `orders:update` on that key: only grant it if accepted that a
   leaked read key could then call `orders.update` directly; otherwise leave the tool failing closed.
4. Migration `20261115_grok_owner_write_requests.sql` is additive and runs automatically
   (`ensureOwnerPushSchema`) on first MCP call.

Until steps 1–3 are done the affected tools fail closed with a clear message; nothing is written.
