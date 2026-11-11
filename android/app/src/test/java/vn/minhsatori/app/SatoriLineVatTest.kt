package vn.minhsatori.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SatoriLineVatTest {
    @Test fun computesVatIndependentlyForEachInvoiceLine() {
        assertEquals(1600L, SatoriPercentCharges.amount(20000L, "8"))
        assertEquals(0L, SatoriPercentCharges.amount(5000L, "0"))
        assertEquals(1650L, SatoriPercentCharges.amount(30000L, "5.5"))
        assertEquals(3250L,
            listOf(
                SatoriPercentCharges.amount(20000L, "8"),
                SatoriPercentCharges.amount(5000L, "0"),
                SatoriPercentCharges.amount(30000L, "5.5")
            ).sum())
    }

    @Test fun usesWholeVndHalfUpRoundingPerLine() {
        assertEquals(73L, SatoriPercentCharges.amount(1000L, "7.25"))
        assertEquals(1L, SatoriPercentCharges.amount(10L, "5"))
        assertEquals(0L, SatoriPercentCharges.amount(1L, "5"))
    }

    @Test fun rejectsRatesOutsideTheSupportedRangeOrPrecision() {
        listOf("-0.01", "100.01", "1.234", "abc", "").forEach { invalid ->
            assertThrows(IllegalArgumentException::class.java) {
                SatoriPercentCharges.amount(10000L, invalid)
            }
        }
    }

    @Test fun legacyAggregateVatCanBeConvertedToAnInitialLineRate() {
        assertEquals("8", SatoriPercentCharges.fromAmount(20000L, 1600L))
        assertEquals("0", SatoriPercentCharges.fromAmount(20000L, 0L))
    }
    @Test fun driveSnapshotRestoresEachLineTaxChoice() {
        val items = org.json.JSONArray()
            .put(org.json.JSONObject().put("product", "Water")
                .put("qty", 2).put("unitPrice", 10000).put("listPrice", 10000)
                .put("vatRate", 8).put("vatAmount", 1600))
            .put(org.json.JSONObject().put("product", "Deposit")
                .put("qty", 1).put("unitPrice", 5000).put("listPrice", 5000)
                .put("vatRate", 0).put("vatAmount", 0))
            .put(org.json.JSONObject().put("product", "Service")
                .put("qty", 2).put("unitPrice", 15000).put("listPrice", 15000)
                .put("vatRate", 5.5).put("vatAmount", 1650))
        val order = org.json.JSONObject()
            .put("id", 7001).put("invoiceNo", 9701).put("name", "Fake VAT")
            .put("phone", "0900000000").put("location", "Fake VAT Address")
            .put("status", "Chưa thanh toán").put("total", 58250)
            .put("shippingAmount", 500).put("vatAmount", 3250).put("items", items)
        val values = org.json.JSONObject().put("satori_orders_v15",
            org.json.JSONArray().put(order).toString())
        val snapshot = SatoriData.fromDriveState(
            org.json.JSONObject().put("revision", 1).put("values", values).toString())
        val lines = snapshot.invoices.single().lines
        assertEquals(listOf(8.0, 0.0, 5.5), lines.map { it.vatRate })
        assertEquals(listOf(1600L, 0L, 1650L), lines.map { it.vatAmount })
        assertEquals(3250L, snapshot.invoices.single().vat)
    }

    @Test fun newManualLineDefaultsToNoTax() {
        assertEquals("0", SatoriPercentCharges.manualLineDefaultVatRate())
    }

}
