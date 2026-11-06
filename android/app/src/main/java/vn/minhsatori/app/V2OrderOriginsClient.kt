package vn.minhsatori.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/**
 * Reads verified checkout origins straight from the V2 backend with the owner's
 * existing V2 Google session (same cookie as push/CRM). The server answers only
 * to an owner session and only from COMMITTED checkouts (read-only transaction).
 *
 * Android re-checks every entry against the bill it is shown on:
 * exact ledger id, exact invoice number and bill apiRequestId == checkout requestId.
 * Nothing here can change an invoice, a payment or a PDF.
 */
object V2OrderOriginsClient {
    private const val PATH = "/api/v2/admin/order-origins"
    private const val PREF = "satori_v2_order_origins"
    private const val KEY = "document"
    private const val MAX_ENTRIES = 50_000

    /** Parse the server document; any structural problem returns null (nothing shown). */
    fun parse(body: String): List<SatoriOrderOrigin>? = try {
        val json = JSONObject(body)
        if (!json.optBoolean("ok") || json.optInt("schemaVersion") != 1 ||
            json.optString("source") != "satori-v2-postgresql-committed") null
        else {
            val rows = json.optJSONArray("entries") ?: JSONArray()
            if (rows.length() > MAX_ENTRIES) null
            else (0 until rows.length()).mapNotNull { i -> entry(rows.optJSONObject(i)) }
        }
    } catch (_: Exception) { null }

    private fun text(row: JSONObject, key: String, max: Int): String? {
        val raw = row.opt(key)
        val value = when (raw) { is String -> raw; is Number -> raw.toString(); else -> return null }
        return value.takeIf { it.isNotEmpty() && it.length <= max && it == it.trim() }
    }

    private fun entry(row: JSONObject?): SatoriOrderOrigin? {
        if (row == null) return null
        return SatoriOrderOrigin(
            ledgerInvoiceId = text(row, "ledgerInvoiceId", 100) ?: return null,
            invoiceNo = text(row, "invoiceNo", 24) ?: return null,
            accountId = text(row, "accountId", 100) ?: return null,
            accountName = text(row, "accountName", 150) ?: return null,
            accountRole = text(row, "accountRole", 40) ?: return null,
            roleSource = text(row, "roleSource", 40).orEmpty(),
            requestId = text(row, "requestId", 100) ?: return null
        )
    }

    /** Network call; run off the UI thread. Null = unavailable (keep last good copy). */
    fun fetch(cookie: String): Pair<String, List<SatoriOrderOrigin>>? {
        if (!cookie.contains("satori_v2_session=")) return null
        val c = (URL(V2RegistrationAlerts.ORIGIN + PATH).openConnection() as HttpsURLConnection).apply {
            connectTimeout = 15000; readTimeout = 45000 // free Render plan may cold-start
            instanceFollowRedirects = false; requestMethod = "GET"
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Cache-Control", "no-store")
            setRequestProperty("Cookie", cookie)
        }
        return try {
            if (c.responseCode != 200) null
            else {
                val body = c.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                parse(body)?.let { body to it }
            }
        } catch (_: Exception) { null } finally { c.disconnect() }
    }

    /** Last good server document, kept in app-private storage for offline display. */
    fun cached(context: Context): List<SatoriOrderOrigin> =
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(KEY, null)
            ?.let { parse(it) }.orEmpty()

    fun store(context: Context, body: String) {
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString(KEY, body).apply()
    }
}
