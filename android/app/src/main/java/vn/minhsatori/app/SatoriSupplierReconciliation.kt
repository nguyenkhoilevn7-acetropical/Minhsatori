package vn.minhsatori.app

import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element
import org.w3c.dom.Node
import java.time.LocalDate

/**
 * Independent, read-only Satori supplier statement reconciliation.
 * Imported files are never sent to Drive or the Mobile API. A mismatch is NOT
 * an instruction to edit, delete, mark paid or combine source invoices.
 */
data class SupplierStatementLine(
    val sourceRow: Int,
    val supplierInvoice: String,
    val supplierOrder: String,
    val customer: String,
    val phone: String,
    val address: String,
    val date: String,
    val product: String,
    val unit: String,
    val quantity: Int?,
    val amount: Long?,
    val wholeDocumentAmount: Boolean
)

data class SupplierDocument(
    val lines: List<SupplierStatementLine>,
    val invoiceCodes: Set<String>,
    val orderCodes: Set<String>,
    val amount: Long?,
    val amountProblem: String?,
    val quantity: Int?,
    val customer: String,
    val phone: String,
    val address: String,
    val date: String
) {
    val label: String get() = invoiceCodes.firstOrNull() ?: orderCodes.firstOrNull() ?:
        "Dòng " + lines.first().sourceRow
}

data class SupplierDifference(
    val document: SupplierDocument,
    val candidateNumbers: List<String>,
    val localAmount: Long?,
    val difference: Long?,
    val category: String, // matched, review, unmatched
    val explanation: String
)

data class SupplierReconciliationReport(
    val documentCount: Int,
    val matched: Int,
    val needsReview: Int,
    val unmatched: Int,
    val items: List<SupplierDifference>
)

/**
 * Restricted spreadsheet parser: first worksheet of XLSX, or CSV.
 * Uses JDK/Android XML+ZIP; no Office macros, external resources or formulas.
 * XML cached cell values may be read, formulas themselves are never evaluated.
 */
object SatoriSupplierSpreadsheet {
    private const val MAX_BYTES = 8 * 1024 * 1024
    private const val MAX_EXPANDED = 20 * 1024 * 1024
    private const val MAX_ROWS = 15000
    private const val MAX_COLUMNS = 60

    fun open(filename: String, bytes: ByteArray): List<List<String>> {
        require(bytes.size <= MAX_BYTES) { "Bảng kê quá lớn (giới hạn 8 MB)." }
        val name = filename.lowercase()
        return when {
            name.endsWith(".csv") -> csv(bytes.toString(Charsets.UTF_8).removePrefix("\uFEFF"))
            name.endsWith(".xlsx") -> xlsx(bytes)
            else -> throw IllegalArgumentException("Chỉ nhận .xlsx hoặc .csv; không mở file Excel .xls cũ hay PDF ở chức năng này.")
        }
    }

    fun csv(input: String): List<List<String>> {
        val source = input.removePrefix("\uFEFF")
        val firstLine = source.lineSequence().firstOrNull().orEmpty()
        val delim = listOf(';', ',', '\t').maxByOrNull { marker -> firstLine.count { it == marker } } ?: ','
        val rows = mutableListOf<List<String>>()
        val cells = mutableListOf<String>()
        val cell = StringBuilder()
        var quoted = false
        var i = 0
        fun nextCell() {
            require(cells.size < MAX_COLUMNS) { "Bảng kê có quá nhiều cột." }
            cells += cell.toString().trim()
            cell.setLength(0)
        }
        fun nextRow() {
            nextCell()
            if (cells.any { it.isNotBlank() }) rows += cells.toList()
            cells.clear()
            require(rows.size <= MAX_ROWS) { "Bảng kê có quá nhiều dòng." }
        }
        while (i < source.length) {
            val c = source[i]
            when {
                c == '"' && quoted && i + 1 < source.length && source[i + 1] == '"' -> {
                    cell.append('"'); i++
                }
                c == '"' -> quoted = !quoted
                c == delim && !quoted -> nextCell()
                (c == '\n' || c == '\r') && !quoted -> {
                    nextRow()
                    if (c == '\r' && i + 1 < source.length && source[i + 1] == '\n') i++
                }
                else -> cell.append(c)
            }
            require(cell.length <= 100000) { "Ô trong bảng kê vượt giới hạn." }
            i++
        }
        require(!quoted) { "CSV có dấu ngoặc kép chưa đóng." }
        if (cell.isNotEmpty() || cells.isNotEmpty()) nextRow()
        return rows
    }

    private fun xml(bytes: ByteArray): org.w3c.dom.Document {
        val factory = DocumentBuilderFactory.newInstance()
        factory.isNamespaceAware = false
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false)
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false)
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false)
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
        factory.isXIncludeAware = false
        factory.isExpandEntityReferences = false
        return factory.newDocumentBuilder().parse(ByteArrayInputStream(bytes))
    }
    private fun Element.nodes(name: String): List<Element> {
        val found = getElementsByTagName(name)
        return (0 until found.length).mapNotNull { found.item(it) as? Element }
    }
    private fun Element.text(name: String): String =
        nodes(name).firstOrNull()?.textContent.orEmpty()
    private fun column(reference: String): Int {
        val letters = reference.takeWhile { it.isLetter() }.uppercase()
        if (letters.isEmpty()) return -1
        return letters.fold(0) { acc, c -> acc * 26 + (c - 'A' + 1) } - 1
    }
    private fun rowNumber(reference: String): Int =
        reference.dropWhile { it.isLetter() }.toIntOrNull()?.minus(1) ?: -1

    private fun xlsx(bytes: ByteArray): List<List<String>> {
        val entries = mutableMapOf<String, ByteArray>()
        var expanded = 0
        var count = 0
        ZipInputStream(ByteArrayInputStream(bytes)).use { stream ->
            while (true) {
                val entry = stream.nextEntry ?: break
                count++
                require(count <= 200) { "Bảng Excel chứa quá nhiều tệp con." }
                val filename = entry.name.replace('\\', '/')
                // Only read known OOXML worksheet/shared-string entries.
                if (filename == "xl/sharedStrings.xml" ||
                    Regex("""xl/worksheets/sheet\d+\.xml""").matches(filename)) {
                    val out = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val read = stream.read(buffer)
                        if (read < 0) break
                        expanded += read
                        require(expanded <= MAX_EXPANDED) { "Bảng Excel giải nén vượt 20 MB." }
                        out.write(buffer, 0, read)
                    }
                    entries[filename] = out.toByteArray()
                }
                stream.closeEntry()
            }
        }
        val sheetName = entries.keys.filter { Regex("""xl/worksheets/sheet\d+\.xml""").matches(it) }
            .minByOrNull { Regex("""\d+""").find(it)?.value?.toIntOrNull() ?: Int.MAX_VALUE }
            ?: throw IllegalArgumentException("Không thấy worksheet trong file Excel.")
        val shared = entries["xl/sharedStrings.xml"]?.let {
            xml(it).documentElement.nodes("si").map { si ->
                si.nodes("t").joinToString("") { t -> t.textContent }
            }
        }.orEmpty()
        val root = xml(entries.getValue(sheetName)).documentElement
        val rows = mutableMapOf<Int, MutableMap<Int, String>>()
        root.nodes("sheetData").firstOrNull()?.nodes("row")?.forEach { r ->
            val idx = r.getAttribute("r").toIntOrNull()?.minus(1)
                ?: return@forEach
            require(idx in 0 until MAX_ROWS) { "Bảng kê có quá nhiều dòng." }
            val columns = rows.getOrPut(idx) { mutableMapOf() }
            r.nodes("c").forEach { c ->
                val col = column(c.getAttribute("r"))
                require(col < MAX_COLUMNS) { "Bảng kê có quá nhiều cột." }
                if (col < 0) return@forEach
                val raw = when (c.getAttribute("t")) {
                    "s" -> shared.getOrNull(c.text("v").toIntOrNull() ?: -1).orEmpty()
                    "inlineStr" -> c.nodes("is").firstOrNull()?.nodes("t")
                        ?.joinToString("") { it.textContent }.orEmpty()
                    else -> c.text("v")
                }
                columns[col] = raw.trim()
            }
        }
        // Expand ONLY explicit Excel merged cells; don't fill arbitrary blanks.
        // Grouped whole-document totals are still counted once, not per row.
        root.nodes("mergeCell").forEach { merged ->
            val range = merged.getAttribute("ref").split(':')
            if (range.size != 2) return@forEach
            val c0 = column(range[0]); val c1 = column(range[1])
            val r0 = rowNumber(range[0]); val r1 = rowNumber(range[1])
            if (c0 < 0 || c1 >= MAX_COLUMNS || r0 < 0 || r1 >= MAX_ROWS ||
                c1 < c0 || r1 < r0 || (c1 - c0 + 1) * (r1 - r0 + 1) > 5000) return@forEach
            val value = rows[r0]?.get(c0).orEmpty()
            if (value.isBlank()) return@forEach
            for (r in r0..r1) for (c in c0..c1) {
                rows.getOrPut(r) { mutableMapOf() }.putIfAbsent(c, value)
            }
        }
        require(rows.isNotEmpty()) { "Không có dữ liệu trong worksheet đầu tiên." }
        return rows.toSortedMap().values.map { r ->
            (0..(r.keys.maxOrNull() ?: 0)).map { col -> r[col].orEmpty() }
        }.filter { row -> row.any { it.isNotBlank() } }
    }
}

object SatoriSupplierReconciliation {
    private fun norm(text: String): String = SatoriData.normalized(text)
        .replace(Regex("""[^a-z0-9]+"""), " ").trim().replace(Regex("""\s+"""), " ")
    private fun code(value: String): String = value.trim().uppercase().replace(Regex("""\s+"""), "")
    private fun money(value: String): Long? {
        val s = value.trim().replace(" ", "").replace("₫", "").replace("đ", "")
        if (s.isEmpty()) return null
        val clean = when {
            s.matches(Regex("""\d+""")) -> s
            s.matches(Regex("""\d{1,3}(?:[.,]\d{3})+""")) -> s.replace(".", "").replace(",", "")
            s.matches(Regex("""\d+\.00""")) -> s.substringBefore('.')
            else -> return null
        }
        return clean.toLongOrNull()?.takeIf { it >= 0 }
    }
    private fun value(row: List<String>, column: Int): String =
        if (column < 0) "" else row.getOrNull(column).orEmpty().trim()

    fun parse(table: List<List<String>>): List<SupplierStatementLine> {
        require(table.size <= 15000) { "Bảng kê quá nhiều dòng." }
        val known = mapOf(
            "invoice" to listOf("so hoa don", "so hd", "ma hoa don", "invoice", "invoice no"),
            "order" to listOf("ma dat hang", "so don hang", "ma don hang", "don dat hang", "order id", "order no"),
            "customer" to listOf("ten khach hang", "khach hang", "nguoi nhan", "customer"),
            "phone" to listOf("so dien thoai", "dien thoai", "sdt", "phone"),
            "address" to listOf("dia chi giao", "dia chi", "noi giao", "address"),
            "date" to listOf("ngay chung tu", "ngay hoa don", "ngay dat", "ngay", "date"),
            "product" to listOf("ten san pham", "ten hang", "mat hang", "san pham", "dien giai", "product"),
            "unit" to listOf("don vi tinh", "dvt", "unit"),
            "quantity" to listOf("so luong", "sl", "qty", "quantity"),
            "lineMoney" to listOf("thanh tien", "tien hang", "line total"),
            "wholeMoney" to listOf("tong tien", "tong thanh toan", "tong cong", "total amount")
        )
        val header = table.take(15).withIndex().map { indexed ->
            val tokens = indexed.value.map(::norm)
            val indices = known.mapValues { (_, values) ->
                tokens.indexOfFirst { it in values }
            }
            Triple(indexed.index, indices, indices.values.count { it >= 0 })
        }.maxByOrNull { it.third }
            ?: throw IllegalArgumentException("Bảng kê trống.")
        val col = header.second
        val lineAmount = col.getValue("lineMoney")
        val wholeAmount = col.getValue("wholeMoney")
        require(header.third >= 3 && (lineAmount >= 0 || wholeAmount >= 0) &&
            (col.getValue("invoice") >= 0 || col.getValue("order") >= 0 ||
                col.getValue("address") >= 0)) {
            "Không xác định được cột bảng kê Satori. Cần tiêu đề Số hóa đơn/Mã đặt hàng, Địa chỉ và Thành tiền hoặc Tổng tiền."
        }
        val useWhole = wholeAmount >= 0
        val amountCol = if (useWhole) wholeAmount else lineAmount
        val lines = table.drop(header.first + 1).mapIndexedNotNull { idx, row ->
            if (row.all { it.isBlank() }) return@mapIndexedNotNull null
            val inv = value(row, col.getValue("invoice"))
            val order = value(row, col.getValue("order"))
            val customer = value(row, col.getValue("customer"))
            val address = value(row, col.getValue("address"))
            val prod = value(row, col.getValue("product"))
            val cash = value(row, amountCol)
            // Skip heading/summary rows, but never silently accept a bad money value.
            if (norm(inv).startsWith("tong cong") || norm(order).startsWith("tong cong"))
                return@mapIndexedNotNull null
            if (inv.isBlank() && order.isBlank() && customer.isBlank() &&
                address.isBlank() && prod.isBlank()) return@mapIndexedNotNull null
            SupplierStatementLine(
                sourceRow = header.first + idx + 2,
                supplierInvoice = inv, supplierOrder = order,
                customer = customer, phone = value(row, col.getValue("phone")),
                address = address, date = value(row, col.getValue("date")),
                product = prod, unit = value(row, col.getValue("unit")),
                quantity = value(row, col.getValue("quantity")).toIntOrNull()?.takeIf { it > 0 },
                amount = money(cash), wholeDocumentAmount = useWhole
            )
        }
        require(lines.isNotEmpty()) { "Không thấy dữ liệu hóa đơn sau hàng tiêu đề." }
        return lines
    }

    fun group(lines: List<SupplierStatementLine>): List<SupplierDocument> {
        require(lines.size <= 15000) { "Bảng kê quá nhiều dòng." }
        val parents = lines.indices.toMutableList()
        fun find(x: Int): Int {
            var a = x
            while (parents[a] != a) { parents[a] = parents[parents[a]]; a = parents[a] }
            return a
        }
        val invoiceSeen = mutableMapOf<String, Int>()
        val orderSeen = mutableMapOf<String, Int>()
        lines.forEachIndexed { index, row ->
            listOf(invoiceSeen to code(row.supplierInvoice), orderSeen to code(row.supplierOrder))
                .forEach { (seen, key) ->
                    if (key.isNotBlank()) {
                        val previous = seen[key]
                        if (previous != null) parents[find(index)] = find(previous)
                        else seen[key] = index
                    }
                }
        }
        return lines.indices.groupBy { find(it) }.values.map { ids ->
            val rows = ids.map(lines::get)
            val invoices = rows.map { code(it.supplierInvoice) }.filter { it.isNotBlank() }.toSet()
            val orders = rows.map { code(it.supplierOrder) }.filter { it.isNotBlank() }.toSet()
            val issues = mutableListOf<String>()
            if (invoices.isEmpty() && orders.isEmpty()) issues += "thiếu mã đơn/chứng từ"
            if (rows.any { it.amount == null }) issues += "thiếu hoặc sai định dạng tiền"
            val whole = rows.first().wholeDocumentAmount
            val amount = if (issues.none { it.contains("tiền") }) {
                if (whole) {
                    // Invoice totals repeated on rows are counted exactly once.
                    val groups = rows.groupBy {
                        code(it.supplierInvoice).ifBlank {
                            "ORDER:" + code(it.supplierOrder)
                        }
                    }
                    val unique = groups.map { (_, group) -> group.mapNotNull { it.amount }.toSet() }
                    if (unique.any { it.size != 1 }) {
                        issues += "tổng hóa đơn mâu thuẫn giữa các dòng"
                        null
                    } else unique.sumOf { it.first() }
                } else {
                    val signatures = rows.map { listOf(it.supplierInvoice, it.supplierOrder,
                        it.product, it.quantity.toString(), it.amount.toString()).joinToString("|") }
                    if (signatures.size != signatures.toSet().size) {
                        issues += "dòng hàng trùng hoàn toàn, cần kiểm tra trước khi cộng"
                        null
                    } else rows.sumOf { it.amount ?: 0L }
                }
            } else null
            val customer = rows.map { norm(it.customer) }.filter { it.isNotBlank() }.toSet()
            val address = rows.map { norm(it.address) }.filter { it.isNotBlank() }.toSet()
            val phone = rows.map { it.phone.filter(Char::isDigit) }.filter { it.isNotBlank() }.toSet()
            val date = rows.map { parseDate(it.date) }.filter { it.isNotBlank() }.toSet()
            if (customer.size > 1 || address.size > 1 || phone.size > 1 || date.size > 1)
                issues += "khác khách/địa chỉ/SĐT/ngày trong cùng chứng từ"
            SupplierDocument(
                lines = rows, invoiceCodes = invoices, orderCodes = orders,
                amount = amount,
                amountProblem = issues.takeIf { it.isNotEmpty() }?.joinToString("; "),
                quantity = if (rows.all { it.quantity != null }) rows.sumOf { it.quantity ?: 0 }
                    else null,
                customer = rows.firstOrNull { it.customer.isNotBlank() }?.customer.orEmpty(),
                phone = rows.firstOrNull { it.phone.isNotBlank() }?.phone.orEmpty(),
                address = rows.firstOrNull { it.address.isNotBlank() }?.address.orEmpty(),
                date = rows.firstOrNull { it.date.isNotBlank() }?.date.orEmpty()
            )
        }
    }

    private fun parseDate(text: String): String {
        val d = text.trim()
        return try {
            if (d.matches(Regex("""\d{1,2}/\d{1,2}/\d{4}"""))) {
                val p = d.split('/'); LocalDate.of(p[2].toInt(), p[1].toInt(), p[0].toInt()).toString()
            } else LocalDate.parse(d).toString()
        } catch (_: Exception) { "" }
    }
    private fun addressComparable(a: String, b: String): Boolean {
        val x = norm(a).split(' ').filter { it.isNotBlank() }
        val y = norm(b).split(' ').filter { it.isNotBlank() }
        if (x.size < 3 || y.size < 3) return false
        val ax = x.firstOrNull { it.any(Char::isDigit) }
        val bx = y.firstOrNull { it.any(Char::isDigit) }
        if (ax == null || bx == null || ax != bx) return false
        val xWords = x.filter { it.any(Char::isLetter) && it.length >= 3 }.toSet()
        val yWords = y.filter { it.any(Char::isLetter) && it.length >= 3 }.toSet()
        return xWords.intersect(yWords).size >= 2
    }
    private fun sameGoods(doc: SupplierDocument, local: SatoriInvoice): Boolean {
        if (doc.quantity == null || doc.quantity <= 0) return false
        if (doc.quantity != local.lines.sumOf { it.quantity }) return false
        if (doc.lines.any { it.product.isBlank() }) return false
        // Product labels vary between supplier and shop: do not claim verified
        // line-level match unless every named supplier product has evidence.
        val localProducts = local.lines.map { norm(it.code + " " + it.description) }
        return doc.lines.all { row ->
            val name = norm(row.product)
            name.isNotBlank() && localProducts.any { it == name || it.contains(name) || name.contains(it) }
        }
    }

    fun compare(lines: List<SupplierStatementLine>, snapshot: SatoriSnapshot): SupplierReconciliationReport {
        val docs = group(lines)
        val active = snapshot.invoices.filterNot { it.isExcluded }
        val results = docs.map { doc ->
            val byCode = active.filter { invoice ->
                code(invoice.number).isNotBlank() && doc.invoiceCodes.contains(code(invoice.number))
            }
            val byEvidence = active.filter { invoice ->
                norm(doc.customer).isNotBlank() &&
                    norm(doc.customer) == norm(invoice.customer) &&
                    addressComparable(doc.address, invoice.address) &&
                    parseDate(doc.date).isNotBlank() &&
                    parseDate(doc.date) == parseDate(invoice.date) &&
                    sameGoods(doc, invoice)
            }
            val candidates = (byCode + byEvidence).distinctBy { it.id + "|" + it.number }
            val conflict = candidates.any { invoice ->
                (doc.phone.isNotBlank() && invoice.phone.isNotBlank() &&
                    doc.phone.filter(Char::isDigit) != invoice.phone.filter(Char::isDigit)) ||
                    (doc.customer.isNotBlank() && invoice.customer.isNotBlank() &&
                        norm(doc.customer) != norm(invoice.customer)) ||
                    (doc.address.isNotBlank() && invoice.address.isNotBlank() &&
                        !addressComparable(doc.address, invoice.address)) ||
                    (doc.date.isNotBlank() && invoice.hasValidDate &&
                        parseDate(doc.date).isNotBlank() &&
                        parseDate(doc.date) != parseDate(invoice.date))
            }
            val category = when {
                doc.amountProblem != null -> "review"
                candidates.isEmpty() -> "unmatched"
                candidates.size != 1 || conflict -> "review"
                else -> "matched"
            }
            val local = candidates.singleOrNull()?.takeIf { category == "matched" }
            val note = when (category) {
                "matched" -> "Khớp duy nhất với hóa đơn #" + local!!.number +
                    "; chênh lệch tiền chỉ là tham khảo, không tự sửa hóa đơn."
                "unmatched" -> "Chưa tìm thấy hóa đơn phù hợp đủ bằng chứng; không tự ghép theo tên."
                else -> doc.amountProblem ?: "Có nhiều hóa đơn phù hợp hoặc thông tin khách/giao hàng mâu thuẫn."
            }
            SupplierDifference(
                document = doc,
                candidateNumbers = candidates.map { it.number },
                localAmount = local?.total,
                difference = if (doc.amount != null && local != null)
                    doc.amount - local.total else null,
                category = category, explanation = note
            )
        }
        // One local bill being claimed by multiple supplier docs is ambiguous.
        val duplicate = results.filter { it.category == "matched" }
            .groupBy { it.candidateNumbers.single() }
            .filterValues { it.size > 1 }.keys
        val safe = results.map { row ->
            if (row.category == "matched" && row.candidateNumbers.single() in duplicate)
                row.copy(category = "review", difference = null, localAmount = null,
                    explanation = "Nhiều chứng từ Satori cùng khớp một hóa đơn; cần kiểm tra.")
            else row
        }
        return SupplierReconciliationReport(
            documentCount = safe.size,
            matched = safe.count { it.category == "matched" },
            needsReview = safe.count { it.category == "review" },
            unmatched = safe.count { it.category == "unmatched" },
            items = safe
        )
    }
}
