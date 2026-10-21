package vn.minhsatori.app

import android.content.ClipData
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

/**
 * Native invoice preview and PDF actions for Gemini DEMO-A only.
 * The authoritative A4 PDF is downloaded from the existing sandbox server.
 * No production invoices, payment links, bank details or customer token persistence.
 */
internal class AiSandboxInvoiceUi(private val activity: AppCompatActivity) {
    private val ink = Color.rgb(25, 45, 66)
    private val soft = Color.rgb(77, 102, 124)
    private val accent = Color.rgb(0, 112, 132)
    private val line = Color.rgb(215, 226, 235)
    private val labelBlue = Color.rgb(225, 245, 252)
    private var fetching = false
    private var toSave: File? = null
    private val documentPicker = activity.registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/pdf")
    ) { uri ->
        val source = toSave
        toSave = null
        if (uri != null && source != null) {
            Thread {
                val saved = runCatching {
                    require(source.exists() && source.length() > 5) { "PDF tạm không còn tồn tại." }
                    activity.contentResolver.openOutputStream(uri, "w")?.use { output ->
                        source.inputStream().use { it.copyTo(output) }
                    } ?: throw IllegalStateException("Không thể ghi file đã chọn.")
                }
                activity.runOnUiThread {
                    if (!activity.isFinishing && !activity.isDestroyed) {
                        toast(saved.fold({ "Đã lưu PDF vào thư mục anh chọn." },
                            { "Không lưu được PDF: " + (it.message ?: "Lỗi file") }))
                    }
                }
            }.start()
        }
    }

    private fun dp(n: Int) = (activity.resources.displayMetrics.density * n + .5f).toInt()
    private fun background(color: Int, radius: Int = 14, bordered: Boolean = false) =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radius).toFloat()
            if (bordered) setStroke(dp(1), line)
        }
    private fun label(s: String, size: Float = 13f, color: Int = ink, bold: Boolean = false) =
        TextView(activity).apply {
            text = s
            textSize = size
            setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setPadding(dp(5), dp(5), dp(5), dp(5))
        }
    private fun action(title: String, perform: () -> Unit) = Button(activity).apply {
        text = title
        textSize = 12f
        isAllCaps = false
        setTextColor(Color.WHITE)
        minHeight = dp(44)
        background = background(accent, 9)
        setOnClickListener { perform() }
    }
    private fun toast(message: String) =
        Toast.makeText(activity, message, Toast.LENGTH_LONG).show()
    private fun money(v: Long): String = String.format(Locale("vi", "VN"), "%,d đ", v)
    private fun amount(obj: JSONObject, field: String): Long = obj.optLong(field, 0L)
    private fun readable(v: String): String = v.ifBlank { "Chưa cung cấp" }
    private fun section(container: LinearLayout, title: String) {
        container.addView(label(title, 13f, accent, true))
    }
    private fun detail(container: LinearLayout, left: String, right: String, important: Boolean = false) {
        val row = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.TOP
            setPadding(0, dp(3), 0, dp(3))
        }
        row.addView(label(left, if (important) 14f else 12f, soft, important),
            LinearLayout.LayoutParams(0, -2, 1f))
        row.addView(label(right, if (important) 17f else 12f,
            if (important) accent else ink, important),
            LinearLayout.LayoutParams(0, -2, 1.1f))
        container.addView(row)
    }
    private fun buttonRow(container: LinearLayout, entries: List<Pair<String, () -> Unit>>) {
        val row = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(5), 0, 0)
        }
        for ((index, entry) in entries.withIndex()) {
            row.addView(action(entry.first, entry.second),
                LinearLayout.LayoutParams(0, dp(46), 1f).apply {
                    if (index != 0) marginStart = dp(6)
                })
        }
        container.addView(row)
    }

    fun invoiceCard(order: JSONObject, quote: Boolean = false, onConfirm: (() -> Unit)? = null): View {
        val ref = order.optString("ref")
        val card = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            background = background(Color.WHITE, 16, true)
            setPadding(dp(14), dp(13), dp(14), dp(14))
        }
        card.addView(label("HỘ KINH DOANH MINH SATORI", 15f, accent, true))
        card.addView(label(if (quote) "BÁO GIÁ • CHƯA XÁC NHẬN" else
            "PHIẾU XUẤT HÓA ĐƠN • BẢN THỬ", 12f, soft, true))
        if (!quote) {
            detail(card, "Mã hóa đơn", ref, true)
            detail(card, "Ngày tạo", order.optString("createdAt").take(19).replace('T', ' '))
            detail(card, "Trạng thái", readable(order.optString("status", "Chờ thanh toán")))
        }
        val profile = order.optString("name")
        section(card, "THÔNG TIN KHÁCH HÀNG")
        detail(card, "Khách hàng", readable(profile))
        detail(card, "Số điện thoại", readable(order.optString("phone")))
        detail(card, "Địa chỉ giao", readable(order.optString("address")))
        if (order.optString("deliveryNote").isNotBlank())
            detail(card, "Lưu ý", order.optString("deliveryNote"))

        section(card, "CHI TIẾT SẢN PHẨM")
        val items = order.optJSONArray("items")
        if (items != null && items.length() > 0) {
            for (i in 0 until items.length()) {
                val item = items.optJSONObject(i) ?: continue
                val itemPanel = LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    background = background(if (i % 2 == 0) Color.rgb(245, 249, 252)
                        else Color.rgb(234, 244, 250), 8)
                    setPadding(dp(7), dp(6), dp(7), dp(6))
                }
                itemPanel.addView(label((i + 1).toString() + ". " +
                    item.optString("product"), 13f, ink, true))
                detail(itemPanel, "Quy cách / số lượng",
                    readable(item.optString("unit")) + " × " + item.optInt("qty"))
                detail(itemPanel, "Giá niêm yết", money(amount(item, "listPrice")))
                detail(itemPanel, "Chiết khấu", item.optString("discount", order.optString("discount", "0")) + "%")
                detail(itemPanel, "Đơn giá", money(amount(item, "unitPrice")))
                detail(itemPanel, "Thành tiền", money(amount(item, "subtotal")))
                card.addView(itemPanel, LinearLayout.LayoutParams(-1, -2).apply {
                    bottomMargin = dp(7)
                })
            }
        } else {
            detail(card, "Sản phẩm", readable(order.optString("product")))
            detail(card, "Quy cách / số lượng",
                readable(order.optString("unit")) + " × " + order.optInt("qty"))
            detail(card, "Giá niêm yết", money(amount(order, "listPrice")))
            detail(card, "Chiết khấu", order.optString("discount", "0") + "%")
            detail(card, "Đơn giá", money(amount(order, "unitPrice")))
            detail(card, "Thành tiền", money(amount(order, "subtotal")))
        }

        section(card, "THANH TOÁN • CHỈ THỬ NGHIỆM")
        detail(card, "Tiền hàng", money(amount(order, "subtotal")))
        detail(card, "Vận chuyển", money(amount(order, "shipping")))
        detail(card, "VAT (" + order.optString("vatRate", "0") + "%)",
            money(amount(order, "vatAmount")))
        detail(card, "TỔNG CỘNG", money(amount(order, "total")), true)
        val note = label("SANDBOX • KHÔNG CHUYỂN KHOẢN • KHÔNG GIAO HÀNG THẬT",
            11f, Color.rgb(148, 78, 28), true)
        note.background = background(Color.rgb(255, 247, 231), 8)
        card.addView(note)
        if (quote && onConfirm != null) {
            buttonRow(card, listOf("XÁC NHẬN ĐƠN TEST" to onConfirm))
        } else if (!quote && AiSandboxContract.validTestRef(ref)) {
            buttonRow(card, listOf(
                "Xem hóa đơn" to { preview(order) },
                "Xem PDF" to { pdf(ref, "view") }
            ))
            buttonRow(card, listOf(
                "Tải PDF" to { pdf(ref, "save") },
                "Chia sẻ" to { pdf(ref, "share") }
            ))
            buttonRow(card, listOf(
                "Zalo" to { pdf(ref, "zalo") },
                "Messenger" to { pdf(ref, "messenger") }
            ))
        }
        return card
    }

    fun preview(order: JSONObject) {
        val content = ScrollView(activity)
        val shell = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        shell.addView(invoiceCard(order))
        content.addView(shell)
        AlertDialog.Builder(activity)
            .setTitle("Hóa đơn THỬ " + order.optString("ref"))
            .setView(content)
            .setNegativeButton("Đóng", null)
            .show()
    }

    private fun pdf(ref: String, mode: String) {
        if (!AiSandboxContract.validTestRef(ref)) {
            toast("Chỉ được tải hóa đơn TEST hợp lệ.")
            return
        }
        if (fetching) { toast("Đang tạo PDF, anh chờ một chút."); return }
        fetching = true
        toast("Đang tải PDF từ server Sandbox…")
        Thread {
            val result = runCatching { fetchPdf(ref) }
            activity.runOnUiThread {
                fetching = false
                if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread
                result.onSuccess { file ->
                    when (mode) {
                        "save" -> { toSave = file; documentPicker.launch(file.name) }
                        "view" -> openPdf(file)
                        "zalo" -> sharePdf(file, "com.zing.zalo")
                        "messenger" -> sharePdf(file, "com.facebook.orca")
                        else -> sharePdf(file, null)
                    }
                }.onFailure { toast("Không lấy được PDF TEST: " + (it.message ?: "Lỗi mạng")) }
            }
        }.start()
    }

    private fun fetchPdf(ref: String): File {
        val path = AiSandboxContract.sandboxPdfPath(ref)
        check(AiSandboxContract.validEndpoint(AiSandboxContract.BASE_URL))
        val c = URL(AiSandboxContract.BASE_URL + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "GET"
            c.instanceFollowRedirects = false
            c.connectTimeout = 9000
            c.readTimeout = 20000
            c.setRequestProperty("Accept", "application/pdf")
            require(c.responseCode == 200) { "Server trả về HTTP " + c.responseCode }
            require(c.contentType.orEmpty().substringBefore(';').trim().equals(
                "application/pdf", ignoreCase = true)) { "Phản hồi không phải PDF." }
            val folder = File(activity.cacheDir, "shared_invoices")
            require(folder.isDirectory || folder.mkdirs()) { "Không tạo được thư mục tạm." }
            val file = File(folder, "MinhSatori_" + ref + ".pdf")
            val pending = File(folder, "MinhSatori_" + ref + ".tmp")
            try {
                c.inputStream.use { input ->
                    FileOutputStream(pending).use { out ->
                        val bytes = ByteArray(8192)
                        var size = 0
                        while (true) {
                            val read = input.read(bytes)
                            if (read == -1) break
                            size += read
                            require(size <= 8_000_000) { "PDF vượt dung lượng an toàn." }
                            out.write(bytes, 0, read)
                        }
                    }
                }
                require(pending.length() >= 6L) { "PDF trống." }
                require(pending.inputStream().use {
                    val sig = ByteArray(5)
                    it.read(sig) == 5 && String(sig, Charsets.US_ASCII) == "%PDF-"
                }) { "PDF không hợp lệ." }
                require(pending.renameTo(file) || run {
                    pending.copyTo(file, overwrite = true)
                    pending.delete()
                    true
                }) { "Không lưu được PDF tạm." }
                return file
            } finally {
                if (pending.exists()) pending.delete()
            }
        } finally {
            c.disconnect()
        }
    }

    private fun uri(file: File): Uri = FileProvider.getUriForFile(activity,
        activity.packageName + ".fileprovider", file)

    private fun openPdf(file: File) {
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri(file), "application/pdf")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        runCatching {
            activity.startActivity(Intent.createChooser(intent, "Xem hóa đơn TEST bằng PDF"))
        }.onFailure { toast("Chưa có ứng dụng xem PDF. Anh có thể tải file hoặc chia sẻ.") }
    }

    private fun sharePdf(file: File, target: String?) {
        val fileUri = uri(file)
        val message = "Hóa đơn Minh Satori THỬ NGHIỆM • Không thanh toán/giao hàng thật."
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, fileUri)
            putExtra(Intent.EXTRA_SUBJECT, file.name)
            putExtra(Intent.EXTRA_TEXT, message)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            clipData = ClipData.newUri(activity.contentResolver, "Hóa đơn TEST", fileUri)
        }
        if (target != null && runCatching {
            activity.startActivity(Intent(send).apply { setPackage(target) })
        }.isSuccess) return
        runCatching {
            activity.startActivity(Intent.createChooser(send, "Chia sẻ hóa đơn PDF TEST"))
        }.onFailure { toast("Không mở được ứng dụng chia sẻ PDF.") }
    }
}
