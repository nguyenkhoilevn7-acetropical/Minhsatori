# Grok → Zalo PDF delivery (Phase A)

## What it does
Every NEW verified canonical invoice (the same ones that trigger the owner push)
gets exactly one row in `satori_v2_owner_pdf_deliveries`. Grok, running on the
owner's computer with Zalo Desktop open, works the queue:

1. `satori_pending_pdf_deliveries` (this connector) → `deliveryId`, `invoiceNo`,
   `ledgerId`, `recipientName`, `orderDate`, `fileName`, `ownerDownloadPath`, `zaloText`.
2. `satori_invoice_pdf` (existing **minh-satori** connector) with
   `id = ledgerId`, `invoiceNo` → official PDF.
3. **Prefer an authenticated owner browser download**:
   open `https://minh-satori-v2-customer-admin.onrender.com` + `ownerDownloadPath`
   in a browser currently signed in as OWNER. The server reads the exact
   canonical signed ledger PDF and returns an HTTP attachment with the correct
   UTF-8 `Content-Disposition`. This avoids any UUID prefix added by an
   AI/chat attachment host. Never forward an AI temporary file directly.
   If using a connector's local PDF instead, **rename the physical file before
   sending to Zalo Desktop** to match
   `fileName` from the queue, for example `5988 - Traky Sài Gòn - 2026-11-12.pdf`.
   This is derived from the verified ledger `invoiceNo`, delivery recipient and
   original order date `orderDate`. Never use a UUID, ledger ID, delivery ID,
   temporary download path, archive hash or current download date in the filename.
   A pre-migration row can have `fileName=null`: verify the original date from
   the official PDF, otherwise mark failed and ask the owner instead of guessing.
   Send the PDF with exactly `zaloText` (two lines: invoice number, recipient)
   to the person/group the owner designated.
4. Only after Zalo accepts the file and its actual filename is inspected,
   call `satori_mark_pdf_delivered` with `deliveryId`, `status:"sent"`, and
   `actualFileName` **exactly equal to `fileName`** in the delivery queue.
   UUID-prefixed, omitted or mismatched names are rejected and must not be
   recorded as delivered. Otherwise mark `failed` (retried later) or
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
"Kiểm tra satori_pending_pdf_deliveries. Lấy ownerDownloadPath để tải PDF
trực tiếp trong trình duyệt đã đăng nhập Owner. Không dùng file đính kèm tạm
của AI. Kiểm tra tên file thật khớp fileName rồi gửi đúng người/nhóm trên Zalo.
Sau khi đã gửi và xác nhận tên, gọi satori_mark_pdf_delivered với
actualFileName=fileName. Nếu chưa xác minh được, ghi failed và báo anh."

## Limits (honest)
- A Grok chat is not an always-on watcher: deliveries wait in the queue until
  Grok is asked (or a Grok scheduled task runs) while the computer and Zalo
  Desktop are open. Nothing is lost or duplicated while waiting.
- Rows older than 7 days or with 10 failed attempts are no longer offered.

## Phase B: owner creates real orders in Grok (`GROK_OWNER_WRITES_ENABLED=1`)

Same connector URL. With the flag set, four more tools appear:

1. `satori_find_customer` (read): past delivery destinations by name/phone -> `customerRef`.
2. `satori_order_draft`: the server prices the order (goods, VAT, shipping, total) with the
   live `orders.create` rules and returns a summary plus a 4-digit approval code. Nothing is
   written to the ledger. VAT: none unless asked; order `vatRate` = invoice VAT on goods;
   line `vatRate`/`vatExempt` = optional per-line VAT.
3. `satori_order_confirm`: only after the owner types the code back. One signed
   `orders.create` through the isolated V2 writer, exact readback by requestId; repeated
   calls never create a second invoice. Then the owner push + PDF queue run as usual.
4. `satori_order_status`: reconcile a draft whose confirm returned `UNCERTAIN`.

Drafts expire after 30 minutes; 5 wrong codes cancel a draft. No payment, edit or delete
tool exists here. To turn it off: remove `GROK_OWNER_WRITES_ENABLED` on Render (the tools
disappear on the next deploy/restart).

Verification: `node --test account-v2/tests/grok-orders.test.mjs` (offline) and
`SATORI_BOTAPI_SOURCE=<clasp clone>/BotApi.js node account-v2/tests/grok-orders-ledger.mjs`
(real BotApi source in a vm sandbox + local PostgreSQL).

## Security and verification (2026-11-12)
- Owner PDF download route is **session-authenticated, owner-only, read-only**.
- It matches **both** immutable ledger ID and invoice number before rendering.
- Do not attach the file via ChatGPT/Grok file upload if the host prepends a UUID;
  instead download to Files and attach that physical, canonical-name PDF to Zalo.
- File attachment name within Zalo is controlled by the receiving app/OS. A
  server response cannot override a filename that Zalo itself renames on import.
- The sent-name gate rejects wrong filenames **as reported by the sender**; it
  cannot inspect the remote Zalo message, so the sender must verify it manually.
- Never run a real invoice write to test the download path.
