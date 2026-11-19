package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject

class SatoriCustomerHistoryTest {
    private fun bill(
        no: String, name: String = "Hà Minh Nguyệt",
        phone: String = "0983000970", address: String = "LK 22-10 Trần Quý Kiên",
        status: String = "Chưa thanh toán", qty: Int = 8,
        updatedAt: Long? = null, isTest: Boolean = false,
        pairRole: String = ""
    ) = SatoriInvoice(
        id = "ledger-$no", number = no, date = "19/11/2026",
        customer = name, phone = phone, address = address, status = status,
        total = qty * 40000L, shipping = 0L, vat = 0L,
        lines = listOf(SatoriLine("Hikari bình 19L", qty, "Bình", 40000L, 50000L)),
        deliveryNote = "Giao đầu giờ", customerPaidAt = "", duplicateFrom = "",
        updatedTimestampMillis = updatedAt, isTest = isTest, pairRole = pairRole
    )

    private val saved = SatoriCustomerMemory(
        id = "ctv-nguyet", name = "Hà Minh Nguyệt", aliases = listOf("Ha Minh Nguyet"),
        defaultPhone = "0983000970", defaultLocation = "LK 22-10 Trần Quý Kiên",
        discountPercent = 20.0, preferredProduct = "Satori 500ml",
        orderCount = 2, receivers = emptyList()
    )

    @Test fun editedInvoiceIsProjectedFromLedgerNotStaleAiMemory() {
        val before = bill("6008", qty = 2, updatedAt = 1795030000000)
        val after = bill("6008", qty = 8, updatedAt = 1795081491000)
        val old = SatoriCustomerHistory.forMemory(saved, listOf(before))
        val fresh = SatoriCustomerHistory.forMemory(saved, listOf(after))
        assertEquals(1, old.verifiedDelivery.size)
        assertEquals(2, old.verifiedDelivery.single().lines.single().quantity)
        assertEquals(8, fresh.verifiedDelivery.single().lines.single().quantity)
        assertTrue(SatoriCustomerHistory.detail(fresh.verifiedDelivery).contains("Hikari bình 19L ×8 Bình"))
        assertTrue(SatoriCustomerHistory.detail(fresh.verifiedDelivery).contains("#6008"))
        assertEquals(2, saved.orderCount) // AI training counts do not dictate current invoice history.
    }

    @Test fun sameNameIsNeverAutomaticallyMergedWithAnotherDelivery() {
        val exact = bill("6008")
        val other = bill("5994", phone = "0338915675", address = "R4-26 Đường số 6")
        val group = SatoriCustomerHistory.forMemory(saved, listOf(other, exact))
        assertEquals(listOf("6008"), group.verifiedDelivery.map { it.number })
        assertEquals(listOf("5994"), group.sameNameUnverified.map { it.number })
        assertEquals(listOf("6008"),
            SatoriCustomerHistory.exactPoint(exact, listOf(exact,other)).map { it.number })
        assertEquals(listOf("5994"),
            SatoriCustomerHistory.sameNameOtherPoints(exact, listOf(exact,other)).map { it.number })
    }

    @Test fun changedDeliveryRemainsDiscoverableButIsNoLongerClaimedVerified() {
        val edited = bill("6008", address = "Địa chỉ đã sửa", qty = 4)
        val projection = SatoriCustomerHistory.forMemory(saved, listOf(edited))
        assertTrue(projection.verifiedDelivery.isEmpty())
        assertEquals("6008",projection.sameNameUnverified.single().number)
        assertTrue(SatoriCustomerHistory.detail(projection.sameNameUnverified).contains("×4"))
    }

    @Test fun testInvoicesAndInternalCtvSettlementAreNeverPresentedAsBuyerHistory() {
        val real = bill("6008")
        val test = bill("9000",isTest=true)
        val internal = bill("5921",pairRole="collaborator")
        val cancelled = bill("5914",status="Đã hủy")
        val result = SatoriCustomerHistory.forMemory(saved,listOf(real,test,internal,cancelled))
        assertEquals(setOf("6008","5914"),result.verifiedDelivery.map{it.number}.toSet())
        assertTrue(SatoriCustomerHistory.detail(listOf(cancelled)).contains("Không tính doanh thu/công nợ"))
    }

    @Test fun latestRevisionEditTimeSortsFirstButOriginalInvoiceDateIsPreserved() {
        val edited = bill("5953",qty=5,updatedAt=1795081491000)
        val newOrder = bill("6008",qty=8,updatedAt=1795081000000)
        val group = SatoriCustomerHistory.forMemory(saved,listOf(newOrder,edited))
        assertEquals(listOf("5953","6008"),group.verifiedDelivery.map{it.number})

        val item = JSONObject().put("product","Hikari bình 19L")
            .put("qty",5).put("unitPrice",40000).put("listPrice",50000)
        val raw = JSONObject()
            .put("id",95).put("invoiceNo",5953).put("name","Hà Minh Nguyệt")
            .put("date","02/11/2026").put("phone","0983000970")
            .put("location","LK 22-10 Trần Quý Kiên")
            .put("total",200000).put("items",JSONArray().put(item))
            .put("updatedAt","2026-11-19T09:44:51.762Z")
        val source = JSONObject().put("revision",288).put("values",
            JSONObject().put("satori_orders_v15",JSONArray().put(raw).toString()))
        val parsed = SatoriData.fromDriveState(source.toString()).invoices.single()
        assertEquals("02/11/2026",parsed.date)
        assertEquals(1795081491762L,parsed.updatedTimestampMillis)
    }
}
