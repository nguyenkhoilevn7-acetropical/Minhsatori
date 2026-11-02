package vn.minhsatori.app

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
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
import javax.net.ssl.HttpsURLConnection
import org.json.JSONObject

/** Public Firebase app config is injected at build time, never a server key. */
class SatoriApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        SatoriPush.initialize(this)
    }
}

internal object SatoriPush {
    private const val CHANNEL = "minh_satori_owner_order_push_v1"
    private const val PREFS = "satori_push_dedupe"
    private const val ACTION = "vn.minhsatori.app.OPEN_NEW_INVOICE"
    private const val EXTRA = "invoice_no"
    private const val ENDPOINT =
        "https://minh-satori-v2-customer-admin.onrender.com/api/v2/admin/push/device"

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
            FirebaseMessaging.getInstance().isAutoInitEnabled = false
        } catch (_: RuntimeException) {
            // Never interfere with orders/accounting if Firebase is unavailable.
        }
    }

    private fun enabled(context: Context): Boolean =
        context.getSharedPreferences("NativeMainActivity", Context.MODE_PRIVATE)
            .getBoolean("satori_live_notifications", false)

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(CHANNEL,
            "Minh Satori · Đơn hàng mới tức thời", NotificationManager.IMPORTANCE_HIGH).apply {
            enableVibration(true)
            description = "Thông báo đơn mới đã xác nhận từ máy chủ Minh Satori"
            setShowBadge(true)
            setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,
                android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).build())
        }
        manager.createNotificationChannel(channel)
    }

    fun registerOwnerDevice(context: Context) {
        if (!configured() || !enabled(context)) return
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED) return
        val cookie = V2RegistrationAlerts.cookie()
        if (!cookie.contains("satori_v2_session=") ||
            !cookie.contains("satori_v2_csrf=")) return
        val csrf = cookie.split(';').map { it.trim() }
            .firstOrNull { it.startsWith("satori_v2_csrf=") }
            ?.substringAfter('=')?.takeIf { it.length in 10..200 } ?: return
        try {
            FirebaseMessaging.getInstance().isAutoInitEnabled = true
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                if (token.isNotBlank() && token.length < 4096) {
                    Thread {
                        try { sendRegistration(cookie, csrf, token) }
                        catch (_: Exception) { /* Session renewal retries on app resume */ }
                    }.start()
                }
            }
        } catch (_: IllegalStateException) {
            // Unconfigured/disabled Firebase cannot enable server push.
        }
    }

    private fun sendRegistration(cookie: String, csrf: String, token: String) {
        val connection = (URL(ENDPOINT).openConnection() as HttpsURLConnection).apply {
            connectTimeout = 7000
            readTimeout = 7000
            instanceFollowRedirects = false
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Origin", V2RegistrationAlerts.ORIGIN)
            setRequestProperty("X-Satori-CSRF", csrf)
            setRequestProperty("Cookie", cookie)
        }
        try {
            val bytes = JSONObject().put("token", token)
                .put("platform", "android")
                .toString().toByteArray(Charsets.UTF_8)
            connection.outputStream.use { it.write(bytes) }
            // Do not log cookies, tokens, the response body or customer data.
            connection.responseCode
        } finally { connection.disconnect() }
    }

    fun showVerifiedInvoice(context: Context, numberText: String) {
        if (!enabled(context) || !configured()) return
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED) return
        val number = numberText.toLongOrNull()?.takeIf { it in 1L..999_999_999L } ?: return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val seen = prefs.getStringSet("seen", emptySet()).orEmpty()
        if (number.toString() in seen) return
        prefs.edit().putStringSet("seen", (seen + number.toString())
            .sortedByDescending { it.toLongOrNull() ?: 0L }.take(100).toSet()).apply()
        createChannel(context)
        val open = Intent(context, NativeMainActivity::class.java).apply {
            action = ACTION
            putExtra(EXTRA, number)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val pending = PendingIntent.getActivity(context, number.toInt(), open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = if (Build.VERSION.SDK_INT >= 26)
            Notification.Builder(context, CHANNEL)
        else Notification.Builder(context)
        builder.setSmallIcon(R.drawable.ic_satori_bell)
            .setContentTitle("Minh Satori · Đơn hàng mới #" + number)
            .setContentText("Chạm để mở hóa đơn đã xác nhận")
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setCategory(Notification.CATEGORY_STATUS)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
        if (Build.VERSION.SDK_INT < 26) {
            @Suppress("DEPRECATION")
            builder.setPriority(Notification.PRIORITY_HIGH)
        }
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(number.toInt(), builder.build())
    }
}

class SatoriFirebaseMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        // A push is a pointer, NEVER a trusted invoice write or accounting event.
        // Server sends only a canonical numeric invoice ID after confirmation.
        if (message.data["type"] != "verified_new_invoice") return
        SatoriPush.showVerifiedInvoice(applicationContext, message.data["invoiceNo"].orEmpty())
    }
    override fun onNewToken(token: String) {
        // Registration requires a currently authenticated Owner V2 session.
        // NativeMainActivity.onResume re-reads current token after login.
    }
}
