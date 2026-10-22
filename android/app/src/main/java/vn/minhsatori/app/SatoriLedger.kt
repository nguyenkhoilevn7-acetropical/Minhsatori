package vn.minhsatori.app

/** Read-only accounting totals. This never modifies Drive or invents cost/profit data.
 * The website's summary excludes invoices with status "Đã hủy" and "Không Tính".
 * Supplier settlement "Đã TT Satori" is not proof that the customer paid.
 */
data class SatoriLedgerTotals(
    val recordCount: Int,
    val countedCount: Int,
    val excludedCount: Int,
    val revenue: Long,
    val customerPaid: Long,
    val customerUnpaid: Long,
    val invalidDateCount: Int
)

object SatoriLedger {
    fun totals(invoices: List<SatoriInvoice>): SatoriLedgerTotals {
        val counted = invoices.filterNot { it.isExcluded }
        val paid = counted.filter { it.customerHasPaid }.sumOf { it.total }
        val unpaid = counted.filterNot { it.customerHasPaid }.sumOf { it.total }
        return SatoriLedgerTotals(
            recordCount = invoices.size,
            countedCount = counted.size,
            excludedCount = invoices.size - counted.size,
            revenue = counted.sumOf { it.total },
            customerPaid = paid,
            customerUnpaid = unpaid,
            invalidDateCount = invoices.count { !it.hasValidDate }
        )
    }

    fun query(invoices: List<SatoriInvoice>, text: String,
              status: String = "Tất cả"): List<SatoriInvoice> =
        invoices.filter { row ->
            SatoriData.search(row, text) &&
                (status == "Tất cả" || row.status == status)
        }
}
