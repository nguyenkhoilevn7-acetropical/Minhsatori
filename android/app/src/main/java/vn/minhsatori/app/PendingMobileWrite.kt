package vn.minhsatori.app

import org.json.JSONObject

/** One immutable operation, bound to the verified account and server; never an OAuth token. */
data class PendingMobileWrite(
    val endpoint: String,
    val actorId: String,
    val action: String,
    val payloadJson: String,
    val createdAt: Long
) {
    val payload: JSONObject get() = JSONObject(payloadJson)
    val requestId: String get() = payload.getString("requestId")

    init {
        require(endpoint.isNotBlank() && actorId.isNotBlank())
        require(action in ACTIONS)
        require(payloadJson.toByteArray(Charsets.UTF_8).size <= 100_000)
        require(Regex("[A-Za-z0-9_-]{8,100}").matches(JSONObject(payloadJson).getString("requestId")))
    }

    fun belongsTo(server: String, actor: String) = endpoint == server && actorId == actor

    fun matches(server: String, actor: String, operation: String, contents: JSONObject): Boolean =
        belongsTo(server, actor) && action == operation && payloadJson == contents.toString()

    fun confirmedIn(snapshot: SatoriSnapshot, trash: JSONObject? = null): Boolean {
        val p = payload
        return when (action) {
            "orders.create", "orders.update", "orders.restore" ->
                snapshot.confirmedWrite(action, requestId) != null
            "payments.markCustomerPaid" -> snapshot.invoices.singleOrNull {
                it.id == p.optString("id") && it.number == p.optString("invoiceNo") &&
                    it.total == p.optLong("amount", -1) && it.customerHasPaid && !it.isExcluded
            } != null
            "orders.delete" -> {
                val entries = trash?.optJSONArray("orders")
                entries != null && (0 until entries.length()).any {
                    val item = entries.getJSONObject(it)
                    item.optString("deleteRequestId") == requestId &&
                        item.optString("id") == p.optString("id") &&
                        item.optString("invoiceNo") == p.optString("invoiceNo")
                }
            }
            else -> false
        }
    }

    fun encode(): String = JSONObject().put("version", 1).put("endpoint", endpoint)
        .put("actorId", actorId).put("action", action).put("payload", payloadJson)
        .put("createdAt", createdAt).toString()

    companion object {
        val ACTIONS = setOf("orders.create", "orders.update", "orders.delete", "orders.restore",
            "payments.markCustomerPaid")

        fun decode(value: String): PendingMobileWrite {
            val json = JSONObject(value)
            require(json.getInt("version") == 1) { "Phiên bản lưu thao tác không hỗ trợ." }
            return PendingMobileWrite(json.getString("endpoint"), json.getString("actorId"),
                json.getString("action"), json.getString("payload"), json.getLong("createdAt"))
        }
    }
}
