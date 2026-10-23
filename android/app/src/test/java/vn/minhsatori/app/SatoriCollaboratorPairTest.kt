package vn.minhsatori.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Synthetic owner-only acceptance. No live Satori invoice is created. */
class SatoriCollaboratorPairTest {
    private val groupId = "pair_12345678-1234-1234-1234-123456789012"
    private fun fixture(): SatoriSnapshot {
        val item = JSONObject().put("code", "TP-00003")
            .put("product", "Nước Satori 500ml")
            .put("qty", 10).put("unit", "Thùng")
            .put("listPrice", 98000).put("unitPrice", 78400)
        val customer = JSONObject()
            .put("id", 1200000000001L).put("invoiceNo", 6001)
            .put("date", "23/10/2026").put("name", "Khách A")
            .put("phone", "0900000001").put("location", "123 Đường A")
            .put("status", "Chưa thanh toán").put("total", 784000)
            .put("items", JSONArray().put(item))
            .put("apiRequestId", "ctv-owner-order-0001")
            .put("pairGroupId", groupId).put("pairRole", "customer")
            .put("pairInvoiceNo", 6002)
            .put("pairCustomerName", "Khách A")
            .put("pairCollaboratorName", "CTV A")
            .put("pairDiscountPercent", 20)
            .put("collaboratorId", "ctv-001")
        val settlementItem = JSONObject(item.toString()).put("unitPrice", 63700)
        val collaborator = JSONObject(customer.toString())
            .put("id", 1200000000002L).put("invoiceNo", 6002)
            .put("name", "CTV A").put("total", 637000)
            .put("items", JSONArray().put(settlementItem))
            .put("pairRole", "collaborator").put("pairInvoiceNo", 6001)
            .put("pairDiscountPercent", 35)
        val orders = JSONArray().put(customer).put(collaborator)
        return SatoriData.fromDriveState(
            JSONObject().put("revision", 113).put("values",
                JSONObject().put("satori_orders_v15", orders.toString()))
                .toString()
        )
    }

    @Test fun readsRealFormatPairWithoutDoubleCountingSalesOrDebt() {
        val data = fixture()
        assertEquals(2, data.invoices.size)
        val buyer = data.invoices.single { it.isCustomerPairBill }
        val settlement = data.invoices.single { it.isInternalCollaboratorBill }
        assertEquals("CTV A", settlement.customer)
        assertEquals("6002", buyer.pairInvoiceNo)
        assertEquals("6001", settlement.pairInvoiceNo)
        assertEquals(20.0, buyer.pairDiscountPercent!!, 0.00001)
        assertEquals(35.0, settlement.pairDiscountPercent!!, 0.00001)
        assertTrue(buyer.pairLabel.contains("BILL KHÁCH"))
        assertTrue(settlement.pairLabel.contains("CTV NỘI BỘ"))
        assertTrue(SatoriData.search(buyer, "CTV A"))
        assertTrue(SatoriData.search(settlement, "Khách A"))
        val totals = SatoriLedger.totals(data.invoices)
        assertEquals(2, totals.recordCount)
        assertEquals(1, totals.countedCount)
        assertEquals(1, totals.excludedCount)
        assertEquals(784000L, totals.revenue)
        assertEquals(784000L, totals.customerUnpaid)
        assertEquals(1, data.activeCount)
        assertEquals(1, data.outstandingCount)
        assertFalse(settlement.canMarkCustomerPaid)
        assertFalse(settlement.isOutstanding)
        assertFalse(settlement.canEditOrDelete)
        assertFalse(buyer.canEditOrDelete)
        assertTrue(buyer.canMarkCustomerPaid)
    }

    @Test fun priceComparisonUsesExplicitPairEvenWhenBillToNamesDiffer() {
        val data = fixture()
        val result = SatoriPriceComparison.compare(data.invoices)
        assertEquals(1, result.pairs.size)
        assertEquals("6001", result.pairs.single().delivery.number)
        assertEquals("6002", result.pairs.single().alternate.number)
        assertEquals(147000L, result.pairs.single().priceDifference)
        assertEquals(0, result.toReview.size)
        assertEquals(0, result.notPairedCount)
    }

    @Test fun lostResponseProofRequiresBothLinkedBills() {
        val data = fixture()
        val buyer = data.invoices.single { it.isCustomerPairBill }
        val settlement = data.invoices.single { it.isInternalCollaboratorBill }
        assertEquals("6001", data.confirmedWrite("orders.create.pair",
            "ctv-owner-order-0001")?.number)
        assertNull(data.confirmedWrite("orders.create", "ctv-owner-order-0001"))
        assertNull(data.copy(invoices = listOf(buyer)).confirmedWrite(
            "orders.create.pair", "ctv-owner-order-0001"))
        assertNull(data.copy(invoices = listOf(buyer,
            settlement.copy(pairInvoiceNo = "9999"))).confirmedWrite(
            "orders.create.pair", "ctv-owner-order-0001"))
        assertNull(data.confirmedWrite("orders.create.pair", "wrong-id"))
    }

    @Test fun malformedOrCancelledHalfMustBeReviewedNotSilentlyPaired() {
        val data = fixture()
        val buyer = data.invoices.single { it.isCustomerPairBill }
        val settlement = data.invoices.single { it.isInternalCollaboratorBill }
        val wrongLink = SatoriPriceComparison.compare(
            listOf(buyer, settlement.copy(pairInvoiceNo = "9999")))
        assertEquals(0, wrongLink.pairs.size)
        assertEquals(1, wrongLink.toReview.size)
        assertEquals(2, wrongLink.notPairedCount)
        val wrongDelivery = SatoriPriceComparison.compare(
            listOf(buyer, settlement.copy(address = "Địa chỉ khác")))
        assertEquals(0, wrongDelivery.pairs.size)
        assertEquals(1, wrongDelivery.toReview.size)
        val cancelled = SatoriPriceComparison.compare(
            listOf(buyer, settlement.copy(status = "Đã hủy")))
        assertEquals(0, cancelled.pairs.size)
        assertEquals(1, cancelled.toReview.size)
        val orphan = SatoriPriceComparison.compare(listOf(buyer))
        assertEquals(1, orphan.toReview.size)
    }
}
