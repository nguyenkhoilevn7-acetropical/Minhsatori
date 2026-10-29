package vn.minhsatori.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.SslErrorHandler
import android.net.http.SslError
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * Complete customer ordering + owner link management from the exact same
 * SANDBOX web UI/server as Android's Gemini demo.
 *
 * No copied pricing logic and no native admin credentials. Admin must sign in
 * with the server-side token INSIDE the owner-only /admin page.
 * This view never navigates off the pinned HTTPS Render host.
 */
class AiCustomerPortalActivity : AppCompatActivity() {
    private lateinit var view: WebView
    private var awaitingFiles: android.webkit.ValueCallback<Array<Uri>>? = null
    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        awaitingFiles?.onReceiveValue(
            if (result.resultCode == Activity.RESULT_OK)
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            else null
        )
        awaitingFiles = null
    }

    private fun dp(value: Int) = (resources.displayMetrics.density * value + .5f).toInt()
    private fun toast(message: String) =
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    private fun sameSandbox(raw: String?): Boolean =
        AiSandboxContract.validPortalNavigation(raw)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(10, 24, 44)
        // The system IME must resize this activity so sticky catalog/cart
        // controls stay visible while editing quantity on Samsung phones.
        window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        val ownerMode = intent.getStringExtra("mode") == "admin"
        val suppliedCustomerUrl = intent.getStringExtra("customer_url")
        val customerUrl = if (ownerMode || suppliedCustomerUrl == null) null
            else AiSandboxContract.customerPortalUrl(suppliedCustomerUrl)
        if (!ownerMode && suppliedCustomerUrl != null && customerUrl == null) {
            toast("Link Gemini không hợp lệ hoặc không thuộc máy chủ Satori.")
            finish()
            return
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(246, 249, 252))
        }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(4), dp(12), dp(4))
            setBackgroundColor(Color.rgb(10, 24, 44))
        }
        fun nav(label: String, action: () -> Unit) = TextView(this).apply {
            text = label
            textSize = 14f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(10), dp(10), dp(10), dp(10))
            isClickable = true
            isFocusable = true
            setOnClickListener { action() }
        }
        bar.addView(nav("‹ Quay lại") { if (view.canGoBack()) view.goBack() else finish() })
        bar.addView(TextView(this).apply {
            text = if (ownerMode) "Gemini • Quản trị chủ tài khoản" else "Khách đặt hàng • SANDBOX"
            textSize = 13f
            setTextColor(Color.rgb(143, 230, 238))
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(0, -2, 1f))
        bar.addView(nav("↻") { view.reload() })
        root.addView(bar)

        view = WebView(this)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true // Site cart and admin UI require JS/DOM storage.
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            builtInZoomControls = false
            displayZoomControls = false
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView?, request: WebResourceRequest?): Boolean {
                if (request == null) return true
                val next = request.url.toString()
                if (!sameSandbox(next)) {
                    toast("Đã chặn liên kết ngoài môi trường thử nghiệm.")
                    return true
                }
                return false
            }
            override fun onReceivedSslError(v: WebView?, handler: SslErrorHandler?, error: SslError?) {
                handler?.cancel() // never bypass invalid certificates
                toast("Không mở được kết nối HTTPS an toàn.")
            }
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(webView: WebView?, callback: android.webkit.ValueCallback<Array<Uri>>?,
                params: FileChooserParams?): Boolean {
                awaitingFiles?.onReceiveValue(null)
                awaitingFiles = callback
                return try {
                    filePicker.launch(params?.createIntent() ?: Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        type = "application/json"
                        addCategory(Intent.CATEGORY_OPENABLE)
                    })
                    true
                } catch (error: Exception) {
                    awaitingFiles?.onReceiveValue(null)
                    awaitingFiles = null
                    toast("Không mở được trình chọn tệp.")
                    false
                }
            }
        }
        // Downloads are only initiated by the user clicking a download link on
        // the trusted website. Browser takes ownership of its own save dialog.
        view.setDownloadListener(DownloadListener { url, _, _, _, _ ->
            if (!sameSandbox(url)) {
                toast("Đã chặn địa chỉ tải tệp không thuộc Sandbox.")
            } else {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                        addCategory(Intent.CATEGORY_BROWSABLE)
                    })
                } catch (_: android.content.ActivityNotFoundException) {
                    toast("Không có ứng dụng phù hợp để mở tệp. Hãy thử Chrome.")
                } catch (_: SecurityException) {
                    toast("Ứng dụng không có quyền mở trình tải tệp.")
                }
            }
        })
        root.addView(view, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        val initialUrl = if (ownerMode) AiSandboxContract.BASE_URL + "/admin"
            else customerUrl ?: AiSandboxContract.BASE_URL + "/c/" + AiSandboxContract.PUBLIC_FIXTURE
        view.loadUrl(initialUrl)
    }

    // Folding / unfolding changes window size without destroying WebView.
    // Preserve unsent Gemini text, cart state, cookies and pending navigation;
    // CSS dynamic viewport/layout reflows naturally without reloading a URL.
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (::view.isInitialized) view.requestLayout()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::view.isInitialized && view.canGoBack()) view.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        awaitingFiles?.onReceiveValue(null)
        awaitingFiles = null
        if (::view.isInitialized) {
            view.stopLoading()
            view.loadUrl("about:blank")
            view.destroy()
        }
        super.onDestroy()
    }
}


/**
 * Minh Satori owner CRM lives INSIDE the existing Android application's
 * "Quản trị hệ thống" section. It renders the already deployed owner-v2 CRM
 * and uses Google Play Services for OAuth (never OAuth inside WebView).
 *
 * A Google ID token is exchanged for the ordinary V2 server session. BEFORE
 * passing the session to WebView, /api/v2/me must assert isAdmin === true.
 * No ID token, HMAC key or server secret is saved on device or sent to JS.
 * Customer/chat and existing native invoice APIs remain unmodified.
 */
class V2OwnerCrmActivity : AppCompatActivity() {
    companion object {
        private const val ORIGIN = "https://minh-satori-v2-customer-admin.onrender.com"
        private const val HOST = "minh-satori-v2-customer-admin.onrender.com"
    }

    private val worker = java.util.concurrent.Executors.newSingleThreadExecutor()
    private lateinit var web: android.webkit.WebView
    private lateinit var authPanel: LinearLayout
    private lateinit var authButton: TextView
    private lateinit var status: TextView
    private lateinit var refreshButton: TextView
    private lateinit var registrationBadge: TextView
    private val alertHandler=android.os.Handler(android.os.Looper.getMainLooper())
    private val alertTicker=object:Runnable{
        override fun run(){
            if(ready&&!isFinishing&&!isDestroyed)refreshOwnerRegistrationAlerts()
            alertHandler.postDelayed(this,25_000L)
        }
    }
    private var webClientId: String? = null
    private var ready = false
    private var requestedOwnerTab = "new"

    private fun dp(n: Int) = (resources.displayMetrics.density * n + .5f).toInt()
    private fun pill(color: Int, radius: Int = 13): android.graphics.drawable.GradientDrawable =
        android.graphics.drawable.GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radius).toFloat()
        }

    private fun action(text: String, foreground: Int, background: Int, click: () -> Unit) =
        TextView(this).apply {
            this.text = text
            textSize = 14f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(foreground)
            gravity = Gravity.CENTER
            setPadding(dp(13), dp(11), dp(13), dp(11))
            this.background = pill(background)
            isClickable = true
            isFocusable = true
            setOnClickListener { click() }
        }

    private fun state(message: String) {
        status.text = message
        status.visibility = View.VISIBLE
        authPanel.visibility = View.VISIBLE
        web.visibility = View.GONE
        refreshButton.visibility = View.GONE
        authButton.isEnabled = webClientId != null
        authButton.alpha = if (webClientId != null) 1f else .55f
        ready = false
    }

    private fun busy(message: String) {
        status.text = message
        status.visibility = View.VISIBLE
        authPanel.visibility = View.VISIBLE
        web.visibility = View.GONE
        refreshButton.visibility = View.GONE
        authButton.isEnabled = false
        authButton.alpha = .5f
        ready = false
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(241, 244, 245)
        window.navigationBarColor = Color.rgb(241, 244, 245)
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or
            View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR)
        window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(241, 244, 245))
        }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(8), dp(12), dp(8))
            setBackgroundColor(Color.WHITE)
        }
        bar.addView(action("‹", Color.rgb(16, 43, 56), Color.rgb(241, 244, 245)) {
            finish()
        })
        val icon = android.widget.ImageView(this).apply {
            setImageResource(R.drawable.ic_satori_users)
            setColorFilter(Color.rgb(0, 156, 153))
            background = pill(Color.rgb(226, 246, 243), 11)
            setPadding(dp(8), dp(8), dp(8), dp(8))
            contentDescription = null
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        bar.addView(icon, LinearLayout.LayoutParams(dp(37), dp(37)).apply {
            marginStart = dp(10)
        })
        val headline = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(11), 0, dp(4), 0)
        }
        headline.addView(TextView(this).apply {
            text = "MINH SATORI"
            textSize = 15f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.rgb(16, 43, 56))
        })
        headline.addView(TextView(this).apply {
            text = "QUẢN TRỊ  •  KHÁCH HÀNG V2"
            textSize = 12f
            setTextColor(Color.rgb(102, 121, 130))
        })
        bar.addView(headline, LinearLayout.LayoutParams(0, -2, 1f))
        refreshButton = action("↻", Color.rgb(0, 156, 153),
            Color.rgb(226, 246, 243)) {
            if (ready) web.reload()
        }.apply {
            textSize = 22f
            setPadding(dp(10), dp(8), dp(10), dp(8))
            contentDescription = "Làm mới quản lý khách hàng"
            visibility = View.GONE
        }
        // Native notification bell and unread badge are part of the APP chrome,
        // not a second, unrelated website header.
        val bellFrame=android.widget.FrameLayout(this).apply{
            isClickable=true;isFocusable=true
            contentDescription="Đăng ký khách hàng mới"
            setOnClickListener {
                if(ready){
                    refreshOwnerRegistrationAlerts()
                    web.evaluateJavascript(
                        "(function(){var x=document.getElementById('crmCustomers');"+
                          "if(x)x.scrollIntoView({behavior:'smooth',block:'start'});})()",
                        null)
                }
            }
        }
        bellFrame.addView(android.widget.ImageView(this).apply{
            setImageResource(R.drawable.ic_satori_bell)
            setColorFilter(Color.rgb(0,156,153))
            background=pill(Color.rgb(226,246,243),12)
            setPadding(dp(10),dp(10),dp(10),dp(10))
        },android.widget.FrameLayout.LayoutParams(dp(43),dp(43)))
        registrationBadge=TextView(this).apply{
            gravity=Gravity.CENTER
            textSize=11f
            setTypeface(typeface,Typeface.BOLD)
            setTextColor(Color.WHITE)
            setPadding(dp(4),0,dp(4),0)
            background=pill(Color.rgb(189,31,57),13)
            minWidth=dp(22);minHeight=dp(22)
            visibility=View.GONE
        }
        bellFrame.addView(registrationBadge,android.widget.FrameLayout.LayoutParams(
            -2,dp(22),Gravity.TOP or Gravity.END))
        bar.addView(bellFrame,LinearLayout.LayoutParams(dp(48),dp(43)).apply{
            marginEnd=dp(8)
        })
        bar.addView(refreshButton)
        root.addView(bar, LinearLayout.LayoutParams(-1, -2).apply {
            bottomMargin = dp(8)
        })
        // One native tab bar only. The embedded owner web tabs are hidden
        // by the pinned-origin theme; switching tabs must change web sections,
        // not just scroll to sections still marked hidden.
        val navigation = android.widget.HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            isFillViewport = true
            setBackgroundColor(Color.rgb(241, 244, 245))
        }
        val quickLinks = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(1), dp(12), dp(5))
        }
        val navChips = arrayListOf<LinearLayout>()
        fun selectNativeTab(index: Int) {
            navChips.forEachIndexed { position, view ->
                val selected = position == index
                view.background = pill(if (selected) Color.rgb(0, 156, 153) else Color.WHITE, 13)
                for (childIndex in 0 until view.childCount) {
                    val child = view.getChildAt(childIndex)
                    if (child is TextView) child.setTextColor(
                        if (selected) Color.WHITE else Color.rgb(16, 43, 56))
                    if (child is android.widget.ImageView) child.setColorFilter(
                        if (selected) Color.WHITE else Color.rgb(0, 156, 153))
                }
                view.isSelected = selected
            }
        }
        fun quickLink(title: String, drawable: Int, tab: String, index: Int) {
            val chip = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
                setPadding(dp(6), dp(7), dp(6), dp(7))
                background = pill(Color.WHITE, 13)
                minimumHeight = dp(41)
                isClickable = true
                isFocusable = true
                contentDescription = "Mở mục " + title
                setOnClickListener {
                    if (ready) {
                        requestedOwnerTab = tab
                        val script = "(function(){if(typeof activateOwnerTab==='function'){" +
                            "activateOwnerTab(" + org.json.JSONObject.quote(tab) + ");" +
                            "window.scrollTo(0,0);}})()"
                        web.evaluateJavascript(script, null)
                        selectNativeTab(index)
                    }
                }
            }
            chip.addView(android.widget.ImageView(this).apply {
                setImageResource(drawable)
                setColorFilter(Color.rgb(0, 156, 153))
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }, LinearLayout.LayoutParams(dp(18), dp(18)).apply { marginEnd = dp(5) })
            chip.addView(TextView(this).apply {
                text = title
                textSize = 12f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(Color.rgb(16, 43, 56))
            })
            navChips.add(chip)
            quickLinks.addView(chip, LinearLayout.LayoutParams(0, -2, 1f).apply {
                if (index > 0) marginStart = dp(7)
            })
        }
        quickLink("Khách mới", R.drawable.ic_satori_user_plus, "new", 0)
        quickLink("Khách cũ", R.drawable.ic_satori_users, "old", 1)
        quickLink("Danh mục", R.drawable.ic_satori_invoice, "catalogue", 2)
        selectNativeTab(0)
        navigation.addView(quickLinks)
        root.addView(navigation, LinearLayout.LayoutParams(-1, -2))

        authPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(19), dp(18), dp(19))
            background = pill(Color.WHITE, 17)
        }
        authPanel.addView(TextView(this).apply {
            text = "Đăng nhập Google quản trị"
            textSize = 21f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.rgb(16, 43, 56))
        })
        authPanel.addView(TextView(this).apply {
            text = "Chỉ Gmail chủ Minh Satori được quản lý khách, duyệt đăng ký, " +
                "chiết khấu và địa chỉ. Các hóa đơn đang hoạt động không bị chỉnh sửa."
            textSize = 15f
            setTextColor(Color.rgb(102, 121, 130))
            setPadding(0, dp(10), 0, dp(18))
        })
        authButton = action("Tiếp tục bằng Google", Color.WHITE,
            Color.rgb(0, 156, 153)) { startNativeGoogleSignIn() }
        authPanel.addView(authButton, LinearLayout.LayoutParams(-1, -2))
        status = TextView(this).apply {
            textSize = 14f
            setTextColor(Color.rgb(102, 121, 130))
            setPadding(0, dp(18), 0, 0)
        }
        authPanel.addView(status)
        root.addView(authPanel, LinearLayout.LayoutParams(-1, -2).apply {
            marginStart = dp(12)
            marginEnd = dp(12)
            topMargin = dp(12)
        })

        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            builtInZoomControls = false
            displayZoomControls = false
            safeBrowsingEnabled = true
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (url == ORIGIN + "/owner-v2" || url == ORIGIN + "/owner-v2/") applyNativeOwnerTheme()
            }
            override fun shouldOverrideUrlLoading(
                v: WebView?, request: WebResourceRequest?
            ): Boolean {
                val u = request?.url ?: return true
                // Never allow a customer-link redirect or external site to inherit
                // a privileged session inside the owner-only screen.
                return !(u.scheme == "https" && u.host == HOST && u.port == -1 &&
                    (u.path == "/owner-v2" || u.path == "/owner-v2/"))
            }

            override fun onReceivedSslError(
                v: WebView?, handler: SslErrorHandler?, error: SslError?
            ) {
                handler?.cancel()
                state("Chứng chỉ HTTPS không hợp lệ. Đã chặn kết nối quản trị.")
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onJsConfirm(
                view: WebView?, url: String?, message: String?, result: android.webkit.JsResult?
            ): Boolean {
                if (result == null) return false
                android.app.AlertDialog.Builder(this@V2OwnerCrmActivity)
                    .setTitle("Xác nhận quản trị Minh Satori")
                    .setMessage(message ?: "Xác nhận thay đổi?")
                    .setPositiveButton("Xác nhận") { _, _ -> result.confirm() }
                    .setNegativeButton("Hủy") { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }
                    .show()
                return true
            }
            override fun onJsAlert(
                view: WebView?, url: String?, message: String?, result: android.webkit.JsResult?
            ): Boolean {
                if (result == null) return false
                android.app.AlertDialog.Builder(this@V2OwnerCrmActivity)
                    .setTitle("Minh Satori")
                    .setMessage(message ?: "Thông báo")
                    .setPositiveButton("Đóng") { _, _ -> result.confirm() }
                    .setOnCancelListener { result.cancel() }
                    .show()
                return true
            }
        }
        web.visibility = View.GONE
        web.alpha = 0f // Prevent a flash of unthemed desktop HTML.
        root.addView(web, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        busy("Đang kiểm tra phiên quản trị đã xác minh…")
        worker.execute {
            try {
                val existing = CookieManager.getInstance().getCookie(ORIGIN).orEmpty()
                if (existing.isNotBlank()) {
                    try {
                        verifyOwnerSession(existing)
                        runOnUiThread {
                            if (!isFinishing && !isDestroyed) openAuthorizedOwner(null)
                        }
                        return@execute
                    } catch (_: Exception) {
                        // Session may have expired or belong to a customer.
                        // A fresh Play Services Google identity is required.
                    }
                }
                val response = request("/api/v2/status")
                val clientId = response.optString("googleClientId", "")
                require(response.optBoolean("enabled") &&
                    Regex("^[0-9]+-[A-Za-z0-9_-]+[.]apps[.]googleusercontent[.]com$")
                        .matches(clientId)) { "Google Client ID của V2 chưa sẵn sàng." }
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    webClientId = clientId
                    state("Chọn Gmail Admin để xác minh danh tính. " +
                        "Không sử dụng quyền Google Drive thay cho quyền Admin.")
                }
            } catch (e: Exception) {
                runOnUiThread {
                    if (!isFinishing && !isDestroyed) {
                        state("Không kết nối được đăng nhập V2: " + (e.message ?: "Lỗi mạng"))
                    }
                }
            }
        }
    }


    /**
     * The owner-v2 portal shares the official V2 customer/discount API, but
     * its responsive presentation adopts the INSTALLED native app theme.
     * This theme is injected only into the pinned owner route after admin auth.
     * No financial DOM, forms, event listeners or HTTP request logic is changed.
     */
    private fun applyNativeOwnerTheme() {
        val css = """
            :root {
                color-scheme:light;
                --bg:#f1f4f5; --ink:#102b38; --sub:#667982;
                --line:#e1e9e9; --blue:#009c99; --pale:#e2f6f3;
            }
            html,body { background:#f1f4f5!important;color:#102b38!important; }
            body { font-family:Roboto,system-ui,-apple-system,"Segoe UI",sans-serif!important;
                font-size:13.5px;line-height:1.42;-webkit-text-size-adjust:100%; }
            main { display:flex!important;flex-direction:column;gap:0;
                max-width:990px!important;width:100%!important;
                padding:0 10px max(24px,env(safe-area-inset-bottom))!important;margin:0 auto!important; }
            main>header, #ownerTabs { display:none!important; }
            /* Native owns the only navigation row on Android. */
            .crm-panel-head { gap:12px!important; }
            .crm-customer-card { padding:0!important;min-height:0!important;overflow:hidden; }
            .crm-customer-card>summary.crm-card-summary { padding:14px!important; }
            .crm-customer-card .crm-card-expanded { padding:15px!important; }
            .crm-role-editor { border:0!important;background:transparent!important; }
            .crm-role-editor>form { padding:0!important; }
            .crm-ctv-clients { background:#eaf8f6!important; }
            main>section[aria-label="Quyền truy cập"] { order:0; background:#e2f6f3!important;
                border-color:#ccebe4!important; }
            #crmConsole { order:1; }
            #legacyConsole { order:2; }
            #console { order:3; }
            #denied { order:4; }
            .card { background:#fff!important;border:1px solid #e1e9e9!important;
                border-radius:16px!important;padding:12px!important;margin:6px 0!important;
                box-shadow:0 1px 3px #102b3808!important; }
            .card>h2 { font-weight:750;font-size:18px!important;color:#102b38!important;
                line-height:1.3;margin:0 0 9px!important; }
            h3 {font-size:16px!important;color:#102b38!important;line-height:1.4}
            p,small,details,summary {color:#667982;font-size:inherit}
            strong,b {color:#102b38}
            .metrics {gap:9px!important;margin:12px 0!important;}
            .metric {background:#f7faf9!important;border-color:#e1e9e9!important;
                padding:12px!important;border-radius:13px!important;}
            .metric small {font-size:12px!important;}
            .metric strong {font-size:21px!important;color:#102b38!important;}
            .crm-entry:not(.crm-customer-card) {background:#fff!important;border:1px solid #e1e9e9!important;
                border-radius:14px!important;margin:8px 0!important;
                padding:14px!important;box-shadow:none!important;}
            .crm-entry:not(.crm-customer-card) strong {color:#102b38!important;font-size:13.5px!important;}
            .crm-entry:not(.crm-customer-card) p,.crm-entry:not(.crm-customer-card) small {font-size:12px!important;line-height:1.42!important;
                color:#667982!important;}
            .crm-tag,.badge {background:#e2f6f3!important;color:#086b69!important;
                border-radius:9px!important;font-weight:700!important;}
            #crmCustomers {max-height:none!important;overflow:visible!important;}
            .crm-controls {gap:10px!important;margin:14px 0!important;}
            .crm-controls label,.field-grid label,.legacy-address label {
                font-size:12.5px!important;font-weight:650!important;color:#526d72!important;
            }
            input,select,textarea,.crm-controls input,.crm-controls select,
            .field-grid input,.field-grid select,.field-grid textarea,
            .legacy-address input {
                background:#fff!important;color:#102b38!important;
                border:1px solid #cfdcdd!important;
                border-radius:10px!important;min-height:39px!important;
                font-size:14px!important;padding:7px 9px!important;
            }
            input:focus,select:focus,textarea:focus {
                outline:2px solid #009c9955!important;outline-offset:0;
                border-color:#009c99!important;
            }
            input[type="checkbox"] {min-height:22px!important;width:22px!important;
                accent-color:#009c99;}
            button {min-height:38px!important;border-radius:10px!important;
                background:#009c99!important;color:#fff!important;
                border:0!important;padding:8px 10px!important;
                font-size:12.5px!important;font-weight:700!important;box-shadow:none!important;}
            button.secondary {background:#e2f6f3!important;color:#086b69!important;}
            button.danger {background:#fff1f3!important;color:#b11c35!important;}
            button:disabled {opacity:.46!important;}
            button .ico,h2>.ico,h3>.ico {color:inherit}
            .legacy-address {background:#f8fbfa!important;border-color:#e1e9e9!important;
                border-radius:14px!important;gap:10px!important;}
            #notice {background:#f1f4f5!important;color:#102b38!important;}
            #crmStatus[data-kind="error"],#legacyStatus[data-kind="error"] {color:#b11c35!important;}
            #crmStatus[data-kind="success"],#legacyStatus[data-kind="success"] {color:#0f8165!important;}
            #notice[data-kind="error"] {background:#fff1f3!important;color:#b11c35!important;}
            #notice[data-kind="success"] {background:#e2f6f3!important;color:#0f8165!important;}
            details:not(.crm-customer-card)>summary {padding:8px 0!important;color:#086b69!important;
                font-weight:650!important;}
            .field-grid {gap:12px!important;}

            /* Screenshot-approved owner old cards stay below the single native header.
               Only web customer roles/rates, never financial logic, are styled here. */
            #legacyConsole .crm-panel-title h2 {font-size:19px!important;}
            #legacyConsole .crm-panel-title p {font-size:12px!important;}
            #legacyConsole .crm-card-summary {padding:10px!important;min-height:68px!important;}
            #legacyConsole .crm-avatar {width:40px!important;height:40px!important;font-size:16px!important;}
            #legacyConsole .crm-card-identity strong {font-size:15px!important;}
            #legacyConsole .crm-card-contact {font-size:12px!important;}
            #legacyConsole .crm-card-metadata small {font-size:11.5px!important;}
            #legacyConsole .crm-tag {font-size:11px!important;padding:3px 7px!important;}
            #legacyConsole .crm-card-expanded {padding:10px!important;}
            #legacyConsole .crm-role-options button {font-size:12px!important;min-height:38px!important;padding:6px!important;}
            #legacyConsole .crm-rate-row span {font-size:12px!important;}
            #legacyConsole .crm-rate-row input {font-size:13px!important;min-height:37px!important;}
            #legacyConsole .crm-ctv-client-row {padding:7px!important;}
            #legacyConsole .crm-client-data strong {font-size:13px!important;}
            #legacyConsole .crm-client-data small {font-size:11px!important;}
            #legacyConsole .crm-card-footer button {min-height:40px!important;font-size:11.5px!important;}
            #legacyConsole #crmLedgerDiscovery>summary {font-size:13px!important;}

            /* Physical Samsung #9107/#9109 versus approved #9091.
               Remote owner UI stays authenticated; only visual grid is forced. */
            #legacyConsole .crm-role-choice-row {display:grid!important;
                grid-template-columns:76px minmax(0,1fr)!important;align-items:center!important;}
            #legacyConsole .crm-role-options {display:grid!important;
                grid-template-columns:repeat(3,minmax(0,1fr))!important;
                width:100%!important;gap:5px!important;min-width:0!important;}
            #legacyConsole .crm-role-options button {width:100%!important;min-width:0!important;
                display:inline-flex!important;flex-direction:row!important;justify-content:center!important;
                align-items:center!important;white-space:nowrap!important;padding:5px 2px!important;}
            /* Older owner CSS gives EVERY descendant button grid-column:1/-1.
               Override per actual grid item, not only the grid container. */
            #legacyConsole .crm-role-editor .crm-role-options>button {grid-column:auto!important;
                grid-row:auto!important;justify-self:stretch!important;}
            #legacyConsole .crm-card-footer {display:grid!important;
                grid-template-columns:minmax(0,1fr) minmax(0,1.05fr) minmax(0,1.45fr)!important;
                gap:5px!important;width:100%!important;}
            #legacyConsole .crm-card-footer .crm-btn-primary {grid-column:auto!important;}
            #legacyConsole .crm-card-footer button {display:inline-flex!important;flex-direction:row!important;
                align-items:center!important;justify-content:center!important;gap:3px!important;
                white-space:nowrap!important;min-width:0!important;
                font-size:clamp(9px,2.5vw,12px)!important;padding:5px 2px!important;}
            #legacyConsole .crm-role-editor .crm-card-footer>button {grid-column:auto!important;
                grid-row:auto!important;justify-self:stretch!important;}
            #legacyConsole .crm-card-footer button .ico {width:13px!important;height:13px!important;margin:0!important;}
            #legacyConsole .crm-rate-row {display:grid!important;
                grid-template-columns:minmax(0,1fr) minmax(105px,135px)!important;gap:6px!important;}
            #legacyConsole .crm-percent-control {display:flex!important;min-width:0!important;align-items:stretch;}
            #legacyConsole .crm-percent-control input {flex:1 1 0!important;width:100%!important;
                min-width:0!important;text-align:right!important;}
            #legacyConsole .crm-ctv-client-row {display:grid!important;
                grid-template-columns:minmax(0,1fr) minmax(130px,175px) 24px!important;
                gap:5px!important;align-items:center!important;}
            #legacyConsole .crm-client-rate {display:flex!important;flex-flow:row nowrap!important;
                gap:3px!important;align-items:center!important;min-width:0!important;}
            #legacyConsole .crm-client-rate input {min-width:0!important;width:42px!important;
                flex:1 1 42px!important;padding:5px 3px!important;}
            #legacyConsole .crm-client-rate>span {flex:0 0 auto!important;font-size:11px!important;}
            #legacyConsole .crm-client-rate .crm-client-save {display:inline-flex!important;
                align-items:center!important;white-space:nowrap!important;min-width:0!important;
                width:auto!important;font-size:10px!important;padding:4px!important;}
            #legacyConsole .crm-client-rate .crm-client-save .ico {width:11px!important;
                height:11px!important;margin:0!important;}
            #legacyConsole .crm-duplicate-picker {display:flex!important;flex-wrap:wrap!important;}
            @media(max-width:430px) {
                #legacyConsole .crm-role-choice-row {grid-template-columns:1fr!important;}
                #legacyConsole .crm-role-options {grid-template-columns:repeat(3,minmax(0,1fr))!important;}
                #legacyConsole .crm-card-footer {grid-template-columns:minmax(0,1fr) minmax(0,1.05fr) minmax(0,1.45fr)!important;}
                #legacyConsole .crm-ctv-client-row {grid-template-columns:minmax(0,1fr) minmax(122px,145px) 20px!important;}
            }
            @media(max-width:560px) {
                main {padding-left:10px!important;padding-right:10px!important;}
                .card {padding:11px!important;}
                .field-grid,.legacy-address {grid-template-columns:1fr!important;}
                .crm-controls>label {min-width:100%!important;}
                .metric strong {font-size:19px!important;}
            }
            @media(min-width:700px) {
                main {padding-left:22px!important;padding-right:22px!important;}
                .card {padding:20px!important;}
            }
        """.trimIndent()
        // JSON quote escapes CSS as a string literal, never executes remote data.
        val script = "(function(){if(location.origin!==" +
            org.json.JSONObject.quote(ORIGIN) +
            "||(location.pathname!=='/owner-v2'&&" +
            "location.pathname!=='/owner-v2/'))return;" +
            "var el=document.getElementById('satori-android-app-theme');" +
            "if(!el){el=document.createElement('style');el.id='satori-android-app-theme';" +
            "document.head.appendChild(el);}el.textContent=" +
            org.json.JSONObject.quote(css) + ";})();"
        web.evaluateJavascript(script) {
            if (!isFinishing && !isDestroyed) {
                val restore = "(function(){if(typeof activateOwnerTab==='function')" +
                    "activateOwnerTab(" + org.json.JSONObject.quote(requestedOwnerTab) + ");})()"
                web.evaluateJavascript(restore, null)
                web.animate().alpha(1f).setDuration(160).start()
            }
        }
    }

    private fun startNativeGoogleSignIn() {
        val id = webClientId ?: return
        busy("Đang mở trình chọn Gmail qua Credential Manager…")
        try {
            // Google removed the old GoogleSignIn APIs from play-services-auth
            // v22 (Aug 2026). The supported Credential Manager provider issues
            // the same signed ID token already verified by our V2 server.
            val nonceBytes = ByteArray(32)
            java.security.SecureRandom().nextBytes(nonceBytes)
            val nonce = android.util.Base64.encodeToString(nonceBytes,
                android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or
                    android.util.Base64.NO_PADDING)
            val google = com.google.android.libraries.identity.googleid
                .GetSignInWithGoogleOption.Builder(id)
                .setNonce(nonce)
                .build()
            val request = androidx.credentials.GetCredentialRequest.Builder()
                .addCredentialOption(google)
                .build()
            androidx.credentials.CredentialManager.create(this).getCredentialAsync(
                context = this,
                request = request,
                cancellationSignal = null,
                executor = androidx.core.content.ContextCompat.getMainExecutor(this),
                callback = object : androidx.credentials.CredentialManagerCallback<
                    androidx.credentials.GetCredentialResponse,
                    androidx.credentials.exceptions.GetCredentialException> {
                    override fun onResult(result: androidx.credentials.GetCredentialResponse) {
                        try {
                            val credential = result.credential
                            val type = com.google.android.libraries.identity.googleid
                                .GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                            if (credential !is androidx.credentials.CustomCredential ||
                                credential.type != type) {
                                throw IllegalStateException("GOOGLE_CREDENTIAL_TYPE_INVALID")
                            }
                            val token = com.google.android.libraries.identity.googleid
                                .GoogleIdTokenCredential.createFrom(credential.data).idToken
                            busy("Đang xác minh Google và quyền Admin trên máy chủ…")
                            worker.execute {
                                try {
                                    val cookies = exchangeGoogleToken(token)
                                    verifyOwnerSession(cookies)
                                    runOnUiThread {
                                        if (!isFinishing && !isDestroyed) {
                                            openAuthorizedOwner(cookies)
                                        }
                                    }
                                } catch (e: Exception) {
                                    runOnUiThread {
                                        if (!isFinishing && !isDestroyed) {
                                            state("Không xác minh được quyền Admin: " +
                                                (e.message ?: "Lỗi kết nối"))
                                        }
                                    }
                                }
                            }
                        } catch (e: Exception) {
                            state("Không đọc được Google ID token: " +
                                (e.message ?: "Credential Manager không sẵn sàng"))
                        }
                    }

                    override fun onError(
                        e: androidx.credentials.exceptions.GetCredentialException
                    ) {
                        state("Google chưa đăng nhập thành công. Kiểm tra tài khoản " +
                            "và cấu hình SHA-1/package Android OAuth (nếu được yêu cầu). " +
                            (e.type ?: ""))
                    }
                }
            )
        } catch (e: Exception) {
            state("Không mở được Google Credential Manager: " +
                (e.message ?: "Lỗi không xác định"))
        }
    }

    private fun request(
        path: String,
        method: String = "GET",
        payload: org.json.JSONObject? = null,
        cookie: String? = null
    ): org.json.JSONObject {
        val conn = java.net.URL(ORIGIN + path).openConnection() as javax.net.ssl.HttpsURLConnection
        conn.connectTimeout = 10000
        conn.readTimeout = 12000
        conn.instanceFollowRedirects = false
        conn.requestMethod = method
        conn.setRequestProperty("Accept", "application/json")
        conn.setRequestProperty("Cache-Control", "no-store")
        if (cookie != null) conn.setRequestProperty("Cookie", cookie)
        if (payload != null) {
            conn.doOutput = true
            conn.setRequestProperty("Origin", ORIGIN)
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.outputStream.use {
                it.write(payload.toString().toByteArray(Charsets.UTF_8))
            }
        }
        try {
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "{}"
            val json = org.json.JSONObject(body)
            if (code !in 200..299) throw IllegalStateException(
                json.optString("error", "HTTP $code"))
            return json
        } finally { conn.disconnect() }
    }

    private fun exchangeGoogleToken(token: String): String {
        val conn = java.net.URL(ORIGIN + "/api/v2/auth/google")
            .openConnection() as javax.net.ssl.HttpsURLConnection
        conn.connectTimeout = 10000
        conn.readTimeout = 12000
        conn.instanceFollowRedirects = false
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setRequestProperty("Origin", ORIGIN)
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        conn.outputStream.use {
            it.write(org.json.JSONObject().put("credential", token)
                .toString().toByteArray(Charsets.UTF_8))
        }
        try {
            val code = conn.responseCode
            val result = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "{}"
            val body = org.json.JSONObject(result)
            if (code != 200 || !body.optBoolean("ok")) {
                throw IllegalStateException(body.optString("error", "GOOGLE_LOGIN_FAILED"))
            }
            // Server returns both HttpOnly session and readable CSRF cookie.
            // Validate exact names and shapes before bridging to WebView.
            val headers = conn.headerFields.entries
                .filter { it.key?.equals("set-cookie", true) == true }
                .flatMap { it.value ?: emptyList() }
                .map { it.substringBefore(';').trim() }
            val session = headers.firstOrNull { it.startsWith("satori_v2_session=") }
                ?: throw IllegalStateException("SESSION_COOKIE_MISSING")
            val csrf = headers.firstOrNull { it.startsWith("satori_v2_csrf=") }
                ?: throw IllegalStateException("CSRF_COOKIE_MISSING")
            require(Regex("^satori_v2_session=[a-f0-9]{64}$").matches(session) &&
                Regex("^satori_v2_csrf=[a-f0-9]{48}$").matches(csrf)) {
                "INVALID_SESSION_COOKIE"
            }
            return "$session; $csrf"
        } finally { conn.disconnect() }
    }

    private fun verifyOwnerSession(cookie: String) {
        val result = request("/api/v2/me", cookie = cookie)
        require(result.optJSONObject("account")?.optBoolean("isAdmin") == true) {
            "Gmail này không có quyền quản trị Minh Satori V2."
        }
    }

    private fun openAuthorizedOwner(newCookies: String?) {
        if (newCookies != null) {
            val mgr = CookieManager.getInstance()
            val parts = newCookies.split(';').map { it.trim() }
            for (part in parts) {
                val isSession = part.startsWith("satori_v2_session=")
                val isCsrf = part.startsWith("satori_v2_csrf=")
                if (isSession || isCsrf) mgr.setCookie(
                    ORIGIN, part + "; Secure; SameSite=Lax; Path=/" +
                        if (isSession) "; HttpOnly" else ""
                )
            }
            mgr.flush()
        }
        ready = true
        V2RegistrationAlerts.schedule(this)
        if(android.os.Build.VERSION.SDK_INT>=33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=
             android.content.pm.PackageManager.PERMISSION_GRANTED){
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),52029)
        }
        updateRegistrationBadge(V2RegistrationAlerts.pendingCount(this))
        refreshOwnerRegistrationAlerts()
        authPanel.visibility = View.GONE
        web.visibility = View.VISIBLE
        refreshButton.visibility = View.VISIBLE
        web.alpha = 0f
        web.loadUrl(ORIGIN + "/owner-v2")
    }


    private fun updateRegistrationBadge(count:Int){
        if(!::registrationBadge.isInitialized)return
        registrationBadge.visibility=if(count>0)View.VISIBLE else View.GONE
        registrationBadge.text=if(count>99)"99+" else count.toString()
        registrationBadge.contentDescription="$count khách mới đang chờ duyệt"
    }

    private fun refreshOwnerRegistrationAlerts(){
        if(!ready)return
        val cookie=V2RegistrationAlerts.cookie()
        try{
            worker.execute{
                try{
                    val feed=V2RegistrationAlerts.fetch(cookie)?:return@execute
                    val count=V2RegistrationAlerts.process(applicationContext,feed)
                    runOnUiThread {
                        if(!isFinishing&&!isDestroyed)updateRegistrationBadge(count)
                    }
                }catch(_:Exception){/* Network or expired Admin session. */}
            }
        }catch(_:java.util.concurrent.RejectedExecutionException){}
    }

    override fun onResume(){
        super.onResume()
        alertHandler.removeCallbacks(alertTicker)
        alertHandler.post(alertTicker)
    }

    override fun onPause(){
        alertHandler.removeCallbacks(alertTicker)
        super.onPause()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (ready && web.canGoBack()) web.goBack()
        else super.onBackPressed()
    }

    override fun onDestroy() {
        alertHandler.removeCallbacks(alertTicker)
        worker.shutdownNow()
        if (::web.isInitialized) {
            web.stopLoading()
            web.loadUrl("about:blank")
            web.destroy()
        }
        super.onDestroy()
    }
}
