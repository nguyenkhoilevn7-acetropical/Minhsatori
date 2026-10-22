# Minh Satori — OWNER-ONLY real three-system acceptance, 23 October 2026

Status at preparation 22 Oct: **NOT READY**. Code merged != deployed and tested. **No customer access**.

## Mandatory preflight (zero writes)
- Verify immutable byte-for-byte Drive prewrite backup with the current live revision and invoice count. Previous sample was revision **113**, **115 orders**; re-read every time, never rely on these numbers as current.
- Verify GitHub PR #82–#87 tests green and live deployed Apps Script version includes BOTH **pair configure/list/create** and previous PDF/payment/API protections. Version 9 did not include this feature at preparation. Preserve old deployment and source backup.
- Gemini Render: service must not be in `SANDBOX_RESCUED_CHAT_PREVIEW_STARTING` read-only emergency preview. Verify URL and HMAC receipt contract using server-only credentials. Do NOT replace encrypted recovery bootstrap or clear ephemeral state.
- Android: owner Samsung APK must be signed and have verified read + write integrations with exactly the **same** Drive ledger, not just a read-only APK candidate.
- Confirm separate admin-only access for write actions. Block all public/customer links, self-service checkout and Gemini autonomous writes. Test authentication/revocation without exposing keys in logs or phone. Verify owner-approved customer/delivery identity and discount policy; no browser-submitted trust flags.
- Configure durable atomic quote/idempotency store shared across Render instances/restarts; no retry of uncertain commits.

## Owner's genuine order test sequence (must be owner-confirmed before each write)
1. Read the current customer's historical invoice and verify the **correct delivery destination**, phone, buyer and collaborator association. The collaborator may have multiple recipients.
2. Preview a real order by Gemini natural language; verify catalogue SKU, unit/qty, price, VAT, delivery note, freight. Ensure no address change by customer chat. **Do not create yet.**
3. For a selected **active CTV**, owner reads the currently approved opt-in ON/OFF policy. Example only: customer discount 20%, internal CTV discount 35%. No automatic default approval for any CTV. Owner verifies expected totals.
4. On explicit owner confirmation, create **exactly one real buyer+CTV pair** under one Drive revision and pair request ID. Read back both invoice numbers, receipt reference, group ID, roles, separate CTV recipient name, correct customer delivery address and every line item.
5. Repeat confirmation/click with same ID: read existing pair, never create two more invoices; on timeout, **stop and reconcile** rather than retrying a new ID.
6. Check website, signed Android app and Gemini show the same **current invoice number, order status and recipient** from one authoritative ledger. Check changes propagated after fresh fetch; fail if any client shows sandbox/dummy or stale data.
7. Validate customer-facing PDF + QR, in-app PDF view, explicit Download and Zalo/Messenger share. The **customer may only receive their 20% bill**; internal 35% settlement details must not appear in a customer payload, share link, response or chat.
8. Confirm receipt/payment status through an authorised owner-only operation and prove a fresh read on all three shows the same status. Never mark paid without the owner's verification.
9. Verify accounting revenue and unpaid debt count the **buyer bill once**, and CTV settlement/commission difference separately. Check owner on/off setting for a second CTV on fake-only data (not another real invoice).
10. If cancelling/restoring/editing either real bill is required, obtain **new explicit confirmation** and use pair-aware workflow; never casually cancel or delete a real customer's legitimate order.

## Success conditions
- All three live systems read the *same* ledger revision and exact new invoice pair; no duplicates, PII leak or separate second sale.
- Customer features remain blocked. The account owner alone initiates/approves actions, including price, payment and one actual order.
- PDF share, two delivery addresses, discount per CTV, VAT, payments and order statuses are verified or explicitly recorded as unsupported/blocked.
- Rollback source, prior Apps Script deployment and immutable Drive backup are available; no auto-deploy before acceptance.

## Known blockers at document creation
- Apps Script live deployment Version 9 predates new paired-invoice source.
- Render deploy points at earlier Gemini sandbox commit; feature source not released.
- Android signed v0.3.8 PR #75 is a *read-only live-ledger acceptance candidate*, not verified real write application.
- No verified Render durable intent store or independently authenticated customer/CTV relationship for real checkout.
- No current per-CTV owner-approved policy in Drive (pair policy key absent in revision 113), and no authorised live owner action configured yet.

**The morning status report must say NOT READY until blockers have been resolved and validated; passing unit tests alone is insufficient.**
