package vn.minhsatori.app

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.ConnectivityManager
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat

/**
 * Android owner portal launcher. Opens the website in the same regular Chrome
 * browser session already used by the owner (instead of an embedded WebView).
 *
 * Never load index.html from file:///android_asset: doing so creates an isolated
 * localStorage database and can mislead users about invoice synchronization.
 * No production HMAC secret or customer record is embedded in this APK.
 */
class MainActivity : AppCompatActivity() {
    private val sections = listOf("Tổng quan", "Hóa đơn", "Khách hàng", "Công nợ", "Trợ lý AI")
    private var currentSection = 0
    private val teal = Color.rgb(17, 106, 115)
    private val ink = Color.rgb(23, 43, 53)
    private val muted = Color.rgb(93, 110, 118)
    private val page = Color.rgb(244, 247, 247)
    private val storage by lazy { getSharedPreferences("satori_android", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        renderHome()
    }

    private fun dp(value: Int): Int = (resources.displayMetrics.density * value + 0.5f).toInt()

    private fun background(color: Int, radius: Int = 16): GradientDrawable =
        GradientDrawable().apply { setColor(color); cornerRadius = dp(radius).toFloat() }

    private fun block(
        parent: LinearLayout,
        text: String,
        textSize: Float,
        bold: Boolean = false,
        color: Int = ink,
        top: Int = 0
    ): TextView {
        val view = TextView(this).apply {
            this.text = text
            setTextColor(color)
            this.textSize = textSize
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(top), 0, 0)
        }
        parent.addView(view)
        return view
    }

    private fun action(
        parent: LinearLayout,
        label: String,
        description: String,
        prominent: Boolean = false,
        onClick: () -> Unit
    ) {
        val item = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(15), dp(18), dp(16))
            background = background(if (prominent) teal else Color.WHITE)
            isClickable = true
            isFocusable = true
            setOnClickListener { onClick() }
            contentDescription = label + ". " + description
        }
        val heading = block(item, label, 17f, true, if (prominent) Color.WHITE else ink)
        heading.gravity = Gravity.CENTER_VERTICAL
        block(item, description, 13f, false,
            if (prominent) Color.rgb(224, 246, 246) else muted, 4)
        val layout = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(12) }
        parent.addView(item, layout)
    }


    /**
     * Native tab navigation. All invoice and customer operations still run in
     * the existing Chrome-authenticated owner portal; native pages contain no
     * simulated financial data and no HMAC keys.
     */
    private fun renderHome() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(page)
        }
        setContentView(root)

        val scroll = ScrollView(this).apply { isFillViewport = true }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(28))
        }
        scroll.addView(column)
        root.addView(scroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        block(column, "MINH SATORI", 13f, true, teal)
        block(column, sections[currentSection], 30f, true, ink, 12)
        block(column, "Ứng dụng Samsung · quản lý bằng dữ liệu Google Drive", 14f,
            false, muted, 10)

        if (!hasNetwork()) {
            block(column, "Đang ngoại tuyến. Không thể xác minh số liệu mới nhất. Kết nối Internet trước khi quản lý hóa đơn.",
                14f, true, Color.rgb(156, 73, 35), 16)
        }

        when (currentSection) {
            0 -> {
                infoPanel(column, "Dữ liệu thống nhất",
                    "Website Minh Satori và Google Drive vẫn là nơi lưu hóa đơn gốc. Ứng dụng Android không tạo thêm một bộ dữ liệu riêng.")
                action(column, "MỞ HỆ THỐNG MINH SATORI  ↗",
                    "Mở website đã đăng nhập bằng Chrome thông thường",
                    prominent = true) { openPortal() }
                action(column, "TRA CỨU HÓA ĐƠN", "Đi tới mục Hóa đơn") { goTo(1) }
                action(column, "KIỂM TRA CÔNG NỢ", "Đi tới mục Công nợ") { goTo(3) }
            }
            1 -> {
                infoPanel(column, "Hóa đơn trực tuyến",
                    "Tạo, tìm, kiểm tra, xuất PDF và chia sẻ bằng website đã đồng bộ. Màn hình Android chưa có quyền ghi API trực tiếp.")
                action(column, "MỞ DANH SÁCH HÓA ĐƠN  ↗",
                    "Dùng Chrome với tài khoản Google đang đăng nhập",
                    prominent = true) { openPortal() }
                infoPanel(column, "Xuất PDF / Zalo / Messenger",
                    "Sử dụng chức năng có sẵn trong website để xuất PDF và chia sẻ qua bảng chia sẻ Android.")
            }
            2 -> {
                infoPanel(column, "Khách hàng",
                    "Tìm theo tên, địa chỉ giao hàng và số điện thoại. Khi trùng tên, phải chọn đúng điểm giao trước khi tạo đơn.")
                action(column, "MỞ DANH SÁCH KHÁCH HÀNG  ↗",
                    "Mở dữ liệu khách trực tuyến",
                    prominent = true) { openPortal() }
            }
            3 -> {
                infoPanel(column, "Công nợ",
                    "Kiểm tra các hóa đơn chưa thanh toán trên website. App không hiển thị số nợ giả hoặc thông tin cũ khi chưa truy vấn được máy chủ.")
                action(column, "MỞ BẢNG CÔNG NỢ  ↗",
                    "Xem công nợ thực tế trong hệ thống",
                    prominent = true) { openPortal() }
                infoPanel(column, "Ghi nhận thanh toán",
                    "Chỉ xác nhận đúng hóa đơn qua luồng quản trị hiện có. Không tự động đánh dấu đã thanh toán trong bản thử nghiệm.")
            }
            else -> {
                infoPanel(column, "Trợ lý Minh Satori",
                    "ChatGPT có thể tìm khách, hóa đơn và công nợ khi plugin được kết nối. Ứng dụng điện thoại không chứa khóa bảo mật của Bot.")
                action(column, "MỞ CHATGPT  ↗",
                    "Ví dụ: Kiểm tra công nợ Hà Minh Nguyệt",
                    prominent = true) { launchHttps("https://chatgpt.com/") }
                infoPanel(column, "Quyền tạo và xóa hóa đơn",
                    "Chỉ kích hoạt sau khi xác thực tài khoản Android qua máy chủ trung gian và kiểm tra dữ liệu an toàn.")
            }
        }

        action(column, "CÀI ĐẶT LIÊN KẾT  ⚙",
            "Thay URL Drive Sync nếu hệ thống được chủ sở hữu cập nhật") {
            editPortalUrl()
        }
        block(column, "Minh Satori Android · thử nghiệm 0.2.0", 12f, false, muted, 20)

        val horizontal = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            setBackgroundColor(Color.WHITE)
        }
        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(10), dp(8), dp(10), dp(9))
        }
        sections.forEachIndexed { index, name ->
            val selected = index == currentSection
            val tab = TextView(this).apply {
                text = name
                textSize = 13f
                gravity = Gravity.CENTER
                setTextColor(if (selected) teal else muted)
                if (selected) setTypeface(typeface, Typeface.BOLD)
                setPadding(dp(14), dp(11), dp(14), dp(11))
                background = background(if (selected) Color.rgb(226, 242, 242) else Color.WHITE, 13)
                isClickable = true
                isFocusable = true
                contentDescription = "Mở mục " + name
                setOnClickListener { goTo(index) }
            }
            tabs.addView(tab)
        }
        horizontal.addView(tabs)
        root.addView(horizontal)
    }

    private fun infoPanel(parent: LinearLayout, heading: String, description: String) {
        val item = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
            background = background(Color.WHITE)
        }
        block(item, heading, 17f, true, ink)
        block(item, description, 14f, false, muted, 7)
        parent.addView(item, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(16)
        })
    }

    private fun goTo(index: Int) {
        currentSection = index
        renderHome()
    }

    private fun hasNetwork(): Boolean {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        @Suppress("DEPRECATION")
        return manager.activeNetworkInfo?.isConnected == true
    }

    private fun activePortalUrl(): String {
        val stored = storage.getString("owner_portal_url", null)
        return PortalUrlValidator.normalize(stored.orEmpty())
            ?: BuildConfig.SATORI_WEB_APP_URL
    }

    private fun openPortal() {
        val url = activePortalUrl()
        if (PortalUrlValidator.normalize(url) == null) {
            Toast.makeText(this, "Địa chỉ Apps Script chưa hợp lệ", Toast.LENGTH_LONG).show()
            return
        }
        if (!hasNetwork()) {
            Toast.makeText(this, "Cần Internet để đồng bộ hóa đơn", Toast.LENGTH_LONG).show()
            return
        }
        launchOwnerPortalInChrome(url)
    }

    /**
     * Open in the actual regular Chrome browser, preserving the owner's
     * successful Google login + authuser account routing. Custom Tabs can
     * behave differently from a regular tab for some Apps Script deployments.
     */
    private fun launchOwnerPortalInChrome(url: String) {
        val uri = android.net.Uri.parse(url)
        val chrome = Intent(Intent.ACTION_VIEW, uri).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
            setPackage("com.android.chrome")
        }
        try {
            startActivity(chrome)
        } catch (_: ActivityNotFoundException) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, uri).apply {
                    addCategory(Intent.CATEGORY_BROWSABLE)
                })
            } catch (_: ActivityNotFoundException) {
                Toast.makeText(this, "Không tìm thấy trình duyệt để mở Minh Satori", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun launchHttps(url: String) {
        try {
            val colors = CustomTabColorSchemeParams.Builder()
                .setToolbarColor(teal)
                .setNavigationBarColor(page)
                .build()
            val intent = CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(colors)
                .setShowTitle(true)
                .setShareState(CustomTabsIntent.SHARE_STATE_ON)
                .build()
            intent.launchUrl(this, android.net.Uri.parse(url))
        } catch (_: ActivityNotFoundException) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)))
            } catch (_: ActivityNotFoundException) {
                Toast.makeText(this, "Vui lòng cài Chrome để đăng nhập Google", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun editPortalUrl() {
        val field = EditText(this).apply {
            setSingleLine(false)
            setText(activePortalUrl())
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        val wrapper = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(12), dp(20), 0)
            addView(field)
        }
        AlertDialog.Builder(this)
            .setTitle("Liên kết Google Apps Script")
            .setMessage("Dán URL website Drive Sync đang mở thành công bằng Chrome, bao gồm ?authuser=0&pli=1 nếu có. KHÔNG dùng URL Bot API.")
            .setView(wrapper)
            .setNegativeButton("Hủy", null)
            .setNeutralButton("Mặc định") { _, _ ->
                storage.edit().remove("owner_portal_url").apply()
                Toast.makeText(this, "Đã dùng lại địa chỉ mặc định", Toast.LENGTH_SHORT).show()
            }
            .setPositiveButton("Lưu") { _, _ ->
                val value = PortalUrlValidator.normalize(field.text.toString())
                if (value == null) {
                    Toast.makeText(this, "Chỉ nhận link Drive Sync /exec với authuser và pli (nếu có)", Toast.LENGTH_LONG).show()
                } else {
                    storage.edit().putString("owner_portal_url", value).apply()
                    Toast.makeText(this, "Đã lưu địa chỉ trên điện thoại này", Toast.LENGTH_SHORT).show()
                }
            }
            .show()
    }
}
