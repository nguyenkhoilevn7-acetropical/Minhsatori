# Verified order origins — deployment review

Status: draft, not deployed. Invoice 5978 is NOT yet attributed to an account.
Read-only Bot API verification on 2026-11-06: revision 231, invoice ID
1793954613776, invoice number 5978, recipient Ngọc Ngô. The response does not
contain account provenance; collaboratorId is null. This is not evidence of
which account submitted it.

## Source and safety

The companion V2 branch `fix/v2-verified-order-origins-20261106` reads committed
checkout receipts with account / quote / profile joins in a read-only transaction.
It exports only unique exact ledger IDs and invoice numbers whose request ID
matches canonical_intent.requestId. Account/profile name and role are current
profile values, not a historical role snapshot. No name/phone/discount matching.

Apps Script reads a separate private owner-controlled export file through
SATORI_V2_ORDER_ORIGINS_FILE_ID. It additionally requires ledger apiRequestId to
match the checkout request. Missing historical request IDs remain unknown.
Snapshot outputs only ledgerInvoiceId, invoiceNo, accountId, accountName, accountRole.

The export refresh/upload workflow is NOT provisioned. Exports expire after 24h;
an operator must refresh the private export before expiry. This draft must not be
released as a complete continuous-sync solution until refresh is operational and
staging verifies it. Android periodic full snapshots/manual refresh pick up
registry changes even when the financial ledger revision is unchanged.

## Required release gates

1. Establish authorized read-only PostgreSQL access; query invoice 5978 and
   compare ledger_invoice_id=1793954613776, ledger_invoice_no=5978, account_id,
   quote.account_id, profile.account_id and canonical requestId against ledger.
2. Back up actual Apps Script Production and record deployment/version and hashes.
   Version 19 is reported by the owner, not reverified in this change.
3. Stage V2 export and Apps Script helper with synthetic invoices. Verify all three
   account roles, missing/duplicate/conflicting identities, expired export, and
   no mutation of submitted orders, financial fields, payment permissions or PDF.
4. Complete Android unit/build/emulator CI and PostgreSQL CI.
5. Present exact Production diff and obtain deployment/merge/release approval.
   Apply only the helper and read hook to backed-up V19; DO NOT replace its full
   Mobile API with repository code that may have different payment permissions.
6. After approved deploy, verify read-only snapshot against the PostgreSQL proof.
   Then approve merge/release separately as required and upload signed APK to Drive.

No Production code, properties, deployments, invoices or account profiles were
changed while preparing this patch. No official APK was produced.
