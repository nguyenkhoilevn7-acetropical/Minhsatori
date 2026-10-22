# Minh Satori AI — pricing authorization checkpoint (staging only)

**Do not deploy this code to Apps Script production until reviewed.**

The normal website key `satori_ai_customer_memory` is trained automatically from earlier orders. Its learned discounts are **not** owner authorization. To prevent a learned or changed rate from silently becoming a sales price, staging BotApi now stores reviewed decisions separately in `satori_ai_pricing_approvals_v1` (append-only approval/revocation events).

## Permissions
- `pricing.approve` requires a **server-only owner HMAC key** with `pricing:approve` scope. It authorizes or revokes a fixed discount, VAT and freight for one exact invoice reference (id, invoiceNo), customer memory ID, phone and delivery address. Requests require `confirmed:true`, current `expectedRevision` and a reusable idempotency requestId.
- `orders.create.ai` requires an independent server-only `orders:ai:write` key. It cannot use generic `orders.create`. On every new attempt it checks the latest owner approval, the reference invoice's recipient and destination, the current versioned `satori_catalogue_v15`, every product code/name/unit/list price/discounted unit price, quantity, VAT, freight and invoice total.
- A lost reply can be retried with the **same requestId and exactly the same intent** without extra writes. Mutated intents fail. When the owner revokes the approval, later new requests fail closed.

## Fictional-only example approval payload

```json
{
  "confirmed": true,
  "expectedRevision": 100,
  "requestId": "fake-owner-approval-001",
  "customerMemoryId": "fake_customer_01",
  "customerRef": {"id": 123, "invoiceNo": 456},
  "phone": "0900000000",
  "location": "123 Fake Test Street",
  "discountPercent": 20,
  "vatPercent": 8,
  "shippingAmount": 0,
  "enabled": true
}
```

Revocation uses `enabled:false`, a new requestId and current revision, preserving audit history. Neither browser code, Android APK nor public Gemini links may hold any production HMAC key.

## CI
- Bot API fake-Drive tests: protected owner approval/revoke, idempotent retries, rejects changed approval, rejects AI underpricing, prohibits AI orders after revocation.
- Cross-branch fake-ledger E2E: HMAC-scoped AI multi-SKU order, current pricing, one invoice, no duplicate on retry, stale source rejection, cross-customer protection, owner-only revocation.
- **These are offline staging tests, not evidence of live customer synchronization.**

## Remaining production gates
An isolated Apps Script sandbox with fake Drive state, real owner-only authentication and OTP-bound customers, durable order storage, private backend HMAC secrets, verified VAT/shipping/VietQR, Samsung-native signed APK and end-to-end acceptance are still required. The preflight `verifiedByServer` property in test fixtures MUST NOT be treated as trustworthy when received from a browser. No `main` merge or production writes until these gates are met.
