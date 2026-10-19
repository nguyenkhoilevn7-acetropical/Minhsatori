package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

class SatoriPriceComparisonTest {
    private val day = 1792368000000L // plausible 2026 website Date.now() id
    private fun invoice(
        id: Long, number: String,
        status: String = "Chưa thanh toán", total: Long = 950400L,
        phone: String = "0903 123 456", address: String = "96 Tôn Đản",
        date: String = "19/10/2026", quantity: Int = 10,
        linkedTo: String = ""
    ): SatoriInvoice = SatoriInvoice(
        id = id.toString(), number = number, date = date,
        customer = "Hà Minh Nguyệt", phone = phone, address = address,
        status = status, total = total, shipping = 0L, vat = 0L,
        lines = listOf(SatoriLine("Nước Satori 350ml", quantity, "Thùng",
            unitPrice = 68000L, listPrice = 88000L)),
        deliveryNote = "", customerPaidAt = "", duplicateFrom = linkedTo
    )

    @Test
    fun recognizesLinkedPriceViewsCreatedMinutesApart() {
        val main = invoice(day, "5914", total = 950400)
        val discount = invoice(day + 4 * 60 * 1000, "5918",
            status = "Không Tính", total = 617760, linkedTo = "5914")
        val outcome = SatoriPriceComparison.compare(listOf(main, discount))
        assertEquals(1, outcome.pairs.size)
        assertEquals("5914", outcome.pairs.single().delivery.number)
        assertEquals("5918", outcome.pairs.single().alternate.number)
        assertEquals(332640L, outcome.pairs.single().priceDifference)
        assertEquals(0, outcome.toReview.size)
        assertEquals(0, outcome.notPairedCount)
    }

    @Test
    fun keepsTwoSameDayDeliveryOrdersSeparateWithoutPriceViewEvidence() {
        val result = SatoriPriceComparison.compare(listOf(
            invoice(day, "5914"), invoice(day + 5 * 60 * 1000, "5918")
        ))
        assertEquals(0, result.pairs.size)
        assertEquals(1, result.toReview.size)
        assertEquals(2, result.notPairedCount)
        assertTrue(result.toReview.single().reason.contains("chưa xác nhận"))
    }

    @Test
    fun differingDeliveryAddressOrPhoneIsReviewNotAutomaticMatch() {
        val main = invoice(day, "5914")
        val alternate = invoice(day + 30_000L, "5918",
            status = "Không Tính", address = "18 Cát Lái", linkedTo = "5914")
        val outcome = SatoriPriceComparison.compare(listOf(main, alternate))
        assertTrue(outcome.pairs.isEmpty())
        assertEquals(1, outcome.toReview.size)
        val otherPhone = alternate.copy(address = main.address, phone = "0903123457")
        assertEquals(1, SatoriPriceComparison.compare(
            listOf(main, otherPhone)).toReview.size)
    }

    @Test
    fun farApartOrUnknownCreateTimeNeverBecomesAutomaticPair() {
        val older = invoice(day, "5914")
        val other = invoice(day + 31 * 60 * 1000L, "5918",
            status = "Không Tính", linkedTo = "5914")
        assertEquals(0, SatoriPriceComparison.compare(
            listOf(older, other)).pairs.size)
        val missingTimestamp = other.copy(id = "row-2")
        val result = SatoriPriceComparison.compare(listOf(older, missingTimestamp))
        assertEquals(0, result.pairs.size)
        assertEquals(1, result.toReview.size)
    }

    @Test
    fun moreThanTwoInvoicesOrInvalidDatesMustBeReviewed() {
        val a = invoice(day, "5914")
        val b = invoice(day + 60_000L, "5918", status = "Không Tính")
        val c = invoice(day + 120_000L, "5920")
        val many = SatoriPriceComparison.compare(listOf(a, b, c))
        assertTrue(many.pairs.isEmpty())
        assertEquals(1, many.toReview.size)
        assertEquals(3, many.notPairedCount)
        val badDate = SatoriPriceComparison.compare(listOf(
            a.copy(date = "22/0802026"), b.copy(date = "22/0802026")
        ))
        assertTrue(badDate.pairs.isEmpty())
        assertEquals(1, badDate.toReview.size)
    }

    @Test
    fun distinctQuantityOrCancelledOrOtherDayDoNotCreatePairs() {
        val main = invoice(day, "5914")
        val alt = invoice(day + 60_000L, "5918", status = "Không Tính")
        assertEquals(0, SatoriPriceComparison.compare(listOf(
            main, alt.copy(lines = listOf(
                SatoriLine("Nước Satori 350ml", 20, "Thùng", 68000, 88000)))
        )).pairs.size)
        assertEquals(0, SatoriPriceComparison.compare(listOf(
            main, alt.copy(status = "Đã hủy")
        )).pairs.size)
        assertEquals(0, SatoriPriceComparison.compare(listOf(
            main, alt.copy(date = "20/10/2026")
        )).pairs.size)
    }
}
