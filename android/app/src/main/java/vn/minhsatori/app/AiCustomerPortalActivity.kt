package vn.minhsatori.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
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
        val ownerMode = intent.getStringExtra("mode") == "admin"
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
            text = if (ownerMode) "Quản lý link • SANDBOX" else "Khách đặt hàng • SANDBOX"
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
            if (sameSandbox(url)) {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } else toast("Đã chặn địa chỉ tải tệp không thuộc Sandbox.")
        })
        root.addView(view, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        val path = if (ownerMode) "/admin" else "/c/" + AiSandboxContract.PUBLIC_FIXTURE
        view.loadUrl(AiSandboxContract.BASE_URL + path)
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
