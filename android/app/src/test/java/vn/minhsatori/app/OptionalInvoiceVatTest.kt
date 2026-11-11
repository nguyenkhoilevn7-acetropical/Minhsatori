package vn.minhsatori.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OptionalInvoiceVatTest {
    private fun invoice(tax: Boolean): SatoriInvoice {
        val line = JSONObject().put("product", "Synthetic deposit").put("qty", 1)
            .put("unitPrice", 5).put("listPrice", 5)
        val order = JSONObject().put("id", "synthetic-1").put("invoiceNo", 1)
            .put("name", "Synthetic customer").put("location", "Synthetic address")
            .put("total", 5).put("vatAmount", 0).put("items", JSONArray().put(line))
        if (tax) {
            order.put("vatMode", "per_line").put("vatRate", 10)
            line.put("vatExempt", true).put("vatRate", 0).put("vatAmount", 0)
        }
        return SatoriData.fromDriveState(JSONObject().put("revision", 1)
            .put("values", JSONObject().put("satori_orders_v15", JSONArray().put(order).toString()))
            .toString()).invoices.single()
    }
    @Test fun reloadPreservesHeaderAndExemptionSnapshot() {
        val bill = invoice(true)
        assertEquals("per_line", bill.vatMode)
        assertEquals(10.0, bill.vatRate)
        assertTrue(bill.lines.single().vatExempt)
        assertEquals(0L, bill.lines.single().vatAmount)
        assertTrue(bill.canEditOrDelete)
        assertTrue(bill.canChangePayment)
    }
    @Test fun legacyReloadDoesNotManufactureTaxFields() {
        val bill = invoice(false)
        assertEquals("invoice", bill.vatMode)
        assertNull(bill.vatRate)
        assertNull(bill.lines.single().vatRate)
        assertNull(bill.lines.single().vatAmount)
        assertFalse(bill.lines.single().vatExempt)
    }
    @Test fun lineVatUsesHalfUpAndRequiresIntentionalRate() {
        assertEquals(1L, SatoriLineTax.amount(5L, "10", false))
        assertEquals(0L, SatoriLineTax.amount(5L, "", true))
        assertThrows(IllegalArgumentException::class.java) { SatoriLineTax.amount(5L, "", false) }
    }
}
