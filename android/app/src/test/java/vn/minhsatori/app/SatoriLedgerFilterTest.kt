package vn.minhsatori.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SatoriLedgerFilterTest {
    private fun rows(): List<SatoriInvoice> {
        val orders = JSONArray()
            .put(JSONObject().put("id", 1).put("invoiceNo", 5914)
                .put("date", "19/10/2026").put("name", "Hà Minh Nguyệt")
                .put("phone", "0903123456").put("status", "Chưa thanh toán")
                .put("total", 950400))
            .put(JSONObject().put("id", 2).put("invoiceNo", 5918)
                .put("date", "20/10/2026").put("name", "Hà Minh Nguyệt")
                .put("phone", "0903123456").put("status", "Không Tính")
                .put("total", 617760))
            .put(JSONObject().put("id", 3).put("invoiceNo", 5920)
                .put("date", "01/09/2026").put("name", "Traky Hair")
                .put("phone", "0911222333").put("status", "Đã thanh toán")
                .put("total", 300000))
            .put(JSONObject().put("id", 4).put("invoiceNo", 5922)
                .put("date", "31/02/2026").put("name", "Ngày lỗi")
                .put("phone", "0888333444").put("total", 9000))
        return SatoriData.fromDriveState(JSONObject().put("revision", 7)
            .put("values", JSONObject().put("satori_orders_v15", orders.toString()))
            .toString()).invoices
    }

    @Test fun combinesCustomerStatusDateAndMonthWithoutGuessingBadDates() {
        val result = SatoriLedger.queryAdvanced(rows(), SatoriLedgerFilter(
            customer = "Ha Minh", status = "Chưa thanh toán",
            fromIso = "2026-10-01", toIso = "2026-10-31",
            month = 10, year = 2026))
        assertEquals(listOf("5914"), result.map { it.number })
        assertEquals(950400L, SatoriLedger.totals(result).customerUnpaid)
        assertEquals(listOf("5918"), SatoriLedger.queryAdvanced(rows(),
            SatoriLedgerFilter(customer = "0903123456", status = "Không Tính"))
            .map { it.number })
        assertEquals(0L, SatoriLedger.totals(SatoriLedger.queryAdvanced(rows(),
            SatoriLedgerFilter(status = "Không Tính"))).revenue)
    }

    @Test fun sortsDateRevenueAndInvoiceNumberWithStableNumericOrder() {
        val data = rows()
        assertEquals(listOf("5918", "5914", "5920", "5922"),
            SatoriLedger.queryAdvanced(data, SatoriLedgerFilter()).map { it.number })
        assertEquals(listOf("5920", "5914", "5918", "5922"),
            SatoriLedger.queryAdvanced(data, SatoriLedgerFilter(sort = "date_asc"))
                .map { it.number })
        assertEquals("5914", SatoriLedger.queryAdvanced(data,
            SatoriLedgerFilter(sort = "revenue_desc")).first().number)
        assertEquals("5922", SatoriLedger.queryAdvanced(data,
            SatoriLedgerFilter(sort = "invoice_desc")).first().number)
        assertEquals("5914", SatoriLedger.queryAdvanced(data,
            SatoriLedgerFilter(sort = "invoice_asc")).first().number)
    }

    @Test fun invalidDatesAreKeptForReviewButExcludedByDateFilter() {
        val data = rows()
        assertEquals(1, data.count { !it.hasValidDate })
        assertEquals(3, SatoriLedger.queryAdvanced(data,
            SatoriLedgerFilter(year = 2026)).size)
        assertEquals(2, SatoriLedger.queryAdvanced(data,
            SatoriLedgerFilter(fromIso = "2026-10-01")).size)
        assertEquals(listOf("5914"), SatoriLedger.queryAdvanced(data,
            SatoriLedgerFilter(search = "HD 5914")).map { it.number })
    }
}
