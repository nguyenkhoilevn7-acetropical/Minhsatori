package vn.minhsatori.app

/**
 * Phase 1, display-only Accounting Pro projection over the existing canonical
 * snapshot. No network, no DB, no payment writes, and no inferred instalments.
 *
 * The old ledger has customer/Satori paid FLAGS, not an allocated cash ledger.
 * The numbers below are explicitly "by legacy flag", never bank-confirmed cash.
 */
data class AccountingProReadOnlySummary(
    val activeInvoiceCount: Int,
    val excludedInvoiceCount: Int,
    val customerPaidFlagCount: Int,
    val customerUnpaidFlagCount: Int,
    val satoriPaidFlagCount: Int,
    val satoriUnpaidFlagCount: Int,
    val questionableInvoiceCount: Int,
    val invalidDateCount: Int,
    val grossByLegacyFlags: Long?,
    val unpaidByLegacyFlags: Long?
)

object AccountingProReadOnly {
    fun summarize(invoices: List<SatoriInvoice>): AccountingProReadOnlySummary {
        val active = invoices.filterNot { it.isExcluded }
        val numbers = active.groupingBy { it.number.trim() }.eachCount()
        val ids = active.groupingBy { it.id.trim() }.eachCount()
        val questionable = active.count { row ->
            row.id.isBlank() || row.id.startsWith("row-") ||
                row.number.toLongOrNull()?.let { it <= 0L } != false ||
                numbers[row.number.trim()] != 1 || ids[row.id.trim()] != 1
        }
        // Do not silently calculate money from duplicated, missing or overflowed
        // invoice identity. Those require manual reconciliation first.
        val gross = if (questionable == 0)
            checkedSum(active.map { it.total }) else null
        val unpaid = if (questionable == 0)
            checkedSum(active.filterNot { it.customerHasPaid }.map { it.total }) else null
        return AccountingProReadOnlySummary(
            activeInvoiceCount = active.size,
            excludedInvoiceCount = invoices.size - active.size,
            customerPaidFlagCount = active.count { it.customerHasPaid },
            customerUnpaidFlagCount = active.count { !it.customerHasPaid },
            satoriPaidFlagCount = active.count { it.satoriHasPaid },
            satoriUnpaidFlagCount = active.count { !it.satoriHasPaid },
            questionableInvoiceCount = questionable,
            invalidDateCount = active.count { !it.hasValidDate },
            grossByLegacyFlags = gross,
            unpaidByLegacyFlags = unpaid
        )
    }

    private fun checkedSum(amounts: List<Long>): Long? = try {
        amounts.fold(0L) { sum, value ->
            require(value >= 0L)
            Math.addExact(sum, value)
        }
    } catch (_: ArithmeticException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }
}
