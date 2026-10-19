package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject

class SatoriModelsTest {
    @Test
    fun parsesMultilineProductsAndDeliveryNotesWithoutMutatingData() {
        val state = """
            {
              "revision": 102,
              "updatedAt": "2026-10-19T08:48:44Z",
              "values": {
                "satori_orders_v15": "[{\"id\":1,\"invoiceNo\":5927,\"date\":\"19/10/2026\",\"name\":\"Quán 18+\",\"status\":\"Đã thanh toán\",\"phone\":\"0900000000\",\"location\":\"Cát Lái\",\"total\":680000,\"deliveryNote\":\"Giao trong giờ hành chính\",\"items\":[{\"product\":\"Satori 350ml\",\"qty\":10,\"unit\":\"Thùng\",\"unitPrice\":68000}]}]"
              }
            }
        """.trimIndent()
        val snapshot = SatoriData.fromDriveState(state)
        assertEquals(102L, snapshot.revision)
        assertEquals(1, snapshot.invoices.size)
        val bill = snapshot.invoices.single()
        assertEquals("5927", bill.number)
        assertEquals("Giao trong giờ hành chính", bill.deliveryNote)
        assertEquals(680000L, bill.lines.single().amount)
        assertTrue(bill.customerHasPaid)
        assertFalse(bill.isOutstanding)
        assertEquals(0L, snapshot.outstandingAmount)
        assertTrue(SatoriData.search(bill, "QUAN 18"))
    }

    @Test
    fun tracksCollaboratorPriceViewAsExcludedNotAnotherDebt() {
        val state = """{"revision":1,"values":{"satori_orders_v15":"[{\"id\":1,\"invoiceNo\":5920,\"name\":\"Hà Minh Nguyệt\",\"status\":\"Chưa thanh toán\",\"total\":1526399},{\"id\":2,\"invoiceNo\":5921,\"name\":\"Hà Minh Nguyệt\",\"status\":\"Không Tính\",\"total\":1240199,\"duplicatedFromInvoiceNo\":5920}]"}}"""
        val data = SatoriData.fromDriveState(state)
        assertEquals(2, data.invoices.size)
        assertEquals(1, data.outstandingCount)
        assertEquals(1526399L, data.outstandingAmount)
        assertEquals(1, data.activeCount)
        assertTrue(data.invoices.any { it.duplicateFrom == "5920" })
    }

    @Test
    fun keepsCustomersWithDifferentLocationsSeparate() {
        val template = """{"revision":2,"values":{"satori_orders_v15":"[{\"id\":1,\"invoiceNo\":10,\"name\":\"Traky Hair\",\"phone\":\"0900\",\"location\":\"Quang Trung\",\"total\":100},{\"id\":2,\"invoiceNo\":11,\"name\":\"Traky Hair\",\"phone\":\"0900\",\"location\":\"Cát Lái\",\"total\":200}]"}}"""
        val invoices = SatoriData.fromDriveState(template).invoices
        assertNotEquals(SatoriData.customerKey(invoices[0]), SatoriData.customerKey(invoices[1]))
    }

    @Test
    fun satoriSettlementDoesNotCountAsCustomerPayment() {
        val unpaid = JSONObject().put("id", 1).put("invoiceNo", 101)
            .put("name", "Khách đã TT Satori")
            .put("status", "Đã TT Satori").put("total", 20000)
        val paid = JSONObject(unpaid.toString()).put("id", 2)
            .put("invoiceNo", 102).put("customerPaidAt", "2026-10-19T14:00:00Z")
        val values = JSONObject().put("satori_orders_v15",
            JSONArray().put(unpaid).put(paid).toString())
        val snapshot = SatoriData.fromDriveState(
            JSONObject().put("revision", 6).put("values", values).toString())
        val invoice101 = snapshot.invoices.single { it.number == "101" }
        val invoice102 = snapshot.invoices.single { it.number == "102" }
        assertTrue(invoice101.isOutstanding)
        assertTrue(invoice101.canMarkCustomerPaid)
        assertFalse(invoice101.canEditOrDelete)
        assertTrue(invoice102.customerHasPaid)
        assertFalse(invoice102.canMarkCustomerPaid)
        assertFalse(invoice102.canEditOrDelete)
        assertFalse(invoice102.isOutstanding)
    }

    @Test(expected = IllegalArgumentException::class)
    fun refusesSnapshotWithoutRevision() {
        SatoriData.fromDriveState("""{"values":{"satori_orders_v15":"[]"}}""")
    }
}
