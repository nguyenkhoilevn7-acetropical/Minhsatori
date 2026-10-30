package vn.minhsatori.app

/**
 * Pure bank-transaction TRIAGE for a future server-verified reconciliation API.
 * Does not read banks, import files, make allocations or mark invoices paid.
 *
 * Amount alone is never sufficient to match an invoice. Exact source identity,
 * trusted provider flag, distinct bank event, ledger revision and invoice
 * reference are required even to display a MANUAL-REVIEW suggestion.
 */
enum class AccountingProBankDirection { CREDIT, DEBIT }
enum class AccountingProBankTriageStatus {
    HOLD_UNVERIFIED, HOLD_DUPLICATE_TRANSACTION, HOLD_INVALID_TRANSACTION,
    HOLD_MISSING_INVOICE_REFERENCE, HOLD_AMBIGUOUS_INVOICE, HOLD_STALE_LEDGER,
    HOLD_INVALID_OPEN_BALANCE, HOLD_OVERPAYMENT,
    REVIEW_PARTIAL_CREDIT, REVIEW_EXACT_CREDIT
}
data class AccountingProBankTransfer(
    val providerTransactionId: String,
    val accountReference: String,
    val invoiceNoReference: Long?,
    val amountVnd: Long,
    val direction: AccountingProBankDirection,
    val providerVerified: Boolean
)
data class AccountingProBankInvoice(
    val ledgerId: String,
    val invoiceNo: Long,
    val openBalanceVnd: Long,
    val revision: Long
)
data class AccountingProBankTriageResult(
    val transfer: AccountingProBankTransfer,
    val status: AccountingProBankTriageStatus,
    val matchedLedgerId: String? = null
) {
    val isSuggestionOnly: Boolean get() =
        status == AccountingProBankTriageStatus.REVIEW_EXACT_CREDIT ||
        status == AccountingProBankTriageStatus.REVIEW_PARTIAL_CREDIT
}

object AccountingProBankTriage {
    fun preview(
        expectedRevision: Long,
        transfers: List<AccountingProBankTransfer>,
        candidates: List<AccountingProBankInvoice>
    ): List<AccountingProBankTriageResult> {
        require(expectedRevision > 0L) { "LEDGER_REVISION_REQUIRED" }
        require(transfers.size <= 250 && candidates.size <= 500) { "TRIAGE_LIMIT" }
        val transactionCounts = transfers.groupingBy {
            it.accountReference.trim() + "|" + it.providerTransactionId.trim()
        }.eachCount()
        val candidatesByNumber = candidates.groupBy { it.invoiceNo }
        return transfers.map { transfer ->
            val key=transfer.accountReference.trim() + "|" +
                transfer.providerTransactionId.trim()
            fun hold(status: AccountingProBankTriageStatus) =
                AccountingProBankTriageResult(transfer, status)
            when {
                !transfer.providerVerified ->
                    hold(AccountingProBankTriageStatus.HOLD_UNVERIFIED)
                transfer.providerTransactionId.isBlank() ||
                    transfer.accountReference.isBlank() ||
                    transfer.amountVnd <= 0L ||
                    transfer.direction != AccountingProBankDirection.CREDIT ->
                    hold(AccountingProBankTriageStatus.HOLD_INVALID_TRANSACTION)
                transactionCounts[key] != 1 ->
                    hold(AccountingProBankTriageStatus.HOLD_DUPLICATE_TRANSACTION)
                transfer.invoiceNoReference == null || transfer.invoiceNoReference <= 0L ->
                    hold(AccountingProBankTriageStatus.HOLD_MISSING_INVOICE_REFERENCE)
                else -> {
                    val matches = candidatesByNumber[transfer.invoiceNoReference].orEmpty()
                    if (matches.size != 1 || matches.any {
                            it.ledgerId.isBlank() || it.ledgerId.startsWith("row-") ||
                            it.invoiceNo <= 0L ||
                            candidates.count { other -> other.ledgerId == it.ledgerId } != 1
                        })
                        hold(AccountingProBankTriageStatus.HOLD_AMBIGUOUS_INVOICE)
                    else {
                        val bill = matches.single()
                        when {
                            bill.revision != expectedRevision ->
                                hold(AccountingProBankTriageStatus.HOLD_STALE_LEDGER)
                            bill.openBalanceVnd <= 0L ->
                                hold(AccountingProBankTriageStatus.HOLD_INVALID_OPEN_BALANCE)
                            transfer.amountVnd > bill.openBalanceVnd ->
                                hold(AccountingProBankTriageStatus.HOLD_OVERPAYMENT)
                            else -> AccountingProBankTriageResult(
                                transfer,
                                if (transfer.amountVnd == bill.openBalanceVnd)
                                    AccountingProBankTriageStatus.REVIEW_EXACT_CREDIT
                                else AccountingProBankTriageStatus.REVIEW_PARTIAL_CREDIT,
                                bill.ledgerId
                            )
                        }
                    }
                }
            }
        }
    }
}
