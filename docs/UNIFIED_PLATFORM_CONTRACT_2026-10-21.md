# Minh Satori — One backend, three synchronized clients (staging contract)

Owner goal: existing Minh Satori website, AI Chat shopping, and native Samsung Android app behave as three clients of ONE server-authoritative business system, comparable to ChatGPT web/mobile shared state. No independent production ledgers.

## Canonical data and isolation

- Production invoice/customer/catalogue/payment/AI-memory source of truth: current owner-authorized Apps Script + versioned Google Drive business state. Existing Bot API read-only status observed revision 105 / 113 invoices, not necessarily latest; recheck before any production migration.
- Gemini Render and Android mobile API sandboxes remain FAKE-ONLY until approved authenticated write adapter is tested. TEST invoice IDs never become business invoice IDs.
- Google OAuth owner/staff roles validated on server. Customer requires separate per-customer, per-delivery-location identity. Demo links are never production authentication.
- Encrypted Google Drive snapshots are recovery copies, not a transactional database, live event bus or permanent session store.

## Versioned API contract

All clients display the same authoritative revision, updatedAt, invoice ID, totals and statuses. Every write is authorized, idempotent with requestId, has expectedRevision and server-recomputed prices, discount, shipping and VAT. Conflicts cause fresh read and explicit review, never silent overwrite.

| Area | Canonical action/read | Acceptance |
|---|---|---|
| Invoice/customer/debt | permission-scoped orders.list / mobile.snapshot | Identical numbers, totals, paid flags, address across website/app/chat |
| Catalogue, tax, discounts | catalogue.list by verified revision | Same SKU, name, unit, price, VAT; server is sole price authority |
| Conversation and draft | identity-scoped message thread + cart | Same pending cart and message history after refresh/restart and on other device |
| Checkout | one authorized orders.create | Multiple chat turns and selection chips => one invoice, repeat request never double-counts |
| Payment/delete/restore | revision-checked authenticated commands | Differentiate supplier settled vs customer paid; soft delete 30 days |
| PDFs/QR | canonical invoice render and merchant config | Same eight columns/QR/amount; Android share via native sharesheet |
| Notifications | versioned owner event feed / push | No duplicate alert; authorize recipient |
| Backup/recovery | encrypted snapshot with restore test | Independent verified restore before production migration |

## Sync behavior

1. First load: authenticated canonical snapshot and revision. Cached device state is **never** uploaded blindly to replace business state.
2. While foregrounded, poll a lightweight authenticated revision endpoint every 10–20 seconds; fetch full snapshot **only when revision changes**. When offline, label last verified data as stale. Push/SSE may reduce latency but cannot replace backfill-on-resume.
3. On app resume or browser visibility event: check revision immediately; pull changed state, conflict-check any pending write.
4. Every mutation: expectedRevision, requestId, transactional lock and backup; all clients observe the committed revision.
5. One conversation/cart per verified customer identity (not per device). A confirmed checkout clears only its matching draft. Never trust LLM pricing or model-written order records.
6. Preserve pending idempotent requests after a network timeout; do not issue new requestId for the same operation.

## Release gates — live production unchanged until satisfied

- Backup and verify **current** production revision, invoice count, payment state, 30-day trash, catalogue and customer memory; prove restore in isolated TEST.
- Prove scoped sandbox Apps Script mobile.revision, mobile.snapshot and payments/order writes, including invalid owner/customer tokens, staleness and concurrent conflict handling.
- Verify 2 simultaneous devices see same TEST cart, chat thread, invoice and payment state, with restart and network-loss retries.
- Use durable transactional persistence for real sessions/messages (Render Free temporary files alone are not durable); support authorization and event audit.
- Verify signed Samsung APK stable OAuth, final PDF, QR payment details, Zalo/Messenger shares and parity with website.
- Release one audited production adapter after explicit approval, then web and Android clients in controlled phases, with rollback.

Current reality: Gemini shared draft + encrypted backups are on its Sandbox branch and CI has passed; Android staging has a mobile.revision server handler, but full production cross-client synchronization is NOT yet complete.
