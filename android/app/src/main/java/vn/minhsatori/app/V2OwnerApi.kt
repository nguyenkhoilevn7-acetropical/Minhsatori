package vn.minhsatori.app

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import javax.net.ssl.HttpsURLConnection

/**
 * Dedicated V2 owner-only HTTPS transport. Session and CSRF tokens are MEMORY ONLY,
 * never copied from the accounting/Drive OAuth token, Android preferences or WebView.
 * The backend verifies a Google ID token's immutable sub before issuing the session.
 *
 * Calls must run off the UI thread.
 */
internal class V2OwnerApi {
    companion object {
        const val ORIGIN = "https://minh-satori-v2-customer-admin.onrender.com"
    }
    private var session: String? = null
    private var csrf: String? = null
    val authenticated: Boolean get() = !session.isNullOrEmpty() && !csrf.isNullOrEmpty()

    fun clear() { session = null; csrf = null }

    fun status(): JSONObject = request("GET", "/api/v2/status", requiresAuth = false)

    fun ownerLogin(idToken: String): JSONObject {
        require(idToken.length > 100) { "Thiếu Google ID Token" }
        clear()
        try {
            request("POST", "/api/v2/auth/google", JSONObject().put("credential", idToken),
                requiresAuth = false)
            val account = request("GET", "/api/v2/me").getJSONObject("account")
            if (!account.optBoolean("isAdmin", false)) {
                clear()
                throw SecurityException("Tài khoản Google này không phải chủ V2 đã được xác minh")
            }
            return account
        } catch (error: Exception) {
            clear()
            throw error
        }
    }

    /** History is account-scoped by V2 backend; never match invoices by phone. */
    fun invoiceHistory(): JSONObject = request("GET", "/api/v2/invoices")

    fun invoiceDetails(bindingId: String): JSONObject {
        val id = runCatching { java.util.UUID.fromString(bindingId).toString() }.getOrNull()
            ?: throw IllegalArgumentException("Mã liên kết hóa đơn không hợp lệ")
        require(bindingId.equals(id, true))
        return request("GET", "/api/v2/invoices?id=$id")
    }

    /** Original PDF bytes only: no Android invoice renderer for V2. */
    fun originalInvoicePdfBytes(invoiceId: String, expectedSha256: String): ByteArray {
        if (!authenticated) throw SecurityException("Chưa đăng nhập V2")
        return V2CanonicalInvoicePdf.download(invoiceId, expectedSha256,
            session ?: throw SecurityException("Thiếu phiên V2"),
            csrf ?: throw SecurityException("Thiếu xác minh V2"))
    }

    fun request(method: String, path: String, data: JSONObject? = null,
                requiresAuth: Boolean = true): JSONObject {
        require(method in setOf("GET", "POST", "PATCH", "PUT")) { "Unsupported HTTP method" }
        // Prevent a caller from using this client as an arbitrary HTTP proxy.
        require(path.startsWith("/api/v2/") && !path.startsWith("//") &&
            !path.contains("://") && !path.contains("\\") &&
            !path.contains("..") && !path.contains('#') && !path.contains('\n') &&
            !path.contains('\r')) { "Untrusted path" }
        if (requiresAuth && !authenticated) throw SecurityException("Chưa xác minh Admin V2")
        val url = URL(ORIGIN + path)
        val connection = (url.openConnection() as HttpsURLConnection)
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 18000
        connection.readTimeout = 25000
        connection.requestMethod = method
        connection.useCaches = false
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Cache-Control", "no-store")
        if (requiresAuth) {
            connection.setRequestProperty("Cookie",
                "satori_v2_session=${session}; satori_v2_csrf=${csrf}")
        }
        if (method != "GET") {
            connection.setRequestProperty("Origin", ORIGIN)
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            if (requiresAuth) connection.setRequestProperty("X-Satori-CSRF", csrf)
            connection.doOutput = true
        }
        try {
            if (method != "GET") {
                val bytes = (data ?: JSONObject()).toString().toByteArray(StandardCharsets.UTF_8)
                require(bytes.size <= 24000) { "Dữ liệu gửi quá lớn" }
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            // No redirect following: a redirect could leak session headers.
            if (status in 300..399) throw SecurityException("Máy chủ V2 chuyển hướng bất thường")
            if (!requiresAuth && path == "/api/v2/auth/google" && status in 200..299) {
                for ((key, values) in connection.headerFields) {
                    if (!key.equals("Set-Cookie", ignoreCase = true)) continue
                    for (value in values) {
                        val pair = value.substringBefore(';')
                        when {
                            pair.startsWith("satori_v2_session=") ->
                                session = pair.substringAfter('=').takeIf { it.matches(Regex("[a-f0-9]{64}")) }
                            pair.startsWith("satori_v2_csrf=") ->
                                csrf = pair.substringAfter('=').takeIf { it.matches(Regex("[a-f0-9]{48}")) }
                        }
                    }
                }
                if (!authenticated) throw SecurityException("Không nhận được phiên Admin V2 hợp lệ")
            }
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            val result = runCatching { JSONObject(body) }.getOrElse { JSONObject() }
            if (status !in 200..299) {
                val code = result.optString("error", "HTTP_$status")
                if (status == 401 || status == 403) {
                    // A rejected session must never allow a later privileged write.
                    clear()
                }
                throw IllegalStateException("V2: $code ($status)")
            }
            return result
        } finally {
            connection.disconnect()
        }
    }
}
