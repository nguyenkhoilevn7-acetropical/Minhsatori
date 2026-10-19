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
 * Android owner portal launcher. Chrome Custom Tabs share the user's Google login.
 *
 * Never load index.html from file:///android_asset: doing so creates an isolated
 * localStorage database and can mislead users about invoice synchronization.
 * No production HMAC secret or customer record is embedded in this APK.
 */
class MainActivity : AppCompatActivity() {
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

    private fun renderHome() {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(page)
            isFillViewport = true
        }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(28))
        }
        scroll.addView(column)
        setContentView(scroll)

        block(column, "MINH SATORI", 13f, true, teal)
        block(column, "Quản lý hóa đơn\nvà công nợ", 30f, true, ink, 12)
        block(column, "Ứng dụng thử nghiệm dành riêng cho Samsung Android", 14f,
            false, muted, 10)

        val intro = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = background(Color.WHITE)
            setPadding(dp(18), dp(15), dp(18), dp(15))
        }
        block(intro, "Dữ liệu đồng bộ qua Google Drive", 16f, true)
        block(intro, "Mở hệ thống trong phiên Google đã đăng nhập. Ứng dụng không giữ bản sao hóa đơn riêng và không chứa khóa Bot.", 13f, false, muted, 6)
        column.addView(intro, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(24) })

        if (!hasNetwork()) {
            block(column, "Không có Internet. Vui lòng kết nối Wi-Fi hoặc dữ liệu di động để xem hóa đơn mới nhất.", 14f,
                true, Color.rgb(156, 73, 35), 16)
        }

        action(column, "MỞ HỆ THỐNG MINH SATORI  ↗",
            "Quản lý hóa đơn, khách hàng, công nợ; xuất PDF và chia sẻ",
            prominent = true) { openPortal() }
        action(column, "TRỢ LÝ AI TRONG CHATGPT  ↗",
            "Tra cứu bằng plugin Minh Satori Bot khi đã được kết nối") {
            launchHttps("https://chatgpt.com/")
        }
        action(column, "CÀI ĐẶT LIÊN KẾT  ⚙",
            "Chỉ thay đổi địa chỉ Apps Script khi chủ hệ thống cập nhật deployment") {
            editPortalUrl()
        }
        block(column,
            "Lưu ý: Phiên bản này dùng Chrome Custom Tabs để bảo toàn đăng nhập Google và tính năng chia sẻ. Không sử dụng file HTML ngoại tuyến để tránh tạo hai bộ dữ liệu khác nhau.",
            12f, false, muted, 22)
        block(column, "Minh Satori Android · thử nghiệm 0.1.0", 12f, false, muted, 12)
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
        launchHttps(url)
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
            .setMessage("Chỉ dán URL /exec của website Drive Sync thuộc tài khoản của anh, KHÔNG dùng URL Bot API.")
            .setView(wrapper)
            .setNegativeButton("Hủy", null)
            .setNeutralButton("Mặc định") { _, _ ->
                storage.edit().remove("owner_portal_url").apply()
                Toast.makeText(this, "Đã dùng lại địa chỉ mặc định", Toast.LENGTH_SHORT).show()
            }
            .setPositiveButton("Lưu") { _, _ ->
                val value = PortalUrlValidator.normalize(field.text.toString())
                if (value == null) {
                    Toast.makeText(this, "Chỉ chấp nhận URL https://script.google.com/macros/s/.../exec", Toast.LENGTH_LONG).show()
                } else {
                    storage.edit().putString("owner_portal_url", value).apply()
                    Toast.makeText(this, "Đã lưu địa chỉ trên điện thoại này", Toast.LENGTH_SHORT).show()
                }
            }
            .show()
    }
}
