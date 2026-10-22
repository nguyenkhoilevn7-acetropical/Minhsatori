package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

/** Offline tests: never request a real invoice or connect to production. */
class PdfPreviewBudgetTest {
    @Test fun thirtyPageA4InvoiceStaysWithinRasterBudget() {
        var remaining = PdfPreviewBudget.MAX_TOTAL_BITMAP_BYTES
        for (index in 0 until 30) {
            val remainingPages = 30 - index
            val width = PdfPreviewBudget.widthForPage(595, 842, remainingPages, remaining, 1000)
            val bytes = PdfPreviewBudget.estimatedBytes(595, 842, width)
            assertTrue(width >= 128)
            assertTrue(bytes <= remaining / remainingPages)
            remaining -= bytes
        }
        assertTrue(remaining >= 0)
    }

    @Test fun singlePageRetainsReadableWidth() {
        assertEquals(1000, PdfPreviewBudget.widthForPage(
            595, 842, 1, PdfPreviewBudget.MAX_TOTAL_BITMAP_BYTES, 1000))
    }

    @Test fun pathologicalPdfFailsClosedInsteadOfAllocatingUnboundedBitmap() {
        assertThrows(IllegalArgumentException::class.java) {
            PdfPreviewBudget.widthForPage(1, 50000, 30, 5000, 1000)
        }
    }
}
