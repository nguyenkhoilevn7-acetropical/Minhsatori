package vn.minhsatori.app

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test

class AccountingProDebtProfitPolicyTest {
    private fun bill(
        id: String, number: String, date: String = "2026-10-30",
        status: String = "Chưa thanh toán", listPrice: Long = 100_000L,
        isTest: Boolean = false
    ) = SatoriInvoice(
        id = id, number = number, date = date, customer = "Khách",
        phone = "0900000000", address = "Thủ Đức",
        status = status, total = 800_000L, shipping = 0L, vat = 0L,
        lines = listOf(SatoriLine("Suối", 10, "thùng", 80_000L, listPrice, code = "SUOI")),
        deliveryNote = "", customerPaidAt = "", duplicateFrom = "",
        isTest = isTest
    )

    private fun report(items: List<SatoriInvoice>, period: AccountingProMargin45Period) =
        AccountingProDebtProfitPolicy.report(
            items, AccountingProMargin45.calculate(items), period)

    @Test fun allTimeDebtCountsOnlyUnpaidButProfitIncludesPaidSales() {
        val unpaid = bill("one", "5901")
        val paid = bill("two", "5902", status = "Đã thanh toán")
        val result = report(listOf(unpaid, paid), AccountingProMargin45Period.all())
        assertEquals(1, result.outstandingInvoices.size)
        assertEquals(800_000L, result.outstandingVnd)
        assertEquals(2, result.margin.computedInvoiceCount)
        assertEquals(500_000L, result.margin.estimatedMarginKnownVnd)
    }

    @Test fun dayFilterAppliesToDebtAndProfitAtTheSameTime() {
        val today = bill("one", "5901", date = "2026-10-30")
        val previous = bill("two", "5902", date = "2026-10-29")
        val result = report(listOf(today, previous),
            AccountingProMargin45Period.day(LocalDate.of(2026, 10, 30)))
        assertEquals(listOf("5901"), result.outstandingInvoices.map { it.number })
        assertEquals(800_000L, result.outstandingVnd)
        assertEquals(250_000L, result.margin.estimatedMarginKnownVnd)
    }

    @Test fun fullPeriodPreservesUndatedDebtButDateFilterNeverGuessesDate() {
        val valid = bill("one", "5901")
        val invalid = bill("two", "5902", date = "bad-date")
        val items = listOf(valid, invalid)
        val all = report(items, AccountingProMargin45Period.all())
        assertEquals(2, all.outstandingInvoices.size)
        assertEquals(1_600_000L, all.outstandingVnd)
        assertEquals(1, all.invalidDateDebtCount)
        val dated = report(items,
            AccountingProMargin45Period.month(2026, 10))
        assertEquals(1, dated.outstandingInvoices.size)
        assertEquals(800_000L, dated.outstandingVnd)
        assertEquals(250_000L, dated.margin.estimatedMarginKnownVnd)
    }

    @Test fun excludedTestInvoicesDoNotEnterEitherTotal() {
        val valid = bill("one", "5901")
        val excluded = bill("two", "5902", isTest = true)
        val result = report(listOf(valid, excluded), AccountingProMargin45Period.all())
        assertEquals(1, result.outstandingInvoices.size)
        assertEquals(1, result.margin.totalInvoiceCount)
    }

    @Test fun unknownPurchasePriceDoesNotBecomeZeroProfit() {
        val unknown = bill("one", "5901", listPrice = 0L)
        val result = report(listOf(unknown), AccountingProMargin45Period.all())
        assertEquals(800_000L, result.outstandingVnd)
        assertNull(result.margin.estimatedMarginKnownVnd)
        assertEquals(1, result.margin.missingInvoiceCount)
    }
}
