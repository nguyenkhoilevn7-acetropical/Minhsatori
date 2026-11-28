package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

class InvoicePdfFilenameTest {
    private fun bill(no: String = "5988", recipient: String = "Traky Sài Gòn",
                     date: String = "12/11/2026") = SatoriInvoice(
        id = "synthetic", number = no, date = date, customer = recipient,
        phone = "", address = "", status = "Chưa thanh toán",
        total = 0L, shipping = 0L, vat = 0L, lines = emptyList(),
        deliveryNote = "", customerPaidAt = "", duplicateFrom = ""
    )

    @Test fun matchesRecipientOrderDateForZaloAndPreview() {
        assertEquals("5988 - Traky Sài Gòn - 2026-11-12.pdf",
            InvoicePdfFilename.forInvoice(bill()))
        assertEquals("5988 - Traky Sài Gòn - 2026-11-12.pdf",
            InvoicePdfFilename.forInvoice(bill(date = "2026-11-12")))
    }
    @Test fun preventsUnsafePathsAndUuidInFilename() {
        assertEquals("5988 - Cô Lan Q.1 - 2026-11-12.pdf",
            InvoicePdfFilename.forInvoice(bill(recipient = "Cô Lan/ Q.1")))
        assertFalse(InvoicePdfFilename.forInvoice(bill()).contains("synthetic"))
    }
    @Test fun badOrderDatesFailClosedWithoutUsingNow() {
        listOf("", "31/02/2026", "2026-13-12").forEach { d ->
            assertThrows(IllegalArgumentException::class.java) {
                InvoicePdfFilename.forInvoice(bill(date = d))
            }
        }
        assertThrows(IllegalArgumentException::class.java) {
            InvoicePdfFilename.forInvoice(bill(recipient = ""))
        }
    }
}
