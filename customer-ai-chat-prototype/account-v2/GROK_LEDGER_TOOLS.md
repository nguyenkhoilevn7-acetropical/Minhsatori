# Grok connector "Minh Satori PDF Zalo-xai": same capabilities as ChatGPT

Owner decision 2026-11-16: Grok does exactly what the ChatGPT connector can do in Minh Satori,
using ONLY the existing production Apps Script actions (`apps-script/production-snapshot-20261115/BotApi.gs`).
No new ledger function: there is **no HỦY (orders.cancel)**; status "Đã hủy" is changed in the app only.

Same MCP endpoint (`/mcp/grok/<SATORI_GROK_MCP_TOKEN>`). Reads use the signed READ transport
(`satori-readonly.mjs`, V2 read key). Edits, previews and payments use the isolated V2 WRITER relay
(`grok-owner-writes.mjs`), never the read key.

## Tools

| Tool | Writes? | Production action (key, scope) |
|---|---|---|
| satori_system_status, satori_find_customer, satori_orders_list, satori_order_get, satori_invoice_pdf | no | system.status / orders.list (READ, orders:read) |
| satori_products_search | no | catalogue.list (READ, catalogue:read) |
| satori_debt_summary, satori_customer_debt, satori_debt_statement_pdf | no | debt.summary (READ, debt:read) + orders.list |
| satori_order_audit_history | no | orders.auditHistory (READ, orders:read + role owner) |
| satori_trash_list | no | trash.list (READ, orders:read) |
| satori_order_preview_update | no (production dry-run on a copy) | orders.get + orders.previewUpdate (WRITER, orders:read/orders:update + role owner) |
| satori_order_update_request → _confirm | yes after owner "ok" | orders.update (WRITER, orders:update + role owner) |
| satori_order_undo_update_request → _confirm | yes after owner "ok" | orders.undoUpdate (WRITER, orders:update + role owner), latest edit only |
| satori_payment_request → _confirm (change = customer_paid / customer_unpaid / satori_paid / satori_unpaid) | yes after owner "ok" | payments.markCustomerPaid / markCustomerUnpaid / markSatoriPaid / markSatoriUnpaid (WRITER, payments:write) |
| satori_order_trash_request → _confirm | yes after owner "ok" | orders.delete (WRITER, orders:delete), 30-day trash bin |
| satori_order_restore_request → _confirm | yes after owner "ok" | orders.restore (WRITER, orders:write) |
| satori_order_draft → satori_order_confirm | yes after owner "ok" | orders.create (unchanged) |

Listing: read tools with `GROK_OWNER_WRITES_ENABLED=1` or `GROK_OWNER_READS_ENABLED=1`; every tool that
uses the WRITER key (including the preview) only with `GROK_OWNER_WRITES_ENABLED=1`, re-checked at call time.
The WRITER relay can sign only: orders.delete, orders.restore, orders.update, orders.undoUpdate,
orders.previewUpdate, orders.get, payments.mark{Customer,Satori}{Paid,Unpaid}.

## Every write: request → owner "ok" → confirm
- Request reads the exact invoice, applies the same refusals as production (edits are dry-run through
  production `orders.previewUpdate`), stores a 30-minute row in `satori_v2_grok_write_requests`
  (draft in `payload` jsonb) and returns a summary. Nothing is written to the ledger.
- Confirm: row lock (one dispatcher), fresh re-read, ONE signed call with the request's fixed requestId
  (production replays it: a second confirm never acts twice), readback (edit log / payment flags / trash).
- Edits: unpaid, active, non-CTV invoices only; `items` must be complete; `priceMode` required (like ChatGPT);
  customer/delivery/VAT fields not given are kept from the current invoice; an invoice that carries VAT must
  state `vatRate` (otherwise refused, VAT is never dropped silently). Production keeps before/after in
  `satori_order_edit_audit_v1`; undo restores the exact previous invoice.
- Payments: administrative marks only (no money moves). customer_paid records the full invoice total;
  unmark actions keep the old facts in the invoice `paymentAudit`. Cancelled invoices and internal CTV bills are refused.
- Migration `20261116_grok_write_parity.sql` (additive: `payload` column, wider `kind` list) runs
  automatically (`ensureOwnerPushSchema`).

## Owner steps (NOT done by this PR) — see `docs/GROK_CHATGPT_PARITY_SETUP.md`
1. Apps Script code: nothing new. If the editor still contains the 2026-11-15 `orders.cancel` edits
   (3 lines in BotApi.gs + file BotApiOrderCancel), remove them.
2. Script Properties `SATORI_BOT_CLIENTS_JSON` (one-time helper `api/GrokLedgerScopesSetup.gs`):
   WRITER key + orders:delete, orders:update, payments:write, role "owner"; READ key + debt:read, role "owner".
   Never give orders:update (or any write scope) to the READ key.
3. Deploy the server (Render) after review. Until step 2 is done the write tools fail closed with
   "Khóa ghi V2 chưa được cấp quyền…"; nothing is written.

## PDF delivery to Grok
Each PDF tool returns (1) an embedded MCP resource `application/pdf` (base64, ≤1.5 MB) and
(2) `downloadUrl` = `/mcp/grok-files/<payload>.<HMAC>`: expires in 15 minutes, signed with a sub-key
derived from `SATORI_GROK_MCP_TOKEN`, carries only kind + invoice number/ledger id + day window
(no names/phones), re-renders from the ledger on download, stores nothing. Origin =
`SATORI_PUBLIC_BASE_URL` if set, else the request Host (https).
