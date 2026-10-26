# Canonical adapter interfaces — SOURCE ONLY, test fixtures only

No production transport, route, cloud configuration or issuance was enabled.
`/api/v2/confirm` still returns 503. Existing Apps Script accounting and Drive
PDF generation are untouched. The new functions require an explicitly injected
`testOnly:true` adapter. Default issuer/Drive/payment readers throw precise
`CANONICAL_*_NOT_CONFIGURED` errors. No environment flag removes this boundary.

## Durable invoice dispatch

Server input: authenticated actor, accepted local test invoice ID; optional
idempotencyKey must equal `v2-test-<stored order UUID>`. Owner/admin status is
server-derived only, never a request-body parameter. CTV can read its invoice
history but cannot dispatch another buyer's invoice.

Provider `issue(request)` and `lookup(request)` receive immutable account ID,
quote snapshot/digest, invoice ID, and stable key. Provider must return the signed
issue envelope defined in SANDBOX_LEDGER_CONTRACT.md. No second CTV invoice.

A database transaction locks the test invoice, creates one outbox entry and
commits ATTEMPTED with attempt_count=1 BEFORE provider I/O. Concurrent calls and
restarts use lookup only. Timeout, unknown or missing result yields UNCERTAIN;
**never automatically reset to READY or issue again**, including if a lookup says
not found. This prioritizes avoiding duplicates over automatic completion.
Ambiguous requests need operator reconciliation. Crashes before sending may
therefore require manual resolution as well. Invalid/forged receipts are rejected.

Verified receipt/commission storage reuses the previous atomic transaction.
If a crash occurs after receipt commit but before outbox update, durable verified
receipt recovery finishes the outbox without a second external send. No database
transaction remains held during network calls. Caller/provider must bound network
timeouts; a hung invocation remains claimed and subsequent requests use lookup.

## Original PDF read abstraction

`resolveSandboxPdf` accepts ONLY local invoice ID. It finds the signed Drive
reference in durable invoice history, never accepts a URL/file ID from clients.
Reader returns `{fileId,canonicalId,mimeType,bytes}`. Check identity, PDF MIME,
PDF header, 10MiB bound and SHA-256 against signed metadata. Check active account
and buyer/assigned-CTV/admin scope both before fetch and before returning bytes,
so revocation during fetch prevents delivery. No public sharing URL is generated.

The fake byte fixture is NOT an actual Google Drive PDF and is not evidence of
live PDF download. Actual Drive read must use a restricted server credential,
verify canonical issuer binding and enforce the same checks. No download route
has been exposed; existing downloadAvailable=false remains accurate.

## Payment reader

`reconcileSandboxPayment` requires server-derived admin authorization. Reader
receives only stored invoice identity and current revision and returns a signed
payment envelope. No browser paid=true assertion. Existing event ID, amount,
revision CAS, append-only partial/full/correction history and rollback apply.
Real payment source-of-truth and reconciliation cadence are not configured.

## Web/Android parity

Both clients retain the existing test-orders, sandbox-invoices and owner
sandbox-ledger routes from the prior contract. No new client-side credential or
provider route. A future dispatch endpoint must derive actor/admin on server,
reuse quote expiry/repricing, and expose UNCERTAIN without retrying creation.
Do not map sandbox VERIFIED to production COMMITTED. No changes to Android/UI.

## Before a real integration test (owner configuration/decisions)

- Approved isolated issuer endpoint and HMAC key ID/secret; provider must support
  lookup by stable idempotency key and signed exact invoice/quote readback.
  Existing legacy endpoint parity is not yet verified; do not assume it implements
  these methods or alter it without review.
- Restricted Drive read credential and explicit sandbox folder/file scope;
  canonical issuer must return original PDF identity + SHA-256.
- Authoritative payment source, signed readback credential and correction policy.
- OAuth audience + immutable owner/pilot subjects; Gemini server credential and
  verified free-project quota remain required for live sign-in/AI tests.
- Isolated durable test DB and successful real backup/restore gate before staging.

Provide credentials through secure provider configuration only, never chat or
GitHub. No permission to deploy/cut over/issue real invoices is implied.
