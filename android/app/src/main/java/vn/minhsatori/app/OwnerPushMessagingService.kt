package vn.minhsatori.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Data-only push. Never displays customer identity, totals, addresses or credentials. */
class OwnerPushMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // A token alone is NEVER owner authorization. Bind only after a fresh
        // owner-authenticated /api/v2/admin/notifications response.
        OwnerPushRegistration.tokenRotated(applicationContext)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        if (!OwnerPushConfig.configured || message.data.isEmpty()) return
        val data = message.data
        val kind = data["type"] ?: return
        val eventId = data["eventId"] ?: return
        val invoiceNumber = data["invoiceNo"]?.toLongOrNull()
        if (!OwnerPushPolicy.valid(kind, eventId, invoiceNumber)) return
        val prefs = getSharedPreferences("satori_owner_fcm", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("owner_armed", false)) return
        // Reuse the existing explicit owner notification opt-in.
        val nativePrefs = getSharedPreferences("NativeMainActivity", Context.MODE_PRIVATE)
        if (!nativePrefs.getBoolean("satori_live_notifications", false)) return
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (!manager.areNotificationsEnabled()) return
        val channel = if (kind == "official_invoice_created")
            "satori_fcm_invoices" else "satori_fcm_registrations"
        manager.createNotificationChannel(NotificationChannel(channel,
            if (kind == "official_invoice_created") "Minh Satori · Đơn hàng mới"
            else "Minh Satori · Đăng ký mới",
            NotificationManager.IMPORTANCE_HIGH))
        if (manager.getNotificationChannel(channel)?.importance ==
            NotificationManager.IMPORTANCE_NONE) return
        synchronized(OwnerPushPolicy) {
            val seen = prefs.getStringSet("posted_event_ids", emptySet())?.toSet().orEmpty()
            if (eventId in seen) return
            val invoice = kind == "official_invoice_created"
            val intent = if (invoice) Intent(this, NativeMainActivity::class.java).apply {
                action = "vn.minhsatori.app.OPEN_NEW_INVOICE"
                putExtra("invoice_no", invoiceNumber!!)
            } else Intent(this, V2OwnerCrmActivity::class.java)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            val pending = PendingIntent.getActivity(this, eventId.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val notification = Notification.Builder(this, channel)
                .setSmallIcon(R.drawable.ic_satori_bell)
                .setContentTitle(if (invoice) "Minh Satori · Có đơn hàng mới"
                                 else "Minh Satori · Có khách đăng ký mới")
                .setContentText(if (invoice) "Mở ứng dụng để xem hóa đơn đã xác minh."
                                else "Mở quản trị để kiểm tra đăng ký.")
                .setContentIntent(pending)
                .setCategory(Notification.CATEGORY_STATUS)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setAutoCancel(true).build()
            try {
                manager.notify(eventId.hashCode(), notification)
                if (!invoice) {
                    // The existing V2 foreground registration poll uses
                    // SHA-256(account UUID) hashes. A successful FCM OS post
                    // must not create a second registration notification.
                    val digest = data["registrationDigest"]
                    if (digest != null && digest.matches(Regex("^[a-f0-9]{64}$"))) {
                        val registrationPrefs = getSharedPreferences(
                            "satori_v2_registration_alerts", Context.MODE_PRIVATE)
                        val existing = registrationPrefs.getStringSet("seen_hashes",
                            emptySet())?.toSet().orEmpty()
                        registrationPrefs.edit().putStringSet("seen_hashes",
                            (existing + digest).toList().takeLast(250).toSet()).apply()
                    }
                }
                if (invoice && invoiceNumber != null) {
                    // The foreground canonical-ledger fallback must not post a
                    // second OS notification for this same verified invoice.
                    val existing = nativePrefs.getStringSet("invoice_alert_delivered_v1",
                        emptySet())?.toSet().orEmpty()
                    nativePrefs.edit().putStringSet("invoice_alert_delivered_v1",
                        (existing + invoiceNumber.toString()).toSet()).apply()
                }
                // Persist only opaque delivery IDs, never invoice or customer data.
                prefs.edit().putStringSet("posted_event_ids",
                    (seen + eventId).toList().takeLast(300).toSet()).apply()
            } catch (_: RuntimeException) {
                // Do not acknowledge a rejected OS notification.
            }
        }
    }
}

/** Pure policy; covered by JVM tests without Android/network dependencies. */
object OwnerPushPolicy {
    private val identifier = Regex("^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")
    fun valid(type: String, eventId: String, invoiceNo: Long?): Boolean {
        if (!identifier.matches(eventId)) return false
        return when (type) {
            "official_invoice_created" -> invoiceNo != null && invoiceNo > 0
            "owner_registration_pending" -> invoiceNo == null
            else -> false
        }
    }
}
