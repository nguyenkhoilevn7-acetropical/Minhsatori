package vn.minhsatori.app

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.net.URL
import java.util.UUID
import javax.net.ssl.HttpsURLConnection
import org.json.JSONObject

/** Public Firebase app config is injected at build time, never a server key. */
class SatoriApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        SatoriPush.initialize(this)
    }
}

/**
 * Owner push client. Server sends a DATA-ONLY high-priority FCM message after
 * the canonical ledger confirms a new invoice; this object only displays a
 * pointer (invoice number) and never writes invoices, payments or accounting.
 * Diagnostics keep safe codes and a 6-character token suffix only.
 */
internal object SatoriPush {
    private const val CHANNEL = "minh_satori_owner_order_push_v1"
    private const val PREFS = "satori_push_dedupe"
    private const val STATE = "satori_push_state"
    private const val ACTION = "vn.minhsatori.app.OPEN_NEW_INVOICE"
    private const val EXTRA = "invoice_no"
    private const val REGISTRATION_JOB = 52031
    private const val TEST_NOTIFICATION_ID = 52032
    private const val REREGISTER_MS = 6 * 60 * 60 * 1000L
    private const val DEVICE_PATH = "/api/v2/admin/push/device"
    private const val STATUS_PATH = "/api/v2/admin/push/status"
    private const val TEST_PATH = "/api/v2/admin/push/test"
    private val dedupeLock = Any()

    fun configured(): Boolean = BuildConfig.SATORI_FCM_APP_ID.isNotBlank() &&
        BuildConfig.SATORI_FCM_API_KEY.isNotBlank() &&
        BuildConfig.SATORI_FCM_PROJECT_ID.isNotBlank()

    fun initialize(context: Context) {
        createChannel(context)
        if (!configured() || FirebaseApp.getApps(context).isNotEmpty()) return
        try {
            val options = FirebaseOptions.Builder()
                .setApplicationId(BuildConfig.SATORI_FCM_APP_ID)
                .setApiKey(BuildConfig.SATORI_FCM_API_KEY)
                .setProjectId(BuildConfig.SATORI_FCM_PROJECT_ID)
                .build()
            FirebaseApp.initializeApp(context, options)
        } catch (_: RuntimeException) {
            record(context, "lastRegistrationCode", "FIREBASE_INIT_FAILED")
        }
    }

    private fun state(context: Context) =
        context.getSharedPreferences(STATE, Context.MODE_PRIVATE)

    private fun record(context: Context, key: String, value: String) {
        state(context).edit().putString(key, value.take(80)).apply()
    }

    /** Random per-install identifier; contains no hardware or personal identifier. */
    fun deviceId(context: Context): String {
        val prefs = state(context)
        prefs.getString("deviceId", null)?.takeIf {
            it.matches(Regex("[0-9a-f-]{36}"))
        }?.let { return it }
        val created = UUID.randomUUID().toString()
        prefs.edit().putString("deviceId", created).apply()
        return created
    }

    fun enabled(context: Context): Boolean =
        context.getSharedPreferences("NativeMainActivity", Context.MODE_PRIVATE)
            .getBoolean("satori_live_notifications", false)

    fun permissionGranted(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    /** True when the user blocked the app or this channel in Android settings. */
    fun channelBlocked(context: Context): Boolean {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (!manager.areNotificationsEnabled()) return true
        if (Build.VERSION.SDK_INT < 26) return false
        val channel = manager.getNotificationChannel(CHANNEL) ?: return false
        return channel.importance == NotificationManager.IMPORTANCE_NONE
    }

    /**
     * Creates the channel once. Android ignores importance/sound changes for an
     * existing channel, so a channel the owner disabled is never re-enabled.
     */
    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL) != null) return
        val channel = NotificationChannel(CHANNEL,
            "Minh Satori · Đơn hàng mới tức thời", NotificationManager.IMPORTANCE_HIGH).apply {
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 250, 150, 250)
            description = "Thông báo đơn mới đã xác nhận từ máy chủ Minh Satori"
            setShowBadge(true)
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,
                android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).build())
        }
        manager.createNotificationChannel(channel)
    }

    private fun csrfFrom(cookie: String): String? = cookie.split(';').map { it.trim() }
        .firstOrNull { it.startsWith("satori_v2_csrf=") }
        ?.substringAfter('=')?.takeIf { it.length in 10..200 }

    /**
     * Registers this phone with the Owner V2 session. MUST run on the main
     * thread (WebView CookieManager). [done] receives a safe result code.
     */
    fun registerOwnerDevice(context: Context, force: Boolean = false,
                            done: ((String) -> Unit)? = null) {
        val app = context.applicationContext
        fun finish(code: String) {
            record(app, "lastRegistrationCode", code)
            record(app, "lastRegistrationAt", System.currentTimeMillis().toString())
            done?.invoke(code)
        }
        if (!configured()) return finish("FIREBASE_MISSING")
        if (!enabled(app)) return finish("ALERTS_OFF")
        if (!permissionGranted(app)) return finish("PERMISSION_DENIED")
        val cookie = V2RegistrationAlerts.cookie()
        if (!cookie.contains("satori_v2_session=")) return finish("OWNER_SESSION_MISSING")
        val csrf = csrfFrom(cookie) ?: return finish("OWNER_CSRF_MISSING")
        try {
            FirebaseMessaging.getInstance().isAutoInitEnabled = true
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token ->
                    if (token.isNullOrBlank() || token.length > 4096) {
                        finish("FCM_TOKEN_EMPTY"); return@addOnSuccessListener
                    }
                    val prefs = state(app)
                    val last = prefs.getString("lastRegistrationAt", "0")?.toLongOrNull() ?: 0L
                    val sameToken = prefs.getString("registeredTokenSuffix", "") == token.takeLast(6)
                    if (!force && sameToken && prefs.getString("lastRegistrationCode", "") == "REGISTERED" &&
                        !prefs.getBoolean("tokenChanged", false) &&
                        System.currentTimeMillis() - last < REREGISTER_MS) {
                        done?.invoke("REGISTERED"); return@addOnSuccessListener
                    }
                    Thread {
                        val code = try { sendRegistration(app, cookie, csrf, token) }
                        catch (_: Exception) { "NETWORK_ERROR" }
                        if (code == "REGISTERED") {
                            prefs.edit().putString("registeredTokenSuffix", token.takeLast(6))
                                .putBoolean("tokenChanged", false).apply()
                        }
                        finish(code)
                    }.start()
                }
                .addOnFailureListener { finish("FCM_TOKEN_FAILED") }
        } catch (_: IllegalStateException) {
            finish("FIREBASE_NOT_INITIALIZED")
        }
    }

    private fun connection(path: String, method: String, cookie: String,
                           csrf: String?): HttpsURLConnection =
        (URL(V2RegistrationAlerts.ORIGIN + path).openConnection() as HttpsURLConnection).apply {
            connectTimeout = 9000
            readTimeout = 9000
            instanceFollowRedirects = false
            requestMethod = method
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Cache-Control", "no-store")
            setRequestProperty("Cookie", cookie)
            if (csrf != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Origin", V2RegistrationAlerts.ORIGIN)
                setRequestProperty("X-Satori-CSRF", csrf)
            }
        }

    /** Reads only a fixed server error code; never logs body, token or cookie. */
    private fun readResult(c: HttpsURLConnection): Pair<Int, JSONObject?> {
        val code = c.responseCode
        val stream = if (code in 200..299) c.inputStream else c.errorStream
        val text = stream?.bufferedReader(Charsets.UTF_8)?.use { reader ->
            val buffer = CharArray(16_384)
            val n = reader.read(buffer)
            if (n > 0) String(buffer, 0, n) else ""
        }.orEmpty()
        return code to try { JSONObject(text) } catch (_: Exception) { null }
    }

    private fun safeError(status: Int, body: JSONObject?): String {
        val server = body?.optString("error").orEmpty()
        return if (server.matches(Regex("[A-Z0-9_]{3,60}"))) server else "HTTP_$status"
    }

    private fun sendRegistration(context: Context, cookie: String, csrf: String,
                                 token: String): String {
        val c = connection(DEVICE_PATH, "POST", cookie, csrf)
        try {
            val bytes = JSONObject().put("token", token)
                .put("platform", "android")
                .put("deviceId", deviceId(context))
                .toString().toByteArray(Charsets.UTF_8)
            c.outputStream.use { it.write(bytes) }
            val (status, body) = readResult(c)
            return if (status == 200 && body?.optBoolean("registered") == true) "REGISTERED"
            else safeError(status, body)
        } finally { c.disconnect() }
    }

    /** Owner turned alerts off: remove this phone from the server registry. */
    fun revokeOwnerDevice(context: Context) {
        val app = context.applicationContext
        val cookie = V2RegistrationAlerts.cookie()
        if (!cookie.contains("satori_v2_session=")) return
        val csrf = csrfFrom(cookie) ?: return
        val id = deviceId(app)
        Thread {
            val code = try {
                val c = connection(DEVICE_PATH, "DELETE", cookie, csrf)
                try {
                    c.outputStream.use {
                        it.write(JSONObject().put("deviceId", id).toString()
                            .toByteArray(Charsets.UTF_8))
                    }
                    val (status, body) = readResult(c)
                    if (status == 200) "REVOKED" else safeError(status, body)
                } finally { c.disconnect() }
            } catch (_: Exception) { "NETWORK_ERROR" }
            record(app, "lastRegistrationCode", code)
            state(app).edit().remove("registeredTokenSuffix").apply()
        }.start()
    }

    /** Firebase rotated the token: re-register as soon as a network is available. */
    fun onTokenRefreshed(context: Context) {
        val app = context.applicationContext
        state(app).edit().putBoolean("tokenChanged", true).apply()
        if (!configured() || !enabled(app)) return
        try {
            val scheduler = app.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
            scheduler.schedule(JobInfo.Builder(REGISTRATION_JOB,
                ComponentName(app, SatoriPushRegistrationJob::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setBackoffCriteria(30_000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                .build())
        } catch (_: RuntimeException) {
            record(app, "lastRegistrationCode", "TOKEN_REFRESH_SCHEDULE_FAILED")
        }
    }

    fun alreadyNotified(context: Context, number: Long): Boolean = synchronized(dedupeLock) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getStringSet("seen", emptySet()).orEmpty().contains(number.toString())
    }

    /** Returns true only the FIRST time an invoice number is marked (dedupe). */
    fun markNotified(context: Context, number: Long): Boolean = synchronized(dedupeLock) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val seen = prefs.getStringSet("seen", emptySet()).orEmpty()
        if (number.toString() in seen) return@synchronized false
        prefs.edit().putStringSet("seen", (seen + number.toString())
            .sortedByDescending { it.toLongOrNull() ?: 0L }.take(300).toSet()).commit()
        true
    }

    @Suppress("DEPRECATION")
    private fun builder(context: Context): Notification.Builder =
        if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL)
        else Notification.Builder(context)

    /** Lock-screen version: no invoice number, customer or amount. */
    private fun publicVersion(context: Context): Notification =
        builder(context).setSmallIcon(R.drawable.ic_satori_bell)
            .setContentTitle("Minh Satori")
            .setContentText("Có đơn hàng mới · mở khóa để xem")
            .build()

    fun showVerifiedInvoice(context: Context, numberText: String) {
        record(context, "lastPushReceivedAt", System.currentTimeMillis().toString())
        if (!enabled(context) || !configured() || !permissionGranted(context)) return
        val number = numberText.toLongOrNull()?.takeIf { it in 1L..999_999_999L } ?: return
        if (!markNotified(context, number)) return
        createChannel(context)
        val open = Intent(context, NativeMainActivity::class.java).apply {
            action = ACTION
            putExtra(EXTRA, number)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val pending = PendingIntent.getActivity(context, number.toInt(), open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = builder(context).setSmallIcon(R.drawable.ic_satori_bell)
            .setContentTitle("Minh Satori · Đơn hàng mới #" + number)
            .setContentText("Chạm để mở hóa đơn đã xác nhận")
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion(context))
            .setNumber(1)
            .setShowWhen(true)
        if (Build.VERSION.SDK_INT < 26) {
            @Suppress("DEPRECATION")
            notification.setPriority(Notification.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_SOUND or Notification.DEFAULT_VIBRATE)
        }
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(number.toInt(), notification.build())
    }

    /** Synthetic server test: proves backend -> FCM -> phone without any invoice. */
    fun showTestNotification(context: Context) {
        record(context, "lastPushReceivedAt", System.currentTimeMillis().toString())
        record(context, "lastTestPushAt", System.currentTimeMillis().toString())
        if (!permissionGranted(context)) return
        createChannel(context)
        val open = PendingIntent.getActivity(context, TEST_NOTIFICATION_ID,
            Intent(context, NativeMainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = builder(context).setSmallIcon(R.drawable.ic_satori_bell)
            .setContentTitle("Minh Satori · Thử thông báo đẩy")
            .setContentText("Máy chủ → Firebase → điện thoại hoạt động bình thường")
            .setAutoCancel(true)
            .setContentIntent(open)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion(context))
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(TEST_NOTIFICATION_ID, notification.build())
    }

    private fun ago(value: String?): String {
        val at = value?.toLongOrNull() ?: return "Chưa có"
        val minutes = (System.currentTimeMillis() - at) / 60_000L
        return when {
            minutes < 1 -> "Vừa xong"
            minutes < 60 -> "$minutes phút trước"
            minutes < 1440 -> "${minutes / 60} giờ trước"
            else -> "${minutes / 1440} ngày trước"
        }
    }

    /** Local diagnostic lines. Never includes full token, cookie or secret. */
    fun localDiagnostics(context: Context): List<Pair<String, String>> {
        val prefs = state(context)
        val code = prefs.getString("lastRegistrationCode", null)
        val cookie = V2RegistrationAlerts.cookie()
        return listOf(
            "Firebase" to if (configured()) "Configured (" + BuildConfig.SATORI_FCM_PROJECT_ID + ")"
                else "Missing — APK chưa có SATORI_FCM_APP_ID / API_KEY / PROJECT_ID",
            "Bật báo đơn (chuông)" to if (enabled(context)) "On" else "Off",
            "Notification permission" to if (permissionGranted(context)) "Granted" else "Denied",
            "Channel" to if (channelBlocked(context)) "Blocked" else "Enabled",
            "Owner session (cookie)" to if (cookie.contains("satori_v2_session=")) "Có"
                else "Chưa đăng nhập Owner V2",
            "FCM Token" to (if (code == "REGISTERED") "Registered (…" +
                prefs.getString("registeredTokenSuffix", "").orEmpty() + ")"
                else "Failed / chưa đăng ký"),
            "Last registration" to ago(prefs.getString("lastRegistrationAt", null)),
            "Last registration code" to (code ?: "Chưa có"),
            "Last push received" to ago(prefs.getString("lastPushReceivedAt", null))
        )
    }

    private fun JSONObject?.text(key: String, fallback: String): String =
        this?.optString(key)?.takeIf { it.isNotBlank() && it != "null" } ?: fallback

    /** Background thread only. Returns safe server diagnostics or an error code. */
    fun fetchServerStatus(context: Context, cookie: String): List<Pair<String, String>> {
        if (!cookie.contains("satori_v2_session="))
            return listOf("Owner session" to "Expired / chưa đăng nhập")
        return try {
            val c = connection(STATUS_PATH + "?deviceId=" + deviceId(context), "GET", cookie, null)
            try {
                val (status, body) = readResult(c)
                if (status == 401) return listOf("Owner session" to "Expired")
                if (status != 200 || body == null)
                    return listOf("Server Push" to "Lỗi " + safeError(status, body))
                val device = body.optJSONObject("device")
                val relay = body.optJSONObject("relay")
                listOf(
                    "Owner session" to "Valid",
                    "Server Push" to if (body.optBoolean("serverPushEnabled")) "Enabled"
                        else "Disabled (" + body.optString("serverReason") + ")",
                    "Server device" to when {
                        device == null -> "—"
                        !device.optBoolean("registered") -> "Chưa đăng ký"
                        !device.optBoolean("enabled", true) ->
                            "Bị vô hiệu (" + device.optString("lastErrorCode") + ")"
                        !device.optBoolean("currentSession", true) -> "Đăng ký bằng phiên cũ"
                        else -> "Registered (…" + device.optString("tokenSuffix") + ")"
                    },
                    "Server last delivery" to device.text("lastDeliveredAt", "Chưa có"),
                    "Server last delivery error" to device.text("lastDeliveryError", "Không"),
                    "Relay last scan" to relay.text("lastScanAt", "Chưa chạy"),
                    "Relay scan error" to relay.text("lastScanError", "Không")
                )
            } finally { c.disconnect() }
        } catch (_: Exception) {
            listOf("Server Push" to "NETWORK_ERROR")
        }
    }

    /** Background thread only. Asks the server to send a synthetic test push. */
    fun requestServerTest(context: Context, cookie: String): String {
        val csrf = csrfFrom(cookie) ?: return "OWNER_SESSION_MISSING"
        return try {
            val c = connection(TEST_PATH, "POST", cookie, csrf)
            try {
                c.outputStream.use {
                    it.write(JSONObject().put("deviceId", deviceId(context)).toString()
                        .toByteArray(Charsets.UTF_8))
                }
                val (status, body) = readResult(c)
                when {
                    status == 200 && body?.optBoolean("accepted") == true -> "FCM_ACCEPTED"
                    status == 200 -> body.text("errorCode", "FCM_REJECTED")
                        .takeIf { it.matches(Regex("[A-Z0-9_]{3,60}")) } ?: "FCM_REJECTED"
                    else -> safeError(status, body)
                }
            } finally { c.disconnect() }
        } catch (_: Exception) { "NETWORK_ERROR" }
    }
}

/** Re-registers a rotated FCM token once a network is available. */
class SatoriPushRegistrationJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        SatoriPush.registerOwnerDevice(applicationContext, force = true) { code ->
            jobFinished(params, code == "NETWORK_ERROR")
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean = true
}

class SatoriFirebaseMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        // A push is a pointer, NEVER a trusted invoice write or accounting event.
        // Server sends only a canonical numeric invoice ID after confirmation.
        if (message.data["type"] == "owner_push_test") {
            SatoriPush.showTestNotification(applicationContext)
            return
        }
        if (message.data["type"] != "verified_new_invoice") return
        SatoriPush.showVerifiedInvoice(applicationContext, message.data["invoiceNo"].orEmpty())
    }
    override fun onNewToken(token: String) {
        // Never store or log the raw token here; the registration job fetches
        // the current token and sends it with the authenticated Owner session.
        SatoriPush.onTokenRefreshed(applicationContext)
    }
}
