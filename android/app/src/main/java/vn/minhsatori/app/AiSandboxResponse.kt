package vn.minhsatori.app

import org.json.JSONObject

/**
 * Transport success (HTTP 2xx) does not mean Gemini accepted the order.
 * Convert business-level errors into exceptions so the draft input is restored.
 */
internal object AiSandboxResponse {
    fun requireSuccess(body: JSONObject): JSONObject {
        if (body.optBoolean("ok", false)) return body
        val fallback = "Máy chủ chưa xác nhận tin nhắn hoặc đơn hàng. Vui lòng thử lại."
        val message = body.optString("message").trim()
        // Do not render unbounded server-controlled text or technical JSON in the chat bubble.
        val safe = if (message.isNotEmpty() && message.length <= 300) message else fallback
        throw IllegalStateException(safe)
    }
}
