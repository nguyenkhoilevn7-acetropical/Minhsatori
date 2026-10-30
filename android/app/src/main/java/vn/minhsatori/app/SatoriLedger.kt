package vn.minhsatori.app

/** Read-only accounting totals, excluding TEST, cancelled and non-counted bills. */
data class SatoriLedgerTotals(
    val recordCount: Int,
    val countedCount: Int,
    val excludedCount: Int,
    val revenue: Long,
    val customerPaid: Long,
    val customerUnpaid: Long,
    val invalidDateCount: Int
)

/** Parity with the website's customer, date range, month, year, status and order filters.
 * Dates are ISO yyyy-MM-dd; impossible source dates are never silently guessed.
 * Profit sorting is intentionally absent until authoritative cost is available.
 */
data class SatoriLedgerFilter(
    val search: String = "",
    val status: String = "Tất cả",
    val customer: String = "",
    val fromIso: String = "",
    val toIso: String = "",
    val month: Int? = null,
    val year: Int? = null,
    val sort: String = "date_desc"
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
        queryAdvanced(invoices, SatoriLedgerFilter(search = text, status = status))

    fun queryAdvanced(invoices: List<SatoriInvoice>, filter: SatoriLedgerFilter): List<SatoriInvoice> {
        val normalizedCustomer = SatoriData.normalized(filter.customer.trim())
        val customerDigits = filter.customer.filter(Char::isDigit)
        val from = checkedIso(filter.fromIso)
        val to = checkedIso(filter.toIso)
        val filtered = invoices.filter { bill ->
            if (!SatoriData.search(bill, filter.search)) return@filter false
            if (filter.status != "Tất cả" && !bill.status.equals(filter.status, ignoreCase = true))
                return@filter false
            if (normalizedCustomer.isNotEmpty()) {
                val named = SatoriData.normalized(bill.customer).contains(normalizedCustomer)
                val phone = customerDigits.length >= 4 &&
                    bill.phone.filter(Char::isDigit).contains(customerDigits)
                if (!named && !phone) return@filter false
            }
            val needsDate = from != null || to != null || filter.month != null || filter.year != null
            if (needsDate && !bill.hasValidDate) return@filter false
            if (needsDate) {
                val date = bill.sortDate
                if (from != null && date < from) return@filter false
                if (to != null && date > to) return@filter false
                if (filter.month != null &&
                    date.substring(4, 6).toInt() != filter.month) return@filter false
                if (filter.year != null &&
                    date.substring(0, 4).toInt() != filter.year) return@filter false
            }
            true
        }
        val invoiceNumber: (SatoriInvoice) -> Long = { it.number.toLongOrNull() ?: -1L }
        return when (filter.sort) {
            "date_asc" -> filtered.sortedWith(
                compareBy<SatoriInvoice> { !it.hasValidDate }
                    .thenBy { it.sortDate }.thenBy(invoiceNumber))
            "revenue_desc" -> filtered.sortedWith(
                compareByDescending<SatoriInvoice> { it.accountingValue }
                    .thenByDescending { it.sortDate }.thenByDescending(invoiceNumber))
            "revenue_asc" -> filtered.sortedWith(
                compareBy<SatoriInvoice> { it.accountingValue }
                    .thenByDescending { it.sortDate }.thenByDescending(invoiceNumber))
            "invoice_desc" -> filtered.sortedWith(
                compareByDescending<SatoriInvoice>(invoiceNumber).thenByDescending { it.sortDate })
            "invoice_asc" -> filtered.sortedWith(
                compareBy<SatoriInvoice>(invoiceNumber).thenByDescending { it.sortDate })
            else -> filtered.sortedWith(
                compareByDescending<SatoriInvoice> { it.sortDate }.thenByDescending(invoiceNumber))
        }
    }

    // Ignore invalid date-picker strings rather than accidentally exclude invoices.
    private fun checkedIso(raw: String): String? {
        if (raw.isBlank()) return null
        return try {
            val d = java.time.LocalDate.parse(raw)
            d.toString().replace("-", "")
        } catch (_: java.time.DateTimeException) {
            null
        }
    }
}
