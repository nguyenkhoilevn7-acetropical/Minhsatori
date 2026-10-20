package vn.minhsatori.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import java.io.ByteArrayOutputStream
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ArrayAdapter
import android.widget.Spinner
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.provider.OpenableColumns
import java.text.DateFormat
import java.util.Date
import org.json.JSONObject
import java.util.UUID
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope

/**
 * Actual native Android invoice application, not a PWA and not a Chrome launcher.
 * All invoice data is loaded using a short-lived Google Drive read-only token.
 * NO write operation is offered until a secure owner-scoped GAS API deployment
 * is configured and tested against a sandbox. No raw token or invoice stored.
 */
class NativeMainActivity : AppCompatActivity() {
    private val teal = Color.rgb(10, 100, 116)
    private val dark = Color.rgb(30, 41, 59)
    private val muted = Color.rgb(100, 116, 139)
    private val pale = Color.rgb(243, 247, 250)
    private val gold = Color.rgb(180, 83, 9)
    private val white = Color.WHITE
    private var activeTab = 0
    private var accessToken: String? = null
    private var snapshot: SatoriSnapshot? = null
    private var statusMessage = "Chưa liên kết dữ liệu Google Drive. Bấm KẾT NỐI DỮ LIỆU để bắt đầu."
    private var searchText = ""
    private var isLoading = false
    private var fileUri: Uri? = null
    private var dataSource = ""
    private var lastReadAt = ""
    private var apiEndpoint: String? = null
    private var allowedActions: Set<String> = emptySet()
    // Owner opt-in: Google read-only access replaces repeated manual Drive file selection.
    // Poll only while the app is foregrounded, and only after successful authorization.
    private val syncHandler = Handler(Looper.getMainLooper())
    private val syncIntervalMs = 120_000L
    private var lastOnlineReadElapsedMs = 0L
    private var foreground = false
    private val syncTick = object : Runnable {
        override fun run() {
            if (!foreground) return
            if (!isLoading && accessToken != null &&
                lastOnlineReadElapsedMs > 0L &&
                SystemClock.elapsedRealtime() - lastOnlineReadElapsedMs >= syncIntervalMs) {
                when (dataSource) {
                    "Minh Satori API" -> refreshFromMobileApi()
                    "Google Drive API" -> refreshFromDrive()
                }
            }
            syncHandler.postDelayed(this, syncIntervalMs)
        }
    }
    private fun canAction(action: String): Boolean =
        apiEndpoint != null && accessToken != null &&
            dataSource == "Minh Satori API" && allowedActions.contains(action)
    private val canWrite: Boolean get() = canAction("orders.create")

    private val filePicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) {
            if (snapshot == null) statusMessage = "Chưa chọn file. Bấm KẾT NỐI DỮ LIỆU rồi chọn MinhSatori_Live_Data.json trong Google Drive."
            render()
        } else {
            try {
                contentResolver.takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (_: SecurityException) {
                // Some providers grant only a session-scoped read URI.
            }
            fileUri = uri
            getPreferences(MODE_PRIVATE).edit().putString("drive_file_uri", uri.toString()).apply()
            refreshFromPicker()
        }
    }

    // Open a supplier XLSX/CSV statement strictly for local, read-only analysis.
    // Never upload statement bytes, persist a copy or mutate a Drive invoice.
    private val supplierStatementPicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) {
            val source = snapshot
            if (source == null) {
                Toast.makeText(this, "Cần đọc dữ liệu hóa đơn trước.", Toast.LENGTH_LONG).show()
            } else {
                val fileName = try {
                    contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME),
                        null, null, null)?.use { cursor ->
                        if (cursor.moveToFirst()) cursor.getString(0) else null
                    }
                } catch (_: Exception) { null } ?: "satori.xlsx"
                Toast.makeText(this, "Đang đối chiếu bảng kê chỉ xem…", Toast.LENGTH_SHORT).show()
                Thread {
                    try {
                        val input = contentResolver.openInputStream(uri)
                            ?: throw IllegalArgumentException("Không đọc được bảng kê.")
                        val bytes = input.use { stream ->
                            val out = ByteArrayOutputStream()
                            val buffer = ByteArray(8192)
                            while (true) {
                                val count = stream.read(buffer)
                                if (count < 0) break
                                if (out.size() + count > 8 * 1024 * 1024)
                                    throw IllegalArgumentException("Bảng kê vượt 8 MB.")
                                out.write(buffer, 0, count)
                            }
                            out.toByteArray()
                        }
                        val sheet = SatoriSupplierSpreadsheet.open(fileName, bytes)
                        val rows = SatoriSupplierReconciliation.parse(sheet)
                        val report = SatoriSupplierReconciliation.compare(rows, source)
                        runOnUiThread { showSupplierStatementReport(fileName, source.revision, report) }
                    } catch (e: Exception) {
                        runOnUiThread {
                            AlertDialog.Builder(this)
                                .setTitle("KHÔNG ĐỌC ĐƯỢC BẢNG KÊ")
                                .setMessage(e.message ?: "File không đúng định dạng XLSX/CSV.")
                                .setPositiveButton("Đóng", null).show()
                        }
                    }
                }.start()
            }
        }
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            try {
                applyAuthorization(Identity.getAuthorizationClient(this)
                    .getAuthorizationResultFromIntent(result.data!!))
            } catch (_: Exception) {
                statusMessage = "Không hoàn tất cấp quyền Google Drive. Hãy thử lại."
                render()
            }
        } else {
            statusMessage = "Anh chưa cấp quyền Google Drive; ứng dụng không tải dữ liệu."
            render()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        fileUri = getPreferences(MODE_PRIVATE).getString("drive_file_uri", null)?.let {
            Uri.parse(it)
        }
        apiEndpoint = MobileApiClient.endpoint(this)
        render()
        if (apiEndpoint != null || preferGoogleDrive()) connectGoogle()
        else if (fileUri != null) refreshFromPicker()
    }

    override fun onResume() {
        super.onResume()
        foreground = true
        syncHandler.removeCallbacks(syncTick)
        syncHandler.postDelayed(syncTick, syncIntervalMs)
        // If returning from another app after a long time, refresh the authenticated
        // source rather than displaying a read-only file as live synced data.
        if (!isLoading && accessToken != null &&
            lastOnlineReadElapsedMs > 0L &&
            SystemClock.elapsedRealtime() - lastOnlineReadElapsedMs >= syncIntervalMs) {
            when (dataSource) {
                "Minh Satori API" -> refreshFromMobileApi()
                "Google Drive API" -> refreshFromDrive()
            }
        }
    }

    override fun onPause() {
        foreground = false
        syncHandler.removeCallbacks(syncTick)
        super.onPause()
    }

    private fun preferGoogleDrive(): Boolean =
        getPreferences(MODE_PRIVATE).getBoolean("google_drive_auto_read", false)

    override fun onDestroy() {
        syncHandler.removeCallbacks(syncTick)
        // Never persist OAuth access tokens or cached customer data to disk.
        accessToken = null
        snapshot = null
        super.onDestroy()
    }

    private fun dp(n: Int): Int = (n * resources.displayMetrics.density + 0.5f).toInt()

    private fun background(color: Int, radius: Int = 13): GradientDrawable =
        GradientDrawable().apply { setColor(color); cornerRadius = dp(radius).toFloat() }

    private fun label(parent: LinearLayout, content: String, size: Float = 14f,
                      isBold: Boolean = false, color: Int = dark, marginTop: Int = 0): TextView {
        val view = TextView(this).apply {
            text = content
            textSize = size
            setTextColor(color)
            if (isBold) setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(marginTop), 0, 0)
        }
        parent.addView(view)
        return view
    }

    private fun button(parent: LinearLayout, text: String, main: Boolean = false,
                       click: () -> Unit) {
        val b = Button(this).apply {
            this.text = text
            textSize = 13f
            isAllCaps = false
            setTextColor(if (main) white else teal)
            background = background(if (main) teal else Color.rgb(224, 242, 247), 10)
            setOnClickListener { click() }
        }
        parent.addView(b, LinearLayout.LayoutParams(-1, dp(48)).apply {
            topMargin = dp(9)
        })
    }

    private fun section(parent: LinearLayout, title: String, detail: String,
                        click: (() -> Unit)? = null) {
        val frame = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(13))
            background = background(white)
            if (click != null) {
                isClickable = true
                isFocusable = true
                setOnClickListener { click() }
            }
        }
        label(frame, title, 15f, true)
        label(frame, detail, 12f, false, muted, 5)
        parent.addView(frame, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(8)
        })
    }

    private fun render() {
        val shell = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(pale)
        }
        setContentView(shell)
        val scroll = ScrollView(this).apply { isFillViewport = true }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(20), dp(16), dp(20))
        }
        scroll.addView(content)
        shell.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))

        // Use the website's original logo and slate-to-blue brand banner.
        // Cosmetic only: do not alter account permissions or invoice calculations.
        val brand = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.rgb(15, 23, 42), Color.rgb(30, 58, 138))).apply {
                cornerRadius = dp(16).toFloat()
            }
        }
        val brandLogo = ImageView(this).apply {
            setImageResource(R.drawable.satori_invoice_logo)
            scaleType = ImageView.ScaleType.FIT_CENTER
            background = background(Color.WHITE, 10)
            setPadding(dp(4), dp(4), dp(4), dp(4))
            clipToOutline = true
            contentDescription = "Logo Minh Satori"
        }
        brand.addView(brandLogo, LinearLayout.LayoutParams(dp(48), dp(48)))
        val brandText = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), 0, 0, 0)
        }
        label(brandText, "MINH SATORI", 17f, true, Color.WHITE)
        label(brandText, "Hóa đơn · Sổ kế toán · Google Drive", 11f,
            false, Color.rgb(186, 230, 253), 3)
        brand.addView(brandText, LinearLayout.LayoutParams(0, -2, 1f))
        content.addView(brand, LinearLayout.LayoutParams(-1, -2))
        label(content, listOf("Tổng quan", "Hóa đơn", "Khách hàng", "Công nợ", "Lên đơn")[
            activeTab], 27f, true, dark, 13)
        label(content, "Minh Satori v" + BuildConfig.VERSION_NAME +
            " · ứng dụng Android", 12f, false, muted, 5)
        val connected = snapshot != null
        val snapshotInfo = snapshot
        val status = if (connected) {
            "Đã đọc " + (if (dataSource.isBlank()) "Drive" else dataSource) +
                " · Revision " + snapshotInfo!!.revision +
                " · " + snapshotInfo.invoices.size + " hóa đơn"
        } else statusMessage
        label(content, status, 13f, true, if (connected) teal else gold, 12)
        if (connected) {
            label(content, "Drive cập nhật: " + snapshotInfo!!.updatedAt +
                (if (lastReadAt.isBlank()) "" else " · Đọc lúc " + lastReadAt),
                11f, false, muted, 4)
        }

        if (isLoading) label(content, "Đang đọc dữ liệu Drive…",
            13f, true, teal, 8)

        button(content, if (apiEndpoint == null) "KÍCH HOẠT KẾT NỐI LÊN ĐƠN" else
            if (accessToken == null) "ĐĂNG NHẬP GOOGLE ĐỂ LÊN ĐƠN" else
            "ĐỒNG BỘ MINH SATORI", true) {
            when {
                apiEndpoint == null -> configureMobileApi()
                accessToken == null -> connectGoogle()
                else -> refreshFromMobileApi()
            }
        }
        if (apiEndpoint != null) {
            label(content, if (canWrite) "Đã xác thực chủ sở hữu · Được phép lên đơn" else
                "Chưa xác thực kết nối ghi đơn. Không thể lưu cho tới khi API hoạt động.",
                12f, true, if (canWrite) teal else gold, 8)
        }
        if (apiEndpoint == null) {
            button(content, if (preferGoogleDrive())
                "LÀM MỚI DỮ LIỆU BẰNG GOOGLE (CHỈ XEM)" else
                "KẾT NỐI GOOGLE DRIVE (CHỈ XEM · TỰ ĐỒNG BỘ)") {
                getPreferences(MODE_PRIVATE).edit()
                    .putBoolean("google_drive_auto_read", true).apply()
                if (accessToken == null) connectGoogle() else refreshFromDrive()
            }
            if (preferGoogleDrive()) label(content,
                "Đã chọn chế độ Google Drive. Khi app đang mở, " +
                    "dữ liệu sẽ làm mới khoảng mỗi 2 phút sau khi cấp quyền. " +
                    "Không tự cập nhật từ file Drive được chọn thủ công.",
                12f, false, muted, 7)
        }
        button(content, "CÀI ĐẶT LIÊN KẾT API") { configureMobileApi() }
        button(content, if (fileUri == null) "ĐỌC FILE DRIVE (CHỈ XEM)" else
            "LÀM MỚI FILE DRIVE (CHỈ XEM)") {
            if (fileUri != null) refreshFromPicker()
            else filePicker.launch(arrayOf("text/plain", "application/json"))
        }

        if (snapshotInfo == null) {
            section(content, "KẾT NỐI ĐỂ LÊN ĐƠN TRỰC TIẾP",
                "1. Kích hoạt đường dẫn Mobile API đã được chủ sở hữu triển khai.\n" +
                "2. Đăng nhập Google trên Android.\n" +
                "3. Hệ thống xác thực tài khoản và đồng bộ đơn từ Drive.\n\n" +
                "Nếu API chưa kích hoạt, có thể chọn file Drive chỉ để kiểm tra dữ liệu.")
            section(content, "An toàn dữ liệu",
                "App không ghi trực tiếp lên file JSON. Mọi lần lưu cần server " +
                "xác thực, kiểm tra revision và sao lưu.")
        } else when (activeTab) {
            0 -> renderOverview(content, snapshotInfo)
            1 -> renderInvoices(content, snapshotInfo)
            2 -> renderCustomers(content, snapshotInfo)
            3 -> renderDebt(content, snapshotInfo)
            else -> renderNewOrderInfo(content)
        }

        // Always display all five tabs without horizontal scrolling.
        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.rgb(15, 23, 42))
            setPadding(dp(4), dp(6), dp(4), dp(6))
        }
        listOf("Tổng quan", "Hóa đơn", "Khách", "Công nợ", "Lên đơn").forEachIndexed { i, name ->
            val chip = TextView(this).apply {
                text = name
                textSize = 11f
                gravity = Gravity.CENTER
                maxLines = 2
                setPadding(dp(2), dp(8), dp(2), dp(8))
                setTextColor(if (activeTab == i) Color.WHITE else
                    Color.rgb(203, 213, 225))
                background = background(if (activeTab == i)
                    Color.rgb(3, 105, 161) else Color.rgb(30, 41, 59), 10)
                isClickable = true
                isFocusable = true
                contentDescription = "Mở mục " + name
                setOnClickListener {
                    activeTab = i
                    render()
                }
            }
            tabs.addView(chip, LinearLayout.LayoutParams(0, dp(48), 1f))
        }
        shell.addView(tabs)
    }

    private fun renderOverview(parent: LinearLayout, data: SatoriSnapshot) {
        if (canWrite) button(parent, "+ LÊN ĐƠN MỚI", true) { launchEditor() }
        button(parent, "BẢNG GIÁ SATORI · " + data.products.size + " sản phẩm (CHỈ XEM)") {
            showCatalogue(data)
        }
        button(parent, "SỔ KẾ TOÁN · TRA CỨU (CHỈ XEM)") {
            showLedger(data)
        }
        button(parent, "TRÍ NHỚ AI · " + data.customerMemory.size + " HỒ SƠ (CHỈ XEM)") {
            showCustomerMemory(data)
        }
        button(parent, "ĐỐI CHIẾU HAI BẢN GIÁ · (CHỈ XEM)") {
            showPriceComparison(data)
        }
        button(parent, "ĐỐI CHIẾU BẢNG KÊ SATORI · XLSX/CSV (CHỈ XEM)") {
            supplierStatementPicker.launch(arrayOf(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "text/csv", "text/plain", "application/octet-stream"
            ))
        }
        section(parent, "Kho hóa đơn · " + data.invoices.size,
            data.activeCount.toString() + " bản ghi tính doanh thu; các bản 'Không Tính' " +
                "không cộng trùng.")
        section(parent, "Công nợ cần thu · " + data.outstandingCount + " hóa đơn",
            SatoriData.money(data.outstandingAmount) + " (ước tính theo trạng thái khách " +
                "thanh toán; không đồng nghĩa với Đã TT Satori).")
        label(parent, "ĐƠN GẦN ĐÂY", 14f, true, teal, 15)
        data.invoices.take(12).forEach { invoice ->
            section(parent, "#" + invoice.number + " · " + invoice.customer,
                invoice.displayDate + " · " + SatoriData.money(invoice.total) + " · " +
                    invoice.status) { openInvoice(invoice) }
        }
    }

    // Conservative read-only comparison of delivery price variants, not an
    // imported supplier Excel match. Nothing here writes or deduplicates Drive.
    private fun showPriceComparison(data: SatoriSnapshot) {
        val comparison = SatoriPriceComparison.compare(data.invoices)
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(12))
        }
        label(panel, "ĐỐI CHIẾU HAI BẢN GIÁ · REV " + data.revision,
            14f, true, teal)
        label(panel, "Ghép tự động chỉ khi cùng khách, ngày, số điện thoại, " +
            "địa chỉ, hàng và số lượng; hai bản tạo trong 30 phút và có dấu hiệu " +
            "bản giá. Thiếu bằng chứng → cần kiểm tra. Chỉ đọc dữ liệu.",
            12f, false, muted, 5)
        section(panel, comparison.pairs.size.toString() + " cặp đủ bằng chứng",
            comparison.toReview.size.toString() +
                " nhóm cần kiểm tra · " + comparison.notPairedCount +
                " bản ghi chưa ghép. Chênh lệch giá KHÔNG mặc định là lợi nhuận.")
        val scroll = ScrollView(this)
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(results)
        panel.addView(scroll, LinearLayout.LayoutParams(-1, dp(460)))

        label(results, "CÁC CẶP ĐỦ BẰNG CHỨNG", 13f, true, teal, 11)
        if (comparison.pairs.isEmpty()) label(results,
            "Chưa có cặp nào đủ điều kiện tự ghép.", 12f, false, muted, 7)
        comparison.pairs.take(80).forEach { pair ->
            section(results, "#" + pair.delivery.number + " / #" +
                pair.alternate.number + " · " + pair.delivery.customer,
                pair.delivery.address +
                    "\nBản tính doanh thu: " + SatoriData.money(pair.delivery.total) +
                    " · Bản giá khác: " + SatoriData.money(pair.alternate.total) +
                    "\nChênh lệch hai bản giá: " +
                    SatoriData.money(pair.priceDifference)) {
                AlertDialog.Builder(this)
                    .setTitle("Cặp #" + pair.delivery.number + " / #" +
                        pair.alternate.number)
                    .setMessage("Chỉ đối chiếu, không xóa hoặc cộng trừ hai đơn.\n\n" +
                        "Bản giao: #" + pair.delivery.number + " · " +
                        pair.delivery.status + "\n" +
                        SatoriData.money(pair.delivery.total) +
                        "\nBản giá khác: #" + pair.alternate.number + " · " +
                        pair.alternate.status + "\n" +
                        SatoriData.money(pair.alternate.total))
                    .setPositiveButton("Đóng", null)
                    .show()
            }
        }
        if (comparison.pairs.size > 80) label(results,
            "Chỉ hiển thị 80 cặp đầu tiên.", 11f, false, muted, 5)
        label(results, "CẦN KIỂM TRA THỦ CÔNG", 13f, true, gold, 15)
        if (comparison.toReview.isEmpty()) label(results,
            "Không có nhóm nghi vấn trong dữ liệu hiện tại.", 12f, false, muted, 6)
        comparison.toReview.take(80).forEach { review ->
            section(results, review.invoices.joinToString(" / ") { "#" + it.number },
                review.invoices.first().customer + "\n" + review.reason)
        }
        if (comparison.toReview.size > 80) label(results,
            "Chỉ hiển thị 80 nhóm đầu tiên.", 11f, false, muted, 5)
        AlertDialog.Builder(this)
            .setTitle("ĐỐI CHIẾU SATORI · HAI BẢN GIÁ")
            .setView(panel)
            .setPositiveButton("Đóng", null)
            .show()
    }

    private fun showSupplierStatementReport(filename: String, revision: Long,
                                            report: SupplierReconciliationReport) {
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        label(panel, "BẢNG KÊ: " + filename + " · REV " + revision, 14f, true, teal)
        label(panel, "Chỉ so sánh dữ liệu trong bộ nhớ app. Không sửa hóa đơn, " +
            "không đánh dấu thanh toán, không gửi file lên máy chủ. " +
            "Chênh lệch là Satori trừ tiền hóa đơn nội bộ trước khi xét " +
            "chiết khấu, thuế hay phí giao hàng.", 12f, false, muted, 6)
        section(panel, report.documentCount.toString() + " chứng từ Satori",
            report.matched.toString() + " khớp duy nhất · " +
                report.needsReview + " cần kiểm tra · " +
                report.unmatched + " chưa khớp.")
        val scroll = ScrollView(this)
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(results)
        panel.addView(scroll, LinearLayout.LayoutParams(-1, dp(460)))
        report.items.take(120).forEach { item ->
            val title = when (item.category) {
                "matched" -> "KHỚP"
                "review" -> "CẦN KIỂM TRA"
                else -> "CHƯA KHỚP"
            }
            val amounts = if (item.difference != null)
                "\nSatori: " + SatoriData.money(item.document.amount ?: 0L) +
                    " · Nội bộ: " + SatoriData.money(item.localAmount ?: 0L) +
                    " · Chênh: " + SatoriData.money(item.difference)
                else if (item.document.amount != null)
                    "\nSatori: " + SatoriData.money(item.document.amount)
                else ""
            section(results, title + " · " + item.document.label,
                item.explanation + amounts +
                    (if (item.candidateNumbers.isEmpty()) "" else
                        "\nHĐ ứng viên: " + item.candidateNumbers.joinToString(", ")))
        }
        if (report.items.size > 120) label(results,
            "Đang hiển thị 120 kết quả đầu. Chỉ có dữ liệu trong file đã chọn " +
                "được so sánh.", 12f, false, gold, 7)
        AlertDialog.Builder(this)
            .setTitle("ĐỐI CHIẾU SATORI · CHỈ XEM")
            .setView(panel)
            .setPositiveButton("Đóng", null).show()
    }

    // AI memory comes only from the current verified snapshot. File picker
    // shows the user's selected local copy; server mode enforces customers:read.
    // This native view never trains, edits or overwrites memory on Drive.
    private fun showCustomerMemory(data: SatoriSnapshot) {
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(12))
        }
        label(panel, "TRÍ NHỚ AI · Revision " + data.revision, 14f, true, teal)
        label(panel, "Chỉ xem hồ sơ và các điểm giao đã đồng bộ. " +
            "Không tự thay đổi địa chỉ hoặc chiết khấu khách hàng.",
            12f, false, muted, 5)
        val search = EditText(this).apply {
            hint = "Tên khách, tên người nhận, điện thoại, địa chỉ…"
            setSingleLine(true)
            textSize = 13f
        }
        panel.addView(search, LinearLayout.LayoutParams(-1, dp(48)))
        val scroll = ScrollView(this)
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(results)
        panel.addView(scroll, LinearLayout.LayoutParams(-1, dp(460)))
        fun refresh() {
            results.removeAllViews()
            val q = SatoriData.normalized(search.text.toString())
            val matches = data.customerMemory.filter { memory ->
                val searchable = listOf(
                    memory.name, memory.defaultPhone, memory.defaultLocation,
                    memory.preferredProduct, memory.aliases.joinToString(" "),
                    memory.receivers.joinToString(" ") { r ->
                        r.name + " " + r.phone + " " + r.location
                    }
                ).joinToString(" ")
                q.isBlank() || SatoriData.normalized(searchable).contains(q)
            }
            label(results, matches.size.toString() + " hồ sơ", 12f, true, teal, 8)
            if (data.customerMemory.isEmpty()) label(results,
                "Nguồn hiện tại không cung cấp Trí nhớ AI. Kiểm tra quyền " +
                    "customers:read và đồng bộ lại, không dùng bộ nhớ mặc định giả.",
                12f, false, gold, 10)
            else matches.take(120).forEach { memory ->
                val discount = memory.discountPercent?.let {
                    " · CK " + String.format(java.util.Locale("vi", "VN"), "%.1f%%", it)
                }.orEmpty()
                section(results, memory.name + discount,
                    "Điện thoại: " + memory.defaultPhone +
                        "\nĐịa chỉ thường dùng: " + memory.defaultLocation +
                        "\nSố điểm giao: " + memory.receivers.size +
                        " · Đơn đã học: " + memory.orderCount +
                        (if (memory.preferredProduct.isBlank()) "" else
                            "\nSản phẩm thường mua: " + memory.preferredProduct)) {
                    val points = if (memory.receivers.isEmpty())
                        "Chưa lưu điểm giao riêng." else memory.receivers.joinToString("\n\n") {
                            (if (it.name.isBlank()) "Người nhận" else it.name) +
                                " · " + it.phone + "\n" + it.location
                        }
                    AlertDialog.Builder(this)
                        .setTitle(memory.name + " · Các điểm giao")
                        .setMessage(points)
                        .setPositiveButton("Đóng", null)
                        .show()
                }
            }
            if (matches.size > 120) label(results,
                "Hiển thị 120 hồ sơ đầu tiên; nhập từ khóa để thu hẹp.",
                11f, false, muted, 8)
        }
        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                refresh()
            }
            override fun afterTextChanged(s: Editable?) {}
        })
        refresh()
        AlertDialog.Builder(this).setTitle("TRÍ NHỚ KHÁCH HÀNG")
            .setView(panel).setPositiveButton("Đóng", null).show()
    }

    // Website-parity milestone: browse the actual current catalogue from the
    // verified snapshot. No price editing until owner API permission is proven.
    private fun showCatalogue(data: SatoriSnapshot) {
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(8))
        }
        label(panel, "Giá lấy từ bản dữ liệu đang mở · Revision " + data.revision +
            ". Chỉ xem, không ghi lên Google Drive.", 12f, false, muted)
        val search = EditText(this).apply {
            hint = "Tìm sản phẩm hoặc mã hàng…"
            setSingleLine(true)
            textSize = 14f
        }
        panel.addView(search, LinearLayout.LayoutParams(-1, dp(48)))
        val scroll = ScrollView(this).apply { isFillViewport = false }
        val list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(4), 0, dp(12))
        }
        scroll.addView(list)
        panel.addView(scroll, LinearLayout.LayoutParams(-1, dp(460)))
        fun update() {
            list.removeAllViews()
            val needle = SatoriData.normalized(search.text.toString())
            val products = data.products.filter { product ->
                needle.isBlank() || SatoriData.normalized(
                    product.name + " " + product.code + " " + product.unit
                ).contains(needle)
            }
            label(list, products.size.toString() + " sản phẩm", 12f, true, teal, 8)
            products.forEach { p ->
                val discountText = p.discountPercent?.let { pct ->
                    " · CK " + String.format(java.util.Locale("vi", "VN"), "%.1f%%", pct)
                }.orEmpty()
                section(list, p.name + (if (p.code.isBlank()) "" else " · " + p.code),
                    p.unit + " · Giá niêm yết: " + SatoriData.money(p.listPrice) +
                    " · Đơn giá: " + SatoriData.money(p.unitPrice) + discountText)
            }
            if (products.isEmpty()) {
                label(list, if (data.products.isEmpty())
                    "Chưa có bảng giá trong nguồn dữ liệu này. Hãy đồng bộ lại."
                    else "Không tìm thấy sản phẩm phù hợp.", 12f, false, muted, 12)
            }
        }
        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                update()
            }
            override fun afterTextChanged(s: Editable?) {}
        })
        update()
        AlertDialog.Builder(this)
            .setTitle("BẢNG GIÁ SATORI")
            .setView(panel)
            .setPositiveButton("Đóng", null)
            .show()
    }

    // Website-inspired ledger: filter invoices without writing or estimating profit.
    // Financial totals intentionally ignore "Không Tính" and "Đã hủy" statuses.
    private fun showLedger(data: SatoriSnapshot) {
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(8), dp(14), dp(12))
        }
        label(content, "SỔ KẾ TOÁN · Revision " + data.revision, 14f, true, teal)
        label(content, "Xem số liệu đã lưu. 'Đã TT Satori' không có nghĩa khách đã trả tiền. " +
            "Lợi nhuận và đối chiếu trùng đơn sẽ được kiểm tra riêng, không tự ước tính.",
            12f, false, muted, 6)

        val search = EditText(this).apply {
            hint = "Số hóa đơn, khách hàng, điện thoại, địa chỉ…"
            setSingleLine(true)
            textSize = 13f
        }
        content.addView(search, LinearLayout.LayoutParams(-1, dp(48)))

        val statuses = listOf("Tất cả", "Chưa thanh toán", "Đã thanh toán",
            "Đã TT Satori", "Không Tính", "Đã hủy")
        val filter = Spinner(this)
        val choices = ArrayAdapter(this, android.R.layout.simple_spinner_item, statuses)
        choices.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        filter.adapter = choices
        content.addView(filter, LinearLayout.LayoutParams(-1, dp(48)))

        val totalsView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = background(Color.rgb(239, 246, 255))
            setPadding(dp(10), dp(8), dp(10), dp(8))
        }
        content.addView(totalsView)
        val scroll = ScrollView(this)
        val rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(rows)
        content.addView(scroll, LinearLayout.LayoutParams(-1, dp(410)))
        fun refresh() {
            val matched = SatoriLedger.query(
                data.invoices, search.text.toString(), statuses[filter.selectedItemPosition])
            val t = SatoriLedger.totals(matched)
            totalsView.removeAllViews()
            rows.removeAllViews()
            label(totalsView, "Hóa đơn: " + t.recordCount +
                " · Tính doanh thu: " + t.countedCount +
                " · Không tính/hủy: " + t.excludedCount, 12f, true, teal)
            label(totalsView, "Doanh thu: " + SatoriData.money(t.revenue), 14f, true, teal, 5)
            label(totalsView, "Khách đã trả: " + SatoriData.money(t.customerPaid) +
                " · Cần thu: " + SatoriData.money(t.customerUnpaid), 12f, false, dark, 4)
            if (t.invalidDateCount > 0) label(totalsView,
                "Có " + t.invalidDateCount +
                    " hóa đơn có ngày chưa hợp lệ; giữ nguyên dữ liệu để đối chiếu.",
                11f, false, gold, 5)
            label(rows, "KẾT QUẢ (" + matched.size + " hóa đơn)", 12f, true, teal, 11)
            matched.take(150).forEach { invoice ->
                section(rows, "#" + invoice.number + " · " + invoice.customer,
                    invoice.displayDate + " · " + invoice.status + " · " +
                    SatoriData.money(invoice.total)) { openInvoice(invoice) }
            }
            if (matched.size > 150) label(rows,
                "Đang hiển thị 150 hóa đơn đầu tiên. Tìm theo số, khách hoặc trạng thái " +
                    "để thu hẹp kết quả.", 11f, false, muted, 8)
            if (matched.isEmpty()) label(rows, "Không có hóa đơn phù hợp.", 12f)
        }
        filter.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: android.widget.AdapterView<*>?,
                view: View?, position: Int, id: Long) { refresh() }
            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
        }
        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                refresh()
            }
            override fun afterTextChanged(s: Editable?) {}
        })
        refresh()
        AlertDialog.Builder(this).setTitle("SỔ KẾ TOÁN MINH SATORI")
            .setView(content).setPositiveButton("Đóng", null).show()
    }

    private fun renderInvoices(parent: LinearLayout, data: SatoriSnapshot) {
        if (canWrite) {
            button(parent, "+ TẠO HÓA ĐƠN", true) { launchEditor() }
            button(parent, "THÙNG RÁC 30 NGÀY") { showTrash() }
        }
        label(parent, "Tìm số hóa đơn, khách hàng, số điện thoại hoặc địa chỉ", 12f,
            false, muted, 14)
        val input = EditText(this).apply {
            hint = "Tìm hóa đơn…"
            textSize = 14f
            setSingleLine(true)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = background(white)
            setText(searchText)
        }
        parent.addView(input, LinearLayout.LayoutParams(-1, dp(48)).apply {
            topMargin = dp(6)
        })
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        parent.addView(list)
        fun updateList() {
            list.removeAllViews()
            val matching = data.invoices.filter { SatoriData.search(it, searchText) }
            label(list, "Tìm thấy " + matching.size + " hóa đơn", 12f, true, teal, 8)
            matching.take(120).forEach { inv ->
                section(list, "#" + inv.number + " · " + inv.customer,
                    inv.displayDate + " · " + SatoriData.money(inv.total) + " · " +
                        inv.status + (if (inv.deliveryNote.isNotBlank()) " · Có ghi chú" else "")) {
                    openInvoice(inv)
                }
            }
        }
        input.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                searchText = s?.toString() ?: ""
                updateList()
            }
            override fun afterTextChanged(s: Editable?) {}
        })
        updateList()
    }

    private fun renderCustomers(parent: LinearLayout, data: SatoriSnapshot) {
        label(parent, "Khách trùng tên nhưng khác địa chỉ hoặc điện thoại được tách riêng.",
            12f, false, muted, 12)
        val groups = data.invoices.groupBy { SatoriData.customerKey(it) }
            .values.sortedWith(compareByDescending<List<SatoriInvoice>> { it.size }
                .thenBy { it.first().customer })
        label(parent, groups.size.toString() + " hồ sơ theo tên + SĐT + địa chỉ",
            13f, true, teal, 8)
        groups.forEach { group ->
            val representative = group.first()
            section(parent, representative.customer,
                representative.phone + " · " + representative.address +
                    " · " + group.size + " hóa đơn") {
                AlertDialog.Builder(this)
                    .setTitle(representative.customer)
                    .setMessage(representative.phone + "\n" + representative.address +
                        "\n\n" + group.joinToString("\n") {
                            "#" + it.number + " · " + SatoriData.money(it.total) +
                                " · " + it.status
                        })
                    .setPositiveButton("Đóng", null)
                    .apply {
                        if (canWrite) setNeutralButton("LÊN ĐƠN CHO KHÁCH", null)
                    }
                    .create().also { info ->
                        info.setOnShowListener {
                            if (canWrite) info.getButton(AlertDialog.BUTTON_NEUTRAL)
                                .setOnClickListener {
                                    info.dismiss()
                                    launchEditor(customer = representative)
                                }
                        }
                        info.show()
                    }
            }
        }
    }

    private fun renderDebt(parent: LinearLayout, data: SatoriSnapshot) {
        label(parent, "Chỉ tính các hóa đơn chưa ghi nhận khách trả tiền. Không cộng " +
            "các bản giá cộng tác viên có trạng thái 'Không Tính'.",
            12f, false, muted, 12)
        section(parent, "CẦN THU " + data.outstandingCount + " HÓA ĐƠN",
            SatoriData.money(data.outstandingAmount))
        data.invoices.filter { it.isOutstanding }.forEach { inv ->
            section(parent, "#" + inv.number + " · " + inv.customer,
                inv.displayDate + " · " + SatoriData.money(inv.total) +
                    " · " + inv.address) { openInvoice(inv) }
        }
    }

    private fun renderNewOrderInfo(parent: LinearLayout) {
        label(parent, "LÊN ĐƠN TRỰC TIẾP", 18f, true, teal, 14)
        if (canWrite) {
            section(parent, "Đã sẵn sàng lên đơn",
                "Tạo hóa đơn nhiều mặt hàng, chọn đúng điểm giao, nhập số tiền và ghi chú.")
            button(parent, "+ TẠO HÓA ĐƠN MỚI", true) { launchEditor() }
        } else {
            section(parent, "Chưa được cấp quyền ghi đơn",
                "Đăng nhập Google và kết nối Mobile API chủ sở hữu trước khi lưu. " +
                "App không ghi trực tiếp lên tệp Drive và không dùng khóa bí mật.")
            button(parent, "KẾT NỐI ĐỂ LÊN ĐƠN", true) {
                if (apiEndpoint == null) configureMobileApi() else connectGoogle()
            }
        }
    }

    private fun showTrash() {
        val endpoint = apiEndpoint
        val token = accessToken
        if (!canAction("orders.delete") || endpoint == null || token == null) {
            Toast.makeText(this, "Chưa có quyền quản lý thùng rác.", Toast.LENGTH_LONG).show()
            return
        }
        if (isLoading) return
        isLoading = true
        statusMessage = "Đang đọc thùng rác 30 ngày…"
        render()
        Thread {
            val reply = runCatching { MobileApiClient.trash(endpoint, token) }
            runOnUiThread {
                isLoading = false
                reply.fold(
                    onSuccess = { json ->
                        val arr = json.optJSONArray("orders")
                        if (arr == null || arr.length() == 0) {
                            Toast.makeText(this, "Thùng rác không có hóa đơn.", Toast.LENGTH_LONG).show()
                        } else {
                            val entries = (0 until arr.length()).map { arr.getJSONObject(it) }
                            val labels = entries.map {
                                "#" + it.optString("invoiceNo") + " · " + it.optString("name") +
                                    "\n" + SatoriData.money(it.optLong("total"))
                            }
                            AlertDialog.Builder(this)
                                .setTitle("THÙNG RÁC 30 NGÀY")
                                .setItems(labels.toTypedArray()) { _, index ->
                                    val chosen = entries[index]
                                    val invoice = chosen.optInt("invoiceNo")
                                    val customer = chosen.optString("name")
                                    val total = chosen.optLong("total")
                                    AlertDialog.Builder(this)
                                        .setTitle("Khôi phục hóa đơn #" + invoice + "?")
                                        .setMessage(customer + "\n" + SatoriData.money(total) +
                                            "\nKhôi phục với đúng mã hóa đơn cũ, không tạo đơn mới.")
                                        .setNegativeButton("Hủy", null)
                                        .setPositiveButton("XÁC NHẬN KHÔI PHỤC") { _, _ ->
                                            val p = JSONObject()
                                                .put("expectedRevision", snapshot?.revision ?: -1)
                                                .put("requestId", UUID.randomUUID().toString().replace("-", ""))
                                                .put("invoiceNo", invoice)
                                                .put("id", chosen.optString("id"))
                                                .put("expectedName", customer)
                                                .put("expectedTotal", total)
                                                .put("confirmed", true)
                                            executeWrite("orders.restore", p) { _, _ -> }
                                        }.show()
                                }.setNegativeButton("Đóng", null).show()
                        }
                        render()
                    },
                    onFailure = { error ->
                        statusMessage = "Không đọc được thùng rác: " + (error.message ?: "Lỗi")
                        render()
                    }
                )
            }
        }.start()
    }

    private fun openInvoice(invoice: SatoriInvoice) {
        val wrapper = ScrollView(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(15), dp(20), dp(18))
        }
        wrapper.addView(content)
        label(content, "HÓA ĐƠN #" + invoice.number, 19f, true, teal)
        label(content, invoice.customer, 16f, true, dark, 10)
        label(content, "Ngày: " + invoice.displayDate + " · " + invoice.status, 13f,
            false, muted, 7)
        label(content, "Điện thoại: " + invoice.phone, 13f, false, dark, 9)
        label(content, "Giao tới: " + invoice.address, 13f, false, dark, 5)
        if (invoice.duplicateFrom.isNotBlank()) {
            label(content, "Bản giá sao từ #" + invoice.duplicateFrom +
                " — kiểm tra trạng thái trước khi tính doanh thu.", 12f,
                true, gold, 8)
        }
        label(content, "SẢN PHẨM", 13f, true, teal, 16)
        invoice.lines.forEach { line ->
            label(content, line.description, 13f, true, dark, 8)
            label(content, line.quantity.toString() + " " + line.unit + " × " +
                SatoriData.money(line.unitPrice) + " = " + SatoriData.money(line.amount),
                12f, false, muted, 3)
        }
        label(content, "Phí giao: " + SatoriData.money(invoice.shipping), 12f,
            false, muted, 12)
        label(content, "Thuế VAT: " + SatoriData.money(invoice.vat), 12f,
            false, muted, 4)
        label(content, "TỔNG THANH TOÁN: " + SatoriData.money(invoice.total),
            17f, true, teal, 10)
        if (invoice.deliveryNote.isNotBlank()) {
            label(content, "GHI CHÚ / YÊU CẦU GIAO HÀNG", 13f, true, gold, 14)
            label(content, invoice.deliveryNote, 13f, true, dark, 4)
        }
        var invoiceDialog: AlertDialog? = null
        if (invoice.canEditOrDelete || invoice.canMarkCustomerPaid) {
            if (invoice.canEditOrDelete && canAction("orders.update")) button(content, "SỬA HÓA ĐƠN") {
                invoiceDialog?.dismiss()
                launchEditor(editing = invoice)
            }
            if (invoice.canMarkCustomerPaid && canAction("payments.markCustomerPaid")) button(content, "GHI NHẬN ĐÃ THANH TOÁN") {
                AlertDialog.Builder(this)
                    .setTitle("Xác nhận đã thực nhận tiền?")
                    .setMessage("Hóa đơn #" + invoice.number + "\nKhách: " +
                        invoice.customer + "\nĐã nhận đủ " + SatoriData.money(invoice.total) +
                        "?\nChỉ đánh dấu khi tiền đã thực sự nhận.")
                    .setNegativeButton("Chưa nhận", null)
                    .setPositiveButton("XÁC NHẬN ĐỦ TIỀN") { _, _ ->
                        val p = JSONObject()
                            .put("expectedRevision", snapshot?.revision ?: -1)
                            .put("invoiceNo", invoice.number.toInt())
                            .put("amount", invoice.total)
                            .put("confirmed", true)
                        executeWrite("payments.markCustomerPaid", p) { success, _ ->
                            if (success) invoiceDialog?.dismiss()
                        }
                    }.show()
            }
            val deleteId = UUID.randomUUID().toString().replace("-", "")
            if (invoice.canEditOrDelete && canAction("orders.delete")) button(content, "XÓA MỀM VÀO THÙNG RÁC 30 NGÀY") {
                AlertDialog.Builder(this)
                    .setTitle("Xóa mềm hóa đơn #" + invoice.number + "?")
                    .setMessage("Khách: " + invoice.customer + "\n" +
                        SatoriData.money(invoice.total) +
                        "\nĐơn chuyển vào thùng rác trong 30 ngày; chưa xóa vĩnh viễn.")
                    .setNegativeButton("Hủy", null)
                    .setPositiveButton("XÁC NHẬN XÓA") { _, _ ->
                        val p = JSONObject()
                            .put("expectedRevision", snapshot?.revision ?: -1)
                            .put("requestId", deleteId)
                            .put("id", invoice.id)
                            .put("invoiceNo", invoice.number.toInt())
                            .put("expectedName", invoice.customer)
                            .put("expectedTotal", invoice.total)
                            .put("confirmed", true)
                        executeWrite("orders.delete", p) { success, _ ->
                            if (success) invoiceDialog?.dismiss()
                        }
                    }.show()
            }
        }
        button(content, "GỬI PDF QUA ZALO") {
            try { NativeInvoicePdf.shareZalo(this, invoice) }
            catch (error: Exception) {
                Toast.makeText(this, "Không chia sẻ được Zalo: " +
                    (error.message ?: ""), Toast.LENGTH_LONG).show()
            }
        }
        button(content, "GỬI PDF QUA MESSENGER") {
            try { NativeInvoicePdf.shareMessenger(this, invoice) }
            catch (error: Exception) {
                Toast.makeText(this, "Không chia sẻ được Messenger: " +
                    (error.message ?: ""), Toast.LENGTH_LONG).show()
            }
        }
        val dialog = AlertDialog.Builder(this)
            .setView(wrapper)
            .setNegativeButton("Đóng", null)
            .setPositiveButton("Xuất / Chia sẻ PDF", null)
            .create()
        invoiceDialog = dialog
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                try {
                    NativeInvoicePdf.share(this, invoice)
                } catch (_: Exception) {
                    Toast.makeText(this, "Không xuất được PDF, hãy thử lại.",
                        Toast.LENGTH_LONG).show()
                }
            }
        }
        dialog.show()
    }

    private fun configureMobileApi() {
        val entry = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_VARIATION_URI
            setText(apiEndpoint.orEmpty())
            setSingleLine(false)
            setPadding(dp(18), dp(12), dp(18), dp(12))
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("KẾT NỐI MOBILE API")
            .setMessage("Nhập liên kết /exec của Apps Script Bot API đã được kích hoạt quyền Android chủ sở hữu. Chỉ nhập đường dẫn, KHÔNG nhập khóa HMAC hay mật khẩu.")
            .setView(entry)
            .setNegativeButton("Hủy", null)
            .setPositiveButton("LƯU & KẾT NỐI", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val candidate = entry.text.toString().trim()
                if (!MobileApiClient.saveEndpoint(this, candidate)) {
                    entry.error = "Chỉ chấp nhận liên kết HTTPS Apps Script /macros/s/.../exec"
                    return@setOnClickListener
                }
                apiEndpoint = MobileApiClient.endpoint(this)
                // Previously loaded file snapshots are read-only until verified API connects.
                dataSource = ""
                snapshot = null
                allowedActions = emptySet()
                dialog.dismiss()
                connectGoogle()
            }
        }
        dialog.show()
    }

    private fun refreshFromMobileApi() {
        val endpoint = apiEndpoint ?: run {
            statusMessage = "Chưa cấu hình Mobile API."
            render()
            return
        }
        val token = accessToken ?: run { connectGoogle(); return }
        if (isLoading) return
        isLoading = true
        statusMessage = "Đang xác thực chủ sở hữu và đồng bộ hóa đơn…"
        render()
        Thread {
            val outcome = runCatching { MobileApiClient.snapshot(endpoint, token) }
            runOnUiThread {
                isLoading = false
                outcome.fold(
                    onSuccess = {
                        snapshot = it.snapshot
                        allowedActions = it.allowedActions
                        dataSource = "Minh Satori API"
                        lastReadAt = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
                        lastOnlineReadElapsedMs = SystemClock.elapsedRealtime()
                        statusMessage = "Đã kết nối quyền lên đơn."
                    },
                    onFailure = {
                        snapshot = null
                        allowedActions = emptySet()
                        dataSource = ""
                        statusMessage = "Không kết nối được Mobile API: " +
                            (it.message ?: "không rõ lỗi") +
                            ". Chưa bật chức năng lưu đơn."
                        if (it is MobileApiError &&
                            (it.apiCode == "AUTH_FAILED" || it.apiCode == "FORBIDDEN")) {
                            accessToken = null
                        }
                    }
                )
                render()
            }
        }.start()
    }

    private fun executeWrite(
        action: String,
        payload: JSONObject,
        completed: (Boolean, String) -> Unit
    ) {
        val endpoint = apiEndpoint
        val token = accessToken
        if (!canAction(action) || endpoint == null || token == null || isLoading) {
            completed(false, "Tài khoản chưa được cấp quyền thực hiện lệnh này.")
            return
        }
        isLoading = true
        statusMessage = "Đang gửi " + action + " lên Minh Satori…"
        render()
        Thread {
            val writeResult = runCatching {
                MobileApiClient.request(endpoint, token, action, payload,
                    UUID.randomUUID().toString().replace("-", ""))
            }
            val latest = if (writeResult.isSuccess) runCatching {
                MobileApiClient.snapshot(endpoint, token)
            } else null
            val requestId = payload.optString("requestId")
            // A timeout is not proof that the server rejected the write.
            // Read the authoritative ledger and find the same durable
            // requestId instead of sending a second write.
            val uncertainTransport = writeResult.isFailure &&
                writeResult.exceptionOrNull() !is MobileApiError
            val canVerifyFromSnapshot = (requestId.isNotBlank() &&
                action in setOf("orders.create", "orders.update", "orders.restore")) ||
                action == "payments.markCustomerPaid"
            val recovery = if (uncertainTransport && canVerifyFromSnapshot)
                runCatching { MobileApiClient.snapshot(endpoint, token) } else null
            runOnUiThread {
                isLoading = false
                writeResult.fold(
                    onSuccess = { reply ->
                        if (latest?.isSuccess == true) {
                            snapshot = latest.getOrNull()?.snapshot
                            allowedActions = latest.getOrNull()?.allowedActions ?: emptySet()
                            dataSource = "Minh Satori API"
                            lastReadAt = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
                        } else {
                            // A confirmed write must never be reported as a failed write.
                            snapshot = null
                            allowedActions = emptySet()
                            dataSource = ""
                            statusMessage = "Server đã xử lý lệnh. Không xác minh được đồng bộ; hãy kết nối lại trước thao tác tiếp."
                        }
                        val changed = reply.optJSONObject("data")?.optJSONObject("order")
                        val invoiceNo = changed?.optString("invoiceNo").orEmpty()
                        val answer = if (invoiceNo.isNotBlank())
                            "Thành công: Hóa đơn #" + invoiceNo else "Server xác nhận thành công."
                        Toast.makeText(this, answer, Toast.LENGTH_LONG).show()
                        completed(true, answer)
                    },
                    onFailure = { e ->
                        val recovered = recovery?.getOrNull()
                        val committed = recovered?.snapshot?.confirmedWrite(action, requestId)
                        val confirmedPaid = if (action == "payments.markCustomerPaid") {
                            recovered?.snapshot?.confirmedCustomerPayment(
                                payload.optString("invoiceNo"),
                                payload.optLong("amount", -1L)
                            )
                        } else null
                        if (recovered != null) {
                            snapshot = recovered.snapshot
                            allowedActions = recovered.allowedActions
                            dataSource = "Minh Satori API"
                            lastReadAt = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
                        }
                        if (committed != null) {
                            val info = "Đã xác minh hóa đơn #" + committed.number +
                                " đã được lưu trước khi mất kết nối."
                            statusMessage = info
                            Toast.makeText(this, info, Toast.LENGTH_LONG).show()
                            completed(true, info)
                        } else if (confirmedPaid != null) {
                            val info = "Đã đối chiếu hóa đơn #" + confirmedPaid.number +
                                ": trạng thái khách thanh toán đã được lưu. Không ghi lần nữa."
                            statusMessage = info
                            Toast.makeText(this, info, Toast.LENGTH_LONG).show()
                            completed(true, info)
                        } else {
                            val info = (e.message ?: "Không rõ lỗi")
                            // A later write may still commit AFTER the recovery snapshot
                            // was read. Even a successful refresh without an exact match
                            // does NOT prove that the operation failed.
                            if (uncertainTransport) {
                                snapshot = null
                                allowedActions = emptySet()
                                dataSource = ""
                                statusMessage = "Chưa xác minh được kết quả thao tác. " +
                                    "Tạm khóa ghi để tránh trùng đơn/thanh toán; hãy kiểm tra " +
                                    "hóa đơn trên hệ thống và đồng bộ lại trước khi tiếp tục."
                            } else {
                                statusMessage = "Không thể hoàn tất yêu cầu: " + info
                            }
                            if (e is MobileApiError && (e.apiCode == "REVISION_CONFLICT" ||
                                    e.apiCode == "PROFILE_CHANGED" ||
                                    e.apiCode == "ORDER_CHANGED")) {
                                Toast.makeText(this,
                                    "Dữ liệu đã thay đổi trên máy khác. Tải lại trước khi tiếp tục.",
                                    Toast.LENGTH_LONG).show()
                            }
                            completed(false, statusMessage)
                        }
                    }
                )
                render()
            }
        }.start()
    }

    private fun launchEditor(editing: SatoriInvoice? = null,
                             customer: SatoriInvoice? = null) {
        val loaded = snapshot
        val action = if (editing == null) "orders.create" else "orders.update"
        if (!canAction(action) || loaded == null) {
            Toast.makeText(this, "Tài khoản chưa được cấp quyền lên/sửa đơn.", Toast.LENGTH_LONG).show()
            return
        }
        NativeOrderEditor.show(this, loaded, editing, customer) { action, payload, done ->
            executeWrite(action, payload, done)
        }
    }

    private fun refreshFromPicker() {
        val selected = fileUri ?: run {
            statusMessage = "Anh cần chọn file MinhSatori_Live_Data.json."
            render()
            return
        }
        if (isLoading) return
        isLoading = true
        statusMessage = "Đang đọc file Drive được chọn qua Android."
        render()
        Thread {
            val result = try {
                // Prevent accidentally displaying a downloaded backup or unrelated file.
                val chosenName = contentResolver.query(
                    selected, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
                )?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                }.orEmpty()
                if (chosenName.isNotBlank() && !chosenName.contains(
                        "MinhSatori_Live_Data", ignoreCase = true)) {
                    throw IllegalArgumentException("Đang chọn file '" + chosenName +
                        "'. Anh hãy chọn MinhSatori_Live_Data.json trên Drive.")
                }
                val bytes = contentResolver.openInputStream(selected)?.use { stream ->
                    val buffer = ByteArray(8192)
                    val target = ByteArrayOutputStream()
                    while (true) {
                        val count = stream.read(buffer)
                        if (count < 0) break
                        if (target.size() + count > 12_000_000)
                            throw IllegalArgumentException("File quá lớn.")
                        target.write(buffer, 0, count)
                    }
                    target.toByteArray()
                } ?: throw IllegalArgumentException("Không mở được file đã chọn.")
                val parsed = SatoriData.fromDriveState(String(bytes, Charsets.UTF_8))
                require(parsed.revision >= 1 && parsed.updatedAt.isNotBlank()) {
                    "File thiếu revision hoặc ngày cập nhật."
                }
                Result.success(parsed)
            } catch (e: Exception) {
                Result.failure<SatoriSnapshot>(e)
            }
            runOnUiThread {
                isLoading = false
                result.fold(
                    onSuccess = {
                        snapshot = it
                        dataSource = "file Google Drive"
                        lastReadAt = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
                        statusMessage = "Đã đọc dữ liệu Drive."
                    },
                    onFailure = {
                        snapshot = null
                        statusMessage = "Không đọc được dữ liệu: " +
                            (it.message ?: "không rõ nguyên nhân") +
                            ". Bấm CHỌN FILE DRIVE KHÁC để kết nối lại."
                    }
                )
                render()
            }
        }.start()
    }

    private fun connectGoogle() {
        if (isLoading) return
        // The secured Mobile API only needs verified email identity.
        // Avoid requesting restricted Drive access when the server reads Drive.
        // Read-only Drive mode still asks for drive.readonly when no API is configured.
        val scopes = mutableListOf(Scope("https://www.googleapis.com/auth/userinfo.email"))
        if (apiEndpoint == null) {
            scopes.add(Scope("https://www.googleapis.com/auth/drive.readonly"))
        }
        val request = AuthorizationRequest.builder()
            .setRequestedScopes(scopes)
            .build()
        statusMessage = "Đang xác thực tài khoản Google được cấp quyền Minh Satori."
        render()
        Identity.getAuthorizationClient(this).authorize(request)
            .addOnSuccessListener { applyAuthorization(it) }
            .addOnFailureListener {
                statusMessage = "Không thể cấp quyền Google. Kiểm tra tài khoản " +
                    "và quyền ứng dụng trên điện thoại."
                render()
            }
    }

    private fun applyAuthorization(result: AuthorizationResult) {
        if (result.hasResolution()) {
            val pending = result.pendingIntent
            if (pending == null) {
                statusMessage = "Google không trả về màn hình cấp quyền."
                render()
                return
            }
            try {
                permissionLauncher.launch(IntentSenderRequest.Builder(pending.intentSender)
                    .build())
            } catch (_: Exception) {
                statusMessage = "Không mở được màn hình cấp quyền Google."
                render()
            }
        } else {
            val token = result.accessToken
            if (token.isNullOrBlank() ||
                !result.grantedScopes.contains("https://www.googleapis.com/auth/userinfo.email")) {
                statusMessage = "Google chưa cấp quyền xác minh email chủ sở hữu."
                render()
                return
            }
            accessToken = token
            if (apiEndpoint != null) refreshFromMobileApi() else refreshFromDrive()
        }
    }

    private fun refreshFromDrive() {
        if (isLoading) return
        val token = accessToken ?: run { connectGoogle(); return }
        isLoading = true
        statusMessage = "Đang đọc dữ liệu thật từ Google Drive."
        render()
        Thread {
            val response = try {
                Result.success(DriveReadClient.loadWithToken(token))
            } catch (error: Exception) {
                Result.failure(error)
            }
            runOnUiThread {
                isLoading = false
                response.fold(
                    onSuccess = {
                        snapshot = it
                        dataSource = "Google Drive API"
                        lastReadAt = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
                        lastOnlineReadElapsedMs = SystemClock.elapsedRealtime()
                        statusMessage = "Đã đồng bộ trực tiếp."
                    },
                    onFailure = {
                        snapshot = null
                        statusMessage = it.message ?: "Không đọc được Drive."
                        // Do not silently show stale results after a failed refresh.
                        if (statusMessage.contains("hết hạn")) accessToken = null
                    }
                )
                render()
            }
        }.start()
    }
}
