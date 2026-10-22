package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

/** Safety regression tests for independent supplier and internal invoice codes. */
class SatoriSupplierStrictMatchingTest {
    private val header = listOf(
        "Số hóa đơn", "Mã đặt hàng", "Tên khách hàng",
        "Số điện thoại", "Địa chỉ", "Ngày chứng từ",
        "Tên sản phẩm", "Số lượng", "Thành tiền")

    private fun invoice(lines: List<SatoriLine> = listOf(
        SatoriLine("Nước Satori 350ml", 2, "Thùng", 450000L, 500000L)
    )) = SatoriInvoice(
        id = "test-invoice", number = "7914", date = "19/10/2026",
        customer = "Khách Mẫu", phone = "0900000000",
        address = "12 Đường Minh Khai", status = "Chưa thanh toán",
        total = 900000L, shipping = 0L, vat = 0L, lines = lines,
        deliveryNote = "", customerPaidAt = "", duplicateFrom = "")

    private fun row(code: String, product: String, count: String) = listOf(
        code, "SUP-100", "Khách Mẫu", "0900000000",
        "12 Đường Minh Khai", "19/10/2026",
        product, count, "200000")

    private fun compare(vararg rows: List<String>, local: SatoriInvoice = invoice()) =
        SatoriSupplierReconciliation.compare(
            SatoriSupplierReconciliation.parse(listOf(header) + rows.toList()),
            SatoriSnapshot(1L, "", listOf(local)))

    @Test fun matchingPhoneAndCoincidentInvoiceNumberAreNotEnough() {
        val sparse = listOf(
            listOf("Số hóa đơn", "Số điện thoại", "Tổng tiền"),
            listOf("7914", "0900000000", "900000"))
        val report = SatoriSupplierReconciliation.compare(
            SatoriSupplierReconciliation.parse(sparse),
            SatoriSnapshot(1L, "", listOf(invoice())))
        assertEquals(0, report.matched)
        assertEquals(1, report.needsReview)
        assertNull(report.items.single().difference)
    }

    @Test fun wrongProductWithSameInvoiceCodeIsForReview() {
        val report = compare(row("7914", "Nước Satori 500ml", "2"))
        assertEquals(0, report.matched)
        assertEquals(1, report.needsReview)
    }

    @Test fun swappedProductQuantitiesCannotHideBehindEqualGrandTotal() {
        val products = listOf(
            SatoriLine("Nước Satori 350ml", 2, "Thùng", 450000L, 500000L),
            SatoriLine("Nước Satori 500ml", 1, "Thùng", 450000L, 500000L))
        val report = compare(
            row("7914", "Nước Satori 350ml", "1"),
            row("7914", "Nước Satori 500ml", "2"),
            local = invoice(products))
        assertEquals(0, report.matched)
        assertEquals(1, report.needsReview)
        assertNull(report.items.single().difference)
    }

    @Test fun distinctDocumentCodeAndExactDeliveryFingerprintCanMatch() {
        val report = compare(row("SUP-INV-7", "Nước Satori 350ml", "2"))
        assertEquals(1, report.matched)
        assertEquals(0, report.needsReview)
    }

    @Test fun exactMultiProductQuantitiesCanMatch() {
        val products = listOf(
            SatoriLine("Nước Satori 350ml", 2, "Thùng", 450000L, 500000L),
            SatoriLine("Nước Satori 500ml", 1, "Thùng", 450000L, 500000L))
        val report = compare(
            row("7914", "Nước Satori 350ml", "2"),
            row("7914", "Nước Satori 500ml", "1"),
            local = invoice(products))
        assertEquals(1, report.matched)
        assertEquals("matched", report.items.single().category)
    }
}
