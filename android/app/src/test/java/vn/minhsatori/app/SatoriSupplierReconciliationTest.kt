package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class SatoriSupplierReconciliationTest {
    private fun sheet(vararg rows: List<String>): List<SupplierStatementLine> =
        SatoriSupplierReconciliation.parse(rows.toList())

    private val header = listOf("Số hóa đơn", "Mã đặt hàng", "Tên khách hàng",
        "Số điện thoại", "Địa chỉ", "Ngày chứng từ", "Tên sản phẩm",
        "Số lượng", "Thành tiền")

    private fun row(invoice: String, order: String, amount: String, product: String,
                    address: String = "377 Nguyễn Duy Trinh", qty: String = "2") =
        listOf(invoice, order, "Hà Minh Nguyệt", "0903 123 456", address,
            "19/10/2026", product, qty, amount)

    private fun local(no: String, total: Long = 950400L,
                      address: String = "377 Nguyễn Duy Trinh") =
        SatoriInvoice(
            id = "1792368000000", number = no, date = "19/10/2026",
            customer = "Hà Minh Nguyệt", phone = "0903123456",
            address = address, status = "Chưa thanh toán", total = total,
            shipping = 0L, vat = 0L,
            lines = listOf(SatoriLine("Nước Satori 350ml", 2, "Thùng", 475200L, 500000L)),
            deliveryNote = "", customerPaidAt = "", duplicateFrom = ""
        )

    @Test fun csvReadsQuotedCommasAndVietnameseHeaders() {
        val text = "Số hóa đơn,Mã đặt hàng,Địa chỉ,Thành tiền\n" +
            "B-1,O-1,\"377 Nguyễn Duy Trinh, TP HCM\",\"950,400\"\n"
        val rows = SatoriSupplierSpreadsheet.open("satori.csv", text.toByteArray())
        assertEquals(2, rows.size)
        assertEquals("377 Nguyễn Duy Trinh, TP HCM", rows[1][2])
        assertEquals(950400L, SatoriSupplierReconciliation.parse(rows).single().amount)
    }

    @Test fun statementGroupsMultiLineSameInvoiceAndSeparatesOrderIdNamespace() {
        val lines = sheet(header,
            row("B-1", "O-1", "100.000", "Nước Satori 350ml"),
            row("B-1", "O-2", "200.000", "Nước Satori 500ml"),
            row("B-2", "O-3", "300.000", "Nước Satori 20L"))
        val docs = SatoriSupplierReconciliation.group(lines)
        assertEquals(2, docs.size)
        assertEquals(300000L, docs.first().amount)
        assertEquals(4, docs.first().quantity)
        assertEquals(300000L, docs.last().amount)
        // Invoice "X" and order "X" must not be treated as the same identifier.
        val separate = sheet(header,
            row("X", "", "1", "Nước Satori 350ml"),
            row("", "X", "2", "Nước Satori 350ml"))
        assertEquals(2, SatoriSupplierReconciliation.group(separate).size)
    }

    @Test fun repeatedWholeDocumentTotalsCountOnceAndConflictsAreReviewed() {
        val head = header.dropLast(1) + "Tổng tiền"
        val original = sheet(head,
            row("B-1", "O-1", "950.400", "Nước Satori 350ml"),
            row("B-1", "O-1", "950.400", "Nước Satori 500ml"))
        assertEquals(950400L, SatoriSupplierReconciliation.group(original).single().amount)
        val conflict = sheet(head,
            row("B-1", "O-1", "950.400", "Nước Satori 350ml"),
            row("B-1", "O-1", "900.400", "Nước Satori 500ml"))
        val doc = SatoriSupplierReconciliation.group(conflict).single()
        assertNull(doc.amount)
        assertTrue(doc.amountProblem.orEmpty().contains("mâu thuẫn"))
    }

    @Test fun duplicateExactLineIsNotSilentlyAddedTwice() {
        val record = row("B-1", "O-1", "950400", "Nước Satori 350ml")
        val result = SatoriSupplierReconciliation.group(sheet(header, record, record)).single()
        assertNull(result.amount)
        assertTrue(result.amountProblem.orEmpty().contains("trùng"))
    }

    @Test fun onlyOneWellEvidencedLocalBillIsMatched() {
        val lines = sheet(header,
            row("5914", "O-1", "950.400", "Nước Satori 350ml"))
        val outcome = SatoriSupplierReconciliation.compare(lines,
            SatoriSnapshot(105L, "", listOf(local("5914"))))
        assertEquals(1, outcome.matched)
        assertEquals(0L, outcome.items.single().difference)
        assertEquals("matched", outcome.items.single().category)
    }

    @Test fun wrongPhoneDifferentHouseAndMultipleLocalBillsAreNotAutoMatched() {
        val source = sheet(header, row("5914", "O-1", "950400", "Nước Satori 350ml"))
        val conflict = SatoriSupplierReconciliation.compare(source,
            SatoriSnapshot(1, "", listOf(local("5914").copy(phone = "0903123999"))))
        assertEquals("review", conflict.items.single().category)
        val wrongHouse = SatoriSupplierReconciliation.compare(source,
            SatoriSnapshot(1, "", listOf(local("5914", address = "378 Nguyễn Duy Trinh"))))
        assertEquals("review", wrongHouse.items.single().category)
        val two = SatoriSupplierReconciliation.compare(source,
            SatoriSnapshot(1, "", listOf(local("5914"), local("5914").copy(id="other"))))
        assertEquals("review", two.items.single().category)
    }

    @Test fun ambiguousAmountAndUnmatchedBillDoNotProduceInventedDifferences() {
        val lines = sheet(header,
            row("A-1", "O-1", "not-a-number", "Nước Satori 350ml"),
            row("A-2", "O-2", "900.000", "Nước Satori 350ml",
                "999 Nguyễn Trãi"))
        val outcome = SatoriSupplierReconciliation.compare(lines,
            SatoriSnapshot(1, "", listOf(local("5914"))))
        assertEquals(1, outcome.needsReview)
        assertEquals(1, outcome.unmatched)
        assertTrue(outcome.items.all { it.difference == null })
    }

    private fun xlsxFixture(sheet: String, shared: String? = null): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            zip.putNextEntry(ZipEntry("xl/worksheets/sheet1.xml"))
            zip.write(sheet.toByteArray())
            zip.closeEntry()
            if (shared != null) {
                zip.putNextEntry(ZipEntry("xl/sharedStrings.xml"))
                zip.write(shared.toByteArray())
                zip.closeEntry()
            }
        }
        return out.toByteArray()
    }

    @Test fun excelSharedStringsMergedBillIdsAndWholeTotalsReadCorrectly() {
        val shared = "<sst><si><t>Số hóa đơn</t></si><si><t>Mã đặt hàng</t></si>" +
            "<si><t>Địa chỉ</t></si><si><t>Tổng tiền</t></si>" +
            "<si><t>B-1</t></si><si><t>O-1</t></si>" +
            "<si><t>O-2</t></si><si><t>377 Nguyễn Duy Trinh</t></si></sst>"
        val sheetXml = "<worksheet><sheetData>" +
            "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c>" +
            "<c r=\"B1\" t=\"s\"><v>1</v></c>" +
            "<c r=\"C1\" t=\"s\"><v>2</v></c>" +
            "<c r=\"D1\" t=\"s\"><v>3</v></c></row>" +
            "<row r=\"2\"><c r=\"A2\" t=\"s\"><v>4</v></c>" +
            "<c r=\"B2\" t=\"s\"><v>5</v></c>" +
            "<c r=\"C2\" t=\"s\"><v>7</v></c>" +
            "<c r=\"D2\"><v>950400</v></c></row>" +
            "<row r=\"3\"><c r=\"B3\" t=\"s\"><v>6</v></c>" +
            "<c r=\"D3\"><v>950400</v></c></row></sheetData>" +
            "<mergeCells><mergeCell ref=\"A2:A3\"/>" +
            "<mergeCell ref=\"C2:C3\"/></mergeCells></worksheet>"
        val table = SatoriSupplierSpreadsheet.open("company.xlsx", xlsxFixture(sheetXml, shared))
        assertEquals("B-1", table[2][0])
        assertEquals("377 Nguyễn Duy Trinh", table[2][2])
        val group = SatoriSupplierReconciliation.group(
            SatoriSupplierReconciliation.parse(table))
        assertEquals(1, group.size)
        assertEquals(2, group.single().lines.size)
        assertEquals(950400L, group.single().amount)
    }

    @Test fun xlsxRejectsDoctypeAndUnsupportedFormats() {
        val bad = "<!DOCTYPE worksheet [<!ENTITY x SYSTEM \"file:///etc/passwd\">]>" +
            "<worksheet><sheetData/></worksheet>"
        try {
            SatoriSupplierSpreadsheet.open("evil.xlsx", xlsxFixture(bad))
            fail("XML DTD should be forbidden")
        } catch (_: Exception) { /* expected secure XML refusal */ }
        try {
            SatoriSupplierSpreadsheet.open("old.xls", byteArrayOf(1,2,3))
            fail("legacy Excel is intentionally unsupported")
        } catch (_: IllegalArgumentException) { /* correct */ }
    }
}
