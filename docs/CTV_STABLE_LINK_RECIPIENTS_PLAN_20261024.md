# CTV recipient registry — stable-link acceptance plan (2026-10-24)

## Owner requirements
- Restore existing `/api/admin/real-links/issue`, `/real/#<sealed-token>`, and `orders.create` **exactly** as before the linked 20/35 commission patch. Existing links must continue to work.
- Keep a completely **independent** CTV receiver and commission spreadsheet in private Google Drive. Owner can enter/edit **any** recipient name, phone, delivery address, individual customer discount and separate collaborator reference discount; **no default 20%** and **no second invoice**.
- After an owner adds an authorized CTV recipient, **the previously issued ordering URL must not change** and must show the new recipient on the next authorized read.

## Current blocker (must not misrepresent)
The current production agency invitation is an AES-GCM **stateless** encrypted token containing its full destination list, immutable at issuance (`production-private-links.mjs`). The owner also selects a pre-existing *exact invoice ID and row ID* per destination. Just adding a row to a Sheet (or appending an unverified customer address in chat) does not put that new address in an already-issued token and does not authorize `orders.create` for a customer who has no historical source invoice.

Render Free web service filesystem is ephemeral. Free Key Value has no disk persistence, and free Postgres expires in 30 days. **Do not use these as authoritative registry storage**. There is currently no production CTV-destination add/read command in the deployed Bot API.

## Safe implementation required in a separate, later release
1. Add and deploy *owner-only* Bot API commands `ctv.recipients.list`, `ctv.recipients.upsert`, `ctv.recipients.revoke` backed by dedicated `satori_ctv_recipients_v1` in the canonical revisioned Google Drive ledger. These commands must require dedicated HMAC scopes, exact collaborator ID, owner confirmation, idempotency/requestId, expectedRevision, lock, prewrite backup, readback and conflict handling. No historical invoice rewrites.
2. Add a stable V2 invitation with durable opaque `linkId` and invitation metadata in the same ledger. The public URL contains `linkId` and an unguessable secret, **not mutable addresses**. Continue requiring a separate recipient access code. The public checkout always reads current *owner-approved* destinations bound to this ID.
3. Add recipients via Admin > CTV or a correctly authorized Google Sheet import, with normalized name, phone, address, customer discount, CTV settlement discount. Never trust incoming browser data as owner approval.
4. In public checkout, select receiver via approved `recipientId`; for a new receiver without a historical invoice, use a new server-side scoped new-recipient confirmation backed by the Bot API. Prevent unreviewed destinations from creating real invoices. Use normal `orders.create` only, and calculate CTV reference spread privately (never expose it on buyer invoice).
5. Implement owner-specific UI for add/edit/revoke recipient, optimistic revision, and a stable-link regression: issue one URL, add recipient B on Drive, fetch the **same exact URL**, verify both A and B appear, revoke A, verify the same URL drops A, real quote still source-valid and exactly one invoice per confirmed order. Test on 2 devices/restart and retry.
6. Do NOT silently migrate existing stateless `/real/#` URLs: old tokens lack mutable lookup ID. To guarantee **existing URL bytes unchanged**, bridge them securely by a server-side registry keyed by the token's immutable invitation ID, encrypted at rest in canonical Drive. Migration must not expose token, PIN, or identities. Fallback for legacy URL must fail closed if no authoritative registry exists.

## Interim operational state
The Drive workbook `Minh Satori - Bảng người nhận và đối soát CTV (độc lập)` is private and editable, but as of this release it is **not** the ordering destination registry. Entering receivers there does not add them to a previously issued ordering link, and it must not be presented as though it does. Do not create false success UI or tell owner the unimplemented stable-link expansion works.

Workbook: https://docs.google.com/spreadsheets/d/1gCHmXCSz4yrcIklFP75L9vfyDQFJGN4_ia_ICpYXz1c/edit
