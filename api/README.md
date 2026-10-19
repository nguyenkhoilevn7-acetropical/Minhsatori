# Minh Satori API v1 (standalone backend)

A separate, versioned REST API for future ChatGPT/MCP, n8n, Zalo and Messenger integrations. It is NOT automatically connected to the current Google Apps Script / Drive application. Adding this directory does not modify the existing index.html or migrate any invoices.

## Security and data safety

- PostgreSQL is required. **No volatile local JSON file, browser storage or ephemeral disk** is used for authoritative API data.
- SHA-256 API key digests and granular scopes are configured by environment variables. Never put credentials in GitHub, frontend JavaScript or screenshots.
- Bearer credentials are for trusted server-to-server calls only, NOT browser JavaScript. For browser access, add a user/session authentication gateway instead.
- Write endpoints require Idempotency-Key to prevent duplicate retries. Editing requires expectedVersion to prevent lost updates.
- A legacy import is **one-time only**, preserves the complete original snapshot in import_backups, rejects duplicate IDs and zero records, and never overwrites existing data.
- An audit log records changes to invoices/payment states. Do not expose the audit endpoint to external bots.
- Never put the API live for invoicing until a verified Google Drive snapshot is migrated and frontend/Drive writes have been safely cut over. Otherwise two sources of truth would exist.
- Current public GitHub repository contains customer details in its legacy HTML. Review repository privacy and git history separately; this API does not fix earlier exposure.

## Setup

1. Provision a durable PostgreSQL database with backups enabled (on Render or another trusted provider). Verify service/storage costs and backup/restore policy.
2. In an isolated backend service, set Root Directory to api, Build Command to npm install, Start Command to npm start; require Node >=20.
3. Set DATABASE_URL and SATORI_API_KEYS privately through the host environment. PORT is provided by the host. Do not paste real keys into chat.
4. Use HTTPS for all remote access. Choose one key for the owner (admin) and separate scoped keys for bots.

Generate a random token and SHA-256 digest locally in a private terminal:

    node -e "const c=require('node:crypto');const s=c.randomBytes(32).toString('hex');console.log('TOKEN (show once):',s);console.log('SHA256:',c.createHash('sha256').update(s).digest('hex'))"

Example SATORI_API_KEYS value (REPLACE digest and never publish it):

    [{"id":"owner","sha256":"64_hex_char_digest","scopes":["admin"]},{"id":"bot-readonly","sha256":"another_64_hex_digest","scopes":["orders:read"]}]

Available scopes: orders:read, orders:write, payments:write, admin. Admin includes all scopes. Read-only keys may search customers and debts but cannot change invoices. Suggested setup: owner admin; accountant read + payments; data-entry bot read + write (no payments).

## Activation / legacy data migration

IMPORTANT: At the time this API was authored, the primary Satori website ran as a static client application with localStorage and a special Google Apps Script iframe bridge using a revision-based Drive sync protocol. The live authoritative Drive revision is NOT available through the repository. The 85 example orders embedded in index.html are NOT automatically treated as the latest records.

The API boots with initialized=false. Until an owner imports an authenticated, VERIFIED backup from the Drive application, invoice read/write routes return HTTP 503.

1. Export a **fresh, verified** complete snapshot from the live Drive-based app, including the satori_orders_v15 string and other settings (or an orders array, if a reviewed conversion has been performed). Compare the real order count, invoice IDs and last changed records with Drive. Save a second offline backup.
2. Pause editing on the old website for a short controlled cutover window, then recheck the Drive revision and snapshot so no intervening edits are missed.
3. POST the snapshot to /v1/admin/legacy/preview. Inspect checksum, count, invalidDates and duplicates.
4. POST /v1/admin/legacy/import with the IDENTICAL snapshot, preview checksum, expectedCount, and a meaningful sourceRevision, plus a unique Idempotency-Key. Import occurs in a single database transaction. Backups are captured BEFORE any order inserts. A failed import rolls back.
5. Compare API count, a sampling of historic invoices, payments and debt totals with the frozen Drive snapshot. Do NOT switch the website yet.
6. Implement a controlled frontend read/write adapter through authenticated sessions, then cut over both browser and bots to the single API source. Verify real-time updates across devices. Preserve original Drive backup and provide a rollback plan.
7. Only after confirming parity, retire the old Drive writer (or make it an explicit backup replica). **Do not run two independent writers**.

The API does not push records into the existing Google Apps Script Web App. That integration requires the Google-side source/authorized deployment and a separate, carefully tested migration step.

## Request format

All authenticated requests: Authorization: Bearer YOUR_PRIVATE_TOKEN.
Every POST or PATCH that changes data: Idempotency-Key: a-stable-unique-request-id.
For edits/payment transitions: expectedVersion from GET /v1/orders/{id}. If another device changed it, HTTP 409 asks the bot to fetch again.

Sample new order:

    POST /v1/orders
    {
      "date":"2026-10-19", "name":"Khách mẫu", "phone":"0900000000",
      "location":"Hồ Chí Minh", "items":[{"code":"TP-00001","product":"Satori 350ml","qty":2,"unitPrice":65000}],
      "shippingAmount":0, "vatAmount":0, "status":"Chưa thanh toán"
    }

The server calculates total when absent; if supplied, total must match items plus shipping/VAT (tolerance <= 1 VND). It allocates invoiceNo atomically. The consumer SHOULD present an order preview for user confirmation before calling the write endpoint.

Patch payment:

    PATCH /v1/orders/{api_id}/payment
    {"expectedVersion":1,"status":"Đã thanh toán"}

Patch ordinary invoice:

    PATCH /v1/orders/{api_id}
    {"expectedVersion":1,"phone":"0900111222"}

On historical imported invoices without an items array, prices cannot be edited via the API until individually reviewed; customer contact and date can be corrected. No destructive DELETE route is provided.

## Endpoints

| Method | Path | Scope | Notes |
|---|---|---|---|
| GET | /healthz | Public | Simple DB health |
| GET | /v1/status | orders:read | Imported status and order count |
| POST | /v1/admin/legacy/preview | admin | Dry run/checksum, no write |
| POST | /v1/admin/legacy/import | admin | One-time transactional import |
| GET | /v1/orders | orders:read | Filter customer, phone, from, to, status; page and limit |
| GET | /v1/orders/{id} | orders:read | Order and optimistic version |
| GET | /v1/orders/export.csv | orders:read | Excel-safe CSV, first 10,000 rows |
| GET | /v1/customers | orders:read | Customer name aggregate |
| GET | /v1/debts | orders:read | Unpaid filtered invoices, summary and up to 200 details |
| POST | /v1/orders | orders:write | New validated order |
| PATCH | /v1/orders/{id} | orders:write | Protected invoice edit |
| PATCH | /v1/orders/{id}/payment | payments:write | Paid/unpaid, versioned |
| GET | /v1/audit | admin | Recent audit log |

All error responses include an error.code string (for bot branching). Filters use ISO date YYYY-MM-DD. /v1/debts excludes statuses 'Đã hủy', 'Không Tính', 'Đã thanh toán', or paid customer receipts. API /v1/audit includes personal details: restrict it to the owner.

## Developer checks

    cd api
    npm install
    npm run check
    npm test

Integration testing against a disposable PostgreSQL database, verifying backup/restore, and a staged Render deployment are required before production traffic. PostgreSQL migrations and API-key rotation should be reviewed on every major upgrade.
