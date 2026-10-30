package vn.minhsatori.app

/**
 * Metadata-only acknowledgement for real canonical invoices. Never stores a
 * customer, amount, OAuth token, or full ledger snapshot.
 * Invoice numbers are monotonic in the original Minh Satori ledger.
 */
data class InvoiceBadgeEntry(val invoiceNo: Long, val isCustomerFacing: Boolean)
data class InvoiceBadgeState(val highWater: Long? = null, val unread: Set<Long> = emptySet()) {
    val count: Int get() = unread.size
}
data class InvoiceBadgeUpdate(val state: InvoiceBadgeState, val fresh: Set<Long>)

object InvoiceBadgePolicy {
    fun reconcile(previous: InvoiceBadgeState, entries: List<InvoiceBadgeEntry>): InvoiceBadgeUpdate {
        val valid = entries.filter { it.invoiceNo > 0 }
        val maxSeen = valid.maxOfOrNull { it.invoiceNo }
        if (previous.highWater == null) {
            // First verified sync is a baseline, never 130 false "new" invoices.
            return InvoiceBadgeUpdate(InvoiceBadgeState(maxSeen, emptySet()), emptySet())
        }
        val currentFacing = valid.asSequence().filter { it.isCustomerFacing }
            .map { it.invoiceNo }.toSet()
        val fresh = currentFacing.filter { it > previous.highWater }.toSet()
        val retained = previous.unread.intersect(currentFacing)
        return InvoiceBadgeUpdate(InvoiceBadgeState(
            highWater = maxOf(previous.highWater, maxSeen ?: previous.highWater),
            unread = retained + fresh
        ), fresh)
    }

    fun acknowledgeAll(state: InvoiceBadgeState): InvoiceBadgeState =
        state.copy(unread = emptySet())

    fun acknowledgeOne(state: InvoiceBadgeState, number: Long): InvoiceBadgeState =
        state.copy(unread = state.unread - number)
}
