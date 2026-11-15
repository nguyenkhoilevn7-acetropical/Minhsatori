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
| satori_order_cancel_request | invoiceNo/orderId, reason | no (PostgreSQL request only) | orders.list |
| satori_order_cancel_confirm | cancelRequestId | **yes: status "Đã hủy"** | **orders.cancel (orders:cancel) via V2 WRITER key** |

Listing: reads appear when `GROK_OWNER_WRITES_ENABLED=1` (or `GROK_OWNER_READS_ENABLED=1` for
reads only). Cancel tools only with `GROK_OWNER_WRITES_ENABLED=1`; confirm re-checks it at call time.
`satori_order_draft` / `satori_order_confirm` are unchanged (legacy `approvalCode` still ignored).

## PDF delivery to Grok
Each PDF tool returns (1) an embedded MCP resource `application/pdf` (base64, ≤1.5 MB) and
(2) `downloadUrl` = `/mcp/grok-files/<payload>.<HMAC>`: expires in 15 minutes, signed with a sub-key
derived from `SATORI_GROK_MCP_TOKEN`, carries only kind + invoice number/ledger id + day window
(no names/phones), re-renders from the ledger on download, stores nothing. Origin =
`SATORI_PUBLIC_BASE_URL` if set, else the request Host (https).

## Soft cancel
1. request: exact invoice; refuses paid (customer or Satori), "Đã hủy"/"Không Tính", CTV pair.
   Stores `satori_v2_grok_cancel_requests` (30-minute TTL). Ledger untouched.
2. owner replies "ok" → confirm: row lock, fresh re-read (name/total unchanged, still unpaid),
   ONE signed `orders.cancel` with the request's fixed requestId, exact readback ("Đã hủy").
   Second confirm → `duplicate:true`, no second cancel. Lost reply → UNCERTAIN, retry is safe
   (Apps Script replays by requestId). Never deletes; row + history kept.

## Owner steps before it works in production (NOT done by this PR)
1. Apps Script: add `api/BotApiOrderCancel.gs` to the BotApi project, then in `BotApi.gs`:
   - `SCOPES`: `'orders.cancel':'orders:cancel'`
   - `write()`: `action==='orders.cancel'?SatoriOrderCancel.cancel(s,all,p,actor):` before the payment fallbacks
   - `handle()`: add `identity.action==='orders.cancel'` to `isWrite`
   Deploy a new version after review.
2. Grant `orders:cancel` to the **V2 writer key only** (`SATORI_V2_CANONICAL_WRITE_KEY_ID`).
3. Grant the **V2 read key** `debt:read` (debt tools) and owner/admin role (audit history).
   `orders.previewUpdate` needs `orders:update` on that key: only grant it if accepted that a
   leaked read key could then call `orders.update` directly; otherwise leave the tool failing closed.
4. Migration `20261115_grok_cancel_requests.sql` is additive and runs automatically
   (`ensureOwnerPushSchema`) on first MCP call.

Until steps 1–3 are done the affected tools fail closed with a clear message; nothing is written.
