package vn.minhsatori.app

import java.math.BigInteger

/**
 * Read-only Android projection. Both totals share the same invoice-date filter:
 * debt is for unpaid customer invoices, while profit spans all valid sales
 * in the selected period (including already-paid customer invoices).
 *
 * "Profit" in the UI is the existing 45%-supplier-discount GROSS estimate;
 * never record it as verified net profit or send financial writes.
 */
data class AccountingProDebtProfitView(
    val outstandingInvoices: List<SatoriInvoice>,
    val outstandingVnd: Long?,
    val margin: AccountingProMargin45Summary,
    val invalidDateDebtCount: Int
)

object AccountingProDebtProfitPolicy {
    fun report(
        invoices: List<SatoriInvoice>,
        margins: List<AccountingProMargin45Row>,
        period: AccountingProMargin45Period
    ): AccountingProDebtProfitView {
        val isAll = period.from == null && period.through == null
        // With "Tất cả", preserve the previous unpaid ledger even if a
        // historical bill has a malformed date; do not fabricate a date.
        val outstanding = invoices.filter { invoice ->
            invoice.isOutstanding && (isAll || period.includes(invoice))
        }
        val total = outstanding.fold(BigInteger.ZERO) { acc, invoice ->
            acc.add(BigInteger.valueOf(invoice.total))
        }
        val amount = if (total > BigInteger.valueOf(Long.MAX_VALUE)) null
            else total.toLong()
        val unknownDates = invoices.count { it.isOutstanding && !it.hasValidDate }
        return AccountingProDebtProfitView(
            outstanding,
            amount,
            AccountingProMargin45.summarize(margins, period),
            unknownDates
        )
    }
}
