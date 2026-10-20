package vn.minhsatori.app

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/** Shared Gemini sandbox API contract used by the native Android customer-chat preview.
 * It is not a Google OAuth token, merchant key, production gateway or real customer login.
 * Production customer links and staff API must only be enabled after verification.
 */
internal object AiSandboxContract {
    const val BASE_URL = "https://minh-satori-customer-ai-gemini.onrender.com"
    const val PUBLIC_FIXTURE = "demo-a"
    const val MAX_LINES = 6
    const val MAX_UNITS = 500

    data class Line(val code: String, val name: String, val unit: String, val qty: Int)

    fun validEndpoint(raw: String): Boolean {
        val uri = runCatching { URI(raw) }.getOrNull() ?: return false
        return uri.scheme == "https" && uri.host == "minh-satori-customer-ai-gemini.onrender.com" &&
            uri.port == -1 && uri.userInfo == null && uri.fragment == null && uri.query == null &&
            uri.path.orEmpty().isEmpty()
    }

    fun validateCart(lines: List<Line>) {
        require(lines.isNotEmpty() && lines.size <= MAX_LINES) { "Chọn từ 1 đến 6 loại sản phẩm." }
        require(lines.map { it.code }.distinct().size == lines.size) { "Sản phẩm bị trùng." }
        require(lines.all { it.code.matches(Regex("TP-\\d{5}")) && it.qty in 1..MAX_UNITS }) {
            "Mã hàng hoặc số lượng không hợp lệ."
        }
        require(lines.sumOf { it.qty } <= MAX_UNITS) { "Tổng số lượng vượt 500." }
    }

    fun cartMessage(lines: List<Line>): String {
        validateCart(lines)
        val message = "Cho tôi đặt một đơn gồm:\n" + lines.joinToString("\n") {
            "- ${it.qty} ${it.unit} ${it.name} (Mã ${it.code})"
        }
        require(message.length <= 500) { "Tin nhắn vượt 500 ký tự." }
        return message
    }

    fun requestMessage(message: String, lines: List<Line>? = null): JSONObject {
        require(message.isNotBlank() && message.length <= 500) { "Tin nhắn không hợp lệ." }
        return JSONObject().put("token", PUBLIC_FIXTURE).put("message", message).apply {
            if (lines != null) {
                require(message == cartMessage(lines)) { "Tin nhắn và giỏ hàng không khớp." }
                put("cartItems", JSONArray().apply {
                    for (line in lines) put(JSONObject().put("code", line.code).put("qty", line.qty))
                })
            }
        }
    }
}
