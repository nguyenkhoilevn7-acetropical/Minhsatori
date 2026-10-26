# Signed invoice/payment reconciliation — sandbox only

No production issuer adapter is connected. `/api/v2/confirm` still returns 503
`REAL_CHECKOUT_GATE_NOT_VERIFIED`. No real invoice, Drive file or accounting
mutation can be initiated by this implementation. Do not label sandbox records
as official invoices. The contract models one canonical invoice per accepted
order so the real adapter can later be verified against an explicit gate.

## Shared web/Android API

Existing auth/session/CSRF/Origin guards apply; do not change Android UI.

- `POST /api/v2/test-orders`: existing authenticated confirmation, expiry,
  catalogue/cart/policy re-pricing and idempotency. No change to its contract.
- `POST /api/v2/admin/sandbox-ledger`: owner only; test-order feature flag must
  be enabled. Body `{payload, signature}`. Missing server-only
  `SATORI_V2_SANDBOX_LEDGER_HMAC_KEY` fails `SANDBOX_LEDGER_NOT_CONFIGURED`.
- `GET /api/v2/sandbox-invoices[?id=<test invoice UUID>]`: buyer's invoices or
  assigned CTV history only. SQL scopes before exposing any invoice or event.
- `GET /api/v2/admin/sandbox-invoices[?id=...]`: owner only, same response shape.

Envelope version 1, `testOnly:true`, expiresAt epoch milliseconds within five
minutes. Signature is lowercase hex HMAC-SHA256 over compact recursive
lexicographic-key JSON (array order retained). Signature generation belongs in
trusted sandbox adapter/CI; never in Android/browser. The quoteDigest uses
SHA-256 of the same canonical JSON for the stored, server-priced snapshot.

Issue receipt fields:
`kind:'issued', invoiceId, canonicalId:'TEST-…', invoiceNumber:'TEST-…',
quoteDigest, currency:'VND', totalVnd, pdf?` plus envelope fields.

Invoice and canonical identities are unique. Repeating the exact signed receipt
is idempotent. Changed receipt or another identity for the same order fails.
Snapshot, total and digest must match the accepted order. One receipt row and
one internal commission entry are committed atomically; no second sale invoice.
No provider retry is implemented here: a future issuer MUST support durable
idempotency and reconciliation on uncertain timeout before live use.

Payment receipt fields:
`kind:'payment', invoiceId, canonicalId, eventId:<UUID>, expectedRevision,
paidVnd, verified:true` plus envelope fields. Amount is cumulative verified paid
amount, integer VND, between zero and invoice total. Revision CAS prevents stale
toggles. Partial/full/reversed payments append immutable events; previous events
are never deleted. Exact event replay is idempotent. Changed event, overpayment,
unverified payment or stale revision rolls back without altering debt.

History returns `paidVnd`, `dueVnd`, `paymentStatus` (UNPAID/PARTIAL/PAID),
`paymentVerified`, revision and verification time. Detail also returns ordered
paymentEvents. No PATCH paid=true shortcut exists. Reports based on this store
must remain labelled test-only. Commission is provisional until full payment,
and even then is explicitly NOT settled; company profit remains unknown/null.

Optional PDF metadata: `{fileId,sha256,mimeType:'application/pdf'}` only, bound
to the signed invoice receipt. Arbitrary URLs/extra fields are rejected. Returned
metadata has `provenance:'signed-sandbox-receipt', downloadAvailable:false`.
This verifies the adapter's assertion only; no actual Drive PDF has been fetched,
validated or made downloadable. Retail payloads exclude CTV/internal money.

## Verified scope versus remaining release gates

Synthetic PostgreSQL tests cover 100 concurrent identical receipt submissions,
one invoice/commission row, tampering/total/PDF failures, account isolation,
payment replay, partial/full/reversal, rollback and reconnect. Existing checkout
tests now also reject an unsubmitted quote after owner disables its CTV.

Google claims are additionally checked after Google's signature verification:
exact web audience, allowed issuer, immutable subject, email verification and
issued/expiry times. Offline claims tests are not Google login evidence.
Existing real Gemini adapter is unchanged; live credentials/provider verification,
conversation corrections and real catalogue acceptance remain pending.

Not done: live issuer + signed remote readback, live Google/Gemini, actual PDF
fetch/provenance, real payment provider reconciliation, migration/backup gates.
Production and legacy data remain unchanged.
