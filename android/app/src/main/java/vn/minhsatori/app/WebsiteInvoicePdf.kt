package vn.minhsatori.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.Normalizer
import java.util.Locale

/** Recreates the invoicePdfDefinition() layout from the existing Minh Satori website.
 * It only reads SatoriInvoice and does not update any Drive or production records. */
internal object WebsiteInvoicePdf {
    private val blue = Color.rgb(3, 105, 161)
    private val black = Color.rgb(15, 23, 42)
    private val amber = Color.rgb(180, 83, 9)
    private val gray = Color.rgb(100, 116, 139)
    private val border = Color.rgb(203, 213, 225)
    private const val account = "658489418"

    private fun memo(invoice: SatoriInvoice): String {
        val normalized = Normalizer.normalize(invoice.customer, Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "").replace('đ', 'd').replace('Đ', 'D')
            .replace(Regex("[^a-zA-Z0-9 ]"), "")
        return ("HD" + invoice.number + " " + normalized).take(25)
    }

    fun qrUrl(invoice: SatoriInvoice): String =
        "https://img.vietqr.io/image/vpbank-" + account + "-compact2.png?amount=" +
            invoice.total + "&addInfo=" + URLEncoder.encode(memo(invoice), "UTF-8") +
            "&accountName=HKD%20MINH%20SATORI"

    fun shareMessage(invoice: SatoriInvoice): String =
        "Kính gửi " + invoice.customer + " hóa đơn bán nước Satori #" + invoice.number + ":\n" +
        "- Tổng thanh toán: " + SatoriData.money(invoice.total) + "\n" +
        "- STK VPBank: " + account + " (HKD MINH SATORI)\n" +
        "- Nội dung CK: " + memo(invoice) + "\n" +
        "Mã QR quét trả tiền:\n" + qrUrl(invoice)

    private fun fetchQr(invoice: SatoriInvoice): Bitmap? {
        // Internet can be unavailable; never let QR retrieval prevent a readable invoice.
        return try {
            val conn = URL(qrUrl(invoice)).openConnection() as HttpURLConnection
            try {
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                if (conn.responseCode != 200) null
                else conn.inputStream.use { BitmapFactory.decodeStream(it) }
            } finally { conn.disconnect() }
        } catch (_: Exception) { null }
    }

    private class W(private val pdf: PdfDocument, private val totalPages: Int?) {
        val pageWidth = 595f
        val left = 30f
        val right = 565f
        private val bottom = 793f
        private var p: PdfDocument.Page? = null
        private var canvas: Canvas? = null
        private val pen = Paint(Paint.ANTI_ALIAS_FLAG)
        var y = 30f
            private set
        var number = 0
            private set

        fun newPage() {
            endPage()
            number++
            p = pdf.startPage(PdfDocument.PageInfo.Builder(595, 842, number).create())
            canvas = p!!.canvas
            canvas!!.drawColor(Color.WHITE)
            y = 30f
        }
        private fun endPage() {
            val old = p ?: return
            draw(" " + number + " / " + (totalPages ?: number), right, 823f, 8f,
                false, gray, Paint.Align.RIGHT)
            pdf.finishPage(old)
            p = null
            canvas = null
        }
        fun finish(): Int { endPage(); return number }
        fun ensure(height: Float) { if (p == null || y + height > bottom) newPage() }
        fun hasRoom(height: Float): Boolean = y + height <= bottom
        fun move(value: Float) { y = value }
        fun gap(height: Float) { ensure(height); y += height }

        private fun paint(size: Float, bold: Boolean, color: Int,
                          alignment: Paint.Align = Paint.Align.LEFT) {
            pen.textSize = size
            pen.typeface = Typeface.create("sans-serif",
                if (bold) Typeface.BOLD else Typeface.NORMAL)
            pen.color = color
            pen.textAlign = alignment
            pen.style = Paint.Style.FILL
        }
        fun draw(text: String, x: Float, baseline: Float, size: Float = 9f,
                 bold: Boolean = false, color: Int = black,
                 alignment: Paint.Align = Paint.Align.LEFT) {
            paint(size, bold, color, alignment)
            canvas?.drawText(text, x, baseline, pen)
        }
        fun image(bitmap: Bitmap?, x: Float, top: Float, width: Float, height: Float) {
            if (bitmap != null) canvas?.drawBitmap(bitmap, null,
                RectF(x, top, x + width, top + height),
                Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
        }
        fun wrap(text: String, width: Float, size: Float, bold: Boolean = false): List<String> {
            paint(size, bold, black)
            val result = mutableListOf<String>()
            for (para in text.replace("\r", "").split("\n")) {
                if (para.isBlank()) { result.add(""); continue }
                var line = ""
                for (word in para.split(Regex("\\s+"))) {
                    if (word.isBlank()) continue
                    val candidate = if (line.isEmpty()) word else line + " " + word
                    if (pen.measureText(candidate) <= width) line = candidate
                    else {
                        if (line.isNotEmpty()) result.add(line)
                        line = ""
                        for (char in word) {
                            val expanded = line + char
                            if (line.isNotEmpty() && pen.measureText(expanded) > width) {
                                result.add(line)
                                line = char.toString()
                            } else line = expanded
                        }
                    }
                }
                if (line.isNotEmpty()) result.add(line)
            }
            return if (result.isEmpty()) listOf("") else result
        }
        fun boxText(text: String, x: Float, top: Float, width: Float,
                    size: Float = 9f, bold: Boolean = false, color: Int = black,
                    alignment: Paint.Align = Paint.Align.LEFT): Float {
            val pieces = wrap(text, width, size, bold)
            val step = size * 1.36f
            val atX = when (alignment) {
                Paint.Align.RIGHT -> x + width
                Paint.Align.CENTER -> x + width / 2f
                else -> x
            }
            pieces.forEachIndexed { idx, line ->
                draw(line, atX, top + size + idx * step, size, bold, color, alignment)
            }
            return pieces.size * step
        }
        fun text(text: String, size: Float = 9f, bold: Boolean = false,
                 color: Int = black) {
            val height = wrap(text, 535f, size, bold).size * size * 1.36f
            ensure(height)
            boxText(text, left, y, 535f, size, bold, color)
            y += height
        }
        fun lineRule() {
            ensure(16f)
            pen.color = blue
            pen.strokeWidth = 1f
            canvas?.drawLine(left, y + 5f, right, y + 5f, pen)
            y += 16f
        }
        fun section(s: String) {
            ensure(23f)
            draw(s, left, y + 10f, 10f, true, blue)
            y += 23f
        }
        fun note(s: String) {
            val textHeight = wrap(s, 517f, 9f).size * 12.25f
            val h = textHeight + 33f
            ensure(h + 8f)
            pen.color = Color.rgb(255, 251, 235)
            canvas?.drawRect(left, y, right, y + h, pen)
            pen.style = Paint.Style.STROKE
            pen.strokeWidth = 0.8f
            pen.color = Color.rgb(245, 158, 11)
            canvas?.drawRect(left, y, right, y + h, pen)
            pen.style = Paint.Style.FILL
            boxText("GHI CHÚ / YÊU CẦU GIAO HÀNG", 39f, y + 6f, 517f,
                9f, true, amber)
            boxText(s, 39f, y + 23f, 517f, 9f)
            y += h + 8f
        }

        private val widths = listOf(20f, 146f, 33f, 24f, 78f, 40f, 84f, 110f)
        private val headings = listOf("STT", "Tên sản phẩm", "ĐVT", "SL",
            "Giá niêm yết", "CK (%)", "Đơn giá", "Thành tiền")
        private fun height(values: List<String>, header: Boolean): Float {
            val size = if (header) 7.25f else 7.5f
            val longest = values.indices.maxOf { col ->
                wrap(values[col], widths[col] - 8f, size, header).size
            }
            return (longest * size * 1.36f + 14f).coerceAtLeast(28f)
        }
        private fun tableRow(values: List<String>, header: Boolean, alternate: Boolean) {
            val h = height(values, header)
            ensure(h)
            val top = y
            pen.color = if (header) blue else if (alternate)
                Color.rgb(248, 250, 252) else Color.WHITE
            canvas?.drawRect(left, top, right, top + h, pen)
            pen.color = border
            pen.style = Paint.Style.STROKE
            pen.strokeWidth = 0.65f
            canvas?.drawRect(left, top, right, top + h, pen)
            pen.style = Paint.Style.FILL
            var x = left
            values.forEachIndexed { col, value ->
                if (col > 0) {
                    pen.color = border
                    canvas?.drawLine(x, top, x, top + h, pen)
                }
                val align = if (col == 1) Paint.Align.LEFT else
                    if (!header && col >= 4) Paint.Align.RIGHT else Paint.Align.CENTER
                boxText(value, x + 4f, top + 5f, widths[col] - 8f,
                    if (header) 7.25f else 7.5f, header,
                    if (header) Color.WHITE else black, align)
                x += widths[col]
            }
            y += h
        }
        fun tableHead() = tableRow(headings, true, false)
        fun tableItem(values: List<String>, alternate: Boolean) {
            if (!hasRoom(height(values, false))) { newPage(); tableHead() }
            tableRow(values, false, alternate)
        }
    }

    private fun percent(line: SatoriLine): String {
        val value = line.discountPercent ?: if (line.listPrice > 0L)
            100.0 * (line.listPrice - line.unitPrice) / line.listPrice.toDouble() else 0.0
        val rounded = String.format(Locale("vi", "VN"), "%.1f",
            if (value.isFinite()) value else 0.0)
        return (if (rounded.endsWith(",0")) rounded.dropLast(2) else rounded) + "%"
    }

    private fun words(amount: Long): String {
        if (amount == 0L) return "Không đồng"
        val names = listOf("không","một","hai","ba","bốn","năm","sáu","bảy","tám","chín")
        fun three(n: Int, fill: Boolean): String {
            val h = n / 100
            val t = n / 10 % 10
            val u = n % 10
            val a = mutableListOf<String>()
            if (h > 0) { a += names[h]; a += "trăm" }
            else if (fill && n > 0) a += "không trăm"
            when (t) {
                0 -> if (u > 0 && (h > 0 || fill)) a += "lẻ"
                1 -> a += "mười"
                else -> { a += names[t]; a += "mươi" }
            }
            if (u > 0) a += when {
                t >= 2 && u == 1 -> "mốt"
                t >= 2 && u == 4 -> "tư"
                t > 0 && u == 5 -> "lăm"
                else -> names[u]
            }
            return a.joinToString(" ")
        }
        var n = amount.coerceAtLeast(0L)
        val groups = mutableListOf<Int>()
        while (n > 0L) { groups += (n % 1000).toInt(); n /= 1000 }
        val units = listOf("", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ", "tỷ tỷ")
        val parts = mutableListOf<String>()
        for (i in groups.indices.reversed()) {
            if (groups[i] == 0) continue
            parts += three(groups[i], i < groups.lastIndex) +
                (if (i > 0) " " + units.getOrElse(i) { "" } else "")
        }
        return parts.joinToString(" ").replaceFirstChar { it.uppercaseChar() } + " đồng"
    }

    private fun draw(context: Context, invoice: SatoriInvoice, qr: Bitmap?, w: W) {
        w.newPage()
        val logo = BitmapFactory.decodeResource(context.resources, R.drawable.satori_invoice_logo)
        w.image(logo, 30f, 30f, 52f, 52f)
        w.boxText("HỘ KINH DOANH MINH SATORI", 92f, 30f, 290f,
            14f, true, blue)
        w.boxText("Mã số thuế: 075087004222", 92f, 51f, 290f)
        w.boxText("Hotline: 0903 772 980", 92f, 65f, 290f)
        w.boxText("Địa chỉ: Số 96/41 Tôn Đản, Phường Khánh Hội, TP. Hồ Chí Minh",
            92f, 80f, 290f, 8f)
        w.boxText("PHIẾU XUẤT HÓA ĐƠN", 410f, 29f, 155f, 11f,
            true, black, Paint.Align.RIGHT)
        w.boxText("#" + invoice.number, 410f, 48f, 155f, 13f,
            true, amber, Paint.Align.RIGHT)
        w.boxText(invoice.displayDate, 410f, 68f, 155f, 8f,
            false, black, Paint.Align.RIGHT)
        w.boxText(invoice.status, 410f, 81f, 155f, 8f,
            false, black, Paint.Align.RIGHT)
        logo?.recycle()
        w.move(115f)
        w.lineRule()
        w.section("THÔNG TIN KHÁCH HÀNG")
        w.text("Khách hàng: " + invoice.customer)
        w.text("Điện thoại: " + invoice.phone.ifBlank { "(Chưa có SĐT)" })
        w.text("Địa chỉ giao: " + invoice.address.ifBlank { "(Chưa có địa chỉ)" })
        w.text("Mã số thuế: " + invoice.taxCode.ifBlank { "Không có" })
        w.gap(10f)
        if (invoice.deliveryNote.isNotBlank()) w.note(invoice.deliveryNote)

        w.tableHead()
        invoice.lines.forEachIndexed { index, line ->
            w.tableItem(listOf((index + 1).toString(), line.description, line.unit,
                line.quantity.toString(), SatoriData.money(line.listPrice),
                percent(line), SatoriData.money(line.unitPrice),
                SatoriData.money(line.amount)), index % 2 == 1)
        }

        w.gap(13f)
        // The financial block must remain together, including signature columns.
        w.ensure(330f)
        val top = w.y
        w.boxText("THÔNG TIN THANH TOÁN", 30f, top, 270f, 10f, true, blue)
        w.boxText("Ngân hàng: VPBank", 30f, top + 20f, 270f)
        w.boxText("Số tài khoản: " + account, 30f, top + 34f, 270f)
        w.boxText("Chủ tài khoản: HKD MINH SATORI", 30f, top + 48f, 270f)
        w.boxText("Nội dung: " + memo(invoice), 30f, top + 62f, 270f)
        if (qr != null) w.image(qr, 30f, top + 78f, 90f, 90f)
        else w.boxText("Không tải được mã QR; kiểm tra số tài khoản trước khi thanh toán.",
            30f, top + 80f, 225f, 8f, false, amber)
        val totals = listOf(
            "Tổng tiền hàng:" to SatoriData.money(invoice.lines.sumOf { it.amount }),
            "Phí vận chuyển:" to SatoriData.money(invoice.shipping),
            "Thuế VAT:" to SatoriData.money(invoice.vat),
            "TỔNG THANH TOÁN" to SatoriData.money(invoice.total)
        )
        totals.forEachIndexed { index, row ->
            val baseline = top + 13f + index * 30f
            w.draw(row.first, 320f, baseline, 8.5f, index == 3)
            w.draw(row.second, 565f, baseline, if (index == 3) 11f else 9f,
                index == 3, if (index == 3) blue else black, Paint.Align.RIGHT)
        }
        val calculated = invoice.lines.sumOf { it.amount } + invoice.shipping + invoice.vat
        if (calculated != invoice.total) w.boxText(
            "Lưu ý: Tổng đã lưu khác tổng các dòng; cần đối chiếu hóa đơn gốc.",
            320f, top + 135f, 245f, 7.3f, false, amber)
        w.move(top + 181f)
        w.text("Số tiền bằng chữ: " + words(invoice.total), 9f)
        w.gap(13f)
        val signatures = w.y
        w.boxText("ĐẠI DIỆN BÊN BÁN", 30f, signatures, 260f, 9f,
            true, black, Paint.Align.CENTER)
        w.boxText("(Ký, ghi rõ họ tên)", 30f, signatures + 15f, 260f, 9f,
            false, black, Paint.Align.CENTER)
        w.boxText("HKD MINH SATORI", 30f, signatures + 66f, 260f, 9f,
            true, blue, Paint.Align.CENTER)
        w.boxText("ĐẠI DIỆN BÊN MUA / NGƯỜI NHẬN", 300f, signatures, 265f, 9f,
            true, black, Paint.Align.CENTER)
        w.boxText("(Ký, ghi rõ họ tên)", 300f, signatures + 15f, 265f, 9f,
            false, black, Paint.Align.CENTER)
        w.boxText(invoice.customer, 300f, signatures + 66f, 265f, 9f,
            true, black, Paint.Align.CENTER)
        w.move(signatures + 96f)
    }

    fun render(context: Context, invoice: SatoriInvoice, file: File) {
        val qr = fetchQr(invoice)
        try {
            // Two passes allow exact "page / total" numbering on multi-page invoices.
            val draft = PdfDocument()
            val pages = try {
                val w = W(draft, null)
                draw(context, invoice, qr, w)
                w.finish()
            } finally { draft.close() }
            val pdf = PdfDocument()
            try {
                val w = W(pdf, pages)
                draw(context, invoice, qr, w)
                w.finish()
                FileOutputStream(file).use { pdf.writeTo(it) }
            } finally { pdf.close() }
        } finally { qr?.recycle() }
    }
}
