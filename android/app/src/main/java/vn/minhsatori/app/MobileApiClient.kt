package vn.minhsatori.app

import android.content.Context
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.UUID

/**
 * Verified-owner Apps Script gateway, with no HMAC / privileged secret in APK.
 * All write operations are backed up and revision-checked server-side.
 * The server endpoint is configured once by the owner, never by untrusted bill data.
 */
object MobileApiClient {
    private const val PREF = "satori_mobile_api"
    private const val ENDPOINT_KEY = "owner_api_endpoint"
    private const val MAX_RESPONSE_BYTES = 14_000_000
    private val redirectHosts = setOf("script.googleusercontent.com", "script.google.com")

    fun endpoint(context: Context): String? = validateEndpoint(
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .getString(ENDPOINT_KEY, null).orEmpty()
    )

    fun saveEndpoint(context: Context, candidate: String): Boolean {
        val valid = validateEndpoint(candidate) ?: return false
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putString(ENDPOINT_KEY, valid).apply()
        return true
    }

    fun validateEndpoint(candidate: String): String? {
        val parsed = try { URI(candidate.trim()) } catch (_: Exception) { return null }
        if (parsed.scheme != "https" ||
            parsed.host != "script.google.com" ||
            parsed.port != -1 || parsed.userInfo != null || parsed.fragment != null ||
            !Regex("^/macros/s/[A-Za-z0-9_-]{15,200}/exec$").matches(parsed.path ?: "") ||
            (parsed.rawQuery != null && parsed.rawQuery != "route=android")
        ) return null
        return parsed.scheme + "://" + parsed.host + parsed.rawPath
    }

    fun request(
        endpoint: String,
        token: String,
        action: String,
        payload: JSONObject = JSONObject(),
        nonce: String = UUID.randomUUID().toString().replace("-", "")
    ): JSONObject {
        val origin = validateEndpoint(endpoint)
            ?: throw IOException("Chưa cấu hình liên kết Apps Script API hợp lệ.")
        require(token.length >= 20) { "Cần đăng nhập tài khoản Google quản lý Minh Satori." }
        if (SatoriOrderValidation.requiresTestLedger(action, payload))
            throw MobileApiError("TEST_ORDER_REQUIRES_SANDBOX",
                "Đơn TEST phải lưu trong môi trường thử riêng, không phải sổ hóa đơn thật.")
        val body = JSONObject()
            .put("kind", "satori-android-v1")
            .put("action", action)
            .put("accessToken", token)
            .put("nonce", nonce)
            .put("payload", payload)
            .toString().toByteArray(Charsets.UTF_8)
        if (body.size > 120_000) throw IOException("Yêu cầu quá lớn.")
        val connection = (URL("$origin?route=android").openConnection() as HttpURLConnection)
        val location: String?
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 45_000
            connection.instanceFollowRedirects = false
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "text/plain; charset=utf-8")
            connection.setRequestProperty("Accept", "application/json")
            connection.setFixedLengthStreamingMode(body.size)
            connection.outputStream.use { it.write(body) }
            location = if (connection.responseCode in 300..399) {
                connection.getHeaderField("Location")
            } else null
            if (location == null) return parseResult(connection)
        } finally {
            connection.disconnect()
        }
        // GAS ContentService responds with a ONE-TIME redirect to Google.
        // Follow with GET and WITHOUT the authentication body or bearer token.
        val uri = URI(location)
        if (uri.scheme != "https" || uri.host !in redirectHosts ||
            uri.port != -1 || uri.userInfo != null) {
            throw IOException("Máy chủ chuyển hướng ra ngoài Google. Đã từ chối.")
        }
        val result = (uri.toURL().openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 45_000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
        }
        try {
            return parseResult(result)
        } finally {
            result.disconnect()
        }
    }

    private fun parseResult(connection: HttpURLConnection): JSONObject {
        val status = connection.responseCode
        if (status !in 200..299) {
            throw IOException("Không thể gọi Minh Satori API (HTTP $status). Kiểm tra triển khai Apps Script.")
        }
        val contents = connection.inputStream.use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val n = input.read(buffer)
                if (n == -1) break
                if (output.size() + n > MAX_RESPONSE_BYTES) {
                    throw IOException("Phản hồi vượt giới hạn an toàn.")
                }
                output.write(buffer, 0, n)
            }
            output.toString(Charsets.UTF_8.name())
        }
        val response = try { JSONObject(contents) } catch (_: Exception) {
            throw IOException("Apps Script chưa triển khai Mobile API hoặc đang yêu cầu đăng nhập trình duyệt.")
        }
        if (!response.optBoolean("ok", false)) {
            val error = response.optJSONObject("error")
            val code = error?.optString("code").orEmpty()
            val message = error?.optString("message").orEmpty()
            throw MobileApiError(code, message.ifBlank { "Yêu cầu chưa được thực hiện." })
        }
        return response
    }

    fun snapshot(endpoint: String, token: String): MobileSnapshot {
        val response = request(endpoint, token, "mobile.snapshot")
        val data = response.getJSONObject("data")
        val allowed = data.optJSONArray("allowedActions")
            ?: throw IOException("Server chưa cấp danh sách quyền. Hãy cập nhật Mobile API.")
        val actions = (0 until allowed.length()).map { allowed.getString(it) }.toSet()
        val actor = data.optString("actorId")
        if (actor.isBlank()) throw IOException("Server chưa hỗ trợ định danh khôi phục thao tác. Cần cập nhật Mobile API.")
        return MobileSnapshot(SatoriData.fromDriveState(data.toString()), actions, actor)
    }

    /**
     * Minimal owner-authorized revision probe. Unlike mobile.snapshot, this
     * never transfers customer rows when the ledger hasn't changed.
     */
    fun revision(endpoint: String, token: String): Long {
        val data = request(endpoint, token, "mobile.revision").getJSONObject("data")
        return LiveSyncPolicy.mobileRevision(data)
    }

    fun trash(endpoint: String, token: String): JSONObject =
        request(endpoint, token, "mobile.trash").getJSONObject("data")
}

data class MobileSnapshot(val snapshot: SatoriSnapshot, val allowedActions: Set<String>, val actorId: String)

class MobileApiError(val apiCode: String, override val message: String) : IOException(message)
