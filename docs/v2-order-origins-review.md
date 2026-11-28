# V2 order origins — account that placed an invoice (owner-only)

Android shows, on invoice cards and the invoice detail screen only:

- Card: `Đặt từ: <tên tài khoản> · CTV | Đại Lý | Khách Lẻ`
  (suffix ` (hồ sơ hiện tại)` when the role is not a checkout-time snapshot)
- Detail: block **Tài khoản đặt hàng** (account, role) separate from block
  **Người nhận hàng** (recipient name, phone, delivery address).
- Anything not proven: `Chưa xác định tài khoản đặt hàng`.

The PDF is not touched. No invoice, ledger revision, payment, profit or permission
logic changes.

## Evidence chain

```
PostgreSQL V2 (committed checkout)            backend PR #395
  satori_v2_order_requests.state = COMMITTED
  request.account = quote.account = profile.account
  canonical_intent.requestId = request_id
  unique ledger id AND unique invoice number (DB index + export check)
  role: CANONICAL_INTENT_RESERVED audit snapshot (ORDER_SNAPSHOT)
        or current profile for older checkouts (CURRENT_PROFILE)
        │  POST /api/v2/origins/export  (HMAC, own secret, ±5 min, single-use nonce, READ ONLY tx)
        ▼
Apps Script time trigger (5 min)              this PR, api/V2OrderOrigins.gs
  satoriV2OrderOriginsRefreshTick → private Drive cache file (auto-created, owner, PRIVATE)
        │  read only after owner OAuth + production ledger checks
        ▼
AndroidOwnerMobileApi → satori_v2_order_origins_v1
  join with CURRENT ledger: exact id + exact number + bill.apiRequestId = requestId,
  any duplicate of id or number on either side → omitted
        ▼
Android InvoiceOrderAccountSource — registry only; inline bill fields are ignored
```

Not used as evidence, ever: recipient name, phone, address, discount percent,
CTV link on the bill, `orderedBy*` fields typed into the ledger.

No manual 24-hour export file any more: the trigger refreshes automatically, and
committed attribution is immutable, so a cache up to 30 days old is still correct
for the invoices it lists; new invoices show "Chưa xác định" until the next refresh.

## Invoice #5978 (read-only check, 2026-11-06)

From the production ledger file (read only, nothing written):

| Field | Value |
|---|---|
| id | 1793954613776 (= 2026-11-06 15:43:33 +07) |
| invoiceNo | 5978 |
| revision written | 231 (ledger updatedAt 08:43:35Z) |
| source | `bot_api` |
| apiRequestId | `827b61d1-59bf-477d-9cec-92631d33ba4e` (random UUID, same shape as V2 checkouts #5963–#5968, #5971, #5976, #5977; owner/ChatGPT-made bills use readable request ids) |
| recipient | Ngọc Ngô |

V2 service logs: instance `vdhls` was up from 14:36 to after 15:43 (+07), and a
successful checkout writes no log line, so the logs neither prove nor exclude it.

**Account that placed #5978: NOT VERIFIED.** The mapping
`request_id 827b61d1-… → account_id → profile` exists only in PostgreSQL
`minh-satori-v2-pilot-isolated`, whose IP allowlist blocks every external client.
Nothing here says it was Hà Minh Nguyệt; Android will show
`Chưa xác định tài khoản đặt hàng` until the export proves it.

Owner check after the backend is deployed (read only):

```sql
SELECT r.request_id, r.state, r.ledger_invoice_id, r.ledger_invoice_no,
       a.display_name AS login_name, p.display_name AS profile_name, p.type
FROM satori_v2_order_requests r
JOIN satori_v2_quotes q ON q.id = r.quote_id
JOIN satori_v2_profiles p ON p.id = q.profile_id
JOIN satori_v2_accounts a ON a.id = r.account_id
WHERE r.request_id = '827b61d1-59bf-477d-9cec-92631d33ba4e';
```

## Deployment (needs owner approval — nothing below has been done)

1. **Back up Apps Script Production version 19** (clasp pull + project JSON + new
   snapshot version) before any change.
2. **Render `minh-satori-v2-customer-admin`**: add env `SATORI_V2_ORIGINS_SECRET`
   (≥32 random chars, different from `SATORI_OWNER_PUSH_WAKE_SECRET`), deploy #395.
   Checkouts after this deploy carry a role snapshot.
3. **Apps Script (staging first)**: add `V2OrderOrigins.gs` and the 3-line hook in
   `AndroidOwnerMobileApi.gs`; Script Properties `SATORI_V2_ORIGINS_ENDPOINT`
   (`https://minh-satori-v2-customer-admin.onrender.com/api/v2/origins/export`) and
   `SATORI_V2_ORIGINS_SECRET` (same value as Render); time trigger every 5 minutes
   on `satoriV2OrderOriginsRefreshTick`. Status (no secrets) is written to the
   Script Property `SATORI_V2_ORDER_ORIGINS_STATUS` (`OK_<n>`, `HTTP_<code>`, ...).
   New OAuth scope: `script.external_request` (UrlFetch) — the owner must re-authorize.
4. Verify on staging, then promote to Production as a new version; deployments
   @8/@19 stay untouched until approved.
5. Android release APK after merge, versionCode above the installed build 73.

## Risk to act on now

`minh-satori-v2-pilot-isolated` is a Render **free** PostgreSQL that **expires on
2026-11-24**. When it expires, every V2 account, profile and checkout journal —
the only evidence of who placed an order — is deleted. Upgrade it or migrate it
before that date.
