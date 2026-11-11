# Grok → Zalo PDF delivery (Phase A)

## What it does
Every NEW verified canonical invoice (the same ones that trigger the owner push)
gets exactly one row in `satori_v2_owner_pdf_deliveries`. Grok, running on the
owner's computer with Zalo Desktop open, works the queue:

1. `satori_pending_pdf_deliveries` (this connector) → `deliveryId`, `invoiceNo`,
   `ledgerId`, `recipientName`, `zaloText`.
2. `satori_invoice_pdf` (existing **minh-satori** connector) with
   `id = ledgerId`, `invoiceNo` → official PDF.
3. Send the PDF with exactly `zaloText` (two lines: invoice number, recipient)
   to the person/group the owner designated.
4. `satori_mark_pdf_delivered` with `sent`, `failed` (retried later) or
   `skipped`. A `sent` delivery is final and never re-queued.

No invoice, payment, VAT, shipping or ledger write exists on this connector.

## Enable (Render, service minh-satori-v2-customer-admin)
- `SATORI_GROK_MCP_ENABLED=1`
- `SATORI_GROK_MCP_TOKEN` = random URL-safe string, at least 40 characters (secret)

grok.com → Plugins → Connectors → New Connector → Custom Connector:
- Name: `Minh Satori PDF Zalo`
- Server URL: `https://minh-satori-v2-customer-admin.onrender.com/mcp/grok/<SATORI_GROK_MCP_TOKEN>`

The URL is the credential: keep it private; rotate the token to revoke access.

## Suggested owner instruction to Grok
"Kiểm tra satori_pending_pdf_deliveries. Với từng mục: lấy PDF bằng
satori_invoice_pdf, gửi PDF kèm đúng zaloText vào nhóm Zalo [tên nhóm] cho
[người nhận], rồi gọi satori_mark_pdf_delivered. Nếu không gửi được thì đánh
dấu failed và báo anh."

## Limits (honest)
- A Grok chat is not an always-on watcher: deliveries wait in the queue until
  Grok is asked (or a Grok scheduled task runs) while the computer and Zalo
  Desktop are open. Nothing is lost or duplicated while waiting.
- Rows older than 7 days or with 10 failed attempts are no longer offered.
