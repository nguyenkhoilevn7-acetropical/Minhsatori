package vn.minhsatori.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

class InvoiceCreatedTimeTest {
    private fun invoice(timestamp: Any?): SatoriInvoice {
        val order = JSONObject()
            .put("id", 1234)
            .put("invoiceNo", 5965)
            .put("date", "01/11/2026")
            .put("name", "KHÁCH GIẢ LẬP")
            .put("status", "Chưa thanh toán")
            .put("total", 0)
            .put("updatedAt", "2026-12-01T20:00:00Z")
        if (timestamp != null) order.put("timestamp", timestamp)
        val root = JSONObject()
            .put("revision", 9)
            .put("values", JSONObject().put("satori_orders_v15",
                JSONArray().put(order).toString()))
        return SatoriData.fromDriveState(root.toString()).invoices.single()
    }

    @Test
    fun creationTimeComesFromSavedLedgerAndUsesVietnamTimezone() {
        val saved = Instant.parse("2026-11-01T04:12:34Z").toEpochMilli()
        val result = invoice(saved)
        assertEquals(saved, result.creationTimestampMillis)
        assertEquals("01/11/2026 11:12:34", result.creationTimeLabel)
        assertEquals("01/11/2026", result.date)
    }

    @Test
    fun missingOrInvalidCreationTimestampDoesNotGuessFromUpdatedAt() {
        assertEquals("", invoice(null).creationTimeLabel)
        assertEquals("", invoice(0).creationTimeLabel)
        assertEquals("", invoice(1793510000L).creationTimeLabel) // seconds, not milliseconds
        assertTrue(invoice(Instant.parse("2026-11-01T04:12:34Z").toEpochMilli())
            .creationTimeLabel.isNotBlank())
    }
}
