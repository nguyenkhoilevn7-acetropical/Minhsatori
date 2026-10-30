package vn.minhsatori.app

/**
 * Android Accounting Pro, phase 1–2: pure read-only projection of the CURRENT
 * canonical invoice snapshot. No local bank feed, payment allocation or
 * write-capable integration is constructed by this module.
 *
 * Customer and Satori flags are independent. A customer flag is NOT proof of
 * bank settlement, and an unpaid flag is NOT an accurate partial-payment due.
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

data class AccountingProInvoiceReview(
    val invoice: SatoriInvoice,
    val identityReliable: Boolean,
    val reason: String
) {
    val needsIdentityReview: Boolean get() = !identityReliable
    val needsDateReview: Boolean get() = !invoice.hasValidDate
    val pendingCustomerFlag: Boolean get() = !invoice.customerHasPaid
    val pendingSatoriFlag: Boolean get() = !invoice.satoriHasPaid
}

object AccountingProReadOnly {
    /**
     * One row per active invoice, never aggregated by matching human names.
     * Duplicate invoice numbers OR immutable IDs are marked unsafe rather than
     * silently selected, even when the amounts happen to match.
     */
    fun invoiceRows(invoices: List<SatoriInvoice>): List<AccountingProInvoiceReview> {
        val active = invoices.filterNot { it.isExcluded }
        val numbers = active.groupingBy { it.number.trim() }.eachCount()
        val ids = active.groupingBy { it.id.trim() }.eachCount()
        return active.map { invoice ->
            val id = invoice.id.trim()
            val number = invoice.number.trim()
            val reason = when {
                id.isBlank() || id.startsWith("row-") -> "ID hóa đơn gốc thiếu/chỉ là giá trị tạm."
                number.toLongOrNull()?.let { it > 0L } != true ->
                    "Số hóa đơn gốc không hợp lệ."
                numbers[number] != 1 -> "Số hóa đơn trùng trong dữ liệu đang xem."
                ids[id] != 1 -> "ID hóa đơn gốc bị trùng."
                else -> ""
            }
            AccountingProInvoiceReview(invoice, reason.isEmpty(), reason)
        }.sortedWith(compareByDescending<AccountingProInvoiceReview> { it.invoice.sortDate }
            .thenByDescending { it.invoice.number.toLongOrNull() ?: 0L })
    }

    fun summarize(invoices: List<SatoriInvoice>): AccountingProReadOnlySummary {
        val active = invoices.filterNot { it.isExcluded }
        val rows = invoiceRows(invoices)
        val questionable = rows.count { it.needsIdentityReview }
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
