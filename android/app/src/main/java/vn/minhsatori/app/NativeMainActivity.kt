package vn.minhsatori.app

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
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
    private var statusMessage = "Kết nối tài khoản Google để đồng bộ dữ liệu hóa đơn."
    private var searchText = ""
    private var isLoading = false

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
        render()
    }

    override fun onDestroy() {
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

        label(content, "MINH SATORI", 14f, true, teal)
        label(content, listOf("Tổng quan", "Hóa đơn", "Khách hàng", "Công nợ", "Lên đơn")[
            activeTab], 27f, true, dark, 6)
        label(content, "Ứng dụng Android · hoạt động ngay trong app · không mở Chrome",
            12f, false, muted, 5)
        val connected = snapshot != null
        val snapshotInfo = snapshot
        val status = if (connected) {
            "Đã đọc Google Drive · Revision " + snapshotInfo!!.revision +
                " · " + snapshotInfo.invoices.size + " hóa đơn"
        } else statusMessage
        val statusColor = if (connected) teal else gold
        label(content, status, 12f, true, statusColor, 12)

        if (isLoading) label(content, "Đang kết nối và đối chiếu dữ liệu Drive…",
            13f, true, teal, 8)
        button(content, if (accessToken == null) "KẾT NỐI TÀI KHOẢN GOOGLE" else
            "LÀM MỚI TỪ GOOGLE DRIVE", true) {
            if (accessToken == null) connectGoogle() else refreshFromDrive()
        }

        if (snapshotInfo == null) {
            section(content, "Dữ liệu luôn lấy từ Drive",
                "Ứng dụng chưa đọc hóa đơn nào. Không có cơ sở dữ liệu giả hoặc bản sao " +
                    "hóa đơn cũ lưu trên điện thoại.")
            section(content, "Bảo mật",
                "Chỉ xin quyền đọc Google Drive. Không lưu mật khẩu, khóa Bot API " +
                    "hay mã hóa đơn xuống bộ nhớ điện thoại.")
        } else when (activeTab) {
            0 -> renderOverview(content, snapshotInfo)
            1 -> renderInvoices(content, snapshotInfo)
            2 -> renderCustomers(content, snapshotInfo)
            3 -> renderDebt(content, snapshotInfo)
            else -> renderNewOrderInfo(content)
        }

        val horizontal = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            setBackgroundColor(white)
        }
        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(8), dp(6), dp(8), dp(6))
        }
        listOf("Tổng quan", "Hóa đơn", "Khách hàng", "Công nợ", "Lên đơn").forEachIndexed { i, name ->
            val chip = TextView(this).apply {
                text = name
                textSize = 13f
                gravity = Gravity.CENTER
                setPadding(dp(12), dp(12), dp(12), dp(12))
                setTextColor(if (activeTab == i) white else teal)
                background = background(if (activeTab == i) teal else white, 10)
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    activeTab = i
                    render()
                }
            }
            tabs.addView(chip)
        }
        horizontal.addView(tabs)
        shell.addView(horizontal)
    }

    private fun renderOverview(parent: LinearLayout, data: SatoriSnapshot) {
        section(parent, "Kho hóa đơn · " + data.invoices.size,
            data.activeCount.toString() + " bản ghi tính doanh thu; các bản 'Không Tính' " +
                "không cộng trùng.")
        section(parent, "Công nợ cần thu · " + data.outstandingCount + " hóa đơn",
            SatoriData.money(data.outstandingAmount) + " (ước tính theo trạng thái khách " +
                "thanh toán; không đồng nghĩa với Đã TT Satori).")
        label(parent, "ĐƠN GẦN ĐÂY", 14f, true, teal, 15)
        data.invoices.take(12).forEach { invoice ->
            section(parent, "#" + invoice.number + " · " + invoice.customer,
                invoice.date + " · " + SatoriData.money(invoice.total) + " · " +
                    invoice.status) { openInvoice(invoice) }
        }
    }

    private fun renderInvoices(parent: LinearLayout, data: SatoriSnapshot) {
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
                    inv.date + " · " + SatoriData.money(inv.total) + " · " +
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
                    .show()
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
                inv.date + " · " + SatoriData.money(inv.total) +
                    " · " + inv.address) { openInvoice(inv) }
        }
    }

    private fun renderNewOrderInfo(parent: LinearLayout) {
        label(parent, "Lên đơn trên Android", 17f, true, teal, 16)
        section(parent, "Chưa bật chức năng ghi đơn trong bản thử này",
            "Bản Android đã đọc dữ liệu thật, tạo PDF và chia sẻ trong app. " +
                "Để tạo hoặc sửa đơn trực tiếp, cần API xác thực tài khoản Android " +
                "và kiểm soát revision phía Apps Script. Không được ghi thẳng " +
                "vào file JSON trên Drive vì dễ gây mất hóa đơn giữa các thiết bị.")
        label(parent, "Không có nút lưu giả. Khi API production được xác thực và " +
            "kiểm thử trên sandbox, chức năng tạo/sửa/xóa mới được mở.",
            12f, false, gold, 12)
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
        label(content, "Ngày: " + invoice.date + " · " + invoice.status, 13f,
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
        val dialog = AlertDialog.Builder(this)
            .setView(wrapper)
            .setNegativeButton("Đóng", null)
            .setPositiveButton("Xuất / Chia sẻ PDF", null)
            .create()
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

    private fun connectGoogle() {
        if (isLoading) return
        val request = AuthorizationRequest.builder()
            .setRequestedScopes(listOf(Scope(
                "https://www.googleapis.com/auth/drive.readonly")))
            .build()
        statusMessage = "Đang yêu cầu quyền đọc Drive bằng tài khoản Google trên Android."
        render()
        Identity.getAuthorizationClient(this).authorize(request)
            .addOnSuccessListener { applyAuthorization(it) }
            .addOnFailureListener {
                statusMessage = "Không thể cấp quyền Drive. Kiểm tra tài khoản Google " +
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
            if (token.isNullOrBlank() || !result.grantedScopes.contains(
                    "https://www.googleapis.com/auth/drive.readonly")) {
                statusMessage = "Tài khoản chưa cho phép đọc Drive."
                render()
                return
            }
            accessToken = token
            refreshFromDrive()
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
                        statusMessage = "Đã đồng bộ thành công."
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
