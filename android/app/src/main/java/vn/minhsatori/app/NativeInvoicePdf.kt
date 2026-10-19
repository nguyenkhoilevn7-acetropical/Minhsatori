package vn.minhsatori.app

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

/** Creates and shares a real Android PDF from the current live Drive snapshot. */
object NativeInvoicePdf {
    fun shareZalo(context: Context, invoice: SatoriInvoice) =
        shareInternal(context, invoice, "com.zing.zalo")

    fun shareMessenger(context: Context, invoice: SatoriInvoice) =
        shareInternal(context, invoice, "com.facebook.orca")

    fun share(context: Context, invoice: SatoriInvoice) =
        shareInternal(context, invoice, null)

    private fun shareInternal(context: Context, invoice: SatoriInvoice, packageName: String?) {
        val directory = File(context.cacheDir, "shared_invoices")
        require(directory.isDirectory || directory.mkdirs()) { "Không thể tạo thư mục PDF." }
        val safeNumber = invoice.number.replace(Regex("[^a-zA-Z0-9_-]"), "").take(24)
        val file = File(directory, "MinhSatori_HD_" + (safeNumber.ifEmpty { "invoice" }) + ".pdf")
        render(invoice, file)
        val uri = FileProvider.getUriForFile(
            context, context.packageName + ".fileprovider", file
        )
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "Hóa đơn Minh Satori #" + invoice.number)
            putExtra(Intent.EXTRA_TEXT, "Hóa đơn #" + invoice.number + " - " +
                invoice.customer + " - " + SatoriData.money(invoice.total))
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            clipData = ClipData.newUri(context.contentResolver, "Hóa đơn Minh Satori", uri)
        }
        if (packageName != null) {
            try {
                context.startActivity(Intent(send).apply { setPackage(packageName) })
                return
            } catch (_: android.content.ActivityNotFoundException) {
                // App not installed or does not accept PDF. Let owner choose instead.
            }
        }
        context.startActivity(Intent.createChooser(send, "Gửi PDF qua Zalo, Messenger…"))
    }

    private class Writer(private val pdf: PdfDocument) {
        private var page: PdfDocument.Page? = null
        private var canvas: Canvas? = null
        private var y = 46f
        private var pageIndex = 0
        private val width = 595f
        private val height = 842f
        private val left = 38f
        private val right = 38f
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Typeface.create("sans-serif", Typeface.NORMAL)
            color = Color.rgb(30, 41, 59)
            textSize = 11f
        }

        private fun newPage() {
            page?.let { pdf.finishPage(it) }
            pageIndex += 1
            page = pdf.startPage(PdfDocument.PageInfo.Builder(
                width.toInt(), height.toInt(), pageIndex
            ).create())
            canvas = page!!.canvas
            canvas?.drawColor(Color.WHITE)
            y = 44f
        }

        fun gap(points: Float = 10f) { y += points }

        fun rule() {
            ensure(14f)
            paint.color = Color.rgb(203, 213, 225)
            paint.strokeWidth = 1f
            canvas?.drawLine(left, y, width - right, y, paint)
            y += 12f
        }

        private fun ensure(points: Float) {
            if (page == null || y + points > height - 52f) newPage()
        }

        fun line(text: String, size: Float = 11f, bold: Boolean = false,
                 color: Int = Color.rgb(30, 41, 59)) {
            paint.textSize = size
            paint.typeface = Typeface.create("sans-serif",
                if (bold) Typeface.BOLD else Typeface.NORMAL)
            paint.color = color
            val step = size * 1.55f
            val maxWidth = width - left - right
            for (paragraph in text.replace("\r", "").split("\n")) {
                val words = paragraph.split(Regex("\\s+"))
                var active = ""
                if (paragraph.isEmpty()) {
                    ensure(step); y += step
                    continue
                }
                for (word in words) {
                    if (word.isBlank()) continue
                    val candidate = if (active.isEmpty()) word else active + " " + word
                    if (paint.measureText(candidate) > maxWidth && active.isNotEmpty()) {
                        ensure(step)
                        canvas?.drawText(active, left, y, paint)
                        y += step
                        active = word
                    } else {
                        active = candidate
                    }
                    if (paint.measureText(active) > maxWidth) {
                        var chunk = ""
                        for (character in active) {
                            val next = chunk + character
                            if (paint.measureText(next) > maxWidth && chunk.isNotEmpty()) {
                                ensure(step)
                                canvas?.drawText(chunk, left, y, paint)
                                y += step
                                chunk = character.toString()
                            } else chunk = next
                        }
                        active = chunk
                    }
                }
                if (active.isNotEmpty()) {
                    ensure(step)
                    canvas?.drawText(active, left, y, paint)
                    y += step
                }
            }
        }

        fun finish() {
            if (page == null) newPage()
            page?.let { pdf.finishPage(it) }
            page = null
            canvas = null
        }
    }

    private fun render(invoice: SatoriInvoice, file: File) {
        val pdf = PdfDocument()
        try {
            val writer = Writer(pdf)
            writer.line("HỘ KINH DOANH MINH SATORI", 17f, true, Color.rgb(3, 105, 161))
            writer.line("PHIẾU THÔNG TIN XUẤT HÓA ĐƠN", 15f, true)
            writer.line("Hóa đơn #" + invoice.number + "  |  Ngày: " + invoice.date)
            writer.line("Mã số thuế: 075087004222 | Hotline: 0903 772 980")
            writer.gap()
            writer.rule()
            writer.line("THÔNG TIN KHÁCH HÀNG", 12f, true, Color.rgb(3, 105, 161))
            writer.line("Khách hàng: " + invoice.customer)
            if (invoice.phone.isNotBlank()) writer.line("Điện thoại: " + invoice.phone)
            writer.line("Địa chỉ giao: " + invoice.address)
            writer.line("Trạng thái: " + invoice.status)
            writer.gap()
            writer.rule()
            writer.line("CHI TIẾT HÀNG HÓA", 12f, true, Color.rgb(3, 105, 161))
            invoice.lines.forEachIndexed { index, item ->
                writer.line((index + 1).toString() + ". " + item.description, 11f, true)
                writer.line("   " + item.quantity + " " + item.unit + " × " +
                    SatoriData.money(item.unitPrice) + " = " + SatoriData.money(item.amount))
            }
            writer.gap()
            writer.rule()
            writer.line("Phí giao hàng: " + SatoriData.money(invoice.shipping))
            writer.line("VAT: " + SatoriData.money(invoice.vat))
            writer.line("TỔNG TIỀN THANH TOÁN: " + SatoriData.money(invoice.total),
                14f, true, Color.rgb(3, 105, 161))
            if (invoice.deliveryNote.isNotBlank()) {
                writer.gap(12f)
                writer.rule()
                writer.line("GHI CHÚ / YÊU CẦU GIAO HÀNG:", 12f, true,
                    Color.rgb(146, 64, 14))
                writer.line(invoice.deliveryNote, 11f, true)
            }
            writer.gap(18f)
            writer.line("Thông tin chuyển khoản: VPBank · 658489418 · HKD MINH SATORI")
            writer.line("Nội dung chuyển khoản: HD" + invoice.number)
            writer.gap()
            writer.line("Phiếu này được xuất từ dữ liệu Minh Satori trên Google Drive.", 9f)
            writer.finish()
            FileOutputStream(file).use { pdf.writeTo(it) }
        } finally {
            pdf.close()
        }
    }
}
