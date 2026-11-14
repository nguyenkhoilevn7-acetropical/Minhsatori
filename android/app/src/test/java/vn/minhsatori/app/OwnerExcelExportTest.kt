package vn.minhsatori.app

import java.io.ByteArrayOutputStream
import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream
import org.junit.Assert.*
import org.junit.Test

class OwnerExcelExportTest {
    private fun invoice(id: String, number: String, customer: String,
                        status: String = "Chưa thanh toán",
                        role: String = "") = SatoriInvoice(
        id = id, number = number, date = "02/11/2026",
        customer = customer, phone = "0903 123 456",
        address = "750 Lã Xuân Oai", status = status,
        total = 800_000L, shipping = 0L, vat = 0L,
        lines = listOf(SatoriLine("Suối 500ml",10,"Thùng",80_000L,100_000L)),
        deliveryNote = "Giao sau 2h", customerPaidAt = "",
        duplicateFrom = "", pairRole = role
    )

    private fun extract(bytes: ByteArray): Map<String, String> {
        val files = mutableMapOf<String, String>()
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                files[entry.name] = zip.readBytes().toString(Charsets.UTF_8)
                zip.closeEntry()
            }
        }
        return files
    }

    @Test fun workbookHasFourSheetsWithNoDoubleCountedCtvOrPaymentConfusion() {
        val buyer = invoice("a", "5901", "Khách A")
        val paid = invoice("b", "5902", "Khách B", "Đã thanh toán")
        val internal = invoice("c", "5903", "CTV nội bộ", role = "collaborator")
        val snapshot = SatoriSnapshot(232L, "2026-11-02",
            listOf(buyer, paid, internal),
            collaborators = listOf(SatoriCollaborator("ctv","Hà Minh Nguyệt",
                "0988888888",35.0)),
            collaboratorRegistryLoaded = true)
        val output = ByteArrayOutputStream()
        OwnerExcelExport.write(snapshot, snapshot.invoices, output)
        val files = extract(output.toByteArray())
        assertEquals(9, files.size)
        val workbook = files.getValue("xl/workbook.xml")
        for (name in listOf("Hoa don", "Cong no", "Bao cao", "Loi nhuan"))
            assertTrue(workbook.contains("name=\"" + name + "\""))
        val bills = files.getValue("xl/worksheets/sheet1.xml")
        val debt = files.getValue("xl/worksheets/sheet2.xml")
        val report = files.getValue("xl/worksheets/sheet3.xml")
        val profit = files.getValue("xl/worksheets/sheet4.xml")
        assertTrue(bills.contains("5903"))
        assertTrue(bills.contains("Không tính"))
        assertFalse(debt.contains("5903"))
        assertTrue(debt.contains("<c r=\"G3\" s=\"2\"><v>800000</v></c>"))
        assertTrue(debt.contains("<c r=\"H2\" s=\"2\"><v>800000</v></c>"))
        assertTrue(report.contains("<f>SUM('Hoa don'!H2:H4)</f><v>1600000</v>"))
        assertTrue(report.contains("<f>SUM('Cong no'!H2:H3)</f><v>800000</v>"))
        assertTrue(profit.contains("170000"))
        assertFalse(profit.contains("5903"))
    }

    @Test fun filterDoesNotLeakOtherCustomersAndTreatsFormulaLikeNameAsPlainText() {
        val customer = invoice("a", "5901", "=HYPERLINK(\"http://evil\", \"open\") & <a>")
        val secret = invoice("b", "5902", "PRIVATE_NOT_SELECTED")
        val snapshot = SatoriSnapshot(233L, "", listOf(customer, secret),
            collaboratorRegistryLoaded = true,
            collaborators = listOf(SatoriCollaborator("ctv","Khác","0",35.0)))
        val output = ByteArrayOutputStream()
        OwnerExcelExport.write(snapshot, listOf(customer), output)
        val entries = extract(output.toByteArray())
        val xml = entries.getValue("xl/worksheets/sheet1.xml")
        assertTrue(xml.contains("t=\"inlineStr\""))
        assertTrue(xml.contains("=HYPERLINK(&quot;http://evil&quot;"))
        assertTrue(xml.contains("&amp; &lt;a&gt;"))
        assertFalse(entries.values.joinToString("").contains("PRIVATE_NOT_SELECTED"))
        assertFalse(entries.values.joinToString("").contains("5902"))
        assertTrue(entries.getValue("xl/worksheets/sheet3.xml")
            .contains("<f>SUM('Hoa don'!H2:H2)</f>"))
    }

    @Test fun missingPartnerPolicyNeverPrintsGrossProfitAsOwnerNet() {
        val customer = invoice("a", "5901", "Khách A")
        val snapshot = SatoriSnapshot(234L, "", listOf(customer))
        val output = ByteArrayOutputStream()
        OwnerExcelExport.write(snapshot, listOf(customer), output)
        val sheet = extract(output.toByteArray()).getValue("xl/worksheets/sheet4.xml")
        assertTrue(sheet.contains("Thiếu hồ sơ CTV"))
        assertFalse(sheet.contains("<c r=\"G2\""))
    }

    @Test fun noEmptyOrUnrecognizedSourceCanBeExported() {
        val customer = invoice("a", "5901", "Khách A")
        val snapshot = SatoriSnapshot(235L, "", listOf(customer))
        try {
            OwnerExcelExport.write(snapshot, emptyList(), ByteArrayOutputStream())
            fail("Empty scope should be rejected")
        } catch (_: IllegalArgumentException) { }
        try {
            OwnerExcelExport.write(snapshot, listOf(customer.copy(id="unverified")),
                ByteArrayOutputStream())
            fail("Foreign rows should be rejected")
        } catch (_: IllegalArgumentException) { }
    }
}
