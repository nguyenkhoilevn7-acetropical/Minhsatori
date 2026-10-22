# Minh Satori — optional twin invoices for ALL collaborators
Updated: 2026-10-22. **Source implemented, PRODUCTION NOT ENABLED.**

## Business rule
For each existing collaborator, owner can configure **OFF (default)** or **ON** and approve:
- Customer-facing invoice discount percentage (example 20%).
- Internal collaborator settlement discount percentage (example 35%, must be higher).
- Freight percentage (owner-entered, not assumed; example existing invoices used 8%).
- VAT rate 0/5/8/10.
No collaborator name is hard-coded. **Hà Minh Nguyệt is one example, not a special case.**

When ON, one real order generates **two linked invoices in one atomic Drive revision** using the same products, quantities, receiving address and delivery note. Both have a `pairGroupId`, explicit `pairRole`, `collaboratorId`, cross-referenced `pairInvoiceNo` and unique invoice number. The customer receives **only the customer-facing invoice**. The internal settlement invoice is never public. The invoice count increases by two; sale/debt counts increase by **one**. A repeated `requestId` returns the original pair and cannot create another. Pair status divergence is flagged for review, not guessed.

When OFF, new orders use the existing normal single-invoice workflow. Old pairs remain linked; turning OFF never rewrites old invoices. Each collaborator has an independent policy.

## GitHub implementation
- [PR 82](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/82): per-CTV owner-scoped policy, atomic two-bill creation, explicit paired accounting in Apps Script and website core.
- [PR 83](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/83): owner CTV directory for the toggle.
- [PR 84](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/84): owner-only Gemini admin ON/OFF form, server-only HMAC signing; disabled by default.
- [PR 85](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/85): visible customer/internal invoice roles and no double-counting in web KPIs.
- [PR 86](https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/86): optional server-only Gemini pair checkout gateway with private settlement invoice, durable idempotent intent contract (pending CI/merge at time of writing).

## API actions (source only)
- `collaborators.pair.list`: `collaborators:pair:read`
- `collaborators.pair.configure`: `collaborators:pair:approve`
- `orders.create.pair`: `collaborators:pair:write`

The scopes MUST be separate least-privilege HMAC clients. Do not put any keys in HTML, APK, GitHub or chats. For Render admin, `SATORI_CTV_PAIR_CONFIG_ENABLED=1` only after owner permission, live Bot deployment and complete sandbox acceptance. `SATORI_CTV_PAIR_LIVE_CHECKOUT_ENABLED=1` must remain disabled until independent OTP/customer/CTV association, approval, durable shared store and signed E2E test exist.

## Before enabling production
1. Compare Apps Script live editor to newest `main/api/BotApi.gs`; back up live code & Drive ledger with byte-verified readback. Bot API Version 9 currently DOES NOT include the pair actions; this GitHub merge does not update the running Apps Script version.
2. Sandbox-test `collaborators.pair.configure` ON/ OFF for **two fake CTVs** with different discounts, then `orders.create.pair` and duplicate/delayed HTTP responses. No fake orders in production.
3. Verify payment, PDF share, cancellation and trash/restore preserve pair links, don't count internal bill in receivables, and never expose internal settlement to buyers.
4. Independently authenticate a real customer with OTP/OAuth, owner-verifiably bind the customer to one collaborator and delivery address, persist intent ID across devices/restarts.
5. Confirm one genuine owner-approved order and prices, then single real pair, reconcile both invoice IDs and the Drive revision. Roll back if anything mismatches.

**Current production baseline:** 115 invoices, revision 113 after Bot API Version 9 rollout. Last confirmed read: 2026-10-22. Re-read before deployment; never assume this is still current.
