package vn.minhsatori.app

/**
 * Read-only invoice list filtering. Order newest first using canonical source
 * date/time, with invoice number as a tie-breaker (not a fabricated timestamp).
 */
internal object InvoiceScreenFilter {
    fun apply(source: List<SatoriInvoice>, filter: Int, query: String): List<SatoriInvoice> =
        source.asSequence()
            .filter { SatoriData.search(it, query) }
            .filter { invoice ->
                when (filter) {
                    1 -> !invoice.customerHasPaid && !invoice.isExcluded
                    2 -> invoice.customerHasPaid && !invoice.isExcluded
                    3 -> invoice.satoriHasPaid && !invoice.isExcluded
                    4 -> invoice.isNonCounted
                    5 -> invoice.isCancelled
                    else -> true
                }
            }
            .sortedWith(
                compareByDescending<SatoriInvoice> { it.sortDate }
                    .thenByDescending { it.creationTimestampMillis ?: 0L }
                    .thenByDescending { it.number.toLongOrNull() ?: 0L }
            ).toList()
}
