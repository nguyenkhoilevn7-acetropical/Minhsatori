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
import android.text.InputType
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
    private var dashboardMode = false
    private val ink = Color.rgb(226, 232, 240)
    private val softInk = Color.rgb(148, 163, 184)
    private val cyan = Color.rgb(103, 232, 249)
    private val night = Color.rgb(2, 6, 23)
    private val surface = Color.rgb(15, 23, 42)
    private val indigo = Color.rgb(30, 58, 138)
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
    private var actorId = ""
    private lateinit var pendingStore: PendingWriteStore
    private var pendingWrite: PendingMobileWrite? = null
    private var pendingStorageError = false
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
    private fun hasServerAction(action: String): Boolean =
        apiEndpoint != null && accessToken != null &&
            actorId.isNotBlank() && dataSource == "Minh Satori API" && allowedActions.contains(action)
    private fun canAction(action: String): Boolean = hasServerAction(action) &&
        (action !in PendingMobileWrite.ACTIONS || (pendingWrite == null && !pendingStorageError))
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
        pendingStore = PendingWriteStore(this)
        runCatching { pendingStore.load() }.fold(
            onSuccess = { pendingWrite = it },
            onFailure = {
                pendingStorageError = true
                statusMessage = "Không mở được thao tác đang chờ. Đã khóa ghi để tránh mất hoặc trùng đơn."
            }
        )
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
        // OAuth tokens/snapshots stay in memory; only the encrypted pending write survives.
        accessToken = null
        snapshot = null
        super.onDestroy()
    }

    private fun dp(n: Int): Int = (n * resources.displayMetrics.density + 0.5f).toInt()

    private fun background(color: Int, radius: Int = 13): GradientDrawable =
        GradientDrawable().apply { setColor(color); cornerRadius = dp(radius).toFloat() }

    private fun label(parent: LinearLayout, content: String, size: Float = 14f,
                      isBold: Boolean = false, color: Int = dark, marginTop: Int = 0): TextView {
        val actualColor = if (!dashboardMode) color else when (color) {
            dark -> ink
            muted -> softInk
            teal -> cyan
            gold -> Color.rgb(251, 191, 36)
            else -> color
        }
        val view = TextView(this).apply {
            text = content
            textSize = size
            setTextColor(actualColor)
            if (isBold) setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(marginTop), 0, 0)
            includeFontPadding = false
        }
        parent.addView(view)
        return view
    }

    private fun panelBackground(color: Int = surface, radius: Int = 16): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radius).toFloat()
            setStroke(dp(1), Color.rgb(42, 59, 86))
        }

    private fun button(parent: LinearLayout, text: String, main: Boolean = false,
                       click: () -> Unit) {
        val b = Button(this).apply {
            this.text = text
            textSize = 12f
            isAllCaps = false
            letterSpacing = 0f
            minHeight = dp(40)
            minimumHeight = dp(40)
            setPadding(dp(9), 0, dp(9), 0)
            stateListAnimator = null
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(if (main) white else cyan)
            background = if (main) {
                GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                    intArrayOf(Color.rgb(37, 99, 235), Color.rgb(8, 145, 178))).apply {
                    cornerRadius = dp(12).toFloat()
                }
            } else panelBackground(Color.rgb(19, 37, 64), 12)
            setOnClickListener { click() }
        }
        parent.addView(b, LinearLayout.LayoutParams(-1, dp(41)).apply {
            topMargin = dp(6)
        })
    }

    private fun section(parent: LinearLayout, title: String, detail: String,
                        click: (() -> Unit)? = null) {
        val frame = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = panelBackground()
            if (click != null) {
                isClickable = true
                isFocusable = true
                setOnClickListener { click() }
            }
        }
        label(frame, title, 13.5f, true, white)
        label(frame, detail, 11.5f, false, softInk, 4)
        parent.addView(frame, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(6)
        })
    }

    private fun metricTile(parent: LinearLayout, title: String, value: String,
                           accent: Int = cyan) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(13), dp(14), dp(12), dp(14))
            background = panelBackground(surface)
        }
        label(box, title, 11.5f, false, muted)
        label(box, value, 18f, true, accent, 7)
        parent.addView(box, LinearLayout.LayoutParams(0, -2, 1f).apply {
            marginEnd = dp(5)
        })
    }

    private fun showConnectionSettings() {
        // AlertDialog shows either setMessage OR the setItems list, not both.
        // Keep the actual source choices visible on compact Samsung displays.
        val items = arrayOf(
            "☁ Google Drive — xem hóa đơn thật (chỉ đọc)",
            "Đăng nhập Google / Đồng bộ Mobile API",
            "Cài đặt Mobile API (SANDBOX)",
            "Chọn file dữ liệu thủ công — chỉ xem"
        )
        AlertDialog.Builder(this)
            .setTitle("Kết nối Minh Satori")
            .setItems(items) { _, choice ->
                when (choice) {
                    0 -> {
                        // Explicitly leave the 3-fake-invoice API snapshot behind.
                        // OAuth must request Drive read scope even when a sandbox
                        // Mobile API endpoint is already stored on the device.
                        getPreferences(MODE_PRIVATE).edit()
                            .putBoolean("google_drive_auto_read", true).apply()
                        accessToken = null
                        actorId = ""
                        allowedActions = emptySet()
                        snapshot = null
                        dataSource = ""
                        connectGoogle()
                    }
                    1 -> {
                        getPreferences(MODE_PRIVATE).edit()
                            .putBoolean("google_drive_auto_read", false).apply()
                        if (apiEndpoint == null) configureMobileApi()
                        else if (accessToken == null) connectGoogle()
                        else refreshFromMobileApi()
                    }
                    2 -> {
                        getPreferences(MODE_PRIVATE).edit()
                            .putBoolean("google_drive_auto_read", false).apply()
                        configureMobileApi()
                    }
                    else -> {
                        if (fileUri != null) refreshFromPicker()
                        else filePicker.launch(arrayOf("text/plain", "application/json"))
                    }
                }
            }
            .setNegativeButton("Đóng", null).show()
    }

    private fun render() {
        dashboardMode = true
        val shell = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(night)
        }
        setContentView(shell)
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(16))
        }
        scroll.addView(content)
        shell.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))

        // Web brand parity: midnight header, cyan gradient and original Satori logo.
        val brand = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.rgb(15, 23, 42), indigo, Color.rgb(8, 89, 121))).apply {
                cornerRadius = dp(18).toFloat()
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
        brand.addView(brandLogo, LinearLayout.LayoutParams(dp(46), dp(46)))
        val brandText = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(11), 0, 0, 0)
        }
        label(brandText, "MINH SATORI", 19f, true, white)
        label(brandText, "HÓA ĐƠN  •  SỔ KẾ TOÁN", 10f,
            false, Color.rgb(186, 230, 253), 5)
        brand.addView(brandText, LinearLayout.LayoutParams(0, -2, 1f))
        val options = TextView(this).apply {
            text = "⚙"
            textSize = 23f
            gravity = Gravity.CENTER
            setTextColor(white)
            contentDescription = "Cài đặt kết nối"
            isClickable = true
            isFocusable = true
            setOnClickListener { showConnectionSettings() }
        }
        brand.addView(options, LinearLayout.LayoutParams(dp(42), dp(46)))
        content.addView(brand, LinearLayout.LayoutParams(-1, -2))

        val pages = listOf("Tổng quan", "Hóa đơn", "Khách hàng", "Công nợ", "Lên đơn")
        label(content, pages[activeTab], 20f, true, white, 12)
        label(content, "MINH SATORI  •  ANDROID " + BuildConfig.VERSION_NAME,
            10.5f, true, cyan, 6)

        val data = snapshot
        val connected = data != null
        val info = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(9), dp(12), dp(9))
            background = panelBackground(if (connected) Color.rgb(8, 47, 53)
                  else Color.rgb(48, 35, 24))
        }
        label(info, if (connected) "●  ĐÃ ĐỒNG BỘ DỮ LIỆU" else "●  CHƯA KẾT NỐI DỮ LIỆU",
            12f, true, if (connected) Color.rgb(94, 234, 212)
                else Color.rgb(253, 186, 116))
        label(info, if (connected)
            (dataSource.ifBlank { "Nguồn dữ liệu" } + "  •  Revision " +
                data!!.revision + "  •  " + data.invoices.size + " hóa đơn")
            else "Chỉ có thể xem dữ liệu hoặc lên đơn khi nguồn được kết nối.",
            12f, false, if (connected) Color.rgb(153, 246, 228)
                else Color.rgb(254, 215, 170), 5)
        if (connected && lastReadAt.isNotBlank()) {
            label(info, "Cập nhật lúc " + lastReadAt, 11f, false, muted, 5)
        }
        content.addView(info, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(10)
        })

        // One customer-facing storefront, one server-side price/discount engine.
        // This sandbox owner hero delegates all cart, invoice and customer-link
        // workflows to the same UI the customer opens from the shared link.
        if (activeTab == 0) {
            val hero = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(16), dp(14), dp(16), dp(16))
                background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                    intArrayOf(Color.rgb(18, 48, 86), Color.rgb(7, 87, 116))).apply {
                    cornerRadius = dp(18).toFloat()
                }
            }
            label(hero, "BÁN HÀNG VỚI SATORI AI", 20f, true, white)
            label(hero, "Tạo link riêng • Giá và chiết khấu theo khách • Đặt hàng trực tiếp",
                12f, false, Color.rgb(202, 239, 249), 7)
            button(hero, "＋ TẠO LINK CHO KHÁCH", true) {
                startActivity(Intent(this, AiCustomerPortalActivity::class.java).putExtra("mode", "admin"))
            }
            button(hero, "XEM TRẢI NGHIỆM ĐẶT HÀNG") {
                startActivity(Intent(this, AiCustomerPortalActivity::class.java).putExtra("mode", "customer"))
            }
            button(hero, "🔗 MỞ CÙNG LINK KHÁCH TRÊN WEBSITE") {
                val input = EditText(this).apply {
                    hint = "https://minh-satori-customer-ai-gemini.onrender.com/c/..."
                    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
                    setSingleLine(true)
                }
                AlertDialog.Builder(this)
                    .setTitle("Mở giỏ hàng Gemini của khách")
                    .setMessage("Dán link khách do Gemini cấp. App mở cùng phiên trên máy chủ; không lưu link vào điện thoại. Chỉ dùng thử, chưa ghi hóa đơn thật.")
                    .setView(input)
                    .setNegativeButton("Hủy", null)
                    .setPositiveButton("Mở link") { _, _ ->
                        val verified = AiSandboxContract.customerPortalUrl(input.text.toString())
                        if (verified == null) {
                            Toast.makeText(this, "Link không hợp lệ. Chỉ nhận link khách Gemini của Satori.", Toast.LENGTH_LONG).show()
                        } else {
                            startActivity(Intent(this, AiCustomerPortalActivity::class.java)
                                .putExtra("mode", "customer")
                                .putExtra("customer_url", verified))
                        }
                    }
                    .show()
            }
            content.addView(hero, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(14)
            })
            label(content, "SANDBOX: quản lý link yêu cầu mã quản trị riêng. Chỉ dữ liệu DEMO, chưa nhận đơn thật.",
                11f, false, muted, 6)
        }
        button(content, "✦ AI CHAT • ĐẦY ĐỦ CHỨC NĂNG WEBSITE") {
            startActivity(Intent(this, AiCustomerPortalActivity::class.java).putExtra("mode", "customer"))
        }
        if (isLoading) {
            label(content, "Đang đồng bộ dữ liệu…", 12f, true, cyan, 12)
        }
        if (data == null) {
            val welcome = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(18), dp(20), dp(18), dp(17))
                background = panelBackground(Color.rgb(19, 37, 64))
            }
            label(welcome, "Quản lý kinh doanh trong một ứng dụng", 20f, true, white)
            label(welcome, "Hóa đơn • Khách hàng • Công nợ • Bảng giá • PDF",
                12f, false, Color.rgb(186, 230, 253), 11)
            label(welcome, "Bản cài thử này chưa liên kết API. Dữ liệu thật được bảo vệ " +
                "và sẽ không được sửa cho đến khi kết nối được xác minh.",
                12f, false, muted, 12)
            content.addView(welcome, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(13)
            })
            button(content, if (apiEndpoint == null) "KẾT NỐI MINH SATORI" else
                if (accessToken == null) "ĐĂNG NHẬP GOOGLE" else
                "ĐỒNG BỘ MOBILE API", true) {
                when {
                    apiEndpoint == null -> configureMobileApi()
                    accessToken == null -> connectGoogle()
                    else -> refreshFromMobileApi()
                }
            }
            button(content, "XEM GOOGLE DRIVE (CHỈ ĐỌC)") {
                getPreferences(MODE_PRIVATE).edit()
                    .putBoolean("google_drive_auto_read", true).apply()
                if (accessToken == null) connectGoogle() else refreshFromDrive()
            }
            val metrics = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, dp(16), 0, 0)
            }
            metricTile(metrics, "HÓA ĐƠN", "—")
            metricTile(metrics, "CÔNG NỢ", "—")
            content.addView(metrics)
            section(content, "Bắt đầu sử dụng",
                "1  Kết nối API sandbox được cấp phép.\n" +
                "2  Đăng nhập tài khoản Google thử nghiệm.\n" +
                "3  Đồng bộ để xem hóa đơn, khách hàng và công nợ.\n\n" +
                "Nếu chưa có API, chỉ nên chọn Google Drive ở chế độ xem.")
        } else {
            if (activeTab == 0) {
                val stats = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    setPadding(0, dp(14), 0, 0)
                }
                metricTile(stats, "HÓA ĐƠN", data.invoices.size.toString())
                metricTile(stats, "CẦN THU", data.outstandingCount.toString(),
                    Color.rgb(253, 186, 116))
                content.addView(stats)
            }
            if (activeTab == 4 && canWrite) {
                button(content, "+ TẠO ĐƠN HÀNG", true) { launchEditor() }
            }
            when (activeTab) {
                0 -> renderOverview(content, data)
                1 -> renderInvoices(content, data)
                2 -> renderCustomers(content, data)
                3 -> renderDebt(content, data)
                else -> renderNewOrderInfo(content)
            }
            button(content, if (dataSource == "Minh Satori API") "LÀM MỚI DỮ LIỆU"
                    else "CÀI ĐẶT KẾT NỐI") {
                if (dataSource == "Minh Satori API") refreshFromMobileApi()
                else showConnectionSettings()
            }
        }
        if (pendingStorageError) section(content, "CẦN KIỂM TRA DỮ LIỆU ĐANG CHỜ",
            "Không đọc được bản lưu thao tác. Đã khóa ghi để phòng trùng đơn.")
        pendingWrite?.let { pending ->
            section(content, "CÓ THAO TÁC CHƯA XÁC MINH",
                "Ứng dụng tạm khóa ghi mới để đảm bảo an toàn.") {
                if (!pendingStorageError &&
                    pending.belongsTo(apiEndpoint.orEmpty(), actorId) &&
                    hasServerAction(pending.action)) {
                    reviewPendingWrite(pending)
                } else {
                    Toast.makeText(this, "Kết nối lại đúng API và tài khoản đã gửi thao tác.",
                        Toast.LENGTH_LONG).show()
                }
            }
        }

        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.rgb(8, 18, 37))
            setPadding(dp(5), dp(8), dp(5), dp(8))
        }
        listOf("Tổng quan", "Hóa đơn", "Khách", "Công nợ", "Lên đơn").forEachIndexed { i, name ->
            val chip = TextView(this).apply {
                text = name
                textSize = 11f
                gravity = Gravity.CENTER
                maxLines = 2
                setPadding(dp(2), dp(8), dp(2), dp(8))
                setTextColor(if (activeTab == i) white else softInk)
                setTypeface(typeface, if (activeTab == i) Typeface.BOLD else Typeface.NORMAL)
                background = if (activeTab == i)
                    GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                        intArrayOf(Color.rgb(37, 99, 235), Color.rgb(8, 145, 178))).apply {
                        cornerRadius = dp(12).toFloat()
                    }
                    else background(Color.rgb(8, 18, 37), 12)
                isClickable = true
                isFocusable = true
                contentDescription = "Mở mục " + name
                setOnClickListener { activeTab = i; render() }
            }
            tabs.addView(chip, LinearLayout.LayoutParams(0, dp(48), 1f))
        }
        shell.addView(tabs)
        dashboardMode = false
    }

    private fun actionTile(row: LinearLayout, title: String, subtitle: String,
                           accent: Int = cyan, click: () -> Unit) {
        val tile = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(13), dp(14), dp(12), dp(14))
            background = panelBackground()
            isClickable = true
            isFocusable = true
            setOnClickListener { click() }
            contentDescription = title + ". " + subtitle
        }
        label(tile, "◆", 15f, true, accent)
        label(tile, title, 14f, true, white, 9)
        label(tile, subtitle, 11f, false, muted, 6)
        row.addView(tile, LinearLayout.LayoutParams(0, -2, 1f).apply {
            marginEnd = dp(5)
        })
    }

    private fun renderOverview(parent: LinearLayout, data: SatoriSnapshot) {
        label(parent, "QUẢN LÝ NHANH", 12f, true, cyan, 19)
        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(9), 0, 0)
        }
        actionTile(row1, "Hóa đơn", data.invoices.size.toString() + " hóa đơn",
            Color.rgb(96, 165, 250)) {
            activeTab = 1
            render()
        }
        actionTile(row1, "Khách hàng", "Hồ sơ & địa chỉ",
            Color.rgb(94, 234, 212)) {
            activeTab = 2
            render()
        }
        parent.addView(row1)
        val row2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(10), 0, 0)
        }
        actionTile(row2, "Công nợ", "Theo dõi cần thu",
            Color.rgb(253, 186, 116)) {
            activeTab = 3
            render()
        }
        actionTile(row2, "Lên đơn", if (canWrite) "Tạo hóa đơn mới" else "Cần kết nối API",
            Color.rgb(196, 181, 253)) {
            activeTab = 4
            render()
        }
        parent.addView(row2)

        label(parent, "CÔNG CỤ KINH DOANH", 12f, true, cyan, 23)
        val tools1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(10), 0, 0)
        }
        actionTile(tools1, "Bảng giá Satori", data.products.size.toString() + " sản phẩm") {
            showCatalogue(data)
        }
        actionTile(tools1, "Sổ kế toán", "Tra cứu & đối chiếu",
            Color.rgb(196, 181, 253)) {
            showLedger(data)
        }
        parent.addView(tools1)
        val tools2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(10), 0, 0)
        }
        actionTile(tools2, "Trí nhớ AI", data.customerMemory.size.toString() + " hồ sơ",
            Color.rgb(94, 234, 212)) {
            showCustomerMemory(data)
        }
        actionTile(tools2, "Đối chiếu giá", "Kiểm tra trùng đơn",
            Color.rgb(253, 186, 116)) {
            showPriceComparison(data)
        }
        parent.addView(tools2)
        button(parent, "ĐỐI CHIẾU BẢNG KÊ SATORI  •  XLSX / CSV") {
            supplierStatementPicker.launch(arrayOf(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "text/csv", "text/plain", "application/octet-stream"
            ))
        }
        section(parent, "Cần thu từ khách hàng",
            data.outstandingCount.toString() + " hóa đơn  •  " +
            SatoriData.money(data.outstandingAmount) +
            "\nTrạng thái thanh toán Satori không đồng nghĩa khách đã thanh toán.")

        label(parent, "HÓA ĐƠN GẦN ĐÂY", 12f, true, cyan, 21)
        if (data.invoices.isEmpty()) {
            section(parent, "Chưa có hóa đơn", "Đồng bộ lại hoặc tạo hóa đơn trong sandbox.")
        } else {
            data.invoices.take(10).forEach { invoice ->
                section(parent, "#" + invoice.number + "  •  " + invoice.customer,
                    invoice.displayDate + "  •  " + SatoriData.money(invoice.total) +
                        "  •  " + invoice.status) { openInvoice(invoice) }
            }
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

    // Native dark controls stay readable even when opened after render() finishes.
    private fun darkSpinner(values: List<String>): Spinner = Spinner(this).apply {
        adapter = object : ArrayAdapter<String>(
            this@NativeMainActivity, android.R.layout.simple_spinner_item, values) {
            private fun style(item: View): View = item.apply {
                if (this is TextView) {
                    setTextColor(white)
                    setBackgroundColor(Color.rgb(19, 37, 64))
                    setPadding(dp(12), dp(8), dp(12), dp(8))
                    textSize = 13f
                }
            }
            override fun getView(position: Int, convertView: View?,
                parent: android.view.ViewGroup): View =
                style(super.getView(position, convertView, parent))
            override fun getDropDownView(position: Int, convertView: View?,
                parent: android.view.ViewGroup): View =
                style(super.getDropDownView(position, convertView, parent))
        }
        background = panelBackground(Color.rgb(19, 37, 64), 10)
    }

    // Match the website's read-only search, customer, date-range, month/year and
    // sort behavior. Source records and payment status are never mutated here.
    private fun showLedger(data: SatoriSnapshot) {
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(18))
            setBackgroundColor(night)
        }
        val scroll = ScrollView(this).apply {
            setBackgroundColor(night)
            addView(content)
        }
        label(content, "SỔ KẾ TOÁN  •  REVISION " + data.revision, 17f, true, white)
        label(content, "Bộ lọc theo website • Chỉ đọc. Đã TT Satori không có nghĩa khách đã trả.",
            11.5f, false, softInk, 6)

        fun edit(hintText: String): EditText = EditText(this).apply {
            hint = hintText
            setSingleLine(true)
            textSize = 13f
            setTextColor(white)
            setHintTextColor(softInk)
            background = panelBackground(Color.rgb(19, 37, 64), 10)
            setPadding(dp(12), 0, dp(12), 0)
        }
        fun fieldTitle(title: String) {
            label(content, title, 11.5f, true, cyan, 12)
        }
        fun addField(view: View, height: Int = 44) {
            content.addView(view, LinearLayout.LayoutParams(-1, dp(height)))
        }
        fieldTitle("TÌM HÓA ĐƠN / KHÁCH / SĐT / ĐỊA CHỈ / SẢN PHẨM")
        val search = edit("Ví dụ: #5914, Traky, Satori 500ml")
        addField(search)
        fieldTitle("CHỌN KHÁCH HÀNG")
        val customers = listOf("Tất cả khách") + data.invoices.map { it.customer.trim() }
            .filter { it.isNotEmpty() }.distinct().sortedWith(String.CASE_INSENSITIVE_ORDER)
        val selectedCustomer = darkSpinner(customers)
        addField(selectedCustomer)
        fieldTitle("TÌM THÊM THEO TÊN KHÁCH HOẶC SỐ ĐIỆN THOẠI")
        val customerText = edit("Tên khách / số điện thoại")
        addField(customerText)
        fieldTitle("TRẠNG THÁI")
        val statuses = listOf("Tất cả", "Chưa thanh toán", "Đã thanh toán",
            "Đã TT Satori", "Không Tính", "Đã hủy")
        val status = darkSpinner(statuses)
        addField(status)

        fieldTitle("LỌC THEO THÁNG / NĂM")
        val months = listOf("Tất cả tháng") + (1..12).map {
            "Tháng " + it.toString().padStart(2, '0')
        }
        val years = listOf("Tất cả năm") + data.invoices.filter { it.hasValidDate }
            .map { it.sortDate.substring(0, 4) }.distinct().sortedDescending()
        val month = darkSpinner(months)
        val year = darkSpinner(years)
        val calendarRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        calendarRow.addView(month, LinearLayout.LayoutParams(0, dp(45), 1f))
        calendarRow.addView(year, LinearLayout.LayoutParams(0, dp(45), 1f).apply {
            marginStart = dp(7)
        })
        content.addView(calendarRow)

        fieldTitle("KHOẢNG NGÀY: TỪ NGÀY → ĐẾN NGÀY")
        var fromIso = ""
        var toIso = ""
        lateinit var refresh: () -> Unit
        fun dateButton(): TextView = TextView(this).apply {
            setTextColor(white)
            textSize = 12f
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), 0, dp(8), 0)
            background = panelBackground(Color.rgb(19, 37, 64), 10)
        }
        val fromDate = dateButton()
        val toDate = dateButton()
        fun updateDateText() {
            fromDate.text = "Từ: " + fromIso.ifBlank { "Chọn" }
            toDate.text = "Đến: " + toIso.ifBlank { "Chọn" }
        }
        fun pick(initial: String, setValue: (String) -> Unit) {
            val current = runCatching { java.time.LocalDate.parse(initial) }
                .getOrDefault(java.time.LocalDate.now())
            android.app.DatePickerDialog(this, { _, yy, mm, dd ->
                setValue(java.time.LocalDate.of(yy, mm + 1, dd).toString())
                updateDateText()
                refresh()
            }, current.year, current.monthValue - 1, current.dayOfMonth).show()
        }
        fromDate.setOnClickListener { pick(fromIso) { fromIso = it } }
        toDate.setOnClickListener { pick(toIso) { toIso = it } }
        val range = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        range.addView(fromDate, LinearLayout.LayoutParams(0, dp(45), 1f))
        range.addView(toDate, LinearLayout.LayoutParams(0, dp(45), 1f).apply {
            marginStart = dp(7)
        })
        content.addView(range)
        updateDateText()

        val quick = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fun addPreset(title: String, onTap: () -> Unit) {
            val chip = TextView(this).apply {
                text = title
                gravity = Gravity.CENTER
                textSize = 11f
                setTextColor(cyan)
                background = panelBackground(Color.rgb(19, 37, 64), 10)
                isClickable = true
                setOnClickListener { onTap() }
            }
            quick.addView(chip, LinearLayout.LayoutParams(0, dp(41), 1f).apply {
                marginStart = dp(4)
            })
        }
        fun setDates(from: java.time.LocalDate, to: java.time.LocalDate) {
            fromIso = from.toString()
            toIso = to.toString()
            month.setSelection(0)
            year.setSelection(0)
            updateDateText()
            refresh()
        }
        val today = java.time.LocalDate.now()
        addPreset("Hôm nay") { setDates(today, today) }
        addPreset("7 ngày") { setDates(today.minusDays(6), today) }
        addPreset("Tháng này") { setDates(today.withDayOfMonth(1), today) }
        addPreset("Tháng trước") {
            val previous = today.withDayOfMonth(1).minusDays(1)
            setDates(previous.withDayOfMonth(1), previous)
        }
        content.addView(quick, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(7) })

        fieldTitle("SẮP XẾP HÓA ĐƠN")
        val sortNames = listOf("Ngày mới nhất", "Ngày cũ nhất", "Doanh thu cao nhất",
            "Doanh thu thấp nhất", "Số HĐ giảm dần", "Số HĐ tăng dần")
        val sortIds = listOf("date_desc", "date_asc", "revenue_desc",
            "revenue_asc", "invoice_desc", "invoice_asc")
        val sort = darkSpinner(sortNames)
        addField(sort)

        val totalsView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(11), dp(12), dp(11))
            background = panelBackground(Color.rgb(9, 38, 57))
        }
        content.addView(totalsView, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(12)
        })
        // Keep the reset control above the (potentially long) results list.
        val rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(rows)

        refresh = {
            val invalidRange = fromIso.isNotBlank() && toIso.isNotBlank() && fromIso > toIso
            val customerChoice = customers.getOrNull(selectedCustomer.selectedItemPosition)
                .orEmpty()
            val filtered = if (invalidRange) emptyList() else SatoriLedger.queryAdvanced(
                data.invoices, SatoriLedgerFilter(
                    search = search.text.toString(),
                    status = statuses[status.selectedItemPosition.coerceIn(0, statuses.lastIndex)],
                    customer = customerText.text.toString(),
                    fromIso = fromIso,
                    toIso = toIso,
                    month = month.selectedItemPosition.takeIf { it > 0 },
                    year = years.getOrNull(year.selectedItemPosition)
                        ?.takeUnless { it == "Tất cả năm" }?.toIntOrNull(),
                    sort = sortIds[sort.selectedItemPosition.coerceIn(0, sortIds.lastIndex)]
                )
            ).filter { customerChoice == "Tất cả khách" ||
                it.customer.equals(customerChoice, ignoreCase = true) }
            val t = SatoriLedger.totals(filtered)
            totalsView.removeAllViews()
            rows.removeAllViews()
            if (invalidRange) label(totalsView, "⚠ Ngày bắt đầu sau ngày kết thúc.",
                12f, true, Color.rgb(253, 186, 116))
            label(totalsView, "PHẠM VI LỌC: " + t.recordCount + " hóa đơn",
                12f, true, cyan)
            label(totalsView, "Doanh thu: " + SatoriData.money(t.revenue),
                16f, true, white, 5)
            label(totalsView, "Đã thu: " + SatoriData.money(t.customerPaid) +
                "   •   Cần thu: " + SatoriData.money(t.customerUnpaid),
                12f, true, Color.rgb(153, 246, 228), 5)
            label(totalsView, "Tính doanh thu: " + t.countedCount +
                "   •   Loại trừ: " + t.excludedCount, 11f, false, softInk, 5)
            if (t.invalidDateCount > 0) label(totalsView,
                "⚠ " + t.invalidDateCount + " ngày hóa đơn cần kiểm tra",
                11f, false, Color.rgb(253, 186, 116), 5)
            label(rows, "DANH SÁCH HÓA ĐƠN (" + filtered.size + ")", 13f, true, cyan, 12)
            filtered.take(150).forEach { inv ->
                section(rows, "HÓA ĐƠN #" + inv.number + "  •  " +
                    SatoriData.money(inv.total),
                    inv.displayDate + "  •  " + inv.status + "\n" +
                    inv.customer + "  •  " + inv.phone + "\n" +
                    inv.address + "\n" +
                    inv.lines.joinToString(", ") { it.description + " x" + it.quantity }) {
                    openInvoice(inv)
                }
            }
            if (filtered.size > 150) label(rows,
                "Đang hiển thị 150 hóa đơn đầu. Hãy thu hẹp bộ lọc.",
                11f, false, softInk, 8)
            if (filtered.isEmpty()) label(rows, "Không có hóa đơn phù hợp.",
                12f, false, softInk, 8)
        }
        val selection = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: android.widget.AdapterView<*>?,
                v: View?, pos: Int, id: Long) { refresh() }
            override fun onNothingSelected(p: android.widget.AdapterView<*>?) {}
        }
        listOf(selectedCustomer, status, month, year, sort).forEach {
            it.onItemSelectedListener = selection
        }
        listOf(search, customerText).forEach { input ->
            input.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int,
                    count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int,
                    before: Int, count: Int) { refresh() }
                override fun afterTextChanged(s: Editable?) {}
            })
        }
        button(content, "↻ XÓA TẤT CẢ BỘ LỌC") {
            fromIso = ""
            toIso = ""
            updateDateText()
            search.setText("")
            customerText.setText("")
            listOf(selectedCustomer, status, month, year, sort).forEach { it.setSelection(0) }
            refresh()
        }
        content.removeView(rows)
        content.addView(rows)
        refresh()
        val dialog = AlertDialog.Builder(this)
            .setView(scroll).setPositiveButton("Đóng", null).create()
        dialog.show()
        dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(night))
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(cyan)
        dialog.window?.setLayout(
            (resources.displayMetrics.widthPixels * .96f).toInt(),
            (resources.displayMetrics.heightPixels * .87f).toInt())
    }

    private fun renderInvoices(parent: LinearLayout, data: SatoriSnapshot) {
        button(parent, "▤ SỔ KẾ TOÁN · LỌC TRẠNG THÁI") { showLedger(data) }
        if (canWrite) button(parent, "+ TẠO HÓA ĐƠN", true) { launchEditor() }
        if (canAction("mobile.trash") && canAction("orders.restore")) {
            button(parent, "THÙNG RÁC 30 NGÀY") { showTrash() }
        }
        label(parent, "Tìm số hóa đơn, khách hàng, số điện thoại hoặc địa chỉ", 12f,
            false, muted, 14)
        val input = EditText(this).apply {
            hint = "Tìm hóa đơn…"
            textSize = 14f
            setSingleLine(true)
            setTextColor(white)
            setHintTextColor(softInk)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = panelBackground(Color.rgb(19, 37, 64), 11)
            setText(searchText)
        }
        parent.addView(input, LinearLayout.LayoutParams(-1, dp(48)).apply {
            topMargin = dp(6)
        })
        val statuses = listOf("Tất cả", "Chưa thanh toán", "Đã thanh toán",
            "Đã TT Satori", "Không Tính", "Đã hủy")
        val filter = darkSpinner(statuses)
        parent.addView(filter, LinearLayout.LayoutParams(-1, dp(42)).apply {
            topMargin = dp(5)
        })
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        parent.addView(list)
        fun updateList() {
            list.removeAllViews()
            val status = statuses[filter.selectedItemPosition.coerceIn(0, statuses.lastIndex)]
            val matching = data.invoices.filter {
                SatoriData.search(it, searchText) &&
                    (status == "Tất cả" || it.status.equals(status, ignoreCase = true))
            }
            label(list, "Tìm thấy " + matching.size + " hóa đơn" +
                (if (status != "Tất cả") " • " + status else ""),
                11.5f, true, cyan, 7)
            matching.take(120).forEach { inv ->
                section(list, "HÓA ĐƠN #" + inv.number + "   •   " +
                    SatoriData.money(inv.total),
                    inv.customer + "  •  " + inv.displayDate + "\n" +
                    inv.status + "  •  " + inv.phone + "\n" +
                    inv.address + "\n" +
                    inv.lines.joinToString(", ") { it.description + " x" + it.quantity } +
                    (if (inv.deliveryNote.isNotBlank()) "\nCó ghi chú giao hàng" else "")) {
                    openInvoice(inv)
                }
            }
        }
        filter.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: android.widget.AdapterView<*>?,
                view: View?, position: Int, id: Long) { updateList() }
            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) { updateList() }
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
        button(parent, "▤ BỘ LỌC SỔ KẾ TOÁN") { showLedger(data) }
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
        if (!canAction("mobile.trash") || !canAction("orders.restore") ||
            endpoint == null || token == null) {
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
        val wrapper = ScrollView(this).apply { setBackgroundColor(night) }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(17), dp(16), dp(17), dp(18))
            setBackgroundColor(night)
        }
        wrapper.addView(content)
        val heading = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(13), dp(14), dp(13))
            background = panelBackground(Color.rgb(19, 37, 64))
        }
        label(heading, "HÓA ĐƠN #" + invoice.number, 21f, true, white)
        label(heading, invoice.displayDate + "  •  " + invoice.status, 12f, true, cyan, 7)
        label(heading, SatoriData.money(invoice.total), 20f, true,
            Color.rgb(153, 246, 228), 8)
        content.addView(heading)
        if (invoice.isTest) label(content,
            "DỮ LIỆU TEST • KHÔNG TÍNH DOANH THU/CÔNG NỢ",
            12f, true, Color.rgb(253, 186, 116), 9)

        label(content, "THÔNG TIN KHÁCH HÀNG", 12f, true, cyan, 15)
        label(content, invoice.customer, 17f, true, white, 7)
        label(content, "Điện thoại: " + invoice.phone.ifBlank { "(Chưa có SĐT)" },
            13f, false, softInk, 8)
        label(content, "Giao tới: " + invoice.address.ifBlank { "(Chưa có địa chỉ)" },
            13f, false, softInk, 6)
        if (invoice.duplicateFrom.isNotBlank()) label(content,
            "Bản giá sao từ #" + invoice.duplicateFrom +
                " — kiểm tra trạng thái trước khi tính doanh thu.",
            12f, true, Color.rgb(253, 186, 116), 8)

        label(content, "SẢN PHẨM (" + invoice.lines.size + " dòng)",
            13f, true, cyan, 16)
        invoice.lines.forEach { line ->
            val product = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), dp(10), dp(12), dp(10))
                background = panelBackground()
            }
            label(product, line.description, 13.5f, true, white)
            label(product, "x" + line.quantity + " " + line.unit + "  ×  " +
                SatoriData.money(line.unitPrice), 12f, false, softInk, 5)
            label(product, "THÀNH TIỀN: " + SatoriData.money(line.amount),
                13f, true, cyan, 5)
            content.addView(product, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(7)
            })
        }
        label(content, "Phí giao: " + SatoriData.money(invoice.shipping),
            12f, false, softInk, 13)
        label(content, "Thuế VAT: " + SatoriData.money(invoice.vat),
            12f, false, softInk, 5)
        label(content, "TỔNG THANH TOÁN: " + SatoriData.money(invoice.total),
            18f, true, Color.rgb(153, 246, 228), 11)
        if (invoice.deliveryNote.isNotBlank()) {
            label(content, "GHI CHÚ / YÊU CẦU GIAO HÀNG", 13f, true, cyan, 13)
            label(content, invoice.deliveryNote, 13f, false, white, 5)
        }
        // The first invoice action must show the actual A4 PDF in this app.
        // Never implicitly download when the user only chooses View.
        button(content, "👁 XEM HÓA ĐƠN PDF", true) {
            NativeInvoicePdf.preview(this, invoice)
        }
        var invoiceDialog: AlertDialog? = null
        // Legacy/partially restored rows may have a missing/non-numeric number.
        // Continue read-only display, but never crash on toInt() or send a write.
        val validInvoiceNumber = invoice.number.toIntOrNull()?.takeIf { it > 0 }
        if (validInvoiceNumber == null) {
            label(content, "⚠ Số hóa đơn cần kiểm tra. Đã khóa sửa, xóa và ghi thanh toán.",
                12f, true, gold, 10)
        }
        if (validInvoiceNumber != null &&
            (invoice.canEditOrDelete || invoice.canMarkCustomerPaid)) {
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
                            .put("id", invoice.id)
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
            dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(night))
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(cyan)
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setTextColor(cyan)
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
                actorId = ""
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
            val pending = pendingWrite
            val trash = if (outcome.isSuccess && pending != null &&
                pending.belongsTo(endpoint, outcome.getOrThrow().actorId) &&
                pending.action == "orders.delete" &&
                outcome.getOrThrow().allowedActions.contains("mobile.trash"))
                runCatching { MobileApiClient.trash(endpoint, token) }.getOrNull() else null
            runOnUiThread {
                isLoading = false
                outcome.fold(
                    onSuccess = {
                        snapshot = it.snapshot
                        allowedActions = it.allowedActions
                        actorId = it.actorId
                        dataSource = "Minh Satori API"
                        lastReadAt = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
                        lastOnlineReadElapsedMs = SystemClock.elapsedRealtime()
                        statusMessage = "Đã kết nối quyền lên đơn."
                        if (pending != null && pending.belongsTo(endpoint, it.actorId)) {
                            if (pending.confirmedIn(it.snapshot, trash)) finishPendingWrite(pending)
                            else statusMessage = "Đã đồng bộ; còn thao tác đang chờ cần kiểm tra hoặc gửi lại đúng yêu cầu cũ."
                        }
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

    private fun finishPendingWrite(pending: PendingMobileWrite): Boolean {
        return runCatching { pendingStore.clear(pending) }.fold(
            onSuccess = { if (pendingWrite == pending) pendingWrite = null; true },
            onFailure = {
                pendingStorageError = true
                statusMessage = "Đã nhận kết quả nhưng chưa cập nhật được bản chờ. Ghi mới vẫn khóa để tránh trùng."
                false
            }
        )
    }

    private fun reviewPendingWrite(pending: PendingMobileWrite) {
        if (isLoading || !pending.belongsTo(apiEndpoint.orEmpty(), actorId) ||
            !hasServerAction(pending.action) || pendingStorageError) return
        val p = pending.payload
        val order = p.optJSONObject("order")
        val description = if (order != null)
            order.optString("name") + " · " + SatoriData.money(order.optLong("total"))
        else "Hóa đơn #" + p.optString("invoiceNo")
        AlertDialog.Builder(this)
            .setTitle("Tiếp tục thao tác đang chờ")
            .setMessage(description + "\n\nApp sẽ gửi lại nguyên yêu cầu cũ, giữ mã chống trùng và revision. " +
                "Nếu dữ liệu đã thay đổi, server sẽ yêu cầu kiểm tra lại. " +
                "Anh nên đồng bộ trước để kiểm tra thao tác đã hoàn tất chưa.")
            .setNegativeButton("Đồng bộ kiểm tra") { _, _ -> refreshFromMobileApi() }
            .setNeutralButton("Đóng", null)
            .setPositiveButton("GỬI LẠI YÊU CẦU CŨ") { _, _ ->
                executeWrite(pending.action, p) { _, _ -> }
            }.show()
    }

    private fun executeWrite(
        action: String,
        payload: JSONObject,
        completed: (Boolean, String) -> Unit
    ) {
        val endpoint = apiEndpoint
        val token = accessToken
        val prior = pendingWrite
        val contents = JSONObject(payload.toString())
        if (!contents.has("requestId")) contents.put("requestId",
            UUID.randomUUID().toString().replace("-", ""))
        if (SatoriOrderValidation.requiresTestLedger(action, contents)) {
            completed(false, "Đơn TEST phải chuyển sang môi trường thử, không được lưu vào sổ hóa đơn thật.")
            return
        }
        val exactRetry = prior?.matches(endpoint.orEmpty(), actorId, action, contents) == true
        if (!hasServerAction(action) || endpoint == null || token == null || isLoading ||
            pendingStorageError || (prior != null && !exactRetry)) {
            completed(false, "Cần đúng tài khoản, quyền và kết quả thao tác đang chờ trước khi ghi mới.")
            return
        }
        val pending = prior ?: PendingMobileWrite(endpoint, actorId, action,
            contents.toString(), System.currentTimeMillis())
        pendingWrite = pending
        isLoading = true
        statusMessage = "Đang lưu an toàn và gửi thao tác Minh Satori…"
        render()
        Thread {
            // Flush encrypted journal BEFORE sending any request. A failed disk/key
            // operation must never fall back to sending without process-death recovery.
            val stored = runCatching { pendingStore.save(pending) }
            if (stored.isFailure) {
                runOnUiThread {
                    isLoading = false
                    pendingStorageError = true
                    statusMessage = "Không lưu được bản chờ an toàn. Chưa gửi yêu cầu lên server."
                    completed(false, statusMessage)
                    render()
                }
                return@Thread
            }
            val result = runCatching {
                MobileApiClient.request(endpoint, token, action, pending.payload,
                    UUID.randomUUID().toString().replace("-", ""))
            }
            val uncertain = result.exceptionOrNull()?.let {
                MobileWriteOutcome.requiresReconciliation(it)
            } ?: false
            val latest = if (result.isSuccess || uncertain)
                runCatching { MobileApiClient.snapshot(endpoint, token) }.getOrNull() else null
            val trash = if (uncertain && action == "orders.delete" && latest != null &&
                latest.allowedActions.contains("mobile.trash"))
                runCatching { MobileApiClient.trash(endpoint, token) }.getOrNull() else null
            val proved = latest != null && pending.belongsTo(endpoint, latest.actorId) &&
                pending.confirmedIn(latest.snapshot, trash)
            runOnUiThread {
                isLoading = false
                if (latest != null && pending.belongsTo(endpoint, latest.actorId)) {
                    snapshot = latest.snapshot
                    allowedActions = latest.allowedActions
                    actorId = latest.actorId
                    dataSource = "Minh Satori API"
                    lastReadAt = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
                    lastOnlineReadElapsedMs = SystemClock.elapsedRealtime()
                }
                val alreadyPaid = result.getOrNull()?.optJSONObject("data")
                    ?.optBoolean("alreadyPaid", false) == true
                if ((result.isSuccess &&
                        MobileWriteOutcome.acceptsServerSuccess(action, alreadyPaid, proved)) || proved) {
                    finishPendingWrite(pending)
                    if (latest == null) {
                        snapshot = null
                        allowedActions = emptySet()
                        dataSource = ""
                    }
                    val message = if (proved && result.isFailure)
                        "Đã xác minh thao tác được lưu trước khi mất kết nối. Không ghi thêm lần nữa."
                    else "Server xác nhận thành công."
                    if (!pendingStorageError) statusMessage = message
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show()
                    completed(true, message)
                } else if (result.isFailure && MobileWriteOutcome.mayDiscardAfterRejection(
                        result.exceptionOrNull()!!, prior != null)) {
                    finishPendingWrite(pending)
                    statusMessage = "Server từ chối yêu cầu: " +
                        (result.exceptionOrNull()?.message ?: "Cần kiểm tra dữ liệu.")
                    // Never reuse a stale snapshot after any rejected operation.
                    snapshot = null
                    allowedActions = emptySet()
                    dataSource = ""
                    completed(false, statusMessage)
                } else {
                    statusMessage = if (result.isSuccess && alreadyPaid)
                        "Hóa đơn đã thanh toán nhưng chưa xác minh được chính yêu cầu của máy này. " +
                            "Giữ bản chờ an toàn, không ghi tiền thêm. Cần đối chiếu giao dịch."
                    else "Chưa xác minh được kết quả trước đó. Đã giữ bản chờ mã hóa, " +
                        "khóa ghi mới và giữ nguyên mã chống trùng kể cả khi đóng app."
                    val error = result.exceptionOrNull()
                    if (error is MobileApiError && error.apiCode in setOf("AUTH_FAILED", "FORBIDDEN")) {
                        accessToken = null
                        actorId = ""
                        allowedActions = emptySet()
                        dataSource = ""
                        statusMessage += " Cần đăng nhập Google lại để tiếp tục đối chiếu."
                    }
                    completed(false, statusMessage)
                }
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
        // Direct Drive reads always require drive.readonly, even when a
        // sandbox API endpoint is still stored. API-only mode needs email only.
        val scopes = mutableListOf(Scope("https://www.googleapis.com/auth/userinfo.email"))
        if (apiEndpoint == null || preferGoogleDrive()) {
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
            actorId = ""
            allowedActions = emptySet()
            dataSource = ""
            if (preferGoogleDrive() || apiEndpoint == null) {
                if (!result.grantedScopes.contains("https://www.googleapis.com/auth/drive.readonly")) {
                    statusMessage = "Chưa cấp quyền Google Drive chỉ đọc. Không sử dụng 3 hóa đơn thử làm dữ liệu thật."
                    render()
                    return
                }
            }
            accessToken = token
            if (preferGoogleDrive() || apiEndpoint == null) refreshFromDrive()
            else refreshFromMobileApi()
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
                        statusMessage = "Đã đồng bộ Google Drive (chỉ xem)."
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
