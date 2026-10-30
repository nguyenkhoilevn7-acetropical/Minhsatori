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
    fun explicitlyMarkedTestInvoicesNeverEnterAccountingOrWriteProof() {
        val orders = JSONArray()
            .put(JSONObject().put("invoiceNo", 103).put("name", "Khách thật")
                .put("status", "Chưa thanh toán").put("total", 20000))
            .put(JSONObject().put("invoiceNo", 104).put("name", "[TEST] Khách giả")
                .put("status", "Chưa thanh toán").put("total", 999999))
            .put(JSONObject().put("invoiceNo", 105).put("name", "Khách giả")
                .put("isTest", true).put("total", 888888)
                .put("apiRequestId", "not-a-real-request"))
        val state = JSONObject().put("revision", 15).put("values",
            JSONObject().put("satori_orders_v15", orders.toString()))
        val snapshot = SatoriData.fromDriveState(state.toString())
        assertEquals(3, snapshot.invoices.size)
        assertEquals(1, snapshot.activeCount)
        assertEquals(1, snapshot.outstandingCount)
        assertEquals(20000L, snapshot.outstandingAmount)
        assertEquals(2, snapshot.invoices.count { it.isTest })
        assertNull(snapshot.confirmedWrite("orders.create", "not-a-real-request"))
        snapshot.invoices.filter { it.isTest }.forEach {
            assertFalse(it.canEditOrDelete)
            assertFalse(it.canMarkCustomerPaid)
        }
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

    @Test
    fun nonCountedInvoiceKeepsOriginalTotalButShowsZeroInAccounting() {
        val invoice = JSONObject().put("id", 5916).put("invoiceNo", 5916)
            .put("name", "CTV kiểm thử").put("status", "Không Tính")
            .put("total", 1727996)
            .put("items", JSONArray().put(JSONObject()
                .put("product", "Nước ép ổi hồng").put("qty", 3)
                .put("unitPrice", 266666).put("listPrice", 333333)))
        val live = JSONObject().put("id", 5917).put("invoiceNo", 5917)
            .put("name", "Khách trả tiền").put("status", "Chưa thanh toán")
            .put("total", 950400)
        val state = JSONObject().put("revision", 190).put("values",
            JSONObject().put("satori_orders_v15",
                JSONArray().put(invoice).put(live).toString()))
        val data = SatoriData.fromDriveState(state.toString())
        val excluded = data.invoices.single { it.number == "5916" }
        assertTrue(excluded.isNonCounted)
        assertTrue(excluded.isExcluded)
        assertEquals("Không Tính", excluded.status)
        assertEquals(1727996L, excluded.total)
        assertEquals(0L, excluded.displayPayable)
        assertEquals(0L, excluded.accountingValue)
        assertFalse(excluded.canChangePayment)
        assertFalse(excluded.canMarkCustomerPaid)
        assertFalse(excluded.isOutstanding)
        val ledger = SatoriLedger.totals(data.invoices)
        assertEquals(950400L, ledger.revenue)
        assertEquals(950400L, ledger.customerUnpaid)
        assertEquals(1, ledger.excludedCount)
        assertEquals("5916", SatoriLedger.query(data.invoices, "#5916",
            "Không Tính").single().number)
        assertEquals("5916", SatoriLedger.queryAdvanced(data.invoices,
            SatoriLedgerFilter(sort = "revenue_asc")).first().number)
    }

    @Test
    fun cancelledInvoiceWithHistoricalPaymentStaysCancelledAndExcluded() {
        val source = JSONObject().put("id", 1).put("invoiceNo", 5914)
            .put("name", "Khách kiểm thử").put("status", "Đã hủy")
            .put("total", 950400).put("customerPaidAt", "2026-10-19T14:10:08Z")
            .put("satoriPaidAt", "2026-10-20T14:10:08Z")
        val orders = JSONArray().put(source)
        val state = JSONObject().put("revision", 189).put("values",
            JSONObject().put("satori_orders_v15", orders.toString()))
        val parsed = SatoriData.fromDriveState(state.toString())
        val invoice = parsed.invoices.single()
        assertTrue(invoice.isCancelled)
        assertTrue(invoice.isExcluded)
        assertEquals("Đã hủy", invoice.status)
        assertEquals("2026-10-19T14:10:08Z", invoice.customerPaidAt)
        assertFalse(invoice.customerHasPaid)
        assertFalse(invoice.satoriHasPaid)
        assertFalse(invoice.isOutstanding)
        assertFalse(invoice.canMarkCustomerPaid)
        assertFalse(invoice.canChangePayment)
        assertFalse(invoice.canEditOrDelete)
        assertEquals(0L, parsed.outstandingAmount)
        assertEquals(0, parsed.activeCount)
        assertNull(parsed.confirmedCustomerPayment("5914", 950400L))
    }

    @Test
    fun cancelledInvoicesAreNotDebtOrActiveAndCannotBePaid() {
        val orders = JSONArray()
            .put(JSONObject().put("id", 1).put("invoiceNo", 100)
                .put("name", "Khách A").put("status", "Đã hủy").put("total", 50000))
            .put(JSONObject().put("id", 2).put("invoiceNo", 101)
                .put("name", "Khách A").put("status", "Chưa thanh toán")
                .put("total", 30000))
        val values = JSONObject().put("satori_orders_v15", orders.toString())
        val snapshot = SatoriData.fromDriveState(
            JSONObject().put("revision", 1).put("values", values).toString())
        val cancelled = snapshot.invoices.single { it.number == "100" }
        assertTrue(cancelled.isExcluded)
        assertFalse(cancelled.isOutstanding)
        assertFalse(cancelled.canMarkCustomerPaid)
        assertFalse(cancelled.canEditOrDelete)
        assertEquals(1, snapshot.activeCount)
        assertEquals(1, snapshot.outstandingCount)
        assertEquals(30000L, snapshot.outstandingAmount)
    }

    @Test
    fun recognizesCommittedOrdersAfterLostMobileResponse() {
        val orders = JSONArray()
            .put(JSONObject().put("id", 1).put("invoiceNo", 100)
                .put("name", "Khách mới").put("apiRequestId", "create123"))
            .put(JSONObject().put("id", 2).put("invoiceNo", 101)
                .put("name", "Khách cũ").put("apiUpdateRequestId", "update123"))
            .put(JSONObject().put("id", 3).put("invoiceNo", 102)
                .put("name", "Khách khôi phục").put("apiRestoreRequestId", "restore123"))
        val root = JSONObject().put("revision", 15).put("values",
            JSONObject().put("satori_orders_v15", orders.toString()))
        val snapshot = SatoriData.fromDriveState(root.toString())
        assertEquals("100", snapshot.confirmedWrite("orders.create", "create123")?.number)
        assertEquals("101", snapshot.confirmedWrite("orders.update", "update123")?.number)
        assertEquals("102", snapshot.confirmedWrite("orders.restore", "restore123")?.number)
        assertNull(snapshot.confirmedWrite("orders.create", "not-matching"))
        assertNull(snapshot.confirmedWrite("orders.delete", "create123"))
        assertNull(snapshot.confirmedWrite("orders.create", ""))
    }

    @Test
    fun ledgerTotalsRespectWebsiteExclusionAndCustomerSettlementRules() {
        val orders = JSONArray()
            .put(JSONObject().put("id", 1).put("invoiceNo", 5914)
                .put("date", "19/10/2026").put("name", "Hà Minh Nguyệt")
                .put("status", "Chưa thanh toán").put("total", 950400))
            .put(JSONObject().put("id", 2).put("invoiceNo", 5918)
                .put("date", "19/10/2026").put("name", "Hà Minh Nguyệt")
                .put("status", "Không Tính").put("total", 617760))
            .put(JSONObject().put("id", 3).put("invoiceNo", 5920)
                .put("date", "19/10/2026").put("name", "Khách thanh toán")
                .put("status", "Đã thanh toán").put("total", 300000))
            .put(JSONObject().put("id", 4).put("invoiceNo", 5921)
                .put("date", "19/10/2026").put("name", "Đã TT Satori")
                .put("status", "Đã TT Satori").put("total", 150000))
            .put(JSONObject().put("id", 5).put("invoiceNo", 5922)
                .put("date", "19/10/2026").put("name", "Đơn hủy")
                .put("status", "Đã hủy").put("total", 100000))
            .put(JSONObject().put("id", 6).put("invoiceNo", 9)
                .put("date", "22/0802026").put("name", "Ngày lỗi")
                .put("status", "Chưa thanh toán").put("total", 0))
        val state = JSONObject().put("revision", 105).put("values",
            JSONObject().put("satori_orders_v15", orders.toString()))
        val invoices = SatoriData.fromDriveState(state.toString()).invoices
        val total = SatoriLedger.totals(invoices)
        assertEquals(6, total.recordCount)
        assertEquals(4, total.countedCount)
        assertEquals(2, total.excludedCount)
        assertEquals(1400400L, total.revenue)
        assertEquals(300000L, total.customerPaid)
        assertEquals(1100400L, total.customerUnpaid)
        assertEquals(1, total.invalidDateCount)
        val supplier = SatoriLedger.query(invoices, "", "Đã TT Satori")
        assertEquals(1, supplier.size)
        assertEquals(150000L, SatoriLedger.totals(supplier).customerUnpaid)
        val collaborator = SatoriLedger.query(invoices, "Hà Minh Nguyệt", "Không Tính")
        assertEquals(1, collaborator.size)
        assertEquals(0L, SatoriLedger.totals(collaborator).revenue)
    }

    @Test
    fun memoryReadsMultipleRecipientsWithoutModifyingDriveSource() {
        val receiverA = JSONObject().put("name", "Người nhận A")
            .put("phone", "0900111222").put("location", "Quận 1")
        val receiverB = JSONObject().put("name", "Người nhận B")
            .put("phone", "0900333444").put("location", "Quận 2")
        val memory = JSONObject().put("id", "cust_test")
            .put("name", "Khách nhiều chi nhánh")
            .put("aliases", JSONArray().put("Khách cũ"))
            .put("receivers", JSONArray().put(receiverA).put(receiverB))
            .put("defaultPhone", "0900111222")
            .put("defaultLocation", "Quận 1")
            .put("discountPercent", 35.0)
            .put("preferredProduct", "Nước Satori 350ml")
            .put("orderCount", 7)
        val values = JSONObject().put("satori_orders_v15", "[]")
            .put("satori_ai_customer_memory", JSONArray().put(memory).toString())
        val root = JSONObject().put("revision", 105).put("values", values)
        val raw = root.toString()
        val parsed = SatoriData.fromDriveState(raw)
        assertEquals(1, parsed.customerMemory.size)
        val cust = parsed.customerMemory.single()
        assertEquals("Khách nhiều chi nhánh", cust.name)
        assertEquals(2, cust.receivers.size)
        assertEquals("Quận 1", cust.receivers[0].location)
        assertEquals("Quận 2", cust.receivers[1].location)
        assertEquals("Khách cũ", cust.aliases.single())
        assertEquals(35.0, cust.discountPercent!!, 0.00001)
        assertEquals(raw, root.toString())
        val withoutMemory = JSONObject().put("revision", 106).put("values",
            JSONObject().put("satori_orders_v15", "[]"))
        assertTrue(SatoriData.fromDriveState(withoutMemory.toString()).customerMemory.isEmpty())
    }

    @Test
    fun catalogueUsesDrivePricesAndExplicitDiscountWithoutChangingSource() {
        val products = JSONArray()
            .put(JSONObject().put("code", "TP-00001")
                .put("name", "Nước tinh khiết Satori 350ml")
                .put("unit", "Thùng")
                .put("listPrice", 88000)
                .put("unitPrice", 66000)
                .put("discountPercent", 25.0))
            .put(JSONObject().put("code", "TP-00002")
                .put("name", "Nước Satori 500ml")
                .put("unit", "Thùng")
                .put("listPrice", 112000)
                .put("unitPrice", 84000))
        val values = JSONObject()
            .put("satori_orders_v15", "[]")
            .put("satori_catalogue_v15", products.toString())
        val state = JSONObject().put("revision", 108).put("values", values)
        val before = state.toString()
        val loaded = SatoriData.fromDriveState(before)
        assertEquals(2, loaded.products.size)
        val first = loaded.products.first()
        assertEquals("TP-00001", first.code)
        assertEquals("Nước tinh khiết Satori 350ml", first.name)
        assertEquals(88000L, first.listPrice)
        assertEquals(66000L, first.unitPrice)
        assertEquals(25.0, first.discountPercent!!, 0.00001)
        assertNull(loaded.products[1].discountPercent)
        assertEquals(before, state.toString())
    }

    @Test
    fun formattingSeparatorsDoNotCreateAnExtraCustomerProfile() {
        val orders = JSONArray()
            .put(JSONObject().put("invoiceNo", 5901).put("name", "Hà Minh Nguyệt")
                .put("phone", "0903 123 456").put("location", "12 Cát Lái"))
            .put(JSONObject().put("invoiceNo", 5902).put("name", "Ha Minh Nguyet")
                .put("phone", "0903-123-456").put("location", "12 Cát Lái"))
            .put(JSONObject().put("invoiceNo", 5903).put("name", "Hà Minh Nguyệt")
                .put("phone", "0903123456").put("location", "18 Cát Lái"))
        val root = JSONObject().put("revision", 1).put("values",
            JSONObject().put("satori_orders_v15", orders.toString()))
        val invoices = SatoriData.fromDriveState(root.toString()).invoices
        val first = invoices.single { it.number == "5901" }
        val second = invoices.single { it.number == "5902" }
        val third = invoices.single { it.number == "5903" }
        assertEquals(SatoriData.customerKey(first), SatoriData.customerKey(second))
        assertNotEquals(SatoriData.customerKey(second), SatoriData.customerKey(third))
    }

    @Test
    fun searchExactShortInvoiceAndPrefixedIdNeverMatchesPhoneDigits() {
        val invoices = JSONArray()
            .put(JSONObject().put("invoiceNo", 9).put("name", "Khách A")
                .put("phone", "0903 999 999").put("location", "Số 5914"))
            .put(JSONObject().put("invoiceNo", 5914).put("name", "Hà Minh Nguyệt")
                .put("phone", "0903 5914 000").put("location", "Số 9"))
            .put(JSONObject().put("invoiceNo", 5918).put("name", "Hà Minh Nguyệt")
                .put("phone", "0903 5914 000").put("location", "Số 10"))
        val root = JSONObject().put("revision", 2).put("values",
            JSONObject().put("satori_orders_v15", invoices.toString()))
        val rows = SatoriData.fromDriveState(root.toString()).invoices
        assertEquals(listOf("9"), rows.filter { SatoriData.search(it, "#9") }
            .map { it.number })
        assertEquals(listOf("5914"), rows.filter { SatoriData.search(it, "5914") }
            .map { it.number })
        assertEquals(listOf("5914"), rows.filter { SatoriData.search(it, "hóa đơn #5914") }
            .map { it.number })
        assertEquals(listOf("5918"), rows.filter { SatoriData.search(it, "HD 5918") }
            .map { it.number })
        assertEquals(2, rows.count { SatoriData.search(it, "Hà Minh Nguyệt") })
    }

    @Test
    fun findsFormattedPhoneByUnformattedDigitsWithoutLooseShortMatches() {
        val data = JSONObject().put("revision", 1).put("values",
            JSONObject().put("satori_orders_v15", JSONArray()
                .put(JSONObject().put("invoiceNo", 5901)
                    .put("name", "Khách A").put("phone", "0903 123 456")
                    .put("location", "Cát Lái")).toString()))
        val invoice = SatoriData.fromDriveState(data.toString()).invoices.single()
        assertTrue(SatoriData.search(invoice, "0903123456"))
        assertTrue(SatoriData.search(invoice, "312345"))
        assertFalse(SatoriData.search(invoice, "3123"))
        assertFalse(SatoriData.search(invoice, "999991"))
    }

    @Test
    fun malformedSourceDatesAreFlaggedAndNeverSortAheadOfValidDates() {
        val orders = JSONArray()
            .put(JSONObject().put("invoiceNo", 9).put("date", "22/0802026"))
            .put(JSONObject().put("invoiceNo", 54).put("date", "20/19/2026"))
            .put(JSONObject().put("invoiceNo", 5900).put("date", "19/10/2026"))
            .put(JSONObject().put("invoiceNo", 5901).put("date", "18/10/2026"))
        val state = JSONObject().put("revision", 105).put("values",
            JSONObject().put("satori_orders_v15", orders.toString()))
        val invoices = SatoriData.fromDriveState(state.toString()).invoices
        assertEquals(listOf("5900", "5901"), invoices.take(2).map { it.number })
        val bad9 = invoices.single { it.number == "9" }
        val bad54 = invoices.single { it.number == "54" }
        assertEquals("22/0802026", bad9.date)
        assertEquals("20/19/2026", bad54.date)
        assertFalse(bad9.hasValidDate)
        assertFalse(bad54.hasValidDate)
        assertTrue(bad9.displayDate.contains("Ngày cần kiểm tra"))
        assertEquals("00000000", bad54.sortDate)
        assertTrue(invoices.first().hasValidDate)
    }

    @Test
    fun rejectsImpossibleCalendarDatesButAllowsLeapDay() {
        val orders = JSONArray()
            .put(JSONObject().put("invoiceNo", 101).put("date", "29/02/2024"))
            .put(JSONObject().put("invoiceNo", 102).put("date", "29/02/2025"))
            .put(JSONObject().put("invoiceNo", 103).put("date", "31/04/2026"))
            .put(JSONObject().put("invoiceNo", 104).put("date", "2026-10-19"))
        val state = JSONObject().put("revision", 1).put("values",
            JSONObject().put("satori_orders_v15", orders.toString()))
        val invoices = SatoriData.fromDriveState(state.toString()).invoices
        assertEquals("20240229", invoices.single { it.number == "101" }.sortDate)
        assertFalse(invoices.single { it.number == "102" }.hasValidDate)
        assertFalse(invoices.single { it.number == "103" }.hasValidDate)
        assertEquals("20261019", invoices.single { it.number == "104" }.sortDate)
    }

    @Test
    fun preservesWebsiteInvoiceTaxCodeAndDiscountForNativePdf() {
        val item = JSONObject().put("product", "Suối 350ml")
            .put("qty", 10).put("unit", "Thùng")
            .put("listPrice", 100000).put("unitPrice", 65000)
            .put("discountPercent", 35)
        val order = JSONObject().put("invoiceNo", 9)
            .put("name", "Edric Salon").put("taxCode", "0312345678")
            .put("items", JSONArray().put(item)).put("total", 650000)
        val root = JSONObject().put("revision", 105).put("values",
            JSONObject().put("satori_orders_v15", JSONArray().put(order).toString()))
        val parsed = SatoriData.fromDriveState(root.toString()).invoices.single()
        assertEquals("0312345678", parsed.taxCode)
        assertEquals(35.0, parsed.lines.single().discountPercent!!, 0.00001)
        assertEquals(100000L, parsed.lines.single().listPrice)
        assertEquals(650000L, parsed.lines.single().amount)
        assertEquals(650000L, parsed.total)
    }

    @Test
    fun verifiesCustomerPaymentAfterLostHttpResponseWithoutAnotherWrite() {
        val orders = JSONArray()
            .put(JSONObject().put("id", 100).put("invoiceNo", 6001)
                .put("name", "Khách đã thu tiền")
                .put("status", "Đã thanh toán").put("total", 650000L))
            .put(JSONObject().put("id", 101).put("invoiceNo", 6002)
                .put("name", "Khách TT Satori")
                .put("status", "Đã TT Satori").put("total", 700000L)
                .put("customerPaidAt", "2026-10-20T00:00:00Z"))
            .put(JSONObject().put("id", 102).put("invoiceNo", 6003)
                .put("name", "Khách chưa thu tiền")
                .put("status", "Chưa thanh toán").put("total", 650000L))
        val data = SatoriData.fromDriveState(JSONObject()
            .put("revision", 101)
            .put("values", JSONObject().put("satori_orders_v15", orders.toString()))
            .toString())
        assertEquals("6001", data.confirmedCustomerPayment("6001", 650000L)?.number)
        assertEquals("6002", data.confirmedCustomerPayment("6002", 700000L)?.number)
        assertNull(data.confirmedCustomerPayment("6001", 650001L))
        assertNull(data.confirmedCustomerPayment("6003", 650000L))
        assertNull(data.confirmedCustomerPayment("6004", 650000L))
        assertNull(data.confirmedCustomerPayment("", 650000L))
    }

    @Test(expected = IllegalArgumentException::class)
    fun refusesSnapshotWithoutRevision() {
        SatoriData.fromDriveState("""{"values":{"satori_orders_v15":"[]"}}""")
    }
}
