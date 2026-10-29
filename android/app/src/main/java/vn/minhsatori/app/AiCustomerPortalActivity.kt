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
    private var webClientId: String? = null
    private var ready = false

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
        window.statusBarColor = Color.rgb(247, 250, 253)
        window.navigationBarColor = Color.rgb(247, 250, 253)
        window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(247, 250, 253))
        }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(8), dp(12), dp(8))
            setBackgroundColor(Color.WHITE)
        }
        bar.addView(action("‹", Color.rgb(20, 51, 79), Color.rgb(238, 245, 253)) {
            finish()
        })
        val headline = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), 0, dp(4), 0)
        }
        headline.addView(TextView(this).apply {
            text = "👥 Khách hàng • Quản trị"
            textSize = 17f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.rgb(20, 51, 79))
        })
        headline.addView(TextView(this).apply {
            text = "Minh Satori · tài khoản chủ"
            textSize = 12f
            setTextColor(Color.rgb(83, 105, 130))
        })
        bar.addView(headline, LinearLayout.LayoutParams(0, -2, 1f))
        refreshButton = action("↻", Color.rgb(0, 112, 214),
            Color.rgb(229, 242, 255)) {
            if (ready) web.reload()
        }.apply {
            contentDescription = "Làm mới quản lý khách hàng"
            visibility = View.GONE
        }
        bar.addView(refreshButton)
        root.addView(bar, LinearLayout.LayoutParams(-1, -2))

        authPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(24))
        }
        authPanel.addView(TextView(this).apply {
            text = "🔐 Đăng nhập Google Admin"
            textSize = 21f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.rgb(20, 51, 79))
        })
        authPanel.addView(TextView(this).apply {
            text = "Chỉ Gmail chủ Minh Satori được quản lý khách, duyệt đăng ký, " +
                "chiết khấu và địa chỉ. Các hóa đơn đang hoạt động không bị chỉnh sửa."
            textSize = 15f
            setTextColor(Color.rgb(65, 86, 112))
            setPadding(0, dp(10), 0, dp(18))
        })
        authButton = action("Tiếp tục bằng Google", Color.WHITE,
            Color.rgb(0, 122, 255)) { startNativeGoogleSignIn() }
        authPanel.addView(authButton, LinearLayout.LayoutParams(-1, -2))
        status = TextView(this).apply {
            textSize = 14f
            setTextColor(Color.rgb(74, 92, 117))
            setPadding(0, dp(18), 0, 0)
        }
        authPanel.addView(status)
        root.addView(authPanel, LinearLayout.LayoutParams(-1, -2))

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
        authPanel.visibility = View.GONE
        web.visibility = View.VISIBLE
        refreshButton.visibility = View.VISIBLE
        web.loadUrl(ORIGIN + "/owner-v2")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (ready && web.canGoBack()) web.goBack()
        else super.onBackPressed()
    }

    override fun onDestroy() {
        worker.shutdownNow()
        if (::web.isInitialized) {
            web.stopLoading()
            web.loadUrl("about:blank")
            web.destroy()
        }
        super.onDestroy()
    }
}
