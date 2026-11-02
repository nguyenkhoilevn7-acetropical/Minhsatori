package vn.minhsatori.app

import java.io.OutputStream
import java.nio.charset.StandardCharsets
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Read-only, local XLSX export from the authenticated Owner ledger.
 * All calculations reuse existing Android accounting and CTV policy objects.
 * No payment write, new OAuth scope, customer-data upload, or cached export.
 */
internal object OwnerExcelExport {
    private const val NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    private data class Cell(val text: String? = null, val amount: Long? = null,
                            val formula: String? = null)
    private fun text(s: String?) = Cell(text = s.orEmpty())
    private fun money(n: Long?) = Cell(amount = n)

    fun write(snapshot: SatoriSnapshot, selected: List<SatoriInvoice>, output: OutputStream) {
        require(selected.isNotEmpty()) { "Không có hóa đơn trong bộ lọc." }
        require(selected.size <= 50_000) { "Tối đa 50.000 hóa đơn/lần xuất." }
        val trusted = snapshot.invoices.toHashSet()
        require(selected.all { it in trusted }) { "Bản ghi chưa được xác minh." }

        val totals = SatoriLedger.totals(selected)
        // Profit is calculated against the WHOLE snapshot, including referenced
        // internal CTV bills. Filter only after reconciliation, never before it.
        val byId = CtvProfitSourcePolicy.profitRows(snapshot).groupBy { it.invoice.id }
        val profit = selected.filterNot { it.isExcluded }.map { inv ->
            byId[inv.id]?.singleOrNull()?.takeIf { it.invoice == inv }
                ?: AccountingProMargin45Row(inv, null, null, null, null,
                    "Thiếu chứng cứ giá vốn hoặc chính sách CTV.")
        }
        val known = profit.mapNotNull { it.estimatedOwnerMarginVnd }
        val knownTotal = known.fold(0L, Math::addExact)
        ZipOutputStream(output.buffered()).use { zip ->
            zip.setLevel(6)
            part(zip, "[Content_Types].xml", types())
            part(zip, "_rels/.rels", """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>""")
            part(zip, "xl/workbook.xml", """<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="$NS" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Hoa don" sheetId="1" r:id="rId1"/><sheet name="Cong no" sheetId="2" r:id="rId2"/>
<sheet name="Bao cao" sheetId="3" r:id="rId3"/><sheet name="Loi nhuan" sheetId="4" r:id="rId4"/></sheets>
<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>""")
            part(zip, "xl/_rels/workbook.xml.rels", """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>""")
            part(zip, "xl/styles.xml", styles())
            sheet(zip, 1, listOf("Số HĐ", "Ngày", "Thời gian đặt", "Khách hàng",
                "SĐT", "Địa chỉ", "Trạng thái", "Doanh thu", "Tổng bill",
                "VAT", "Shipping", "Khách trả", "TT Satori", "Loại trừ",
                "CTV ID", "Ghi chú"), selected.asSequence().map { inv ->
                listOf(text(inv.number), text(inv.date), text(inv.creationTimeLabel),
                    text(inv.customer), text(inv.phone), text(inv.address), text(inv.status),
                    money(if (inv.isExcluded) 0L else inv.total), money(inv.total),
                    money(inv.vat), money(inv.shipping),
                    text(if (inv.customerHasPaid) "Đã trả" else "Chưa trả"),
                    text(if (inv.satoriHasPaid) "Đã TT Satori" else "Chưa TT Satori"),
                    text(if (inv.isExcluded) "Không tính" else ""),
                    text(inv.collaboratorId), text(inv.deliveryNote))
            })
            sheet(zip, 2, listOf("Số HĐ", "Ngày", "Khách hàng", "SĐT",
                "Địa chỉ", "Tổng tính", "Đã thu khách", "Còn nợ",
                "Trạng thái khách", "TT Satori"), selected.asSequence()
                .filterNot { it.isExcluded }.map { inv ->
                    listOf(text(inv.number), text(inv.date), text(inv.customer),
                        text(inv.phone), text(inv.address), money(inv.total),
                        money(if (inv.customerHasPaid) inv.total else 0L),
                        money(if (inv.customerHasPaid) 0L else inv.total),
                        text(if (inv.customerHasPaid) "Đã thanh toán" else "Chưa thanh toán"),
                        text(if (inv.satoriHasPaid) "Đã TT Satori" else "Chưa TT Satori"))
                })
            sheet(zip, 3, listOf("Chỉ số", "Số liệu", "Giải thích"), sequenceOf(
                listOf(text("Revision"), money(snapshot.revision), text("Bản dữ liệu đã xác thực")),
                listOf(text("Số hóa đơn đã lọc"), money(totals.recordCount.toLong()), text("Tính cả bill loại trừ")),
                listOf(text("Hóa đơn hợp lệ"), money(totals.countedCount.toLong()), text("Không gồm TEST / hủy / Không Tính / bill CTV nội bộ")),
                listOf(text("Hóa đơn loại trừ"), money(totals.excludedCount.toLong()), text("Không cộng trùng doanh thu")),
                listOf(text("Doanh thu"), Cell(amount = totals.revenue,
                    formula = "SUM('Hoa don'!H2:H" + (selected.size + 1) + ")"), text("Chỉ các bill hợp lệ")),
                listOf(text("Khách đã thanh toán"), Cell(amount = totals.customerPaid,
                    formula = "SUM('Cong no'!G2:G" + (totals.countedCount + 1) + ")"), text("Khác thanh toán Satori")),
                listOf(text("Công nợ còn lại"), Cell(amount = totals.customerUnpaid,
                    formula = "SUM('Cong no'!H2:H" + (totals.countedCount + 1) + ")"), text("Khách chưa thanh toán đủ")),
                listOf(text("Lợi nhuận ước tính đã tính được"), Cell(amount = knownTotal,
                    formula = "SUM('Loi nhuan'!G2:G" + (profit.size + 1) + ")"),
                    text("CHƯA phải lợi nhuận ròng, không thay thế báo cáo thuế")),
                listOf(text("Số bill đủ dữ liệu lợi nhuận"), money(known.size.toLong()), text("Không suy đoán giá vốn hoặc CTV")),
                listOf(text("Số bill thiếu dữ liệu"), money((profit.size - known.size).toLong()),
                    text("Lợi nhuận để TRỐNG, không gán 0")),
                listOf(text("Cách tính giá vốn"), text("55% giá niêm yết"), text("Ước tính theo chiết khấu nhà cung cấp 45%")),
                listOf(text("Hoa hồng CTV"), text("Chỉ dữ liệu đã xác minh"), text("Bảo vệ bill cặp và đơn CTV một hóa đơn")),
                listOf(text("Chi phí chưa trừ"), text("Overhead, thực chi shipping, thuế, hoàn trả"), text("Không sử dụng như báo cáo lợi nhuận ròng")),
                listOf(text("Bill sai ngày"), money(totals.invalidDateCount.toLong()), text("Không tự đoán ngày hóa đơn"))
            ))
            sheet(zip, 4, listOf("Số HĐ", "Ngày", "Khách hàng", "Tiền hàng",
                "Giá vốn ước tính", "Hoa hồng CTV", "Lợi nhuận ước tính",
                "Lý do chưa tính"), profit.asSequence().map { row ->
                    listOf(text(row.invoice.number), text(row.invoice.date),
                        text(row.invoice.customer), money(row.saleGoodsVnd),
                        money(row.estimatedPurchaseVnd),
                        money(row.estimatedCtvCommissionVnd),
                        money(row.estimatedOwnerMarginVnd), text(row.reason))
                })
        }
    }

    private fun part(zip: ZipOutputStream, name: String, content: String) {
        zip.putNextEntry(ZipEntry(name))
        zip.write(content.toByteArray(StandardCharsets.UTF_8))
        zip.closeEntry()
    }

    private fun types(): String = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
""" + (1..4).joinToString("") { "<Override PartName=\"/xl/worksheets/sheet" + it +
    ".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" } +
    "</Types>"

    private fun styles(): String = """<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="$NS">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0 &quot;đ&quot;"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF137A75"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>"""

    // Strings always use inlineStr (not formulas), preventing Excel formula injection.
    private fun xml(value: String): String = buildString {
        for (c in value.take(32_000)) when (c) {
            '&' -> append("&amp;")
            '<' -> append("&lt;")
            '>' -> append("&gt;")
            '"' -> append("&quot;")
            else -> if (c.code >= 32 || c == '\t' || c == '\n' || c == '\r') append(c)
        }
    }

    private fun col(index: Int): String {
        var n = index + 1
        val out = StringBuilder()
        while (n > 0) {
            n--
            out.insert(0, ('A'.code + n % 26).toChar())
            n /= 26
        }
        return out.toString()
    }

    private fun sheet(zip: ZipOutputStream, number: Int, headings: List<String>,
                      rows: Sequence<List<Cell>>) {
        zip.putNextEntry(ZipEntry("xl/worksheets/sheet" + number + ".xml"))
        fun put(value: String) { zip.write(value.toByteArray(StandardCharsets.UTF_8)) }
        put("""<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="$NS"><sheetViews><sheetView workbookViewId="0">
<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>""")
        headings.forEachIndexed { i, heading ->
            val width = if (heading.contains("Địa chỉ") || heading.contains("Giải thích") ||
                heading.contains("Lý do") || heading.contains("Ghi chú")) 38 else 19
            put("<col min=\"" + (i+1) + "\" max=\"" + (i+1) +
                "\" width=\"" + width + "\" customWidth=\"1\"/>")
        }
        put("</cols><sheetData>")
        fun writeRow(index: Int, values: List<Cell>, header: Boolean) {
            require(values.size == headings.size)
            put("<row r=\"" + index + "\">")
            values.forEachIndexed { i, value ->
                val ref = col(i) + index
                if (value.formula != null && value.amount != null) {
                    put("<c r=\"$ref\" s=\"2\"><f>" + xml(value.formula) +
                        "</f><v>" + value.amount + "</v></c>")
                } else if (value.amount != null) {
                    put("<c r=\"$ref\" s=\"2\"><v>" + value.amount + "</v></c>")
                } else if (value.text != null) {
                    put("<c r=\"$ref\"" + (if (header) " s=\"1\"" else "") +
                        " t=\"inlineStr\"><is><t xml:space=\"preserve\">" +
                        xml(value.text) + "</t></is></c>")
                }
            }
            put("</row>")
        }
        writeRow(1, headings.map(::text), true)
        var index = 1
        for (row in rows) {
            index++
            require(index <= 50_001) { "Quá giới hạn Excel." }
            writeRow(index, row, false)
        }
        put("</sheetData><autoFilter ref=\"A1:" + col(headings.lastIndex) +
            index + "\"/></worksheet>")
        zip.closeEntry()
    }
}
