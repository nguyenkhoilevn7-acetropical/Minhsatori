package vn.minhsatori.app

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection

/**
 * Binds FCM token to a fresh authenticated V2 OWNER session, never to a device
 * ID or client-supplied email/role. V2 server rechecks session + CSRF + owner.
 */
object OwnerPushRegistration {
    private const val PREF = "satori_owner_fcm"
    private const val ORIGIN = "https://minh-satori-v2-customer-admin.onrender.com"
    private const val RETRY_MS = 60 * 60 * 1000L
    private val executor = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)

    fun tokenRotated(context: Context) {
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
            .putLong("registered_at", 0L).putBoolean("owner_armed", false).apply()
    }

    fun disarm(context: Context) {
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
            .putBoolean("owner_armed", false).putLong("registered_at", 0L).apply()
    }

    fun bindVerifiedOwner(context: Context, cookie: String, optedIn: Boolean) {
        if (!OwnerPushConfig.configured || !optedIn ||
            FirebaseApp.getApps(context).isEmpty() ||
            !cookie.contains("satori_v2_session=")) {
            disarm(context)
            return
        }
        val prefs = context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        if (prefs.getBoolean("owner_armed", false) &&
            System.currentTimeMillis() - prefs.getLong("registered_at", 0L) < RETRY_MS) return
        if (!busy.compareAndSet(false, true)) return
        val app = context.applicationContext
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (!task.isSuccessful || task.result.isNullOrBlank()) {
                    busy.set(false)
                    return@addOnCompleteListener
                }
                val token = task.result
                executor.execute {
                    try {
                        val csrf = cookie.split(';').map { it.trim() }
                            .firstOrNull { it.startsWith("satori_v2_csrf=") }
                            ?.substringAfter('=') ?: return@execute
                        if (csrf.isBlank()) return@execute
                        val id = prefs.getString("device_id", null)
                            ?: UUID.randomUUID().toString().also {
                                prefs.edit().putString("device_id", it).apply()
                            }
                        val conn = URL("$ORIGIN/api/v2/admin/push-devices")
                            .openConnection() as HttpsURLConnection
                        try {
                            conn.connectTimeout = 8000
                            conn.readTimeout = 8000
                            conn.requestMethod = "POST"
                            conn.doOutput = true
                            conn.instanceFollowRedirects = false
                            conn.setRequestProperty("Origin", ORIGIN)
                            conn.setRequestProperty("Cookie", cookie)
                            conn.setRequestProperty("X-Satori-CSRF", csrf)
                            conn.setRequestProperty("Content-Type", "application/json")
                            val body = JSONObject().put("deviceId", id).put("token", token)
                                .toString().toByteArray(Charsets.UTF_8)
                            conn.outputStream.use { it.write(body) }
                            if (conn.responseCode == 200) {
                                val result = conn.inputStream.bufferedReader().use { it.readText() }
                                if (JSONObject(result).optBoolean("ok") &&
                                    JSONObject(result).optBoolean("enabled")) {
                                    prefs.edit().putBoolean("owner_armed", true)
                                        .putLong("registered_at", System.currentTimeMillis()).apply()
                                }
                            } else if (conn.responseCode == 401 || conn.responseCode == 403) {
                                disarm(app)
                            }
                        } finally {
                            conn.disconnect()
                        }
                    } catch (_: Exception) {
                        // No token, cookie or customer information is logged.
                    } finally {
                        busy.set(false)
                    }
                }
            }
        } catch (_: RuntimeException) {
            busy.set(false)
        }
    }
}
