package vn.minhsatori.app

/**
 * Pure, offline preview for a future OWNER-APPROVED payment-allocation endpoint.
 *
 * The inputs MUST eventually come from an authenticated, version-locked
 * server-side accounting ledger. None can be reconstructed from the legacy
 * 'Đã thanh toán' / 'Chưa thanh toán' flags. This class never persists, sends,
 * confirms, marks paid or modifies the existing Satori invoice ledger.
 */
data class AccountingProVerifiedOpenBalance(
    val ledgerId: String,
    val invoiceNo: Long,
    val sourceRevision: Long,
    val outstandingVnd: Long
)

data class AccountingProAllocationLine(
    val ledgerId: String,
    val invoiceNo: Long,
    val amountVnd: Long
)

data class AccountingProAllocationPreview(
    val allocatedVnd: Long,
    val unallocatedVnd: Long,
    val remainingByLedgerId: Map<String, Long>,
    val needsManualReview: Boolean = true
)

object AccountingProPaymentAllocation {
    /**
     * Suggests an allocation for a single incoming amount; it is NOT a booked
     * payment. Rejects ambiguous IDs, stale/discordant revisions, overpayment
     * per invoice, duplicate allocation lines, negatives and Long overflow.
     *
     * - One receipt can be split across multiple independently identified bills.
     * - A partial receipt leaves an unpaid balance.
     * - Excess receipt remains UNALLOCATED, never changes an invoice total.
     */
    fun preview(
        receiptVnd: Long,
        expectedLedgerRevision: Long,
        verifiedOpenBalances: List<AccountingProVerifiedOpenBalance>,
        intendedAllocations: List<AccountingProAllocationLine>
    ): AccountingProAllocationPreview {
        require(receiptVnd > 0L) { "RECEIPT_AMOUNT_INVALID" }
        require(expectedLedgerRevision >= 1L) { "LEDGER_REVISION_REQUIRED" }
        require(verifiedOpenBalances.isNotEmpty()) { "VERIFIED_BALANCES_REQUIRED" }
        require(verifiedOpenBalances.size <= 200 && intendedAllocations.size <= 200) {
            "ALLOCATION_LIMIT"
        }
        require(intendedAllocations.isNotEmpty()) { "ALLOCATION_REQUIRED" }

        val ids = HashSet<String>()
        val nos = HashSet<Long>()
        for (bill in verifiedOpenBalances) {
            require(validId(bill.ledgerId) && bill.invoiceNo > 0L) {
                "CANONICAL_INVOICE_ID_REQUIRED"
            }
            require(bill.sourceRevision == expectedLedgerRevision) {
                "STALE_LEDGER_REVISION"
            }
            require(bill.outstandingVnd >= 0L) { "INVALID_OPEN_BALANCE" }
            require(ids.add(bill.ledgerId) && nos.add(bill.invoiceNo)) {
                "AMBIGUOUS_INVOICE"
            }
        }
        val byId = verifiedOpenBalances.associateBy { it.ledgerId }
        val remaining = verifiedOpenBalances.associate { it.ledgerId to it.outstandingVnd }
            .toMutableMap()
        val assigned = HashSet<String>()
        var allocated = 0L
        for (line in intendedAllocations) {
            val bill = byId[line.ledgerId]
                ?: throw IllegalArgumentException("INVOICE_NOT_IN_VERIFIED_BALANCES")
            require(line.invoiceNo == bill.invoiceNo) { "INVOICE_NUMBER_MISMATCH" }
            require(assigned.add(line.ledgerId)) { "DUPLICATE_ALLOCATION" }
            require(line.amountVnd > 0L && line.amountVnd <= bill.outstandingVnd) {
                "ALLOCATION_EXCEEDS_OPEN_BALANCE"
            }
            allocated = try {
                Math.addExact(allocated, line.amountVnd)
            } catch (_: ArithmeticException) {
                throw IllegalArgumentException("PAYMENT_OVERFLOW")
            }
            require(allocated <= receiptVnd) { "ALLOCATION_EXCEEDS_RECEIPT" }
            remaining[line.ledgerId] = bill.outstandingVnd - line.amountVnd
        }
        return AccountingProAllocationPreview(
            allocatedVnd = allocated,
            unallocatedVnd = receiptVnd - allocated,
            remainingByLedgerId = remaining.toMap()
        )
    }

    private fun validId(id: String) =
        id.isNotBlank() && id == id.trim() && !id.startsWith("row-") &&
            id.length <= 256
}
