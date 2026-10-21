package vn.minhsatori.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SatoriOrderValidationTest {
    @Test fun moneySupportsPlainDigitsAndThousandsGrouping() {
        assertEquals(65000L, SatoriOrderValidation.amount("65000"))
        assertEquals(65000L, SatoriOrderValidation.amount("65.000"))
        assertEquals(65000L, SatoriOrderValidation.amount("65,000"))
        assertEquals(1000000L, SatoriOrderValidation.amount("1 000 000"))
        assertEquals(0L, SatoriOrderValidation.amount(""))
    }

    @Test fun malformedPricesCannotSilentlyChangeTheBill() {
        listOf("1.50", "65,5", "12abc", "-100", "1.000,20", "9e5",
            "922337203685477580800").forEach { bad ->
            assertThrows(IllegalArgumentException::class.java) {
                SatoriOrderValidation.amount(bad)
            }
        }
    }

    @Test fun invalidDatesNeverBecomeDeliveryDates() {
        assertEquals("", SatoriOrderValidation.validDeliveryDate(""))
        assertEquals("2028-02-29", SatoriOrderValidation.validDeliveryDate("2028-02-29"))
        listOf("2026-02-29", "2026-02-30", "2026-13-01", "20/10/2026",
            "2026-01-00", "2026-12-32").forEach { bad ->
            assertThrows(IllegalArgumentException::class.java) {
                SatoriOrderValidation.validDeliveryDate(bad)
            }
        }
    }

    @Test fun sandboxMarkersAreRejectedByRealInvoiceApi() {
        val values = listOf(
            org.json.JSONObject().put("isTest", true),
            org.json.JSONObject().put("environment", "sandbox"),
            org.json.JSONObject().put("order", org.json.JSONObject().put("name", "[TEST] Demo")),
            org.json.JSONObject().put("invoiceNo", "TEST-000001")
        )
        values.forEach {
            org.junit.Assert.assertTrue(SatoriOrderValidation.requiresTestLedger("orders.create", it))
        }
        org.junit.Assert.assertFalse(SatoriOrderValidation.requiresTestLedger("orders.list", values[0]))
        org.junit.Assert.assertFalse(SatoriOrderValidation.requiresTestLedger("orders.create",
            org.json.JSONObject().put("order", org.json.JSONObject().put("name", "Khách thật"))))
    }

    @Test fun commonExplicitTestLabelsDoNotPassLiveWrites() {
        val marked = listOf(
            org.json.JSONObject().put("order", org.json.JSONObject().put("name", "TEST đơn giả")),
            org.json.JSONObject().put("order", org.json.JSONObject().put("deliveryNote", "test - không giao")),
            org.json.JSONObject().put("order", org.json.JSONObject().put("note", "Sandbox: kiểm tra")),
            org.json.JSONObject().put("order", org.json.JSONObject().put("name", "[ test ] Demo")),
            org.json.JSONObject().put("order", org.json.JSONObject().put("name", "TEST_ONLY Demo"))
        )
        marked.forEach {
            org.junit.Assert.assertTrue("Explicit TEST marker was not blocked: $it",
                SatoriOrderValidation.requiresTestLedger("orders.create", it))
        }
        listOf("Testing Cafe", "Contest Coffee", "Khách TESTA").forEach { customer ->
            org.junit.Assert.assertFalse(SatoriOrderValidation.requiresTestLedger("orders.create",
                org.json.JSONObject().put("order", org.json.JSONObject().put("name", customer))))
        }
    }

    @Test fun lineAndGrandTotalsRejectIntegerOverflow() {
        assertEquals(650000L, SatoriOrderValidation.lineAmount(10L, 65000L))
        assertEquals(702000L, SatoriOrderValidation.sum(650000L, 52000L, 0L))
        assertThrows(IllegalArgumentException::class.java) {
            SatoriOrderValidation.lineAmount(Long.MAX_VALUE, 2L)
        }
        assertThrows(IllegalArgumentException::class.java) {
            SatoriOrderValidation.sum(Long.MAX_VALUE, 1L)
        }
    }
}
