package vn.minhsatori.app

import org.json.JSONArray
import org.json.JSONObject

/** Defensive restoration of a locally selected cart. Never trust unvalidated saved state. */
internal object AiSandboxDraftRecovery {
    fun encode(lines: List<AiSandboxContract.Line>?): String {
        if (lines == null) return ""
        AiSandboxContract.validateCart(lines)
        return JSONArray().apply {
            for (line in lines) put(JSONObject()
                .put("code", line.code).put("name", line.name)
                .put("unit", line.unit).put("qty", line.qty))
        }.toString()
    }

    fun restore(message: String, raw: String?): List<AiSandboxContract.Line>? {
        if (message.isBlank() || raw.isNullOrBlank() || raw.length > 5000) return null
        return runCatching {
            val items = JSONArray(raw)
            if (items.length() !in 1..AiSandboxContract.MAX_LINES) return null
            val lines = (0 until items.length()).map {
                val obj = items.getJSONObject(it)
                AiSandboxContract.Line(
                    obj.getString("code"), obj.getString("name"),
                    obj.getString("unit"), obj.getInt("qty"))
            }
            if (AiSandboxContract.cartMessage(lines) == message) lines else null
        }.getOrNull()
    }
}
