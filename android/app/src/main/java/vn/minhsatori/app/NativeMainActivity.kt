package vn.minhsatori.app

import android.app.Activity
import android.app.Notification
import android.app.PendingIntent
import android.app.NotificationChannel
import android.app.NotificationManager
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.content.Intent
import android.view.animation.DecelerateInterpolator
import android.animation.ValueAnimator
import android.content.res.Configuration
import android.net.Uri
import java.io.ByteArrayOutputStream
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ArrayAdapter
import android.widget.Spinner
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.provider.OpenableColumns
import java.text.DateFormat
import java.util.Date
import org.json.JSONObject
import java.util.UUID
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope

/**
 * Actual native Android invoice application, not a PWA and not a Chrome launcher.
 * All invoice data is loaded using a short-lived Google Drive read-only token.
 * NO write operation is offered until a secure owner-scoped GAS API deployment
 * is configured and tested against a sandbox. No raw token or invoice stored.
 */
class NativeMainActivity : AppCompatActivity() {
    private val teal get() = SatoriUiTheme.accent(this)
    private val dark = Color.rgb(16, 43, 56)
    private val muted = Color.rgb(102, 121, 130)
    private val pale = Color.rgb(241, 244, 245)
    private val gold = Color.rgb(175, 94, 0)
    private val white = Color.WHITE
    private var dashboardMode = false
    private val ink = Color.rgb(16, 43, 56)
    private val softInk = Color.rgb(102, 121, 130)
    private val cyan get() = SatoriUiTheme.accent(this)
    private val night = Color.rgb(241, 244, 245)
    private val surface = Color.rgb(255, 255, 255)
    private val indigo = Color.rgb(229, 248, 242)
    private var activeTab = 0
    private var activeInvoiceDialog: AlertDialog? = null
    private var showAdvancedOverview = false
    private var accessToken: String? = null
    private var snapshot: SatoriSnapshot? = null
    // Owner-only, in-memory read bridge. Never persist tokens or CTV policies.
    private var ctvBridgeRevision: Long? = null
    private var ctvBridgeToken: String? = null
    private var ctvBridgeSnapshot: SatoriSnapshot? = null
    private var statusMessage = "Chưa liên kết dữ liệu Google Drive. Bấm KẾT NỐI DỮ LIỆU để bắt đầu."
    private var searchText = ""
    private var selectedInvoiceStatusIndex = 0
    // UI-only filters: no ledger mutation and no new data permissions.
    private var debtProfitPeriod = AccountingProMargin45Period.all()
    private var debtProfitChoice = 0
    private var homeProfitPeriod = AccountingProMargin45Period.all()
    private var homeProfitChoice = 0
    // Export data is captured at tap time; never persist customer records locally.
    private var pendingExcelExport: Pair<SatoriSnapshot, List<SatoriInvoice>>? = null
    private var isLoading = false
    private var fileUri: Uri? = null
    private var dataSource = ""
    private var lastReadAt = ""
    private var previousScrollView: ScrollView? = null
    private var previousRenderedTab = -1
    private var apiEndpoint: String? = null
    private var allowedActions: Set<String> = emptySet()
    private var actorId = ""
    private lateinit var pendingStore: PendingWriteStore
    private var pendingWrite: PendingMobileWrite? = null
    private var pendingStorageError = false
    // Owner opt-in: Google read-only access replaces repeated manual Drive file selection.
    // Poll only while the app is foregrounded, and only after successful authorization.
    private val syncHandler = Handler(Looper.getMainLooper())
    // Probe change metadata every 20 seconds; reconcile full ledger every minute.
    // Full reconciliation covers delayed or missed version notifications.
    private val syncIntervalMs = 20_000L
    private val fallbackReadMs = 60_000L
    private var lastDriveVersion: Long? = null
    private var lastVersionProbeElapsedMs = 0L
    private var isCheckingVersion = false
    private var isCheckingMobileRevision = false
    private var lastMobileRevisionProbeElapsedMs = 0L
    private var lastOnlineReadElapsedMs = 0L
    private var lastSyncAttemptElapsedMs = 0L
    private var authorizationPending = false
    private var authorizationDeclined = false
    private var foreground = false
    private var lastOAuthRecoveryAt = 0L
    private val oauthRetryBackoffMs = 300_000L
    private val newOrderChannelId = "minh_satori_live_orders"
    private val newOrderNotificationId = 52001
    private val newInvoiceTapAction = "vn.minhsatori.app.OPEN_NEW_INVOICE"
    private val newInvoiceTapExtra = "invoice_no"
    private var pendingNotificationInvoiceNo: Long? = null

    /** Notification opens may carry an invoice number but never private ledger content. */
    private fun queueInvoiceFromNotification(source: Intent?) {
        if (source?.action != newInvoiceTapAction) return
        val no = source.getLongExtra(newInvoiceTapExtra, -1L)
        if (no > 0L) {
            pendingNotificationInvoiceNo = no
            activeTab = 1
        }
    }

    /** A cold start defers navigation until the canonical invoice snapshot is loaded. */
    private fun openPendingNotificationInvoiceIfReady() {
        val no = pendingNotificationInvoiceNo ?: return
        if (activeInvoiceDialog?.isShowing == true) return
        val invoice = snapshot?.invoices?.firstOrNull { it.number.toLongOrNull() == no }
            ?: return
        pendingNotificationInvoiceNo = null
        previousScrollView?.post {
            if (!isFinishing && !isDestroyed && activeTab == 1 &&
                activeInvoiceDialog?.isShowing != true) openInvoice(invoice)
        }
    }
    // Persist only invoice sequence IDs, never customer information or order contents.
    private var invoiceBadgeState = InvoiceBadgeState()
    private var invoiceBadgeLoaded = false
    private fun currentInvoiceBadge(): InvoiceBadgeState {
        if (!invoiceBadgeLoaded) {
            val prefs = getPreferences(MODE_PRIVATE)
            val rawHigh = prefs.getLong("invoice_badge_high_water_v1", -1L)
            val ids = prefs.getStringSet("invoice_badge_unread_v1", emptySet())
                .orEmpty().mapNotNull { it.toLongOrNull()?.takeIf { no -> no > 0 } }.toSet()
            invoiceBadgeState = InvoiceBadgeState(rawHigh.takeIf { it >= 0L }, ids)
            invoiceBadgeLoaded = true
        }
        return invoiceBadgeState
    }

    private fun saveInvoiceBadge(state: InvoiceBadgeState) {
        invoiceBadgeState = state
        getPreferences(MODE_PRIVATE).edit()
            .putLong("invoice_badge_high_water_v1", state.highWater ?: -1L)
            .putStringSet("invoice_badge_unread_v1", state.unread.map { it.toString() }.toSet())
            .apply()
    }

    private fun acknowledgeInvoiceBadge() {
        val current = currentInvoiceBadge()
        if (current.count > 0) saveInvoiceBadge(InvoiceBadgePolicy.acknowledgeAll(current))
    }

    /** Reading one invoice clears only its own unread marker, not other new orders. */
    private fun acknowledgeInvoiceBadge(number: Long) {
        val current = currentInvoiceBadge()
        if (number in current.unread) {
            val next = InvoiceBadgePolicy.acknowledgeOne(current, number)
            saveInvoiceBadge(next)
            if (next.count == 0)
                (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
                    .cancel(newOrderNotificationId)
        }
    }

    private fun badgePill(count: Int): TextView = TextView(this).apply {
        text = if (count > 99) "99+" else count.toString()
        textSize = 10f
        setTextColor(Color.WHITE)
        setTypeface(typeface, Typeface.BOLD)
        gravity = Gravity.CENTER
        includeFontPadding = false
        minWidth = dp(18)
        minHeight = dp(18)
        setPadding(dp(3), 0, dp(3), 0)
        background = panelBackground(Color.rgb(213, 40, 50), 15)
        contentDescription = "$count hóa đơn mới chưa xem"
    }

    // Separate from accounting: V2 new customer alerts require ONLY a verified
    // owner WebView session; never borrow a Google Drive OAuth scope.
    private val v2AlertHandler=Handler(Looper.getMainLooper())
    private val v2AlertExecutor=java.util.concurrent.Executors.newSingleThreadExecutor()
    private var v2SignupBadge:TextView?=null
    private val v2AlertTick=object:Runnable{
        override fun run(){
            if(!foreground)return
            val cookie=V2RegistrationAlerts.cookie()
            if(cookie.contains("satori_v2_session=")){
                try{
                    v2AlertExecutor.execute{
                        try{
                            val feed=V2RegistrationAlerts.fetch(cookie)
                            if(feed!=null){
                                val count=V2RegistrationAlerts.process(applicationContext,feed)
                                runOnUiThread{
                                    if(!isFinishing&&!isDestroyed)updateNativeV2Badge(count)
                                }
                            }
                        }catch(_:Exception){}
                    }
                }catch(_:java.util.concurrent.RejectedExecutionException){}
            }
            v2AlertHandler.postDelayed(this,25_000L)
        }
    }
    private fun updateNativeV2Badge(count:Int){
        v2SignupBadge?.apply{
            visibility=if(count>0)View.VISIBLE else View.GONE
            text=if(count>99)"99+" else count.toString()
            contentDescription="$count khách mới đang chờ duyệt"
        }
    }
    // Never persist OAuth tokens. Re-authorize silently through Google when
    // resuming; show a consent dialog only when Android actually requires it.
    private val syncTick = object : Runnable {
        override fun run() {
            if (!foreground) return
            if (!isLoading && !authorizationPending && !authorizationDeclined) {
                if (preferredSource() == AutoSyncPolicy.DRIVE && snapshot != null &&
                    accessToken != null) {
                    if (AutoSyncPolicy.due(lastVersionProbeElapsedMs,
                            SystemClock.elapsedRealtime(), syncIntervalMs)) checkDriveVersion()
                } else if (preferredSource() == AutoSyncPolicy.MOBILE_API &&
                    dataSource == "Minh Satori API" &&
                    allowedActions.contains("mobile.revision") && accessToken != null) {
                    if (AutoSyncPolicy.due(lastMobileRevisionProbeElapsedMs,
                            SystemClock.elapsedRealtime(), syncIntervalMs))
                        checkMobileRevision()
                } else if (AutoSyncPolicy.due(lastSyncAttemptElapsedMs,
                        SystemClock.elapsedRealtime(), fallbackReadMs)) {
                    syncPreferredSource()
                }
            }
            syncHandler.postDelayed(this, syncIntervalMs)
        }
    }
    /**
     * Google's AuthorizationClient can return a cached token that the
     * server-side tokeninfo endpoint has already rejected. Clear ONLY that
     * access token's cache entry; never revoke the owner's scopes or persist
     * credentials. Throttle re-authorization to avoid endless OAuth loops.
     */
    private fun recoverRejectedOAuthToken(token: String) {
        if (token.isBlank() || accessToken != token) return
        val now = SystemClock.elapsedRealtime()
        if (lastOAuthRecoveryAt > 0L && now - lastOAuthRecoveryAt < oauthRetryBackoffMs) {
            statusMessage = "⚠ Google tiếp tục từ chối token. " +
                "Kiểm tra OAuth client ID và chứng chỉ ký APK; chưa bật ghi đơn."
            return
        }
        lastOAuthRecoveryAt = now
        accessToken = null
        actorId = ""
        allowedActions = emptySet()
        statusMessage = "Đang xin token Google mới; giữ nguyên dữ liệu đã đồng bộ."
        Identity.getAuthorizationClient(this)
            .clearToken(ClearTokenRequest.builder().setToken(token).build())
            .addOnCompleteListener {
                if (foreground && !authorizationPending) connectGoogle(automatic = true)
            }
    }

    private fun notifyVerifiedNewInvoices(prior: SatoriSnapshot?, latest: SatoriSnapshot) {
        // Always process a verified ledger, including after app restart. First
        // sync establishes a quiet baseline; only a higher canonical invoice
        // number can become new, regardless of payment/status edits.
        if (prior != null && latest.revision < prior.revision) return
        val entries = latest.invoices.mapNotNull { invoice ->
            invoice.number.toLongOrNull()?.takeIf { it > 0 }?.let {
                InvoiceBadgeEntry(it, !invoice.isExcluded)
            }
        }
        val update = InvoiceBadgePolicy.reconcile(currentInvoiceBadge(), entries)
        saveInvoiceBadge(update.state)
        if (update.fresh.isEmpty()) return
        statusMessage = "🔔 Có " + update.state.count +
            " hóa đơn mới chưa xem • dữ liệu thật Rev " + latest.revision
        // In-app badge is ALWAYS visible, even if Android 13 notification
        // permission is denied or the owner disabled audible notifications.
        Toast.makeText(this, "🔔 " + update.fresh.size +
            " hóa đơn mới đã được ghi vào sổ Minh Satori", Toast.LENGTH_LONG).show()
        if (!getPreferences(MODE_PRIVATE).getBoolean("satori_live_notifications", false)) return
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED) return
        val notifications = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26)
            notifications.createNotificationChannel(NotificationChannel(newOrderChannelId,
                "Đơn hàng thật Minh Satori", NotificationManager.IMPORTANCE_HIGH))
        val newestNo = update.fresh.maxOrNull() ?: return
        // One OS notification per invoice: if FCM already alerted for every
        // fresh invoice, re-sync must not alert again (and vice versa).
        val notYetAlerted = update.fresh.filter { SatoriPush.markNotified(this, it) }
        if (notYetAlerted.isEmpty()) return
        val invoice = latest.invoices.firstOrNull {
            it.number.toLongOrNull() == newestNo
        } ?: return
        val destination = Intent(this, NativeMainActivity::class.java)
            .setAction(newInvoiceTapAction)
            .putExtra(newInvoiceTapExtra, newestNo)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val openInvoiceIntent = PendingIntent.getActivity(this, newOrderNotificationId,
            destination, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        @Suppress("DEPRECATION")
        val notification = if (Build.VERSION.SDK_INT >= 26)
            Notification.Builder(this, newOrderChannelId)
        else Notification.Builder(this)
        notification.setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Minh Satori • " + update.state.count + " hóa đơn chưa xem")
            .setContentText("Mới nhất #" + invoice.number + " • " +
                SatoriData.money(invoice.total))
            .setContentIntent(openInvoiceIntent)
            .setAutoCancel(true)
            // Amounts are hidden on the lock screen; only a generic line shows.
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion((if (Build.VERSION.SDK_INT >= 26)
                Notification.Builder(this, newOrderChannelId)
                else @Suppress("DEPRECATION") Notification.Builder(this))
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Minh Satori")
                .setContentText("Có đơn hàng mới · mở khóa để xem").build())
        notifications.notify(newOrderNotificationId, notification.build())
    }

    private fun hasServerAction(action: String): Boolean =
        apiEndpoint != null && accessToken != null &&
            actorId.isNotBlank() && dataSource == "Minh Satori API" && allowedActions.contains(action)
    private fun canAction(action: String): Boolean = hasServerAction(action) &&
        (action !in PendingMobileWrite.ACTIONS || (pendingWrite == null && !pendingStorageError))
    private val canWrite: Boolean get() = canAction("orders.create")

    private val filePicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) {
            if (snapshot == null) statusMessage = "Chưa chọn file. Bấm KẾT NỐI DỮ LIỆU rồi chọn MinhSatori_Live_Data.json trong Google Drive."
            render()
        } else {
            try {
                contentResolver.takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (_: SecurityException) {
                // Some providers grant only a session-scoped read URI.
            }
            fileUri = uri
            getPreferences(MODE_PRIVATE).edit()
                .putString("drive_file_uri", uri.toString())
                .putString("satori_source_mode", "file")
                .putBoolean("google_drive_auto_read", false).apply()
            refreshFromPicker()
        }
    }

    // Open a supplier XLSX/CSV statement strictly for local, read-only analysis.
    // Never upload statement bytes, persist a copy or mutate a Drive invoice.
    private val saveExcelPicker = registerForActivityResult(
        ActivityResultContracts.CreateDocument(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    ) { uri ->
        val pending = pendingExcelExport
        pendingExcelExport = null
        if (uri != null && pending != null) {
            Thread {
                try {
                    val stream = contentResolver.openOutputStream(uri, "w")
                        ?: throw java.io.IOException("Không tạo được file Excel.")
                    stream.use { OwnerExcelExport.write(pending.first, pending.second, it) }
                    runOnUiThread {
                        Toast.makeText(this, "Đã lưu Excel 4 sheet • " +
                            pending.second.size + " hóa đơn", Toast.LENGTH_LONG).show()
                    }
                } catch (e: Exception) {
                    runOnUiThread {
                        AlertDialog.Builder(this).setTitle("Không xuất được Excel")
                            .setMessage(e.message ?: "Không ghi được file.")
                            .setPositiveButton("Đóng", null).show()
                    }
                }
            }.start()
        }
    }

    private val supplierStatementPicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) {
            val source = snapshot
            if (source == null) {
                Toast.makeText(this, "Cần đọc dữ liệu hóa đơn trước.", Toast.LENGTH_LONG).show()
            } else {
                val fileName = try {
                    contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME),
                        null, null, null)?.use { cursor ->
                        if (cursor.moveToFirst()) cursor.getString(0) else null
                    }
                } catch (_: Exception) { null } ?: "satori.xlsx"
                Toast.makeText(this, "Đang đối chiếu bảng kê chỉ xem…", Toast.LENGTH_SHORT).show()
                Thread {
                    try {
                        val input = contentResolver.openInputStream(uri)
                            ?: throw IllegalArgumentException("Không đọc được bảng kê.")
                        val bytes = input.use { stream ->
                            val out = ByteArrayOutputStream()
                            val buffer = ByteArray(8192)
                            while (true) {
                                val count = stream.read(buffer)
                                if (count < 0) break
                                if (out.size() + count > 8 * 1024 * 1024)
                                    throw IllegalArgumentException("Bảng kê vượt 8 MB.")
                                out.write(buffer, 0, count)
                            }
                            out.toByteArray()
                        }
                        val sheet = SatoriSupplierSpreadsheet.open(fileName, bytes)
                        val rows = SatoriSupplierReconciliation.parse(sheet)
                        val report = SatoriSupplierReconciliation.compare(rows, source)
                        runOnUiThread { showSupplierStatementReport(fileName, source.revision, report) }
                    } catch (e: Exception) {
                        runOnUiThread {
                            AlertDialog.Builder(this)
                                .setTitle("KHÔNG ĐỌC ĐƯỢC BẢNG KÊ")
                                .setMessage(e.message ?: "File không đúng định dạng XLSX/CSV.")
                                .setPositiveButton("Đóng", null).show()
                        }
                    }
                }.start()
            }
        }
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult()
    ) { result ->
        authorizationPending = false
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            try {
                applyAuthorization(Identity.getAuthorizationClient(this)
                    .getAuthorizationResultFromIntent(result.data!!))
            } catch (_: Exception) {
                statusMessage = "Không hoàn tất cấp quyền Google. Có thể thử lại trong Cài đặt."
                authorizationDeclined = true
                render()
            }
        } else {
            authorizationDeclined = true
            statusMessage = "Anh chưa cấp quyền Google; chạm biểu tượng Cài đặt để kết nối lần đầu."
            render()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        queueInvoiceFromNotification(intent)
        pendingStore = PendingWriteStore(this)
        runCatching { pendingStore.load() }.fold(
            onSuccess = { pendingWrite = it },
            onFailure = {
                pendingStorageError = true
                statusMessage = "Không mở được thao tác đang chờ. Đã khóa ghi để tránh mất hoặc trùng đơn."
            }
        )
        fileUri = getPreferences(MODE_PRIVATE).getString("drive_file_uri", null)?.let {
            Uri.parse(it)
        }
        apiEndpoint = MobileApiClient.endpoint(this)
        // No manual "Đồng bộ Mobile API" step on each new app process.
        // On first installation, choose authenticated LIVE Drive read.
        // Never silently treat an old SANDBOX API as the production source.
        val preferred = preferredSource()
        val prefs = getPreferences(MODE_PRIVATE)
        // One-time migration from a document-picker snapshot to the actual
        // live Drive ledger. Document providers may hand back stale local copies.
        // Explicitly selecting a file again remains possible in Settings.
        if (!prefs.getBoolean("live_sync_source_migrated_v043", false)) {
            val editor = prefs.edit().putBoolean("live_sync_source_migrated_v043", true)
            if (preferred == AutoSyncPolicy.FILE) {
                editor.putString("satori_source_mode", AutoSyncPolicy.DRIVE)
                    .putBoolean("google_drive_auto_read", true)
                statusMessage = "Đang chuyển từ file tĩnh sang Google Drive live để tự nhận thay đổi từ web."
            }
            editor.apply()
        }
        if (preferredSource() == AutoSyncPolicy.DRIVE) {
            getPreferences(MODE_PRIVATE).edit()
                .putString("satori_source_mode", AutoSyncPolicy.DRIVE)
                .putBoolean("google_drive_auto_read", true).apply()
        }
        render()
        syncPreferredSource()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action != newInvoiceTapAction) return
        queueInvoiceFromNotification(intent)
        if (pendingNotificationInvoiceNo != null) {
            activeInvoiceDialog?.dismiss()
            render()
        }
    }

    override fun onResume() {
        super.onResume()
        foreground = true
        SatoriPush.registerOwnerDevice(this)
        syncHandler.removeCallbacks(syncTick)
        syncHandler.postDelayed(syncTick, syncIntervalMs)
        v2AlertHandler.removeCallbacks(v2AlertTick)
        v2AlertHandler.post(v2AlertTick)
        // Resume promptly checks orders written while another app was open.
        if (!isLoading && !authorizationPending && !authorizationDeclined) {
            if (preferredSource() == AutoSyncPolicy.DRIVE && snapshot != null &&
                accessToken != null) {
                // Reopening after a long pause must reconcile the full ledger,
                // even when Drive file.version was cached or delayed.
                if (AutoSyncPolicy.due(lastOnlineReadElapsedMs,
                        SystemClock.elapsedRealtime(), fallbackReadMs)) refreshFromDrive()
                else checkDriveVersion()
            } else if (preferredSource() == AutoSyncPolicy.MOBILE_API &&
                dataSource == "Minh Satori API" &&
                allowedActions.contains("mobile.revision") && accessToken != null) {
                if (AutoSyncPolicy.due(lastOnlineReadElapsedMs,
                        SystemClock.elapsedRealtime(), fallbackReadMs)) refreshFromMobileApi()
                else checkMobileRevision()
            }
            else if (AutoSyncPolicy.due(lastSyncAttemptElapsedMs,
                    SystemClock.elapsedRealtime(), fallbackReadMs)) syncPreferredSource()
        }
    }

    /**
     * Owner-facing push diagnostics. Shows safe states only: never the full FCM
     * token, cookies or secrets. "Gửi thử" asks the server for a synthetic push
     * (no invoice) to prove server -> Firebase -> this phone end to end.
     */
    private fun showPushDiagnostics() {
        fun format(lines: List<Pair<String, String>>) =
            lines.joinToString("\n") { "• " + it.first + ": " + it.second }
        val local = format(SatoriPush.localDiagnostics(this))
        val dialog = AlertDialog.Builder(this)
            .setTitle("Chẩn đoán thông báo đẩy")
            .setMessage(local + "\n\nĐang kiểm tra máy chủ…")
            .setPositiveButton("Gửi thử", null)
            .setNeutralButton("Đăng ký lại", null)
            .setNegativeButton("Đóng", null)
            .show()
        val message = dialog.findViewById<TextView>(android.R.id.message)
        message?.setTextIsSelectable(true)
        fun refresh(note: String? = null) {
            val cookie = V2RegistrationAlerts.cookie()
            val localNow = format(SatoriPush.localDiagnostics(this))
            Thread {
                val server = format(SatoriPush.fetchServerStatus(applicationContext, cookie))
                runOnUiThread {
                    if (dialog.isShowing) dialog.setMessage(localNow + "\n\nMÁY CHỦ\n" + server +
                        (if (note != null) "\n\n" + note else ""))
                }
            }.start()
        }
        refresh()
        dialog.getButton(AlertDialog.BUTTON_NEUTRAL)?.setOnClickListener {
            SatoriPush.registerOwnerDevice(this, force = true) { code ->
                runOnUiThread { refresh("Kết quả đăng ký: " + code) }
            }
        }
        dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.setOnClickListener {
            val cookie = V2RegistrationAlerts.cookie()
            Thread {
                val code = SatoriPush.requestServerTest(applicationContext, cookie)
                runOnUiThread {
                    refresh(if (code == "FCM_ACCEPTED")
                        "Firebase đã nhận tin thử. Thông báo sẽ hiện trên máy trong giây lát."
                        else "Gửi thử thất bại: " + code)
                }
            }.start()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 5201) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
                SatoriPush.registerOwnerDevice(this)
            } else {
                getPreferences(MODE_PRIVATE).edit()
                    .putBoolean("satori_live_notifications", false).apply()
                Toast.makeText(this, "Quyền thông báo bị từ chối. Chưa bật báo đơn.",
                    Toast.LENGTH_LONG).show()
            }
            render()
        }
    }

    override fun onPause() {
        foreground = false
        syncHandler.removeCallbacks(syncTick)
        v2AlertHandler.removeCallbacks(v2AlertTick)
        super.onPause()
    }

    private fun preferGoogleDrive(): Boolean =
        getPreferences(MODE_PRIVATE).getBoolean("google_drive_auto_read", false)

    private fun preferredSource(): String = AutoSyncPolicy.source(
        getPreferences(MODE_PRIVATE).getString("satori_source_mode", null),
        fileUri != null, apiEndpoint != null
    )

    /**
     * Owner-requested emergency refresh: bypass revision polling and timers,
     * fetch the complete current ledger, and reauthorize if the token expired.
     * A previously selected file is not live; switch to authenticated Drive.
     */
    private fun refreshNow() {
        if (isLoading || authorizationPending) {
            Toast.makeText(this, "Đang đồng bộ, vui lòng kiểm tra trạng thái trên màn hình.",
                Toast.LENGTH_SHORT).show()
            return
        }
        authorizationDeclined = false
        if (preferredSource() == AutoSyncPolicy.FILE) {
            getPreferences(MODE_PRIVATE).edit()
                .putString("satori_source_mode", AutoSyncPolicy.DRIVE)
                .putBoolean("google_drive_auto_read", true).apply()
            // An API/email-only token cannot read Drive; obtain Drive scope.
            accessToken = null
            allowedActions = emptySet()
            actorId = ""
            statusMessage = "Đang chuyển sang Google Drive live; file thủ công không tự cập nhật."
        }
        lastSyncAttemptElapsedMs = 0L
        // Manual refresh also retries the approved CTV read when GAS is outdated.
        ctvBridgeRevision = null
        if (accessToken == null) connectGoogle() else syncPreferredSource()
    }

    private fun syncPreferredSource() {
        if (isLoading || authorizationPending || authorizationDeclined) return
        // This works after reopening the app, without storing an access token.
        when (preferredSource()) {
            AutoSyncPolicy.FILE -> refreshFromPicker()
            AutoSyncPolicy.MOBILE_API -> if (accessToken == null) connectGoogle(automatic = true)
                else refreshFromMobileApi()
            else -> if (accessToken == null) connectGoogle(automatic = true)
                else refreshFromDrive()
        }
    }

    override fun onDestroy() {
        syncHandler.removeCallbacks(syncTick)
        v2AlertHandler.removeCallbacks(v2AlertTick)
        v2AlertExecutor.shutdownNow()
        // OAuth tokens/snapshots stay in memory; only the encrypted pending write survives.
        accessToken = null
        snapshot = null
        ctvBridgeToken = null
        ctvBridgeSnapshot = null
        super.onDestroy()
    }

    private fun dp(n: Int): Int = (n * resources.displayMetrics.density + 0.5f).toInt()

    private fun background(color: Int, radius: Int = 13): GradientDrawable =
        GradientDrawable().apply { setColor(color); cornerRadius = dp(radius).toFloat() }

    // Visual-only currency treatment: preserve numeric values and payment status colors.
    private val moneyAmountPattern = Regex("""(?<![\p{L}\d])[-+]?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{1,2})?\s*(?:đ|₫)(?!\p{L})""", RegexOption.IGNORE_CASE)
    private val invoiceMoneyRed = Color.rgb(220, 38, 38)

    private fun highlightMoney(value: CharSequence): CharSequence {
        val content = value.toString()
        if (!content.contains('đ', ignoreCase = true) && !content.contains('₫')) return value
        val matches = moneyAmountPattern.findAll(content).toList()
        if (matches.isEmpty()) return value
        val highlighted = android.text.SpannableStringBuilder(value)
        for (match in matches) {
            highlighted.setSpan(
                android.text.style.ForegroundColorSpan(invoiceMoneyRed),
                match.range.first, match.range.last + 1,
                android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
            )
        }
        return highlighted
    }

    private fun highlightMoneyInView(view: View) {
        when (view) {
            is EditText -> Unit // Don't change editable fields.
            is TextView -> {
                val current = view.text
                if (moneyAmountPattern.matches(current.toString().trim())) {
                    // Full monetary value: set the view's text color, not merely a span.
                    view.setTextColor(invoiceMoneyRed)
                }
                val highlighted = highlightMoney(current)
                if (highlighted !== current) view.text = highlighted
            }
            is android.view.ViewGroup -> {
                for (index in 0 until view.childCount) highlightMoneyInView(view.getChildAt(index))
            }
        }
    }

    private fun label(parent: LinearLayout, content: String, size: Float = 14f,
                      isBold: Boolean = false, color: Int = dark, marginTop: Int = 0): TextView {
        // iOS light grouped palette: labels stay readable across all native screens.
        val actualColor = when (color) {
            white, dark -> ink
            muted -> softInk
            teal -> cyan
            gold -> Color.rgb(175, 94, 0)
            else -> color
        }
        val view = TextView(this).apply {
            textSize = size
            setTextColor(actualColor)
            // Apply red spans AFTER the default text color has been assigned.
            text = highlightMoney(content)
            if (isBold) setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(marginTop), 0, 0)
            includeFontPadding = false
        }
        parent.addView(view)
        return view
    }

    /**
     * Compact numerical values to the actual available card width.
     *
     * A TextView with setSingleLine(true) becomes horizontally scrollable on
     * Android, so the platform auto-size engine measures an effectively
     * infinite width and may clip the trailing digits of VND totals.
     * maxLines=1 WITHOUT horizontal scrolling lets auto-size choose a font
     * that fits the measured card (including compact Samsung/Fold layouts).
     */
    private fun fitCardNumber(view: TextView, maxSp: Int = 21, minSp: Int = 9) {
        require(minSp in 1..maxSp)
        view.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        view.maxLines = 1
        view.setHorizontallyScrolling(false)
        view.ellipsize = null
        view.setAutoSizeTextTypeUniformWithConfiguration(
            minSp, maxSp, 1, android.util.TypedValue.COMPLEX_UNIT_SP
        )
    }

    // V2: shared 2.5D surface strokes; preserve account-selected theme colors.
    private fun panelBackground(color: Int = surface, radius: Int = 20): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radius).toFloat()
            setStroke(dp(1), Color.rgb(216, 234, 229))
        }

    private fun button(parent: LinearLayout, text: String, main: Boolean = false,
                       iconRes: Int = 0, danger: Boolean = false, click: () -> Unit) {
        val b = Button(this).apply {
            this.text = text
            textSize = 12f
            isAllCaps = false
            letterSpacing = 0f
            minHeight = dp(44)
            minimumHeight = dp(44)
            setPadding(dp(9), 0, dp(9), 0)
            stateListAnimator = null
            setTypeface(typeface, Typeface.BOLD)
            val accent = if (main) SatoriUiTheme.onAccent(this@NativeMainActivity) else if (danger) Color.rgb(207, 46, 46) else cyan
            setTextColor(accent)
            if (iconRes != 0) {
                val symbol = androidx.core.content.ContextCompat.getDrawable(
                    this@NativeMainActivity, iconRes)?.mutate()
                symbol?.setTint(accent)
                symbol?.setBounds(0, 0, dp(17), dp(17))
                setCompoundDrawablesRelative(symbol, null, null, null)
                compoundDrawablePadding = dp(9)
                gravity = Gravity.CENTER
            }
            background = if (main) {
                GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                    intArrayOf(SatoriUiTheme.deep(this@NativeMainActivity), teal)).apply {
                    cornerRadius = dp(16).toFloat()
                }
            } else panelBackground(if (danger) Color.rgb(255, 243, 243)
                else SatoriUiTheme.soft(this@NativeMainActivity), 14)
            setOnClickListener { click() }
            elevation = if (SatoriUiTheme.raised(this@NativeMainActivity)) dp(3).toFloat() else 0f
        }
        parent.addView(b, LinearLayout.LayoutParams(-1, dp(44)).apply {
            topMargin = dp(6)
        })
    }

    private fun section(parent: LinearLayout, title: String, detail: String,
                        click: (() -> Unit)? = null) {
        val frame = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(15), dp(13), dp(15), dp(13))
            background = panelBackground()
            clipToOutline = true
            if (click != null) {
                isClickable = true
                isFocusable = true
                setOnClickListener { click() }
            }
        }
        label(frame, title, 13.5f, true, white)
        label(frame, detail, 11.5f, false, softInk, 4)
        frame.elevation = if (SatoriUiTheme.raised(this)) dp(4).toFloat() else 0f
        parent.addView(frame, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(6)
        })
    }

    private fun metricTile(parent: LinearLayout, title: String, value: String,
                           accent: Int = cyan) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(15), dp(15), dp(15))
            background = panelBackground(when (accent) {
                Color.rgb(16, 122, 78), Color.rgb(17, 133, 91) -> Color.rgb(227, 247, 238)
                gold -> Color.rgb(255, 246, 223)
                else -> SatoriUiTheme.soft(this@NativeMainActivity)
            })
            clipToOutline = true
        }
        label(box, title, 11.5f, false, muted)
        fitCardNumber(label(box, value, 18f, true, accent, 7), maxSp = 18)
        box.elevation = if (SatoriUiTheme.raised(this)) dp(4).toFloat() else 0f
        parent.addView(box, LinearLayout.LayoutParams(0, -2, 1f).apply {
            marginEnd = dp(5)
        })
    }

    private fun showConnectionSettings() {
        // AlertDialog shows either setMessage OR the setItems list, not both.
        // Keep the actual source choices visible on compact Samsung displays.
        val items = arrayOf(
            "☁ Google Drive — xem hóa đơn thật (chỉ đọc)",
            "Đăng nhập Google / Đồng bộ Mobile API",
            "Cấu hình Mobile API quản lý hóa đơn",
            "Chọn file dữ liệu thủ công — chỉ xem"
        )
        AlertDialog.Builder(this)
            .setTitle("Kết nối Minh Satori")
            .setItems(items) { _, choice ->
                when (choice) {
                    0 -> {
                        // Explicitly leave the 3-fake-invoice API snapshot behind.
                        // OAuth must request Drive read scope even when a sandbox
                        // Mobile API endpoint is already stored on the device.
                        getPreferences(MODE_PRIVATE).edit()
                            .putBoolean("google_drive_auto_read", true)
                            .putString("satori_source_mode", "drive").apply()
                        accessToken = null
                        actorId = ""
                        allowedActions = emptySet()
                        snapshot = null
                        dataSource = ""
                        // Owner manually selected Drive: offer account chooser
                        // instead of silently reusing an unrelated Google account.
                        connectGoogle(askAccount = true)
                    }
                    1 -> {
                        getPreferences(MODE_PRIVATE).edit()
                            .putBoolean("google_drive_auto_read", false)
                            .putBoolean("mobile_owner_readonly_fallback", false)
                            .putString("satori_source_mode", "api").apply()
                        if (apiEndpoint == null) configureMobileApi()
                        else if (accessToken == null) connectGoogle()
                        else refreshFromMobileApi()
                    }
                    2 -> {
                        getPreferences(MODE_PRIVATE).edit()
                            .putBoolean("google_drive_auto_read", false)
                            .putBoolean("mobile_owner_readonly_fallback", false)
                            .putString("satori_source_mode", "api").apply()
                        configureMobileApi()
                    }
                    else -> {
                        if (fileUri != null) refreshFromPicker()
                        else filePicker.launch(arrayOf("text/plain", "application/json"))
                    }
                }
            }
            .setNegativeButton("Đóng", null).show()
    }

    private fun motionEnabled(): Boolean =
        Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled()

    private fun adaptiveShellWidth(): Int {
        // One responsive, centered phone-width canvas. Folding/unfolding must
        // neither stretch ledger cards into tablet-wide buttons nor clip the
        // outer-screen compact layout. Width is remeasured on each resize.
        val widthDp = resources.configuration.screenWidthDp
        return if (widthDp >= 600) dp(minOf(680, widthDp - 32)) else -1
    }


    /** Native 2.5D order-mode cards share the original verified editor / Gemini routes. */
    private fun renderUi25dOrderChoices(parent: LinearLayout, enabled: Boolean) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(12), 0, 0)
        }
        fun option(title: String, note: String, icon: Int, tint: Int, action: () -> Unit): LinearLayout {
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(13), dp(15), dp(13), dp(15))
                background = panelBackground(Color.WHITE, 21)
                elevation = if (SatoriUiTheme.raised(this@NativeMainActivity)) dp(5).toFloat() else 0f
                isClickable = true
                isFocusable = true
                contentDescription = title + ". " + note
                setOnClickListener { action() }
            }
            val image = ImageView(this).apply {
                setImageResource(icon)
                setColorFilter(tint)
                background = panelBackground(SatoriUiTheme.soft(this@NativeMainActivity), 12)
                setPadding(dp(9), dp(9), dp(9), dp(9))
                contentDescription = null
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }
            card.addView(image, LinearLayout.LayoutParams(dp(43), dp(43)))
            label(card, title, 14f, true, ink, 12)
            label(card, note, 11f, false, softInk, 6)
            return card
        }
        val editor = option("Lên đơn thủ công",
            if (enabled) "Chọn khách, điểm giao và sản phẩm"
            else "Cần xác minh quyền ghi", R.drawable.ic_satori_invoice, teal) {
            if (enabled) launchEditor()
            else if (apiEndpoint == null) configureMobileApi()
            else connectGoogle()
        }
        val gemini = option("Mở Gemini quản trị",
            "Lên đơn bằng hội thoại", R.drawable.ic_satori_plus, Color.rgb(117, 83, 201)) {
            startActivity(Intent(this@NativeMainActivity, AiCustomerPortalActivity::class.java)
                .putExtra("mode", "admin"))
        }
        row.addView(editor, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(5) })
        row.addView(gemini, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = dp(5) })
        parent.addView(row, LinearLayout.LayoutParams(-1, -2))
    }

    private fun renderMoneyMindOfflineState(parent: LinearLayout, tab: Int) {
        when (tab) {
            1 -> {
                val search = EditText(this).apply {
                    hint = "⌕  Tìm hóa đơn, khách hàng..."
                    textSize = 13f
                    isEnabled = false
                    setSingleLine()
                    setPadding(dp(15), dp(12), dp(15), dp(12))
                    background = panelBackground(Color.WHITE, 13)
                }
                parent.addView(search, LinearLayout.LayoutParams(-1, dp(46)).apply {
                    topMargin = dp(12)
                })
                val summaryRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    setPadding(0, dp(11), 0, 0)
                }
                val left = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(12), dp(15), dp(12), dp(15))
                    background = panelBackground(Color.WHITE, 21)
                    elevation = if (SatoriUiTheme.raised(this@NativeMainActivity)) dp(5).toFloat() else 0f
                }
                label(left, "TỔNG TIỀN BÁN", 11f, true, softInk)
                label(left, "—", 22f, true, teal, 8)
                val right = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(12), dp(15), dp(12), dp(15))
                    background = panelBackground(Color.WHITE, 21)
                    elevation = if (SatoriUiTheme.raised(this@NativeMainActivity)) dp(5).toFloat() else 0f
                }
                label(right, "TỔNG HÓA ĐƠN", 11f, true, softInk)
                label(right, "—", 22f, true, cyan, 8)
                summaryRow.addView(left, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(5) })
                summaryRow.addView(right, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = dp(5) })
                parent.addView(summaryRow)
                label(parent, "Lịch sử hóa đơn", 16f, true, ink, 17)
                section(parent, "Chưa thể xem hóa đơn",
                    "Đăng nhập và đồng bộ để xem danh sách, tìm kiếm, chỉnh sửa hoặc đối soát.")
            }
            2 -> {
                label(parent, "Hồ sơ khách hàng", 15f, true, ink, 15)
                section(parent, "Chưa đồng bộ hồ sơ",
                    "Tài khoản đã xác thực sẽ hiển thị khách hàng và các địa chỉ giao.")
            }
            3 -> {
                val metric = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(15), dp(15), dp(15), dp(15))
                    background = panelBackground(Color.rgb(227, 247, 243), 18)
                }
                label(metric, "Tổng công nợ cần thu", 12f, false, softInk)
                label(metric, "—", 25f, true, ink, 7)
                label(metric, "Chưa có dữ liệu đối soát", 11f, false,
                    Color.rgb(22, 127, 103), 5)
                parent.addView(metric, LinearLayout.LayoutParams(-1, -2).apply {
                    topMargin = dp(12)
                })
                label(parent, "Công nợ theo khách hàng", 15f, true, ink, 15)
                section(parent, "Chưa thể xem khoản cần thu",
                    "Công nợ tính theo hóa đơn thật sau khi đồng bộ. Trạng thái khách trả và thanh toán Satori độc lập.")
            }
            4 -> {
                label(parent, "Chọn cách tạo đơn", 17f, true, ink, 17)
                renderUi25dOrderChoices(parent, false)
                section(parent, "Chưa được cấp quyền tạo đơn",
                    "Chỉ tạo hóa đơn thật sau khi Mobile API xác minh quyền Admin và anh xác nhận.")
            }
        }
    }

    /** Four colorful native shortcuts with original authorized callbacks. */

    private fun renderMoneyMindShortcuts(parent: LinearLayout) {
        val icons = listOf(
            Triple("Hóa đơn", R.drawable.ic_satori_invoice, Color.rgb(245, 157, 19)),
            Triple("Khách", R.drawable.ic_satori_users, Color.rgb(16, 156, 91)),
            Triple("Công nợ", R.drawable.ic_satori_debt, Color.rgb(49, 139, 221)),
            Triple("Gemini", R.drawable.ic_satori_plus, Color.rgb(130, 75, 198))
        )
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(11), 0, dp(7))
        }
        icons.forEachIndexed { index, (title, icon, accent) ->
            val tile = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(dp(2), dp(3), dp(2), dp(3))
                isClickable = true
                isFocusable = true
                contentDescription = "Mở " + title
                setOnClickListener {
                    when (index) {
                        0 -> { activeTab = 1; render() }
                        1 -> { activeTab = 2; render() }
                        2 -> { activeTab = 3; render() }
                        else -> startActivity(Intent(this@NativeMainActivity,
                            AiCustomerPortalActivity::class.java).putExtra("mode", "admin"))
                    }
                }
            }
            val iconView = ImageView(this).apply {
                setImageResource(icon)
                setColorFilter(accent)
                setPadding(dp(9), dp(9), dp(9), dp(9))
                background = panelBackground(when (index) {
                    0 -> Color.rgb(255, 243, 222)
                    1 -> Color.rgb(224, 248, 236)
                    2 -> Color.rgb(226, 241, 255)
                    else -> Color.rgb(244, 235, 255)
                }, 13)
                contentDescription = null
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }
            val iconSlot = FrameLayout(this)
            iconSlot.addView(iconView, FrameLayout.LayoutParams(dp(46), dp(46),
                Gravity.CENTER))
            if (index == 0 && currentInvoiceBadge().count > 0)
                iconSlot.addView(badgePill(currentInvoiceBadge().count),
                    FrameLayout.LayoutParams(dp(23), dp(19), Gravity.TOP or Gravity.END))
            tile.addView(iconSlot, LinearLayout.LayoutParams(dp(52), dp(48)))
            label(tile, title, 11f, true, ink, 5)
            row.addView(tile, LinearLayout.LayoutParams(0, -2, 1f))
        }
        parent.addView(row)
    }

    /** Recent invoices only from the verified ledger; no demo amounts. */

    private fun renderMoneyMindRecent(parent: LinearLayout, data: SatoriSnapshot) {
        label(parent, "Hóa đơn gần đây", 15f, true, ink, 15)
        if (data.invoices.isEmpty()) {
            section(parent, "Chưa có hóa đơn", "Đồng bộ lại để xem dữ liệu.")
            return
        }
        data.invoices.take(4).forEach { invoice ->
            val isUnread = invoice.number.toLongOrNull()?.let {
                it in currentInvoiceBadge().unread
            } == true
            section(parent, (if (isUnread) "🔴 MỚI · " else "") +
                "#" + invoice.number + "  ·  " + invoice.customer,
                invoice.displayDate + "  ·  " + SatoriData.money(invoice.total)) {
                openInvoice(invoice)
            }
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // AndroidManifest handles screenSize changes to retain owner session,
        // but that requires an explicit responsive rerender after folding.
        if (previousScrollView != null) render()
        // Keep an already-open invoice readable after fold/unfold without reloading data.
        activeInvoiceDialog?.takeIf { it.isShowing }?.let(::resizeInvoiceDialog)
    }


    /**
     * UI25D v0.4.47: the approved dashboard composition, not just tinting old cards.
     * All financial figures come from a verified SatoriSnapshot; no demo values.
     * Cards share the original tab handlers and the original owner auth policy.
     */
    private fun renderUi25dHome(parent: LinearLayout, data: SatoriSnapshot?) {
        val darkTeal = SatoriUiTheme.deep(this)
        val tealAccent = SatoriUiTheme.accent(this)
        val pale = SatoriUiTheme.soft(this)
        val raised = SatoriUiTheme.raised(this)
        val hero = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(19), dp(20), dp(19), dp(20))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(darkTeal, tealAccent, SatoriUiTheme.lighter(this@NativeMainActivity))).apply {
                cornerRadius = dp(25).toFloat()
            }
            elevation = if (raised) dp(8).toFloat() else 0f
        }
        label(hero, "BẢNG ĐIỀU KHIỂN MINH SATORI", 10f, true,
            SatoriUiTheme.onAccent(this)).apply {
            letterSpacing = .11f
            setTextColor(SatoriUiTheme.onAccent(this@NativeMainActivity))
        }
        label(hero, "Chào quản trị viên 👋", 23f, true,
            SatoriUiTheme.onAccent(this), 9).apply {
            setTextColor(SatoriUiTheme.onAccent(this@NativeMainActivity))
        }
        label(hero, "Quản lý doanh thu, hóa đơn và khách hàng trong một giao diện gọn gàng.",
            12f, false, SatoriUiTheme.onAccent(this), 8).apply {
            setTextColor(SatoriUiTheme.onAccent(this@NativeMainActivity))
        }
        val report = TextView(this).apply {
            text = "Xem báo cáo   ›"
            textSize = 12f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(SatoriUiTheme.onAccent(this@NativeMainActivity))
            setPadding(dp(15), dp(11), dp(15), dp(11))
            background = GradientDrawable().apply {
                setColor(Color.argb(42, 255, 255, 255))
                setStroke(dp(1), Color.argb(125, 255, 255, 255))
                cornerRadius = dp(13).toFloat()
            }
            isClickable = true
            isFocusable = true
            contentDescription = "Mở bảng hóa đơn"
            setOnClickListener { activeTab = 1; render() }
        }
        hero.addView(report, LinearLayout.LayoutParams(-2, -2).apply {
            topMargin = dp(16)
        })
        parent.addView(hero, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })

        val heading = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(18), 0, dp(10))
        }
        label(heading, "Tổng quan kinh doanh", 18f, true, ink)
        val more = TextView(this).apply {
            text = "Xem hóa đơn  ›"
            textSize = 11f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(tealAccent)
            gravity = Gravity.END
            setPadding(dp(6), dp(7), dp(2), dp(7))
            isClickable = true
            isFocusable = true
            setOnClickListener { activeTab = 1; render() }
        }
        heading.addView(more, LinearLayout.LayoutParams(0, -2, 1f))
        parent.addView(heading)

        fun kpi(title: String, value: String, note: String, tint: Int,
                iconRes: Int, openTab: Int): LinearLayout {
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(15), dp(14), dp(12), dp(14))
                background = GradientDrawable().apply {
                    setColor(Color.WHITE)
                    cornerRadius = dp(21).toFloat()
                    setStroke(dp(1), Color.rgb(226, 235, 238))
                }
                elevation = if (raised) dp(6).toFloat() else 0f
                minimumHeight = dp(150)
                isClickable = true
                isFocusable = true
                contentDescription = title + ": " + value + ". " + note
                setOnClickListener { activeTab = openTab; render() }
            }
            val smallIcon = ImageView(this).apply {
                setImageResource(iconRes)
                setColorFilter(tint)
                scaleType = ImageView.ScaleType.FIT_CENTER
                setPadding(dp(10), dp(10), dp(10), dp(10))
                background = GradientDrawable().apply {
                    setColor(Color.rgb(
                        (Color.red(tint) + 255 * 3) / 4,
                        (Color.green(tint) + 255 * 3) / 4,
                        (Color.blue(tint) + 255 * 3) / 4
                    ))
                    cornerRadius = dp(11).toFloat()
                }
                contentDescription = title
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }
            card.addView(smallIcon, LinearLayout.LayoutParams(dp(36), dp(36)))
            label(card, title, 11f, false, softInk, 10)
            val number = label(card, value, 19f, true,
                if (title == "Công nợ phải thu") invoiceMoneyRed else tint, 6)
            fitCardNumber(number, maxSp = 19)
            label(card, note, 10f, false, softInk, 6)
            return card
        }
        val sales = data?.invoices?.filterNot { it.isExcluded }?.sumOf { it.total }
        val salesCount = data?.invoices?.count { !it.isExcluded }
        val first = kpi("Tổng tiền bán",
            if (sales == null) "—" else SatoriData.money(sales),
            if (salesCount == null) "Chưa đồng bộ" else "$salesCount hóa đơn hợp lệ",
            tealAccent, R.drawable.ic_satori_invoice, 1)
        val second = kpi("Công nợ phải thu",
            if (data == null) "—" else SatoriData.money(data.outstandingAmount),
            if (data == null) "Chưa đồng bộ" else "${data.outstandingCount} hóa đơn chưa thu",
            Color.rgb(209, 77, 91), R.drawable.ic_satori_debt, 3)
        val grid = LinearLayout(this).apply {
            orientation = if (resources.configuration.screenWidthDp >= 350)
                LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
        }
        if (grid.orientation == LinearLayout.HORIZONTAL) {
            grid.addView(first, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(5) })
            grid.addView(second, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = dp(5) })
        } else {
            grid.addView(first, LinearLayout.LayoutParams(-1, -2))
            grid.addView(second, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
        }
        parent.addView(grid, LinearLayout.LayoutParams(-1, -2))
        // Profit uses the SAME read-only verified 45%/CTV formula as the debt
        // tab. Filtering never multiplies total sales by 45% or writes any data.
        val profitRows = data?.let(CtvProfitSourcePolicy::profitRows)
        val profitSummary = profitRows?.let {
            AccountingProMargin45.summarize(it, homeProfitPeriod)
        }
        val verifiedRegistry = data?.collaboratorRegistryLoaded == true &&
            data.collaborators.isNotEmpty()
        val noEligibleInvoice = profitSummary?.totalInvoiceCount == 0 &&
            profitSummary.excludedInvalidDates == 0 &&
            (homeProfitChoice != 0 || data?.invoices?.none { !it.isExcluded } == true)
        // Sum only verified rows; old invoices without financial evidence
        // are omitted, never fabricated as zero-margin invoices.
        val confirmedProfit = when {
            data == null -> null
            noEligibleInvoice -> SatoriData.money(0L)
            profitSummary != null && profitSummary.computedInvoiceCount > 0 ->
                profitSummary.estimatedMarginKnownVnd?.let(SatoriData::money)
            else -> null
        }
        val profitNote = when {
            data == null -> "Chưa kết nối sổ hóa đơn"
            noEligibleInvoice -> "Không có hóa đơn hợp lệ trong kỳ"
            profitSummary == null -> "Chưa có dữ liệu lợi nhuận"
            profitSummary.computedInvoiceCount > 0 ->
                "Đã tính " + profitSummary.computedInvoiceCount + "/" +
                    profitSummary.totalInvoiceCount + " bill · bỏ qua bill thiếu dữ liệu"
            !verifiedRegistry -> "Thiếu hồ sơ CTV từ nguồn đồng bộ"
            profitSummary.excludedInvalidDates > 0 ->
                "Có " + profitSummary.excludedInvalidDates + " bill thiếu ngày hợp lệ"
            else -> "Chưa có bill đủ điều kiện tính"
        }
        val profit = kpi("Lợi nhuận", confirmedProfit ?: "Chưa có số liệu",
            profitNote, Color.rgb(120, 87, 199), R.drawable.ic_satori_profit, 0)
        // Show line-by-line source reasons instead of silently hiding amounts.
        profit.setOnClickListener {
            if (data == null) showConnectionSettings() else showMarginPeriod(data)
        }
        // On Fold the third card aligns with the two-column dashboard.
        val width = if (resources.configuration.screenWidthDp >= 350)
            (resources.displayMetrics.widthPixels / 2 - dp(23)) else -1
        parent.addView(profit, LinearLayout.LayoutParams(width, -2).apply {
            topMargin = dp(11)
        })
        label(parent, "Lọc lợi nhuận theo thời gian", 13f, true, ink, 14)
        val periodFilter = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(6), 0, dp(5))
        }
        listOf("Tất cả", "Ngày", "Tháng", "Năm").forEachIndexed { index, title ->
            val active = index == homeProfitChoice
            val chip = TextView(this).apply {
                text = title
                gravity = Gravity.CENTER
                textSize = 11.5f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(if (active) Color.WHITE else tealAccent)
                background = panelBackground(
                    if (active) tealAccent else Color.WHITE, 12)
                isClickable = true
                isFocusable = true
                contentDescription = "Lọc lợi nhuận: $title"
                setOnClickListener { selectHomeProfitPeriod(index, data) }
            }
            periodFilter.addView(chip, LinearLayout.LayoutParams(0, dp(39), 1f).apply {
                if (index > 0) marginStart = dp(5)
            })
        }
        parent.addView(periodFilter, LinearLayout.LayoutParams(-1, -2))
        label(parent, homeProfitPeriod.title + " · " +
            (profitSummary?.computedInvoiceCount ?: 0) + "/" +
            (profitSummary?.totalInvoiceCount ?: 0) + " bill đã tính được",
            11f, false, softInk, 3)
        if (data != null && !verifiedRegistry && !noEligibleInvoice) {
            val sourceWarning = TextView(this).apply {
                text = "⚠ Thiếu hồ sơ CTV. Chạm để chọn nguồn Google Drive chỉ đọc."
                textSize = 11f
                setTextColor(Color.rgb(154, 83, 24))
                setPadding(dp(9), dp(10), dp(9), dp(10))
                background = panelBackground(Color.rgb(255, 247, 230), 11)
                isClickable = true
                isFocusable = true
                setOnClickListener { showConnectionSettings() }
            }
            parent.addView(sourceWarning, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(7)
            })
        }
        label(parent, "Truy cập nhanh", 16f, true, ink, 19)
        renderMoneyMindShortcuts(parent)
    }

    /** Date filter for the Home profit card; never edits an invoice or payment. */
    private fun selectHomeProfitPeriod(mode: Int, data: SatoriSnapshot?) {
        val today = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Ho_Chi_Minh"))
        if (mode == 0) {
            homeProfitChoice = 0
            homeProfitPeriod = AccountingProMargin45Period.all()
            render()
            return
        }
        if (mode == 1 || mode == 2) {
            val initial = homeProfitPeriod.from ?: today
            val dialog = android.app.DatePickerDialog(this,
                { _, year, monthZeroBased, dayOfMonth ->
                    val day = java.time.LocalDate.of(year, monthZeroBased + 1, dayOfMonth)
                    homeProfitChoice = mode
                    homeProfitPeriod = if (mode == 1)
                        AccountingProMargin45Period.day(day)
                    else AccountingProMargin45Period.month(year, monthZeroBased + 1)
                    render()
                }, initial.year, initial.monthValue - 1, initial.dayOfMonth)
            dialog.setTitle(if (mode == 1) "Chọn ngày xem lợi nhuận" else
                "Chọn một ngày trong tháng cần xem")
            dialog.show()
            return
        }
        if (mode == 3) {
            val years = (data?.invoices.orEmpty()
                .filter { it.hasValidDate }
                .mapNotNull { it.sortDate.substring(0, 4).toIntOrNull() } +
                today.year).distinct().sortedDescending()
            AlertDialog.Builder(this)
                .setTitle("Chọn năm xem lợi nhuận")
                .setItems(years.map { "Năm $it" }.toTypedArray()) { _, idx ->
                    homeProfitChoice = 3
                    homeProfitPeriod = AccountingProMargin45Period.year(years[idx])
                    render()
                }
                .setNegativeButton("Đóng", null).show()
        }
    }

    private fun renderUi25dSectionIntro(parent: LinearLayout, name: String) {
        val description = when (name) {
            "Hóa đơn" -> "Lịch sử và chi tiết hóa đơn"
            "Khách hàng" -> "Hồ sơ và địa điểm giao hàng"
            "Công nợ" -> "Theo dõi khoản phải thu"
            "Lên đơn" -> "Tạo đơn trên tài khoản được cấp quyền"
            else -> "Thông tin cá nhân và quản trị"
        }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(17), dp(17), dp(17), dp(17))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(SatoriUiTheme.deep(this@NativeMainActivity),
                    SatoriUiTheme.accent(this@NativeMainActivity))).apply {
                cornerRadius = dp(21).toFloat()
            }
            elevation = if (SatoriUiTheme.raised(this@NativeMainActivity))
                dp(6).toFloat() else 0f
        }
        label(top, "MINH SATORI • QUẢN TRỊ", 9f, true,
            SatoriUiTheme.onAccent(this)).apply {
            setTextColor(SatoriUiTheme.onAccent(this@NativeMainActivity))
            letterSpacing = .1f
        }
        label(top, name, 22f, true, SatoriUiTheme.onAccent(this), 6).apply {
            setTextColor(SatoriUiTheme.onAccent(this@NativeMainActivity))
        }
        label(top, description, 12f, false, SatoriUiTheme.onAccent(this), 6).apply {
            setTextColor(SatoriUiTheme.onAccent(this@NativeMainActivity))
        }
        parent.addView(top, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
    }

    private fun render() {
        dashboardMode = true
        // New orders should not jump the owner to the top of a long invoice
        // list during an automatic refresh.
        val tabChanged = previousRenderedTab >= 0 && previousRenderedTab != activeTab
        val oldScrollY = if (previousRenderedTab == activeTab)
            previousScrollView?.scrollY ?: 0 else 0
        previousRenderedTab = activeTab
        val root = FrameLayout(this).apply { setBackgroundColor(night) }
        val shell = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(night)
        }
        val shellWidth = adaptiveShellWidth()
        val shellInset = if (shellWidth > 0)
            (resources.displayMetrics.widthPixels - shellWidth).coerceAtLeast(0) / 2
            else 0
        root.addView(shell, FrameLayout.LayoutParams(
            shellWidth, -1, Gravity.CENTER_HORIZONTAL))
        setContentView(root)
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(16))
        }
        scroll.addView(content)
        shell.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        previousScrollView = scroll
        if (oldScrollY > 0) scroll.post { scroll.scrollTo(0, oldScrollY) }

        // iOS-style light grouped header; retain original Satori logo and owner actions.
        val brand = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(7), dp(8), dp(7), dp(8))
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(SatoriUiTheme.deep(this@NativeMainActivity), teal,
                    SatoriUiTheme.lighter(this@NativeMainActivity))).apply {
                cornerRadius = dp(22).toFloat()
            }
            elevation = if (SatoriUiTheme.raised(this@NativeMainActivity))
                dp(5).toFloat() else 0f
        }
        val menuButton = android.widget.ImageButton(this).apply {
            setImageResource(R.drawable.ic_satori_menu)
            setColorFilter(SatoriUiTheme.onAccent(this@NativeMainActivity))
            background = panelBackground(Color.TRANSPARENT, 12)
            scaleType = ImageView.ScaleType.FIT_CENTER
            setPadding(dp(10), dp(11), dp(10), dp(11))
            contentDescription = "Mở menu tác vụ"
        }
        val brandLogo = ImageView(this).apply {
            setImageResource(R.drawable.satori_invoice_logo)
            // Circular avatar mask: keep original logo asset, crop only its
            // square corners. 38dp diameter / 19dp rounded background.
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = background(Color.WHITE, 12)
            setPadding(0, 0, 0, 0)
            clipToOutline = true
            contentDescription = "Logo Minh Satori vuông bo góc"
        }
        brand.addView(brandLogo, LinearLayout.LayoutParams(dp(38), dp(38)))
        val brandText = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(7), 0, 0, 0)
        }
        label(brandText, "MINH SATORI", 15f, true, ink).apply {
            setTextColor(SatoriUiTheme.onAccent(this@NativeMainActivity))
        }
        label(brandText, if (activeTab == 0) "Xin chào, Quản trị viên 👋"
            else "HÓA ĐƠN  •  SỔ KẾ TOÁN", 10f,
            false, Color.rgb(79, 102, 132), 4).apply {
            setTextColor(SatoriUiTheme.onAccent(this@NativeMainActivity))
        }
        brand.addView(brandText, LinearLayout.LayoutParams(0, -2, 1f))
        val refreshButton = android.widget.ImageButton(this).apply {
            setImageResource(R.drawable.ic_satori_refresh)
            setColorFilter(SatoriUiTheme.onAccent(this@NativeMainActivity))
            background = panelBackground(Color.TRANSPARENT, 12)
            scaleType = ImageView.ScaleType.FIT_CENTER
            setPadding(dp(8), dp(12), dp(8), dp(12))
            contentDescription = "Đồng bộ hóa đơn từ server"
            setOnClickListener { refreshNow() }
        }
        brand.addView(refreshButton, LinearLayout.LayoutParams(dp(38), dp(46)))
        val bellButton = android.widget.ImageButton(this).apply {
            val enabled = getPreferences(MODE_PRIVATE).getBoolean(
                "satori_live_notifications", false)
            setImageResource(if (enabled) R.drawable.ic_satori_bell
                else R.drawable.ic_satori_bell_off)
            setColorFilter(SatoriUiTheme.onAccent(this@NativeMainActivity))
            background = panelBackground(Color.TRANSPARENT, 12)
            scaleType = ImageView.ScaleType.FIT_CENTER
            setPadding(dp(7), dp(11), dp(7), dp(11))
            contentDescription = if (enabled) "Tắt thông báo hóa đơn"
                else "Bật thông báo hóa đơn"
            setOnClickListener {
                val existing = getPreferences(MODE_PRIVATE).getBoolean(
                    "satori_live_notifications", false)
                val next = !existing
                getPreferences(MODE_PRIVATE).edit().putBoolean(
                    "satori_live_notifications", next).apply()
                if (next && Build.VERSION.SDK_INT >= 33 &&
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                        PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 5201)
                }
                if (next) SatoriPush.registerOwnerDevice(this@NativeMainActivity, force = true)
                else SatoriPush.revokeOwnerDevice(this@NativeMainActivity)
                Toast.makeText(this@NativeMainActivity,
                    if (!next) "Đã tắt thông báo đơn mới."
                    else if (SatoriPush.configured())
                        "Đã bật thông báo. Khi đăng nhập Owner V2, thiết bị đăng ký nhận push."
                    else "Đã bật thông báo khi đồng bộ. Push tức thời chưa có cấu hình FCM.",
                    Toast.LENGTH_LONG).show()
                render()
            }
        }
        val bellContainer=FrameLayout(this)
        bellContainer.addView(bellButton,FrameLayout.LayoutParams(dp(38),dp(46)))
        val alertCount=V2RegistrationAlerts.pendingCount(this)
        v2SignupBadge=TextView(this).apply{
            text=if(alertCount>99)"99+" else alertCount.toString()
            textSize=10f;gravity=Gravity.CENTER
            setTypeface(typeface,Typeface.BOLD)
            setTextColor(Color.WHITE)
            background=panelBackground(Color.rgb(189,31,57),12)
            minimumWidth=dp(21);minHeight=dp(21)
            setPadding(dp(3),0,dp(3),0)
            visibility=if(alertCount>0)View.VISIBLE else View.GONE
            isClickable=true;isFocusable=true
            contentDescription="Mở "+alertCount+" đăng ký Gmail mới chờ duyệt"
            setOnClickListener{
                startActivity(Intent(this@NativeMainActivity,V2OwnerCrmActivity::class.java))
            }
        }
        bellContainer.addView(v2SignupBadge,FrameLayout.LayoutParams(-2,dp(21),
            Gravity.TOP or Gravity.END))
        brand.addView(bellContainer,LinearLayout.LayoutParams(dp(38),dp(46)))
        val options = android.widget.ImageButton(this).apply {
            setImageResource(R.drawable.ic_satori_settings)
            setColorFilter(SatoriUiTheme.onAccent(this@NativeMainActivity))
            background = panelBackground(Color.TRANSPARENT, 12)
            scaleType = ImageView.ScaleType.FIT_CENTER
            setPadding(dp(10), dp(11), dp(10), dp(11))
            contentDescription = "Cài đặt kết nối"
            setOnClickListener { showConnectionSettings() }
        }
        brand.addView(options, LinearLayout.LayoutParams(dp(42), dp(46)))
        // Hamburger is the last header action, immediately right of Settings.
        brand.addView(menuButton, LinearLayout.LayoutParams(dp(42), dp(45)))
        // Keep the hamburger and primary controls visible while long ledgers scroll.
        shell.addView(brand, 0, LinearLayout.LayoutParams(-1, -2))

        val pages = listOf("Tổng quan", "Hóa đơn", "Khách hàng", "Công nợ", "Lên đơn", "Cá nhân")

        val data = snapshot
        val connected = data != null

        // Compact connection indicator. The detailed warning stays accessible
        // by tap, rather than occupying most of the MoneyMind home screen.
        val stale = statusMessage.startsWith("⚠")
        val info = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(11), dp(10), dp(11), dp(10))
            background = panelBackground(if (connected) Color.rgb(232, 248, 240)
                else Color.rgb(255, 247, 230), 12)
            isClickable = true
            isFocusable = true
            contentDescription = "Trạng thái đồng bộ. Chạm xem chi tiết."
            setOnClickListener {
                AlertDialog.Builder(this@NativeMainActivity)
                    .setTitle(if (connected) "Trạng thái đồng bộ" else "Cần kết nối Minh Satori")
                    .setMessage(statusMessage +
                        (if (preferredSource() == AutoSyncPolicy.FILE)
                            "\n\nLưu ý: file chọn thủ công có thể là dữ liệu tĩnh." else "") +
                        (if (connected) "\n\nNguồn: " + dataSource +
                            " · Revision " + data!!.revision else ""))
                    .setPositiveButton("Đóng", null).show()
            }
        }
        label(info, when {
            stale -> "●  Cảnh báo đồng bộ · Chạm xem"
            connected -> "●  Đã đồng bộ · Rev " + data!!.revision
            isLoading || authorizationPending -> "●  Đang kết nối..."
            else -> "●  Chưa kết nối dữ liệu · Chạm xem"
        }, 11f, true, if (connected) Color.rgb(17, 133, 91)
            else Color.rgb(171, 95, 18))
        if (connected && lastReadAt.isNotBlank())
            label(info, "Cập nhật " + lastReadAt, 10f, false, softInk, 3)

        // Status now leads the page, matching the approved preview.
        content.addView(info, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(9)
        })
        if (activeTab == 0) renderUi25dHome(content, data)
        else renderUi25dSectionIntro(content, pages[activeTab])

        if (isLoading) {
            label(content, "Đang đồng bộ dữ liệu…", 12f, true, cyan, 12)
        }
        if (activeTab == 5) {
            renderV2OwnerBackend(content, data)

        } else if (data == null) {
            // No fabricated numbers: reference layout with real API-only values.
            if (activeTab == 0) {
                label(content, "Hóa đơn gần đây", 16f, true, ink, 19)
                section(content, "Chưa đồng bộ hóa đơn",
                    "Kết nối tài khoản để xem dữ liệu thực tế.")
            }
            if (activeTab != 0) renderMoneyMindOfflineState(content, activeTab)
            button(content, if (apiEndpoint == null) "Kết nối Minh Satori" else
                if (accessToken == null) "Đăng nhập Google" else
                "Đồng bộ Mobile API", true) {
                when {
                    apiEndpoint == null -> configureMobileApi()
                    accessToken == null -> connectGoogle()
                    else -> refreshFromMobileApi()
                }
            }
            button(content, "Xem Google Drive · chỉ đọc") {
                getPreferences(MODE_PRIVATE).edit()
                    .putBoolean("google_drive_auto_read", true).apply()
                if (accessToken == null) connectGoogle() else refreshFromDrive()
            }
        } else {

            if (activeTab == 4 && canWrite) {
                button(content, "+ TẠO ĐƠN HÀNG", true) { launchEditor() }
            }
            when (activeTab) {
                0 -> {
                    renderMoneyMindRecent(content, data)
                    section(content, "Công cụ nâng cao",
                        if (showAdvancedOverview) "Chạm để thu gọn công cụ"
                        else "Sổ kế toán · Bảng giá · Trí nhớ AI · Đối chiếu") {
                        showAdvancedOverview = !showAdvancedOverview
                        render()
                    }
                    if (showAdvancedOverview) renderOverview(content, data)
                }
                1 -> renderInvoices(content, data)
                2 -> renderCustomers(content, data)
                3 -> renderDebt(content, data)
                4 -> renderNewOrderInfo(content)
                5 -> renderV2OwnerBackend(content, data)
                else -> renderOverview(content, data)
            }
            button(content, if (dataSource in setOf("Minh Satori API",
                        "Google Drive API", "file Google Drive")) "LÀM MỚI DỮ LIỆU"
                    else "CÀI ĐẶT KẾT NỐI") {
                when (dataSource) {
                    "Minh Satori API" -> refreshFromMobileApi()
                    "Google Drive API" -> refreshFromDrive()
                    "file Google Drive" -> refreshFromPicker()
                    else -> showConnectionSettings()
                }
            }
        }
        if (pendingStorageError) section(content, "CẦN KIỂM TRA DỮ LIỆU ĐANG CHỜ",
            "Không đọc được bản lưu thao tác. Đã khóa ghi để phòng trùng đơn.")
        pendingWrite?.let { pending ->
            section(content, "CÓ THAO TÁC CHƯA XÁC MINH",
                "Ứng dụng tạm khóa ghi mới để đảm bảo an toàn.") {
                if (!pendingStorageError &&
                    pending.belongsTo(apiEndpoint.orEmpty(), actorId) &&
                    hasServerAction(pending.action)) {
                    reviewPendingWrite(pending)
                } else {
                    Toast.makeText(this, "Kết nối lại đúng API và tài khoản đã gửi thao tác.",
                        Toast.LENGTH_LONG).show()
                }
            }
        }

        // MoneyMind reference: persistent five-action bottom navigation. Legacy
        // drawer retains all six routes, including Khách hàng and advanced tools.
        val bottomNav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(6), dp(4), dp(6))
            background = panelBackground(Color.WHITE, 18)
            elevation = if (SatoriUiTheme.raised(this@NativeMainActivity)) dp(7).toFloat() else 0f
        }
        val bottomDestinations = listOf(
            Triple(0, "Trang chủ", R.drawable.ic_satori_dashboard),
            Triple(1, "Hóa đơn", R.drawable.ic_satori_invoice),
            Triple(4, "Lên đơn", R.drawable.ic_satori_plus),
            Triple(3, "Công nợ", R.drawable.ic_satori_debt),
            Triple(5, "Cá nhân", R.drawable.ic_satori_settings)
        )
        bottomDestinations.forEach { (index, title, drawable) ->
            val selected = activeTab == index
            val item = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(dp(2), dp(4), dp(2), dp(3))
                minimumHeight = dp(53)
                isClickable = true
                isFocusable = true
                contentDescription = if (index == 1 && currentInvoiceBadge().count > 0)
                    "Mở Hóa đơn, có " + currentInvoiceBadge().count + " đơn mới"
                    else "Mở " + title
                setOnClickListener {
                    if (activeTab != index) {
                        activeTab = index
                        render()
                    }
                }
            }
            val glyph = ImageView(this).apply {
                setImageResource(drawable)
                setColorFilter(if (index == 4) Color.WHITE
                    else if (selected) teal else softInk)
                setPadding(dp(6), dp(6), dp(6), dp(6))
                background = if (index == 4) panelBackground(teal, 28)
                    else panelBackground(Color.TRANSPARENT, 12)
                contentDescription = null
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }
            val iconSlot = FrameLayout(this)
            iconSlot.addView(glyph, FrameLayout.LayoutParams(
                dp(if (index == 4) 45 else 33), dp(if (index == 4) 45 else 33),
                Gravity.CENTER))
            if (index == 1 && currentInvoiceBadge().count > 0) {
                val unread = badgePill(currentInvoiceBadge().count)
                iconSlot.addView(unread, FrameLayout.LayoutParams(
                    dp(23), dp(19), Gravity.TOP or Gravity.END))
            }
            item.addView(iconSlot, LinearLayout.LayoutParams(dp(49), dp(45)))
            if (selected && tabChanged && motionEnabled()) {
                glyph.scaleX = 0.88f
                glyph.scaleY = 0.88f
                glyph.animate().scaleX(1f).scaleY(1f).setDuration(180)
                    .setInterpolator(DecelerateInterpolator()).start()
            }
            val text = TextView(this).apply {
                this.text = title
                textSize = 9f
                gravity = Gravity.CENTER
                setTextColor(if (selected) teal else softInk)
                setTypeface(typeface, if (selected) Typeface.BOLD else Typeface.NORMAL)
                includeFontPadding = false
            }
            item.addView(text, LinearLayout.LayoutParams(-1, dp(16)).apply {
                topMargin = dp(2)
            })
            bottomNav.addView(item, LinearLayout.LayoutParams(0, -2, 1f))
        }
        shell.addView(bottomNav, LinearLayout.LayoutParams(-1, -2))

        // Preserve the drawer as the full advanced navigation inventory.
        // Pure native Android animation: no webview, no new dependencies.
        val scrim = View(this).apply {
            setBackgroundColor(Color.argb(115, 10, 16, 28))
            alpha = 0f
            visibility = View.GONE
            isClickable = true
            contentDescription = "Đóng menu tác vụ"
        }
        root.addView(scrim, FrameLayout.LayoutParams(-1, -1))
        val drawerWidth = minOf(
            dp(300), dp((resources.configuration.screenWidthDp - 36).coerceAtLeast(225)))
        val drawer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(24), dp(18), dp(20))
            setBackgroundColor(white)
            elevation = dp(14).toFloat()
            visibility = View.GONE
            translationX = drawerWidth.toFloat()
        }
        root.addView(drawer, FrameLayout.LayoutParams(drawerWidth, -1, Gravity.END).apply {
            rightMargin = shellInset
        })
        val titleRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val drawerHeading = TextView(this).apply {
            text = "Minh Satori"
            textSize = 21f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(ink)
        }
        titleRow.addView(drawerHeading, LinearLayout.LayoutParams(0, -2, 1f))
        val closeButton = android.widget.ImageButton(this).apply {
            setImageResource(R.drawable.ic_satori_close)
            setColorFilter(Color.rgb(203, 48, 48))
            background = panelBackground(Color.TRANSPARENT, 12)
            scaleType = ImageView.ScaleType.FIT_CENTER
            setPadding(dp(14), dp(14), dp(14), dp(14))
            contentDescription = "Đóng menu"
        }
        titleRow.addView(closeButton, LinearLayout.LayoutParams(dp(48), dp(48)))
        drawer.addView(titleRow)
        label(drawer, "TÁC VỤ", 11f, true, softInk, 22)
        val destinations = listOf(
            R.drawable.ic_satori_dashboard to "Tổng quan",
            R.drawable.ic_satori_invoice to "Hóa đơn",
            R.drawable.ic_satori_users to "Khách hàng",
            R.drawable.ic_satori_debt to "Công nợ",
            R.drawable.ic_satori_plus to "Lên đơn",
            R.drawable.ic_satori_settings to "Quản trị hệ thống"
        )
        var drawerOpened = false
        fun dismissDrawer(after: (() -> Unit)? = null) {
            if (!drawerOpened) {
                after?.invoke()
                return
            }
            drawerOpened = false
            drawer.animate().cancel()
            scrim.animate().cancel()
            if (!motionEnabled()) {
                drawer.translationX = drawerWidth.toFloat()
                drawer.visibility = View.GONE
                scrim.alpha = 0f
                scrim.visibility = View.GONE
                after?.invoke()
                return
            }
            drawer.animate().translationX(drawerWidth.toFloat())
                .setDuration(200).setInterpolator(DecelerateInterpolator())
                .withEndAction {
                    drawer.visibility = View.GONE
                    scrim.visibility = View.GONE
                    after?.invoke()
                }.start()
            scrim.animate().alpha(0f).setDuration(185).start()
        }
        fun showDrawer() {
            if (drawerOpened) return
            drawerOpened = true
            drawer.animate().cancel()
            scrim.animate().cancel()
            scrim.alpha = 0f
            scrim.visibility = View.VISIBLE
            drawer.translationX = drawerWidth.toFloat()
            drawer.visibility = View.VISIBLE
            if (!motionEnabled()) {
                drawer.translationX = 0f
                scrim.alpha = 1f
                return
            }
            drawer.animate().translationX(0f).setDuration(245)
                .setInterpolator(DecelerateInterpolator()).start()
            scrim.animate().alpha(1f).setDuration(210).start()
        }
        destinations.forEachIndexed { index, item ->
            val destination = TextView(this).apply {
                text = item.second
                val glyph = androidx.core.content.ContextCompat.getDrawable(
                    this@NativeMainActivity, item.first)?.mutate()
                glyph?.setTint(if (activeTab == index) cyan else ink)
                glyph?.setBounds(0, 0, dp(21), dp(21))
                setCompoundDrawablesRelative(glyph, null, null, null)
                compoundDrawablePadding = dp(13)
                textSize = 16f
                setTypeface(typeface, if (activeTab == index) Typeface.BOLD else Typeface.NORMAL)
                setTextColor(if (activeTab == index) cyan else ink)
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(14), 0, dp(12), 0)
                background = background(if (activeTab == index)
                    SatoriUiTheme.soft(this@NativeMainActivity) else white, 14)
                contentDescription = "Mở mục " + item.second + if (item.second == "Quản trị hệ thống") " · Quản trị bên trong ứng dụng Minh Satori" else ""
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    dismissDrawer {
                        activeTab = index
                        render()
                    }
                }
            }
            drawer.addView(destination, LinearLayout.LayoutParams(-1, dp(54)).apply {
                topMargin = dp(5)
            })
        }
        val syncMenu = TextView(this).apply {
            text = "Đồng bộ dữ liệu"
            val glyph = androidx.core.content.ContextCompat.getDrawable(
                this@NativeMainActivity, R.drawable.ic_satori_refresh)?.mutate()
            glyph?.setTint(cyan)
            glyph?.setBounds(0, 0, dp(21), dp(21))
            setCompoundDrawablesRelative(glyph, null, null, null)
            compoundDrawablePadding = dp(13)
            textSize = 15f
            setTextColor(cyan)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(12), dp(10), dp(12))
            isClickable = true
            isFocusable = true
            contentDescription = "Đồng bộ dữ liệu ngay"
            setOnClickListener { dismissDrawer { refreshNow() } }
        }
        drawer.addView(syncMenu, LinearLayout.LayoutParams(-1, dp(56)).apply {
            topMargin = dp(14)
        })
        val appearanceMenu = TextView(this).apply {
            text = "🎨  Giao diện · Màu sắc / 2.5D"
            textSize = 15f
            setTextColor(cyan)
            setPadding(dp(14), dp(14), dp(12), dp(14))
            background = panelBackground(SatoriUiTheme.soft(this@NativeMainActivity), 14)
            elevation = if (SatoriUiTheme.raised(this@NativeMainActivity)) dp(3).toFloat() else 0f
            isClickable = true
            isFocusable = true
            contentDescription = "Tùy chỉnh màu và độ nổi giao diện"
            setOnClickListener {
                dismissDrawer { SatoriUiTheme.picker(this@NativeMainActivity) { render() } }
            }
        }
        drawer.addView(appearanceMenu, LinearLayout.LayoutParams(-1, dp(52)).apply {
            topMargin = dp(8)
        })
        menuButton.setOnClickListener { showDrawer() }
        closeButton.setOnClickListener { dismissDrawer() }
        scrim.setOnClickListener { dismissDrawer() }
        // Apply red to amounts in the invoice, debt and home cards (including
        // direct TextViews built by the protected invoiceQuickCard method).
        if (activeTab == 0 || activeTab == 1 || activeTab == 3)
            highlightMoneyInView(content)
        // Only animate a genuine tab change, never a background revision sync:
        // no flicker when accounting data auto-refreshes.
        if (tabChanged && motionEnabled()) {
            scroll.alpha = 0.75f
            scroll.translationY = dp(6).toFloat()
            scroll.animate().alpha(1f).translationY(0f).setDuration(190)
                .setInterpolator(DecelerateInterpolator()).start()
        }
        dashboardMode = false
        openPendingNotificationInvoiceIfReady()
    }



    /**
     * MoneyMind-consistent offline pages. These are informative empty states,
     * never synthetic invoices, amounts, customers or enabled write controls.
     */
    private fun actionTile(row: LinearLayout, title: String, subtitle: String,
                           accent: Int = cyan, iconRes: Int = R.drawable.ic_satori_invoice,
                           click: () -> Unit) {
        // Icon-first quick actions, matching the reference pill/cards; navigation
        // and permissions remain attached to the existing click callback.
        val tile = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(91)
            setPadding(dp(8), dp(9), dp(6), dp(8))
            val tint = when (accent) {
                Color.rgb(17, 133, 91) -> Color.rgb(225, 247, 236)
                Color.rgb(181, 95, 6) -> Color.rgb(255, 244, 220)
                Color.rgb(114, 76, 196) -> Color.rgb(242, 235, 255)
                else -> Color.rgb(225, 247, 244)
            }
            background = panelBackground(tint, 17)
            isClickable = true
            isFocusable = true
            setOnClickListener { click() }
            contentDescription = title + ". " + subtitle
        }
        val pictogram = ImageView(this).apply {
            setImageResource(iconRes)
            setColorFilter(accent)
            scaleType = ImageView.ScaleType.FIT_CENTER
            setPadding(dp(5), dp(5), dp(5), dp(5))
            contentDescription = null // tile describes the action once
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            background = panelBackground(Color.WHITE, 11)
        }
        tile.addView(pictogram, LinearLayout.LayoutParams(dp(31), dp(31)))
        label(tile, title, 12f, true, ink, 5)
        label(tile, subtitle, 10f, false, softInk, 3)
        tile.elevation = if (SatoriUiTheme.raised(this)) dp(4).toFloat() else 0f
        row.addView(tile, LinearLayout.LayoutParams(0, -2, 1f).apply {
            marginEnd = dp(5)
        })
    }


    /**
     * Owner's back office is a NATIVE SCREEN inside the installed Minh Satori
     * app. Customer order website is never used as an admin console.
     *
     * Existing ledger actions retain their independently verified Mobile API
     * authorization. V2 CRM/discount writes are deliberately locked until
     * Google OAuth V2 validates the owner's immutable Google subject.
     */
    private fun requestOwnerExcel(data: SatoriSnapshot, invoices: List<SatoriInvoice>) {
        if (invoices.isEmpty()) {
            Toast.makeText(this, "Bộ lọc không có hóa đơn.", Toast.LENGTH_LONG).show()
            return
        }
        if (pendingExcelExport != null) {
            Toast.makeText(this, "Đang chọn vị trí lưu Excel.", Toast.LENGTH_SHORT).show()
            return
        }
        pendingExcelExport = data to invoices.toList()
        try {
            saveExcelPicker.launch("MinhSatori_KeToan_" + java.time.LocalDate.now() +
                "_rev" + data.revision + ".xlsx")
        } catch (e: Exception) {
            pendingExcelExport = null
            Toast.makeText(this, "Không mở được nơi lưu Excel: " + e.message,
                Toast.LENGTH_LONG).show()
        }
    }

    private fun renderV2OwnerBackend(parent: LinearLayout, current: SatoriSnapshot?) {
        val title = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(15), dp(14), dp(15))
            background = panelBackground(Color.WHITE, 21)
            elevation = if (SatoriUiTheme.raised(this@NativeMainActivity)) dp(5).toFloat() else 0f
        }
        label(title, "CÁ NHÂN & QUẢN TRỊ", 19f, true, ink)
        label(title, "Tài khoản quản trị Minh Satori • các tác vụ được phân quyền",
            12f, false, muted, 5)
        label(title, if (current == null) "Chưa liên kết dữ liệu" else
            "Đang xem sổ Satori • " + current.invoices.size + " hóa đơn • Revision " +
            current.revision, 12f, true, cyan, 9)
        parent.addView(title, LinearLayout.LayoutParams(-1, -2))
        val modules = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(11), dp(8), dp(11), dp(8))
            background = panelBackground(Color.WHITE, 21)
            elevation = if (SatoriUiTheme.raised(this@NativeMainActivity)) dp(5).toFloat() else 0f
        }
        // MoneyMind personal/settings hierarchy: small colored icon, label and
        // chevron. Routes still target their original native Owner pages.
        fun profileRow(text: String, iconRes: Int, tint: Int, destination: Int) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(52)
                setPadding(dp(5), dp(4), dp(6), dp(4))
                isClickable = true
                isFocusable = true
                contentDescription = "Mở " + text
                setOnClickListener { activeTab = destination; render() }
            }
            val icon = ImageView(this).apply {
                setImageResource(iconRes)
                setColorFilter(tint)
                background = panelBackground(when(destination) {
                    1 -> Color.rgb(255, 244, 220)
                    2 -> Color.rgb(233, 241, 255)
                    3 -> Color.rgb(225, 248, 237)
                    else -> Color.rgb(241, 233, 255)
                }, 11)
                setPadding(dp(8), dp(8), dp(8), dp(8))
                contentDescription = null
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }
            row.addView(icon, LinearLayout.LayoutParams(dp(37), dp(37)).apply {
                marginEnd = dp(12)
            })
            val label = TextView(this).apply {
                this.text = text
                textSize = 13f
                setTextColor(ink)
                setTypeface(typeface, Typeface.BOLD)
            }
            row.addView(label, LinearLayout.LayoutParams(0, -2, 1f))
            val arrow = TextView(this).apply {
                this.text = "›"
                textSize = 22f
                setTextColor(softInk)
            }
            row.addView(arrow)
            modules.addView(row)
        }
        profileRow("Hóa đơn & trạng thái thanh toán",
            R.drawable.ic_satori_invoice, Color.rgb(204, 143, 14), 1)
        profileRow("Khách hàng & hồ sơ hiện có",
            R.drawable.ic_satori_users, Color.rgb(46, 112, 217), 2)
        profileRow("Công nợ & đối chiếu",
            R.drawable.ic_satori_debt, Color.rgb(21, 159, 98), 3)
        profileRow("Lên đơn với quyền API đã xác minh",
            R.drawable.ic_satori_plus, Color.rgb(139, 84, 201), 4)
        parent.addView(modules, LinearLayout.LayoutParams(-1, -2).apply { topMargin=dp(10) })

        // Settings section follows MoneyMind's compact personal-page rows.
        // Each callback is an existing authenticated workflow, never a new
        // invoice, payment, or permission path.
        label(parent, "CÀI ĐẶT & HỖ TRỢ", 12f, true, cyan, 17)
        val settings = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), dp(7), dp(10), dp(7))
            background = panelBackground(Color.WHITE, 17)
        }
        fun settingRow(text: String, iconRes: Int, tint: Int, action: () -> Unit) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(52)
                setPadding(dp(5), dp(4), dp(6), dp(4))
                isClickable = true
                isFocusable = true
                contentDescription = "Mở " + text
                setOnClickListener { action() }
            }
            val icon = ImageView(this).apply {
                setImageResource(iconRes)
                setColorFilter(tint)
                background = panelBackground(Color.rgb(235, 248, 245), 11)
                setPadding(dp(8), dp(8), dp(8), dp(8))
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }
            row.addView(icon, LinearLayout.LayoutParams(dp(37), dp(37)).apply {
                marginEnd = dp(12)
            })
            label(row, text, 13f, true, ink).layoutParams =
                LinearLayout.LayoutParams(0, -2, 1f)
            val chevron = TextView(this).apply {
                this.text = "›"
                textSize = 22f
                setTextColor(softInk)
            }
            row.addView(chevron, LinearLayout.LayoutParams(-2, -2).apply {
                marginStart = dp(7)
            })
            settings.addView(row)
        }
        settingRow("Xuất Excel · Hóa đơn / Công nợ / Lợi nhuận",
            R.drawable.ic_satori_excel, Color.rgb(17, 133, 91)) {
            if (current == null)
                Toast.makeText(this, "Cần đồng bộ hóa đơn trước khi xuất.",
                    Toast.LENGTH_LONG).show()
            else requestOwnerExcel(current, current.invoices)
        }
        settingRow("Cài đặt kết nối", R.drawable.ic_satori_settings, cyan) {
            showConnectionSettings()
        }
        settingRow("Chẩn đoán thông báo đẩy (Push)", R.drawable.ic_satori_bell,
            Color.rgb(214, 96, 40)) { showPushDiagnostics() }
        settingRow("Đồng bộ dữ liệu", R.drawable.ic_satori_refresh,
            Color.rgb(22, 126, 184)) { refreshNow() }
        settingRow("Trợ lý Gemini", R.drawable.ic_satori_plus,
            Color.rgb(130, 75, 198)) {
            startActivity(Intent(this, AiCustomerPortalActivity::class.java)
                .putExtra("mode", "admin"))
        }
        parent.addView(settings, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(8)
        })

        val v2 = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
            background = panelBackground(Color.WHITE, 17)
        }
        label(v2, "HỆ THỐNG KHÁCH HÀNG V2", 13f, true, ink)
        label(v2, "Đại lý / CTV • Hồ sơ & địa chỉ • Chính sách chiết khấu • Phân quyền",
            12f, false, muted, 7)
        label(v2, "✓ Dùng tài khoản Google Admin V2 đã xác minh", 12f, true,
            Color.rgb(17, 133, 91), 11)
        label(v2, "Duyệt khách mới → nhập chiết khấu → kích hoạt. " +
            "Tìm khách cũ theo tên/SĐT, sửa hồ sơ, thêm điểm giao và liên kết Gmail. " +
            "Mọi thao tác được kiểm tra quyền trên server, không dùng quyền Drive thay thế.",
            12f, false, muted, 8)
        val pendingV2=V2RegistrationAlerts.pendingCount(this)
        if(pendingV2>0){
            label(v2,"🔔  "+pendingV2+" khách mới đang chờ duyệt",15f,true,
                Color.rgb(178,45,55),8)
        }
        button(v2, "👥  QUẢN LÝ KHÁCH HÀNG V2"+
            (if(pendingV2>0)"  •  "+pendingV2+" mới" else ""), true,
            R.drawable.ic_satori_users) {
            startActivity(Intent(this, V2OwnerCrmActivity::class.java))
        }
        button(v2, "↻  Đồng bộ hóa đơn đang có") { refreshNow() }
        parent.addView(v2, LinearLayout.LayoutParams(-1, -2).apply { topMargin=dp(12) })
    }

    private fun renderOverview(parent: LinearLayout, data: SatoriSnapshot) {
        val marginRows = CtvProfitSourcePolicy.profitRows(data)
        val marginAll = AccountingProMargin45.summarize(
            marginRows, AccountingProMargin45Period.all())
        section(parent,
            (if ((data.collaboratorRegistryLoaded && data.collaborators.isNotEmpty())) "TỔNG LỢI NHUẬN SAU CTV (ƯỚC TÍNH): "
                else "TỔNG LỢI NHUẬN · THIẾU HỒ SƠ CTV: ") +
                (marginAll.estimatedMarginKnownVnd?.let(SatoriData::money)
                    ?: "Chưa đủ dữ liệu"),
            "Tính được " + marginAll.computedInvoiceCount + "/" +
                marginAll.totalInvoiceCount + " hóa đơn hợp lệ có ngày đúng." +
                (if (marginAll.missingInvoiceCount > 0)
                    " Có " + marginAll.missingInvoiceCount + " bill chưa đủ giá/CTV." else "") +
                " Chưa trừ phí giao thực, thuế và chi phí vận hành.")
        button(parent, "XEM LÃI TỪNG BILL · LỌC NGÀY / THÁNG / NĂM",
            false, R.drawable.ic_satori_debt) {
            showMarginPeriod(data)
        }
        label(parent, "Truy cập nhanh", 15f, true, ink, 15)
        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(9), 0, 0)
        }
        actionTile(row1, "Hóa đơn", data.invoices.size.toString() + " hóa đơn",
            Color.rgb(0, 156, 153), R.drawable.ic_satori_invoice) {
            activeTab = 1
            render()
        }
        actionTile(row1, "Khách hàng", "Hồ sơ & địa chỉ",
            Color.rgb(17, 133, 91), R.drawable.ic_satori_users) {
            activeTab = 2
            render()
        }
        parent.addView(row1)
        val row2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(10), 0, 0)
        }
        actionTile(row2, "Công nợ", "Theo dõi cần thu",
            Color.rgb(181, 95, 6), R.drawable.ic_satori_debt) {
            activeTab = 3
            render()
        }
        actionTile(row2, "Lên đơn", if (canWrite) "Tạo hóa đơn mới" else "Cần kết nối API",
            Color.rgb(114, 76, 196), R.drawable.ic_satori_plus) {
            activeTab = 4
            render()
        }
        parent.addView(row2)

        label(parent, "CÔNG CỤ KINH DOANH", 12f, true, cyan, 23)
        val tools1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(10), 0, 0)
        }
        actionTile(tools1, "Bảng giá Satori", data.products.size.toString() + " sản phẩm",
            iconRes = R.drawable.ic_satori_invoice) {
            showCatalogue(data)
        }
        actionTile(tools1, "Sổ kế toán", "Tra cứu & đối chiếu",
            Color.rgb(114, 76, 196), R.drawable.ic_satori_settings) {
            showLedger(data)
        }
        parent.addView(tools1)
        val tools2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(10), 0, 0)
        }
        actionTile(tools2, "Trí nhớ AI", data.customerMemory.size.toString() + " hồ sơ",
            Color.rgb(17, 133, 91), R.drawable.ic_satori_users) {
            showCustomerMemory(data)
        }
        actionTile(tools2, "Đối chiếu giá", "Kiểm tra trùng đơn",
            Color.rgb(181, 95, 6), R.drawable.ic_satori_debt) {
            showPriceComparison(data)
        }
        parent.addView(tools2)
        button(parent, "ĐỐI CHIẾU BẢNG KÊ SATORI  •  XLSX / CSV") {
            supplierStatementPicker.launch(arrayOf(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "text/csv", "text/plain", "application/octet-stream"
            ))
        }
        section(parent, "Cần thu từ khách hàng",
            data.outstandingCount.toString() + " hóa đơn  •  " +
            SatoriData.money(data.outstandingAmount) +
            "\nTrạng thái thanh toán Satori không đồng nghĩa khách đã thanh toán.")

        label(parent, "Hóa đơn gần đây", 15f, true, ink, 16)
        if (data.invoices.isEmpty()) {
            section(parent, "Chưa có hóa đơn", "Đồng bộ lại hoặc tạo hóa đơn trong sandbox.")
        } else {
            data.invoices.take(10).forEach { invoice ->
                section(parent, "#" + invoice.number + "  •  " + invoice.customer,
                    invoice.displayDate + "  •  " + SatoriData.money(invoice.total) +
                        "  •  " + invoice.status) { openInvoice(invoice) }
            }
        }
    }

    // Conservative read-only comparison of delivery price variants, not an
    // imported supplier Excel match. Nothing here writes or deduplicates Drive.
    private fun showPriceComparison(data: SatoriSnapshot) {
        val comparison = SatoriPriceComparison.compare(data.invoices)
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(12))
        }
        label(panel, "ĐỐI CHIẾU HAI BẢN GIÁ · REV " + data.revision,
            14f, true, teal)
        label(panel, "Ghép tự động chỉ khi cùng khách, ngày, số điện thoại, " +
            "địa chỉ, hàng và số lượng; hai bản tạo trong 30 phút và có dấu hiệu " +
            "bản giá. Thiếu bằng chứng → cần kiểm tra. Chỉ đọc dữ liệu.",
            12f, false, muted, 5)
        section(panel, comparison.pairs.size.toString() + " cặp đủ bằng chứng",
            comparison.toReview.size.toString() +
                " nhóm cần kiểm tra · " + comparison.notPairedCount +
                " bản ghi chưa ghép. Chênh lệch giá KHÔNG mặc định là lợi nhuận.")
        val scroll = ScrollView(this)
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(results)
        panel.addView(scroll, LinearLayout.LayoutParams(-1, dp(460)))

        label(results, "CÁC CẶP ĐỦ BẰNG CHỨNG", 13f, true, teal, 11)
        if (comparison.pairs.isEmpty()) label(results,
            "Chưa có cặp nào đủ điều kiện tự ghép.", 12f, false, muted, 7)
        comparison.pairs.take(80).forEach { pair ->
            section(results, "#" + pair.delivery.number + " / #" +
                pair.alternate.number + " · " + pair.delivery.customer,
                pair.delivery.address +
                    "\nBản tính doanh thu: " + SatoriData.money(pair.delivery.total) +
                    " · Bản giá khác: " + SatoriData.money(pair.alternate.total) +
                    "\nChênh lệch hai bản giá: " +
                    SatoriData.money(pair.priceDifference)) {
                AlertDialog.Builder(this)
                    .setTitle("Cặp #" + pair.delivery.number + " / #" +
                        pair.alternate.number)
                    .setMessage("Chỉ đối chiếu, không xóa hoặc cộng trừ hai đơn.\n\n" +
                        "Bản giao: #" + pair.delivery.number + " · " +
                        pair.delivery.status + "\n" +
                        SatoriData.money(pair.delivery.total) +
                        "\nBản giá khác: #" + pair.alternate.number + " · " +
                        pair.alternate.status + "\n" +
                        SatoriData.money(pair.alternate.total))
                    .setPositiveButton("Đóng", null)
                    .show()
            }
        }
        if (comparison.pairs.size > 80) label(results,
            "Chỉ hiển thị 80 cặp đầu tiên.", 11f, false, muted, 5)
        label(results, "CẦN KIỂM TRA THỦ CÔNG", 13f, true, gold, 15)
        if (comparison.toReview.isEmpty()) label(results,
            "Không có nhóm nghi vấn trong dữ liệu hiện tại.", 12f, false, muted, 6)
        comparison.toReview.take(80).forEach { review ->
            section(results, review.invoices.joinToString(" / ") { "#" + it.number },
                review.invoices.first().customer + "\n" + review.reason)
        }
        if (comparison.toReview.size > 80) label(results,
            "Chỉ hiển thị 80 nhóm đầu tiên.", 11f, false, muted, 5)
        AlertDialog.Builder(this)
            .setTitle("ĐỐI CHIẾU SATORI · HAI BẢN GIÁ")
            .setView(panel)
            .setPositiveButton("Đóng", null)
            .show()
    }

    private fun showSupplierStatementReport(filename: String, revision: Long,
                                            report: SupplierReconciliationReport) {
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        label(panel, "BẢNG KÊ: " + filename + " · REV " + revision, 14f, true, teal)
        label(panel, "Chỉ so sánh dữ liệu trong bộ nhớ app. Không sửa hóa đơn, " +
            "không đánh dấu thanh toán, không gửi file lên máy chủ. " +
            "Chênh lệch là Satori trừ tiền hóa đơn nội bộ trước khi xét " +
            "chiết khấu, thuế hay phí giao hàng.", 12f, false, muted, 6)
        section(panel, report.documentCount.toString() + " chứng từ Satori",
            report.matched.toString() + " khớp duy nhất · " +
                report.needsReview + " cần kiểm tra · " +
                report.unmatched + " chưa khớp.")
        val scroll = ScrollView(this)
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(results)
        panel.addView(scroll, LinearLayout.LayoutParams(-1, dp(460)))
        report.items.take(120).forEach { item ->
            val title = when (item.category) {
                "matched" -> "KHỚP"
                "review" -> "CẦN KIỂM TRA"
                else -> "CHƯA KHỚP"
            }
            val amounts = if (item.difference != null)
                "\nSatori: " + SatoriData.money(item.document.amount ?: 0L) +
                    " · Nội bộ: " + SatoriData.money(item.localAmount ?: 0L) +
                    " · Chênh: " + SatoriData.money(item.difference)
                else if (item.document.amount != null)
                    "\nSatori: " + SatoriData.money(item.document.amount)
                else ""
            section(results, title + " · " + item.document.label,
                item.explanation + amounts +
                    (if (item.candidateNumbers.isEmpty()) "" else
                        "\nHĐ ứng viên: " + item.candidateNumbers.joinToString(", ")))
        }
        if (report.items.size > 120) label(results,
            "Đang hiển thị 120 kết quả đầu. Chỉ có dữ liệu trong file đã chọn " +
                "được so sánh.", 12f, false, gold, 7)
        AlertDialog.Builder(this)
            .setTitle("ĐỐI CHIẾU SATORI · CHỈ XEM")
            .setView(panel)
            .setPositiveButton("Đóng", null).show()
    }

    // AI memory comes only from the current verified snapshot. File picker
    // shows the user's selected local copy; server mode enforces customers:read.
    // This native view never trains, edits or overwrites memory on Drive.
    private fun showCustomerMemory(data: SatoriSnapshot) {
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(12))
        }
        label(panel, "TRÍ NHỚ AI · Revision " + data.revision, 14f, true, teal)
        label(panel, "Chỉ xem hồ sơ và các điểm giao đã đồng bộ. " +
            "Không tự thay đổi địa chỉ hoặc chiết khấu khách hàng.",
            12f, false, muted, 5)
        val search = EditText(this).apply {
            hint = "Tên khách, tên người nhận, điện thoại, địa chỉ…"
            setSingleLine(true)
            textSize = 13f
        }
        panel.addView(search, LinearLayout.LayoutParams(-1, dp(48)))
        val scroll = ScrollView(this)
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(results)
        panel.addView(scroll, LinearLayout.LayoutParams(-1, dp(460)))
        fun refresh() {
            results.removeAllViews()
            val q = SatoriData.normalized(search.text.toString())
            val matches = data.customerMemory.filter { memory ->
                val searchable = listOf(
                    memory.name, memory.defaultPhone, memory.defaultLocation,
                    memory.preferredProduct, memory.aliases.joinToString(" "),
                    memory.receivers.joinToString(" ") { r ->
                        r.name + " " + r.phone + " " + r.location
                    }
                ).joinToString(" ")
                q.isBlank() || SatoriData.normalized(searchable).contains(q)
            }
            label(results, matches.size.toString() + " hồ sơ", 12f, true, teal, 8)
            if (data.customerMemory.isEmpty()) label(results,
                "Nguồn hiện tại không cung cấp Trí nhớ AI. Kiểm tra quyền " +
                    "customers:read và đồng bộ lại, không dùng bộ nhớ mặc định giả.",
                12f, false, gold, 10)
            else matches.take(120).forEach { memory ->
                val discount = memory.discountPercent?.let {
                    " · CK " + String.format(java.util.Locale("vi", "VN"), "%.1f%%", it)
                }.orEmpty()
                section(results, memory.name + discount,
                    "Điện thoại: " + memory.defaultPhone +
                        "\nĐịa chỉ thường dùng: " + memory.defaultLocation +
                        "\nSố điểm giao: " + memory.receivers.size +
                        " · Đơn đã học: " + memory.orderCount +
                        (if (memory.preferredProduct.isBlank()) "" else
                            "\nSản phẩm thường mua: " + memory.preferredProduct)) {
                    val points = if (memory.receivers.isEmpty())
                        "Chưa lưu điểm giao riêng." else memory.receivers.joinToString("\n\n") {
                            (if (it.name.isBlank()) "Người nhận" else it.name) +
                                " · " + it.phone + "\n" + it.location
                        }
                    AlertDialog.Builder(this)
                        .setTitle(memory.name + " · Các điểm giao")
                        .setMessage(points)
                        .setPositiveButton("Đóng", null)
                        .show()
                }
            }
            if (matches.size > 120) label(results,
                "Hiển thị 120 hồ sơ đầu tiên; nhập từ khóa để thu hẹp.",
                11f, false, muted, 8)
        }
        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                refresh()
            }
            override fun afterTextChanged(s: Editable?) {}
        })
        refresh()
        AlertDialog.Builder(this).setTitle("TRÍ NHỚ KHÁCH HÀNG")
            .setView(panel).setPositiveButton("Đóng", null).show()
    }

    // Website-parity milestone: browse the actual current catalogue from the
    // verified snapshot. No price editing until owner API permission is proven.
    private fun showCatalogue(data: SatoriSnapshot) {
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(8))
        }
        label(panel, "Giá lấy từ bản dữ liệu đang mở · Revision " + data.revision +
            ". Chỉ xem, không ghi lên Google Drive.", 12f, false, muted)
        val search = EditText(this).apply {
            hint = "Tìm sản phẩm hoặc mã hàng…"
            setSingleLine(true)
            textSize = 14f
        }
        panel.addView(search, LinearLayout.LayoutParams(-1, dp(48)))
        val scroll = ScrollView(this).apply { isFillViewport = false }
        val list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(4), 0, dp(12))
        }
        scroll.addView(list)
        panel.addView(scroll, LinearLayout.LayoutParams(-1, dp(460)))
        fun update() {
            list.removeAllViews()
            val needle = SatoriData.normalized(search.text.toString())
            val products = data.products.filter { product ->
                needle.isBlank() || SatoriData.normalized(
                    product.name + " " + product.code + " " + product.unit
                ).contains(needle)
            }
            label(list, products.size.toString() + " sản phẩm", 12f, true, teal, 8)
            products.forEach { p ->
                val discountText = p.discountPercent?.let { pct ->
                    " · CK " + String.format(java.util.Locale("vi", "VN"), "%.1f%%", pct)
                }.orEmpty()
                section(list, p.name + (if (p.code.isBlank()) "" else " · " + p.code),
                    p.unit + " · Giá niêm yết: " + SatoriData.money(p.listPrice) +
                    " · Đơn giá: " + SatoriData.money(p.unitPrice) + discountText)
            }
            if (products.isEmpty()) {
                label(list, if (data.products.isEmpty())
                    "Chưa có bảng giá trong nguồn dữ liệu này. Hãy đồng bộ lại."
                    else "Không tìm thấy sản phẩm phù hợp.", 12f, false, muted, 12)
            }
        }
        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                update()
            }
            override fun afterTextChanged(s: Editable?) {}
        })
        update()
        AlertDialog.Builder(this)
            .setTitle("BẢNG GIÁ SATORI")
            .setView(panel)
            .setPositiveButton("Đóng", null)
            .show()
    }

    // Native dark controls stay readable even when opened after render() finishes.
    private fun darkSpinner(values: List<String>): Spinner = Spinner(this).apply {
        adapter = object : ArrayAdapter<String>(
            this@NativeMainActivity, android.R.layout.simple_spinner_item, values) {
            private fun style(item: View): View = item.apply {
                if (this is TextView) {
                    setTextColor(ink)
                    setBackgroundColor(Color.rgb(248, 249, 252))
                    setPadding(dp(12), dp(8), dp(12), dp(8))
                    textSize = 13f
                }
            }
            override fun getView(position: Int, convertView: View?,
                parent: android.view.ViewGroup): View =
                style(super.getView(position, convertView, parent))
            override fun getDropDownView(position: Int, convertView: View?,
                parent: android.view.ViewGroup): View =
                style(super.getDropDownView(position, convertView, parent))
        }
        background = panelBackground(Color.rgb(248, 249, 252), 10)
    }

    // Match the website's read-only search, customer, date-range, month/year and
    // sort behavior. Source records and payment status are never mutated here.
    private fun showLedger(data: SatoriSnapshot) {
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(18))
            setBackgroundColor(night)
        }
        val scroll = ScrollView(this).apply {
            setBackgroundColor(night)
            addView(content)
        }
        label(content, "SỔ KẾ TOÁN  •  REVISION " + data.revision, 17f, true, white)
        label(content, "Bộ lọc theo website • Chỉ đọc. Đã TT Satori không có nghĩa khách đã trả.",
            11.5f, false, softInk, 6)

        fun edit(hintText: String): EditText = EditText(this).apply {
            hint = hintText
            setSingleLine(true)
            textSize = 13f
            setTextColor(ink)
            setHintTextColor(softInk)
            background = panelBackground(Color.rgb(248, 249, 252), 10)
            setPadding(dp(12), 0, dp(12), 0)
        }
        fun fieldTitle(title: String) {
            label(content, title, 11.5f, true, cyan, 12)
        }
        fun addField(view: View, height: Int = 44) {
            content.addView(view, LinearLayout.LayoutParams(-1, dp(height)))
        }
        fieldTitle("TÌM HÓA ĐƠN / KHÁCH / SĐT / ĐỊA CHỈ / SẢN PHẨM")
        val search = edit("Ví dụ: #5914, Traky, Satori 500ml")
        addField(search)
        fieldTitle("CHỌN KHÁCH HÀNG")
        val customers = listOf("Tất cả khách") + data.invoices.map { it.customer.trim() }
            .filter { it.isNotEmpty() }.distinct().sortedWith(String.CASE_INSENSITIVE_ORDER)
        val selectedCustomer = darkSpinner(customers)
        addField(selectedCustomer)
        fieldTitle("TÌM THÊM THEO TÊN KHÁCH HOẶC SỐ ĐIỆN THOẠI")
        val customerText = edit("Tên khách / số điện thoại")
        addField(customerText)
        fieldTitle("TRẠNG THÁI")
        val statuses = listOf("Tất cả", "Chưa thanh toán", "Đã thanh toán",
            "Đã TT Satori", "Không Tính", "Đã hủy")
        val status = darkSpinner(statuses)
        addField(status)

        fieldTitle("LỌC THEO THÁNG / NĂM")
        val months = listOf("Tất cả tháng") + (1..12).map {
            "Tháng " + it.toString().padStart(2, '0')
        }
        val years = listOf("Tất cả năm") + data.invoices.filter { it.hasValidDate }
            .map { it.sortDate.substring(0, 4) }.distinct().sortedDescending()
        val month = darkSpinner(months)
        val year = darkSpinner(years)
        val calendarRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        calendarRow.addView(month, LinearLayout.LayoutParams(0, dp(45), 1f))
        calendarRow.addView(year, LinearLayout.LayoutParams(0, dp(45), 1f).apply {
            marginStart = dp(7)
        })
        content.addView(calendarRow)

        fieldTitle("KHOẢNG NGÀY: TỪ NGÀY → ĐẾN NGÀY")
        var fromIso = ""
        var toIso = ""
        lateinit var refresh: () -> Unit
        var currentFiltered: List<SatoriInvoice> = emptyList()
        fun dateButton(): TextView = TextView(this).apply {
            setTextColor(ink)
            textSize = 12f
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), 0, dp(8), 0)
            background = panelBackground(Color.rgb(248, 249, 252), 10)
        }
        val fromDate = dateButton()
        val toDate = dateButton()
        fun updateDateText() {
            fromDate.text = "Từ: " + fromIso.ifBlank { "Chọn" }
            toDate.text = "Đến: " + toIso.ifBlank { "Chọn" }
        }
        fun pick(initial: String, setValue: (String) -> Unit) {
            val current = runCatching { java.time.LocalDate.parse(initial) }
                .getOrDefault(java.time.LocalDate.now())
            android.app.DatePickerDialog(this, { _, yy, mm, dd ->
                setValue(java.time.LocalDate.of(yy, mm + 1, dd).toString())
                updateDateText()
                refresh()
            }, current.year, current.monthValue - 1, current.dayOfMonth).show()
        }
        fromDate.setOnClickListener { pick(fromIso) { fromIso = it } }
        toDate.setOnClickListener { pick(toIso) { toIso = it } }
        val range = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        range.addView(fromDate, LinearLayout.LayoutParams(0, dp(45), 1f))
        range.addView(toDate, LinearLayout.LayoutParams(0, dp(45), 1f).apply {
            marginStart = dp(7)
        })
        content.addView(range)
        updateDateText()

        val quick = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fun addPreset(title: String, onTap: () -> Unit) {
            val chip = TextView(this).apply {
                text = title
                gravity = Gravity.CENTER
                textSize = 11f
                setTextColor(cyan)
                background = panelBackground(Color.rgb(248, 249, 252), 10)
                isClickable = true
                setOnClickListener { onTap() }
            }
            quick.addView(chip, LinearLayout.LayoutParams(0, dp(41), 1f).apply {
                marginStart = dp(4)
            })
        }
        fun setDates(from: java.time.LocalDate, to: java.time.LocalDate) {
            fromIso = from.toString()
            toIso = to.toString()
            month.setSelection(0)
            year.setSelection(0)
            updateDateText()
            refresh()
        }
        val today = java.time.LocalDate.now()
        addPreset("Hôm nay") { setDates(today, today) }
        addPreset("7 ngày") { setDates(today.minusDays(6), today) }
        addPreset("Tháng này") { setDates(today.withDayOfMonth(1), today) }
        addPreset("Tháng trước") {
            val previous = today.withDayOfMonth(1).minusDays(1)
            setDates(previous.withDayOfMonth(1), previous)
        }
        content.addView(quick, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(7) })

        fieldTitle("SẮP XẾP HÓA ĐƠN")
        val sortNames = listOf("Ngày mới nhất", "Ngày cũ nhất", "Doanh thu cao nhất",
            "Doanh thu thấp nhất", "Số HĐ giảm dần", "Số HĐ tăng dần")
        val sortIds = listOf("date_desc", "date_asc", "revenue_desc",
            "revenue_asc", "invoice_desc", "invoice_asc")
        val sort = darkSpinner(sortNames)
        addField(sort)

        val totalsView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(11), dp(12), dp(11))
            background = panelBackground(Color.rgb(238, 245, 252))
        }
        content.addView(totalsView, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(12)
        })
        // Keep the reset control above the (potentially long) results list.
        val rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(rows)

        refresh = {
            val invalidRange = fromIso.isNotBlank() && toIso.isNotBlank() && fromIso > toIso
            val customerChoice = customers.getOrNull(selectedCustomer.selectedItemPosition)
                .orEmpty()
            val filtered = if (invalidRange) emptyList() else SatoriLedger.queryAdvanced(
                data.invoices, SatoriLedgerFilter(
                    search = search.text.toString(),
                    status = statuses[status.selectedItemPosition.coerceIn(0, statuses.lastIndex)],
                    customer = customerText.text.toString(),
                    fromIso = fromIso,
                    toIso = toIso,
                    month = month.selectedItemPosition.takeIf { it > 0 },
                    year = years.getOrNull(year.selectedItemPosition)
                        ?.takeUnless { it == "Tất cả năm" }?.toIntOrNull(),
                    sort = sortIds[sort.selectedItemPosition.coerceIn(0, sortIds.lastIndex)]
                )
            ).filter { customerChoice == "Tất cả khách" ||
                it.customer.equals(customerChoice, ignoreCase = true) }
            currentFiltered = filtered
            val t = SatoriLedger.totals(filtered)
            totalsView.removeAllViews()
            rows.removeAllViews()
            if (invalidRange) label(totalsView, "⚠ Ngày bắt đầu sau ngày kết thúc.",
                12f, true, Color.rgb(181, 95, 6))
            label(totalsView, "PHẠM VI LỌC: " + t.recordCount + " hóa đơn",
                12f, true, cyan)
            label(totalsView, "Doanh thu: " + SatoriData.money(t.revenue),
                16f, true, white, 5)
            label(totalsView, "Đã thu: " + SatoriData.money(t.customerPaid) +
                "   •   Cần thu: " + SatoriData.money(t.customerUnpaid),
                12f, true, Color.rgb(17, 133, 91), 5)
            label(totalsView, "Tính doanh thu: " + t.countedCount +
                "   •   Loại trừ: " + t.excludedCount, 11f, false, softInk, 5)
            if (t.invalidDateCount > 0) label(totalsView,
                "⚠ " + t.invalidDateCount + " ngày hóa đơn cần kiểm tra",
                11f, false, Color.rgb(181, 95, 6), 5)
            label(rows, "DANH SÁCH HÓA ĐƠN (" + filtered.size + ")", 13f, true, cyan, 12)
            filtered.take(150).forEach { inv ->
                ledgerInvoiceCard(rows, inv)
            }
            if (filtered.size > 150) label(rows,
                "Đang hiển thị 150 hóa đơn đầu. Hãy thu hẹp bộ lọc.",
                11f, false, softInk, 8)
            if (filtered.isEmpty()) label(rows, "Không có hóa đơn phù hợp.",
                12f, false, softInk, 8)
        }
        val selection = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: android.widget.AdapterView<*>?,
                v: View?, pos: Int, id: Long) { refresh() }
            override fun onNothingSelected(p: android.widget.AdapterView<*>?) {}
        }
        listOf(selectedCustomer, status, month, year, sort).forEach {
            it.onItemSelectedListener = selection
        }
        listOf(search, customerText).forEach { input ->
            input.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int,
                    count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int,
                    before: Int, count: Int) { refresh() }
                override fun afterTextChanged(s: Editable?) {}
            })
        }
        button(content, "XUẤT EXCEL ĐƠN ĐANG LỌC (.XLSX)",
            iconRes = R.drawable.ic_satori_excel) {
            if (fromIso.isNotBlank() && toIso.isNotBlank() && fromIso > toIso)
                Toast.makeText(this, "Khoảng ngày không hợp lệ.", Toast.LENGTH_LONG).show()
            else requestOwnerExcel(data, currentFiltered)
        }
        button(content, "↻ XÓA TẤT CẢ BỘ LỌC") {
            fromIso = ""
            toIso = ""
            updateDateText()
            search.setText("")
            customerText.setText("")
            listOf(selectedCustomer, status, month, year, sort).forEach { it.setSelection(0) }
            refresh()
        }
        content.removeView(rows)
        content.addView(rows)
        refresh()
        val dialog = AlertDialog.Builder(this)
            .setView(scroll).setPositiveButton("Đóng", null).create()
        dialog.show()
        dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(night))
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(cyan)
        dialog.window?.setLayout(
            (resources.displayMetrics.widthPixels * .96f).toInt(),
            (resources.displayMetrics.heightPixels * .87f).toInt())
    }

    /**
     * Compact, iOS-inspired cards: separate identity, contact/address and
     * money so long Vietnamese addresses never compete with the amount.
     * Actions use the exact same owner-only soft-delete pathway as the detail.
     */
    private fun infoStrip(parent: LinearLayout, value: String, tint: Int) {
        val strip = TextView(this).apply {
            text = value
            textSize = 11.5f
            setTextColor(tint)
            maxLines = 3
            setPadding(dp(10), dp(7), dp(10), dp(7))
            background = panelBackground(Color.rgb(248, 249, 252), 10)
            includeFontPadding = false
        }
        parent.addView(strip, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(6)
        })
    }

    private fun compactAction(text: String, color: Int, action: () -> Unit): TextView =
        TextView(this).apply {
            this.text = text
            gravity = Gravity.CENTER
            textSize = 11.5f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(color)
            setPadding(dp(13), dp(8), dp(13), dp(8))
            minHeight = dp(37)
            background = panelBackground(Color.rgb(233, 243, 254), 11)
            isClickable = true
            isFocusable = true
            contentDescription = text
            setOnClickListener { action() }
        }

    /**
     * Read-only profit badge under the invoice amount, at the top-right of
     * the same card. Both invoice and debt tabs call this shared layout.
     * Does not change payment, edit, delete, or invoice write handlers.
     */
    private fun showProfitInsideInvoiceCard(parent: LinearLayout,
                                            row: AccountingProMargin45Row?,
                                            hasCtvRegistry: Boolean) {
        val card = parent.getChildAt(parent.childCount - 1) as? LinearLayout ?: return
        val header = card.getChildAt(0) as? LinearLayout ?: return
        val amount = header.getChildAt(header.childCount - 1) as? TextView ?: return
        header.removeView(amount)
        val right = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.END
        }
        amount.gravity = Gravity.END
        right.addView(amount, LinearLayout.LayoutParams(-2, -2))
        val value = row?.estimatedOwnerMarginVnd?.let(SatoriData::money)
        val labelName = "Lợi nhuận"
        val badge = TextView(this).apply {
            text = labelName + "  " +
                (if (hasCtvRegistry) (value ?: "Chưa rõ") else "Chờ dữ liệu CTV")
            textSize = 11f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(invoiceMoneyRed)
            setPadding(dp(8), dp(5), dp(8), dp(5))
            gravity = Gravity.CENTER
            includeFontPadding = false
            maxLines = 1
            setAutoSizeTextTypeUniformWithConfiguration(9, 11, 1,
                android.util.TypedValue.COMPLEX_UNIT_SP)
            background = panelBackground(Color.rgb(255, 243, 241), 9)
            contentDescription = labelName + ": " +
                (if (hasCtvRegistry) (value ?: "Chưa đủ dữ liệu")
                    else "Mobile API chưa trả hồ sơ CTV. Đồng bộ Google Drive hoặc cập nhật Mobile API.")
        }
        right.addView(badge, LinearLayout.LayoutParams(-2, -2).apply {
            topMargin = dp(6)
        })
        header.addView(right, LinearLayout.LayoutParams(-2, -2))
    }

    /**
     * Native edit entrypoint, never a local ledger mutation. The button on
     * each card must open the editor directly when the owner API is available,
     * and give actionable connection steps instead of silently doing nothing.
     */
    private fun requestInvoiceEdit(original: SatoriInvoice) {
        val latest = snapshot?.invoices?.singleOrNull { current ->
            current.id == original.id && current.number == original.number
        }
        if (latest == null || latest != original) {
            AlertDialog.Builder(this)
                .setTitle("Hóa đơn đã thay đổi")
                .setMessage("Không xác minh được đúng bản hóa đơn hiện tại. " +
                    "Đồng bộ lại trước khi sửa để tránh ghi đè dữ liệu mới.")
                .setNegativeButton("Đóng", null)
                .setPositiveButton("Đồng bộ") { _, _ -> syncPreferredSource() }
                .show()
            return
        }
        if (!latest.canEditOrDelete || latest.number.toIntOrNull()?.takeIf { it > 0 } == null) {
            AlertDialog.Builder(this)
                .setTitle("Hóa đơn không được phép sửa")
                .setMessage("Chỉ sửa hóa đơn chưa thanh toán, chưa đối soát, không phải " +
                    "bản nội bộ CTV hoặc hóa đơn đã hủy.")
                .setPositiveButton("Đóng", null).show()
            return
        }
        val identity = snapshot?.let { data ->
            AccountingProReadOnly.invoiceRows(data.invoices)
                .singleOrNull { row -> row.invoice === latest }
        }
        if (identity?.identityReliable != true) {
            AlertDialog.Builder(this)
                .setTitle("Mã hóa đơn cần đối chiếu")
                .setMessage("ID hoặc số hóa đơn trùng/không đáng tin cậy. " +
                    "Tạm khóa sửa để không ghi vào hóa đơn khác.")
                .setPositiveButton("Đóng", null).show()
            return
        }
        if (!canAction("orders.update")) {
            val reason = when {
                apiEndpoint == null -> "Chưa cấu hình Mobile API quản trị."
                pendingWrite != null || pendingStorageError ->
                    "Đang có thao tác ghi chưa được xác minh. Hãy đối chiếu trước."
                dataSource != "Minh Satori API" ->
                    "Đang ở chế độ xem Google Drive, không có quyền ghi."
                else -> "Mobile API chưa cấp quyền orders.update cho chủ tài khoản."
            }
            AlertDialog.Builder(this)
                .setTitle("Kết nối quyền sửa hóa đơn")
                .setMessage(reason + "\n\nSửa hóa đơn thật phải qua Mobile API " +
                    "đã xác thực Google Owner. Không ghi trực tiếp vào Drive.")
                .setNegativeButton("Đóng", null)
                .setPositiveButton("Kết nối / Kiểm tra") { _, _ -> showConnectionSettings() }
                .show()
            return
        }
        launchEditor(editing = latest)
    }

    private fun invoiceQuickCard(parent: LinearLayout, invoice: SatoriInvoice,
                                 fromDebt: Boolean = false) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(13), dp(12), dp(13), dp(12))
            background = panelBackground(Color.rgb(255, 255, 255), 16)
        }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val code = TextView(this).apply {
            text = "HÓA ĐƠN #" + invoice.number
            textSize = 13.5f
            setTextColor(Color.rgb(25, 104, 181))
            setTypeface(typeface, Typeface.BOLD)
        }
        top.addView(code, LinearLayout.LayoutParams(0, -2, 1f))
        val amount = TextView(this).apply {
            text = SatoriData.money(invoice.displayPayable)
            textSize = 15f
            setTextColor(if (fromDebt) Color.rgb(181, 95, 6)
                else Color.rgb(17, 133, 91))
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.END
        }
        top.addView(amount, LinearLayout.LayoutParams(-2, -2))
        card.addView(top)
        label(card, "👤 " + invoice.customer, 14f, true, white, 9)
        infoStrip(card, "☎  " + invoice.phone.ifBlank { "Chưa có số điện thoại" },
            Color.rgb(18, 128, 88))
        infoStrip(card, "📍  " + invoice.address.ifBlank { "Chưa có địa chỉ" },
            Color.rgb(25, 104, 181))
        // Dates remain neutral; payment statuses use the same semantic tint
        // in Hóa đơn and Công nợ (unpaid amber, paid green).
        val statusColor = when {
            invoice.isNonCounted -> Color.rgb(105, 74, 164)
            invoice.isCancelled -> Color.rgb(190, 40, 48)
            invoice.status.contains("chưa thanh toán", ignoreCase = true) ->
                Color.rgb(181, 95, 6)
            invoice.status.contains("đã thanh toán", ignoreCase = true) ->
                Color.rgb(16, 122, 78)
            else -> softInk
        }
        val statusLine = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, 0)
        }
        label(statusLine, invoice.displayDate + "   •   ", 11f, false, softInk)
        label(statusLine, invoice.status, 11f, true, statusColor)
        card.addView(statusLine)
        if (invoice.creationTimeLabel.isNotBlank()) label(card,
            "Tạo lúc: " + invoice.creationTimeLabel, 11f, false, softInk, 4)
        if (invoice.isNonCounted) {
            label(card, "Không tính doanh thu / công nợ • Giá gốc: " +
                SatoriData.money(invoice.total), 11f, false, softInk, 5)
        }
        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            setPadding(0, dp(9), 0, 0)
        }
        actions.addView(compactAction("Xem chi tiết", cyan) { openInvoice(invoice) },
            LinearLayout.LayoutParams(0, dp(38), 1f))
        if (invoice.canEditOrDelete) {
            actions.addView(compactAction("Sửa", cyan) {
                requestInvoiceEdit(invoice)
            }, LinearLayout.LayoutParams(-2, dp(38)).apply { marginStart = dp(8) })
        }
        if (invoice.canEditOrDelete) {
            actions.addView(compactAction("🗑 Xóa đơn",
                if (canAction("orders.delete")) Color.rgb(215, 44, 43)
                else Color.rgb(110, 110, 115)) {
                confirmSoftDelete(invoice)
            }, LinearLayout.LayoutParams(-2, dp(38)).apply { marginStart = dp(8) })
        }
        card.addView(actions)
        parent.addView(card, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(9)
        })
    }

    /** One guarded soft-delete from the invoice list, debt list and detail. */
    private fun confirmSoftDelete(invoice: SatoriInvoice, after: (() -> Unit)? = null) {
        val number = invoice.number.toIntOrNull()?.takeIf { it > 0 }
        if (!invoice.canEditOrDelete || number == null) {
            Toast.makeText(this, "Hóa đơn này không đủ điều kiện xóa.", Toast.LENGTH_LONG).show()
            return
        }
        if (!canAction("orders.delete")) {
            AlertDialog.Builder(this)
                .setTitle("Cần quyền xóa của chủ tài khoản")
                .setMessage("Kết nối Mobile API Production bằng Google của chủ tài khoản " +
                    "và bật quyền orders.delete. Chế độ xem Drive không được phép xóa.")
                .setNegativeButton("Đóng", null)
                .setPositiveButton("Cài đặt kết nối") { _, _ -> showConnectionSettings() }
                .show()
            return
        }
        val current = snapshot?.invoices?.find { it.id == invoice.id }
        if (current == null || current.number != invoice.number ||
            current.customer != invoice.customer || current.total != invoice.total) {
            Toast.makeText(this, "Dữ liệu hóa đơn đã thay đổi. Làm mới trước khi xóa.",
                Toast.LENGTH_LONG).show()
            return
        }
        val requestId = UUID.randomUUID().toString().replace("-", "")
        AlertDialog.Builder(this)
            .setTitle("Chuyển hóa đơn #" + number + " vào thùng rác?")
            .setMessage("Khách: " + invoice.customer + "\n" +
                "Số tiền: " + SatoriData.money(invoice.total) +
                "\n\nXóa mềm trên Google Drive. Có thể khôi phục trong 30 ngày. " +
                "Các đơn đã thanh toán và đơn đối soát được bảo vệ.")
            .setNegativeButton("Hủy", null)
            .setPositiveButton("XÁC NHẬN XÓA") { _, _ ->
                // No local deletion and no optimistic count change.
                val payload = JSONObject()
                    .put("expectedRevision", snapshot?.revision ?: -1)
                    .put("requestId", requestId)
                    .put("id", invoice.id)
                    .put("invoiceNo", number)
                    .put("expectedName", invoice.customer)
                    .put("expectedTotal", invoice.total)
                    .put("confirmed", true)
                executeWrite("orders.delete", payload) { success, _ ->
                    if (success) after?.invoke()
                }
            }
            .show()
    }

    private fun styleUi25dInvoiceCard(parent: LinearLayout) {
        val card = parent.getChildAt(parent.childCount - 1) as? LinearLayout ?: return
        card.background = panelBackground(Color.WHITE, 21)
        card.elevation = if (SatoriUiTheme.raised(this)) dp(5).toFloat() else 0f
    }

    private fun renderInvoices(parent: LinearLayout, data: SatoriSnapshot) {
        if (currentInvoiceBadge().count > 0) {
            val pending = currentInvoiceBadge().count
            val freshNumbers = data.invoices.filter {
                it.number.toLongOrNull()?.let { no -> no in currentInvoiceBadge().unread } == true
            }.take(5).joinToString(" · ") { "#" + it.number }
            val banner = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(12), dp(9), dp(12), dp(9))
                background = panelBackground(Color.rgb(255, 237, 237), 12)
            }
            val message = if (freshNumbers.isBlank()) "🔔  $pending hóa đơn mới chưa xem"
                else "🔔  $pending đơn mới · $freshNumbers"
            label(banner, message, 13f, true, Color.rgb(176, 35, 45))
            banner.addView(compactAction("Đã xem", teal) {
                acknowledgeInvoiceBadge()
                render()
            }, LinearLayout.LayoutParams(-2, dp(38)).apply { marginStart = dp(9) })
            parent.addView(banner, LinearLayout.LayoutParams(-1, -2).apply {
                bottomMargin = dp(9)
            })
        }
        // MoneyMind: compact toolbar instead of three full-width CTA blocks.
        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(4), 0, dp(7))
        }
        fun tool(text: String, tint: Int, action: () -> Unit) {
            toolbar.addView(compactAction(text, tint) { action() },
                LinearLayout.LayoutParams(0, dp(42), 1f).apply {
                    marginEnd = dp(5)
                })
        }
        tool("☷ Lọc sổ", cyan) { showLedger(data) }
        if (canWrite) tool("+ Tạo đơn", Color.rgb(16, 122, 78)) { launchEditor() }
        if (canAction("mobile.trash") && canAction("orders.restore")) {
            tool("Thùng rác", Color.rgb(197, 66, 76)) { showTrash() }
        } else if (preferredSource() == AutoSyncPolicy.DRIVE) {
            tool("Quyền ghi", Color.rgb(173, 105, 18)) {
                AlertDialog.Builder(this)
                    .setTitle("Chế độ chỉ đọc Google Drive")
                    .setMessage("Muốn sửa, xóa mềm hoặc khôi phục hóa đơn, hãy kết nối Mobile API chủ tài khoản đã xác thực. Drive không được phép ghi trực tiếp.")
                    .setNegativeButton("Đóng", null)
                    .setPositiveButton("Kết nối") { _, _ -> showConnectionSettings() }
                    .show()
            }
        }
        parent.addView(toolbar)
        val salesTotal = data.invoices.filterNot { it.isExcluded }.sumOf { it.total }
        val salesSummary = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(11), dp(14), dp(11))
            background = panelBackground(Color.WHITE, 21)
            elevation = if (SatoriUiTheme.raised(this@NativeMainActivity)) dp(5).toFloat() else 0f
        }
        label(salesSummary, "TỔNG TIỀN BÁN", 11f, true, softInk)
        val salesAmount = label(salesSummary, SatoriData.money(salesTotal),
            21f, true, invoiceMoneyRed, 5)
        fitCardNumber(salesAmount)
        val countSummary = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(11), dp(14), dp(11))
            background = panelBackground(Color.WHITE, 21)
            elevation = if (SatoriUiTheme.raised(this@NativeMainActivity)) dp(5).toFloat() else 0f
        }
        label(countSummary, "TỔNG HÓA ĐƠN", 11f, true, softInk)
        val invoiceCount = label(countSummary,
            data.invoices.count { !it.isExcluded }.toString(), 21f, true, cyan, 5)
        fitCardNumber(invoiceCount)
        val salesRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        // Fix the two statistic cards to the same height regardless of amount wrapping.
        salesRow.addView(salesSummary, LinearLayout.LayoutParams(0, dp(110), 1f).apply {
            marginEnd = dp(5)
        })
        salesRow.addView(countSummary, LinearLayout.LayoutParams(0, dp(110), 1f).apply {
            marginStart = dp(5)
        })
        parent.addView(salesRow, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(10)
        })
        val input = EditText(this).apply {
            hint = "Tìm mã hóa đơn, khách, SĐT..."
            textSize = 14f
            setSingleLine(true)
            setTextColor(ink)
            setHintTextColor(softInk)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = panelBackground(Color.rgb(248, 249, 252), 11)
            setText(searchText)
        }
        parent.addView(input, LinearLayout.LayoutParams(-1, dp(48)).apply {
            topMargin = dp(6)
        })
        val statuses = listOf("Tất cả", "Chưa thanh toán", "Đã thanh toán",
            "Đã TT Satori", "Không Tính", "Đã hủy")
        // Direct chip selection: a hidden Spinner can lose click callbacks on
        // some Android/Fold layouts. Keep the selection in native screen state.
        var refreshList: () -> Unit = {}
        val chipScroll = android.widget.HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            setPadding(0, dp(4), 0, dp(4))
        }
        val chipRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val chips = mutableListOf<TextView>()
        statuses.forEachIndexed { index, title ->
            val chip = TextView(this).apply {
                text = title
                gravity = Gravity.CENTER
                textSize = 11f
                setTypeface(typeface, Typeface.BOLD)
                setPadding(dp(13), dp(11), dp(13), dp(11))
                isClickable = true
                isFocusable = true
                contentDescription = "Lọc " + title
                setOnClickListener {
                    selectedInvoiceStatusIndex = index
                    refreshList()
                }
            }
            chips.add(chip)
            chipRow.addView(chip, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(6) })
        }
        chipScroll.addView(chipRow)
        parent.addView(chipScroll, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4) })
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        parent.addView(list)
        val marginByInvoice =
            java.util.IdentityHashMap<SatoriInvoice, AccountingProMargin45Row>().apply {
                CtvProfitSourcePolicy.profitRows(data).forEach {
                    put(it.invoice, it)
                }
            }
        if (!(data.collaboratorRegistryLoaded && data.collaborators.isNotEmpty())) {
            label(parent, "⚠ Chưa có hồ sơ CTV từ " + dataSource +
                ". Lợi nhuận chưa được tính; kết nối Drive chỉ đọc hoặc cập nhật Mobile API.",
                11.5f, true, invoiceMoneyRed, 7)
        }
        fun updateList() {
            list.removeAllViews()
            val selected = selectedInvoiceStatusIndex.coerceIn(0, statuses.lastIndex)
            val status = statuses[selected]
            chips.forEachIndexed { i, chip ->
                chip.setTextColor(if (i == selected) SatoriUiTheme.onAccent(this@NativeMainActivity) else softInk)
                chip.background = panelBackground(if (i == selected) cyan else Color.WHITE, 13)
                chip.elevation = if (i == selected && SatoriUiTheme.raised(this@NativeMainActivity))
                    dp(2).toFloat() else 0f
            }
            val matching = InvoiceScreenFilter.apply(
                data.invoices, selected, searchText)

            label(list, "Tìm thấy " + matching.size + " hóa đơn" +
                (if (status != "Tất cả") " • " + status else ""),
                11.5f, true, cyan, 7)
            matching.take(120).forEach { inv ->
                invoiceQuickCard(list, inv)
                styleUi25dInvoiceCard(list)
                if (!inv.isExcluded)
                    showProfitInsideInvoiceCard(list, marginByInvoice[inv],
                        (data.collaboratorRegistryLoaded && data.collaborators.isNotEmpty()))
            }
            // Filter/search callbacks build cards *after* render(); normalize
            // prices here as well so old green inline TextViews cannot reappear.
            highlightMoneyInView(list)
        }
        refreshList = { updateList() }
        input.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                searchText = s?.toString() ?: ""
                updateList()
            }
            override fun afterTextChanged(s: Editable?) {}
        })
        updateList()
    }

    /**
     * One consistent, accessible contact row in customer cards, profile details,
     * and the invoice modal. Text labels remain visible without relying on color.
     */
    private fun customerInfoRow(parent: LinearLayout, iconRes: Int,
                                title: String, value: String,
                                tint: Int, fill: Int) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = panelBackground(fill, 12)
        }
        val glyph = ImageView(this).apply {
            setImageResource(iconRes)
            setColorFilter(tint)
            setPadding(dp(4), dp(4), dp(4), dp(4))
            contentDescription = title
        }
        row.addView(glyph, LinearLayout.LayoutParams(dp(36), dp(36)).apply {
            marginEnd = dp(10)
        })
        val detail = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        label(detail, title, 10.5f, true, tint)
        val actual = label(detail, value, 14f, true, ink, 3)
        actual.setLineSpacing(dp(2).toFloat(), 1f)
        row.addView(detail, LinearLayout.LayoutParams(0, -2, 1f))
        parent.addView(row, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(8)
        })
    }

    /**
     * Sổ kế toán / filtered results: the same customer identity hierarchy as
     * customer profiles, rather than one grey multi-line accounting string.
     * This is read-only; tapping still opens the original invoice detail.
     */
    private fun ledgerInvoiceCard(parent: LinearLayout, invoice: SatoriInvoice) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(13), dp(13), dp(13), dp(12))
            background = panelBackground(surface, 16)
            isClickable = true
            isFocusable = true
            contentDescription = "Hóa đơn số " + invoice.number + ", khách " +
                invoice.customer + ", " + invoice.status + ", " +
                SatoriData.money(invoice.displayPayable)
            setOnClickListener { openInvoice(invoice) }
        }
        val headline = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val invoiceTitle = label(headline, "HÓA ĐƠN #" + invoice.number,
            16f, true, ink)
        headline.removeView(invoiceTitle)
        headline.addView(invoiceTitle, LinearLayout.LayoutParams(0, -2, 1f))
        val amount = label(headline, SatoriData.money(invoice.displayPayable),
            16f, true, if (invoice.isNonCounted) Color.rgb(105, 74, 164) else cyan)
        headline.removeView(amount)
        headline.addView(amount, LinearLayout.LayoutParams(-2, -2).apply {
            marginStart = dp(8)
        })
        card.addView(headline)
        label(card, invoice.displayDate, 11.5f, false, softInk, 5)
        if (invoice.creationTimeLabel.isNotBlank()) label(card,
            "Tạo lúc: " + invoice.creationTimeLabel, 11f, false, softInk, 4)
        if (invoice.isNonCounted) {
            label(card, "KHÔNG TÍNH • GIÁ TRỊ 0 đ", 12f, true,
                Color.rgb(105, 74, 164), 7)
            label(card, "Giá gốc để đối soát: " + SatoriData.money(invoice.total),
                11f, false, softInk, 4)
        } else if (invoice.isCancelled) {
            label(card, "⊘ HÓA ĐƠN ĐÃ HỦY", 12f, true, Color.rgb(190, 40, 48), 7)
            if (invoice.customerPaidAt.isNotBlank() || invoice.satoriPaidAt.isNotBlank())
                label(card, "Có lịch sử thanh toán • cần đối soát", 11f, true,
                    Color.rgb(155, 91, 30), 4)
        } else {
            val customerStatus = if (invoice.customerHasPaid) "✓ Khách đã thanh toán"
                                 else "● Khách chưa thanh toán"
            label(card, customerStatus, 12f, true,
                if (invoice.customerHasPaid) Color.rgb(16, 122, 78)
                else Color.rgb(171, 95, 18), 7)
            val satoriStatus = if (invoice.satoriHasPaid) "✓ Đã thanh toán Satori"
                               else "○ Chưa thanh toán Satori"
            label(card, satoriStatus, 11f, true,
                if (invoice.satoriHasPaid) Color.rgb(16, 122, 78)
                else softInk, 4)
        }
        if (invoice.isLinkedPairBill) {
            label(card, invoice.pairLabel, 11.5f, true, cyan, 7)
        }
        val who = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(10), 0, 0)
        }
        val userIcon = ImageView(this).apply {
            setImageResource(R.drawable.ic_satori_users)
            setColorFilter(cyan)
            contentDescription = "Tên khách hàng"
        }
        who.addView(userIcon, LinearLayout.LayoutParams(dp(22), dp(22)).apply {
            marginEnd = dp(9)
        })
        val customerName = label(who, invoice.customer.ifBlank { "Chưa có tên khách" },
            15f, true, ink)
        customerName.maxLines = 3
        card.addView(who)
        customerInfoRow(card, R.drawable.ic_satori_phone,
            "SỐ ĐIỆN THOẠI", invoice.phone.ifBlank { "Chưa có số điện thoại" },
            Color.rgb(16, 122, 78), Color.rgb(234, 249, 241))
        customerInfoRow(card, R.drawable.ic_satori_map_pin,
            "ĐỊA CHỈ GIAO HÀNG", invoice.address.ifBlank { "Chưa có địa chỉ" },
            Color.rgb(17, 103, 177), Color.rgb(236, 245, 255))
        val products = invoice.lines.joinToString(", ") {
            it.description + " x" + it.quantity
        }
        label(card, "SẢN PHẨM", 10.5f, true, softInk, 10)
        label(card, products.ifBlank { "Chưa có sản phẩm" },
            12.5f, false, ink, 3)
        label(card, "Xem chi tiết hóa đơn", 11.5f, true, cyan, 9)
        parent.addView(card, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(9)
        })
    }

    private fun customerQuickCard(parent: LinearLayout, customer: SatoriInvoice,
                                  count: Int, onClick: () -> Unit) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(13), dp(13), dp(13), dp(12))
            background = panelBackground(surface, 20)
            elevation = if (SatoriUiTheme.raised(this@NativeMainActivity)) dp(4).toFloat() else 0f
            isClickable = true
            isFocusable = true
            contentDescription = "Xem khách " + customer.customer + ", " + count + " hóa đơn"
            setOnClickListener { onClick() }
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val avatar = ImageView(this).apply {
            setImageResource(R.drawable.ic_satori_users)
            setColorFilter(cyan)
            background = panelBackground(Color.rgb(232, 242, 255), 12)
            setPadding(dp(11), dp(11), dp(11), dp(11))
            contentDescription = "Hồ sơ khách hàng"
        }
        header.addView(avatar, LinearLayout.LayoutParams(dp(46), dp(46)).apply {
            marginEnd = dp(10)
        })
        val identity = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        val customerName = label(identity,
            customer.customer.ifBlank { "Chưa có tên khách hàng" }, 16f, true, ink)
        customerName.maxLines = 2
        label(identity, "HỒ SƠ KHÁCH HÀNG", 10f, true, softInk, 4)
        header.addView(identity, LinearLayout.LayoutParams(0, -2, 1f))
        val countBadge = TextView(this).apply {
            text = "$count đơn"
            textSize = 11f
            setTextColor(cyan)
            setTypeface(typeface, Typeface.BOLD)
            background = panelBackground(Color.rgb(232, 242, 255), 11)
            setPadding(dp(9), dp(7), dp(9), dp(7))
            includeFontPadding = false
        }
        header.addView(countBadge, LinearLayout.LayoutParams(-2, -2).apply {
            marginStart = dp(8)
        })
        card.addView(header)

        customerInfoRow(card, R.drawable.ic_satori_phone,
            "SỐ ĐIỆN THOẠI", customer.phone.ifBlank { "Chưa có số điện thoại" },
            Color.rgb(16, 122, 78), Color.rgb(234, 249, 241))
        customerInfoRow(card, R.drawable.ic_satori_map_pin,
            "ĐỊA CHỈ GIAO HÀNG", customer.address.ifBlank { "Chưa có địa chỉ" },
            Color.rgb(17, 103, 177), Color.rgb(236, 245, 255))
        val footer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(2), dp(10), 0, 0)
        }
        val eye = ImageView(this).apply {
            setImageResource(R.drawable.ic_satori_eye)
            setColorFilter(cyan)
            contentDescription = "Xem chi tiết"
        }
        footer.addView(eye, LinearLayout.LayoutParams(dp(18), dp(18)).apply {
            marginEnd = dp(7)
        })
        label(footer, "Xem hồ sơ & lịch sử hóa đơn", 12f, true, cyan)
        card.addView(footer)
        parent.addView(card, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(10)
        })
    }

    private fun renderCustomers(parent: LinearLayout, data: SatoriSnapshot) {
        label(parent, "Khách trùng tên nhưng khác địa chỉ hoặc điện thoại được tách riêng.",
            12f, false, muted, 12)
        // Internal CTV settlement is not a second buyer or customer profile.
        val groups = data.invoices.filterNot { it.isInternalCollaboratorBill }
            .groupBy { SatoriData.customerKey(it) }
            .values.sortedWith(compareByDescending<List<SatoriInvoice>> { it.size }
                .thenBy { it.first().customer })
        label(parent, groups.size.toString() + " hồ sơ theo tên + SĐT + địa chỉ",
            13f, true, teal, 8)
        groups.forEach { group ->
            val representative = group.first()
            customerQuickCard(parent, representative, group.size) {
                val detailScroll = ScrollView(this).apply {
                    setBackgroundColor(night)
                }
                val detail = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(16), dp(13), dp(16), dp(18))
                }
                detailScroll.addView(detail)
                label(detail, representative.customer.ifBlank { "Khách hàng" },
                    19f, true, ink)
                label(detail, group.size.toString() + " hóa đơn trong hồ sơ",
                    12f, true, cyan, 5)
                customerInfoRow(detail, R.drawable.ic_satori_phone,
                    "SỐ ĐIỆN THOẠI",
                    representative.phone.ifBlank { "Chưa có số điện thoại" },
                    Color.rgb(16, 122, 78), Color.rgb(234, 249, 241))
                customerInfoRow(detail, R.drawable.ic_satori_map_pin,
                    "ĐỊA CHỈ GIAO HÀNG",
                    representative.address.ifBlank { "Chưa có địa chỉ" },
                    Color.rgb(17, 103, 177), Color.rgb(236, 245, 255))
                label(detail, "LỊCH SỬ HÓA ĐƠN", 12f, true, cyan, 16)
                group.forEach { invoice ->
                    val row = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(12), dp(10), dp(12), dp(10))
                        background = panelBackground(surface, 12)
                    }
                    label(row, "#" + invoice.number + "  •  " +
                        SatoriData.money(invoice.displayPayable), 13.5f, true, ink)
                    label(row, invoice.displayDate + "  •  " + invoice.status,
                        11.5f, true,
                        if (invoice.isNonCounted) Color.rgb(105, 74, 164)
                        else if (invoice.isCancelled) Color.rgb(190, 40, 48)
                        else if (invoice.customerHasPaid) Color.rgb(16, 122, 78)
                        else Color.rgb(168, 91, 16), 5)
                    detail.addView(row, LinearLayout.LayoutParams(-1, -2).apply {
                        topMargin = dp(7)
                    })
                }
                val dialog = AlertDialog.Builder(this)
                    .setView(detailScroll)
                    .setPositiveButton("Đóng", null)
                    .apply {
                        if (canWrite) setNeutralButton("LÊN ĐƠN CHO KHÁCH", null)
                    }
                    .create()
                dialog.setOnShowListener {
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(cyan)
                    if (canWrite) dialog.getButton(AlertDialog.BUTTON_NEUTRAL)
                        .setOnClickListener {
                            dialog.dismiss()
                            launchEditor(customer = representative)
                        }
                }
                dialog.show()
                dialog.window?.setBackgroundDrawable(
                    android.graphics.drawable.ColorDrawable(night))
            }
        }
    }

    /**
     * Filter estimated gross margin by invoice DATE, not payment timestamp.
     * Uses only the already-synced ledger and 45%-off catalog price in invoice
     * lines; excluded / unsafe invoices are never silently assigned zero profit.
     */
    private fun showMarginPeriod(data: SatoriSnapshot) {
        val marginRows=CtvProfitSourcePolicy.profitRows(data)
        val panel=LinearLayout(this).apply {
            orientation=LinearLayout.VERTICAL
            setPadding(dp(14),dp(12),dp(14),dp(16))
        }
        label(panel,if((data.collaboratorRegistryLoaded && data.collaborators.isNotEmpty()))
                "LỢI NHUẬN SAU CTV (ƯỚC TÍNH)"
            else "THIẾU HỒ SƠ CTV · CHƯA TÍNH LỢI NHUẬN",
            15f,true,ink)
        label(panel,"Chỉ xem · Theo ngày lập hóa đơn · Chưa trừ chi phí vận hành",
            11f,false,softInk,6)
        val choices=listOf("Tất cả","Theo ngày","Theo tháng","Theo năm",
            "Khoảng tùy chỉnh")
        val periodChoice=darkSpinner(choices)
        panel.addView(periodChoice, LinearLayout.LayoutParams(-1,dp(45)).apply {
            topMargin=dp(8)
        })
        val fields=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL }
        panel.addView(fields)
        val inputs=mutableMapOf<String,EditText>()
        val results=LinearLayout(this).apply {
            orientation=LinearLayout.VERTICAL
            setPadding(0,dp(6),0,dp(6))
        }
        val listScroll=ScrollView(this).apply { addView(results) }
        panel.addView(listScroll, LinearLayout.LayoutParams(-1,
            (resources.displayMetrics.heightPixels * 43 / 100).coerceAtLeast(dp(170))))
        val today=java.time.LocalDate.now(java.time.ZoneId.of("Asia/Ho_Chi_Minh"))
        val homeDate=homeProfitPeriod.from ?: today
        val todayIso=homeDate.toString()

        fun value(key:String)=inputs[key]?.text?.toString()?.trim().orEmpty()
        fun redraw() {
            results.removeAllViews()
            val range=try {
                when(periodChoice.selectedItemPosition.coerceIn(0,choices.lastIndex)) {
                    1 -> AccountingProMargin45Period.day(java.time.LocalDate.parse(value("day")))
                    2 -> java.time.YearMonth.parse(value("month")).let {
                        AccountingProMargin45Period.month(it.year,it.monthValue) }
                    3 -> AccountingProMargin45Period.year(value("year").toInt())
                    4 -> AccountingProMargin45Period.custom(
                        java.time.LocalDate.parse(value("from")),
                        java.time.LocalDate.parse(value("to")))
                    else -> AccountingProMargin45Period.all()
                }
            } catch (_: Exception) {
                label(results,"Bộ lọc chưa đúng. Nhập ngày YYYY-MM-DD, " +
                    "tháng YYYY-MM hoặc năm YYYY.",12f,true,invoiceMoneyRed,9)
                return
            }
            val summary=AccountingProMargin45.summarize(marginRows,range)
            val totalDisplay = when {
                summary.computedInvoiceCount > 0 ->
                    summary.estimatedMarginKnownVnd?.let(SatoriData::money)
                        ?: "Chưa có số liệu"
                summary.totalInvoiceCount == 0 &&
                    summary.excludedInvalidDates == 0 -> SatoriData.money(0L)
                else -> "Chưa có số liệu"
            }
            section(results,"TỔNG LỢI NHUẬN ƯỚC TÍNH: " + totalDisplay,
                range.title + " · Đã tính " + summary.computedInvoiceCount +
                    "/" + summary.totalInvoiceCount + " bill." +
                    (if (summary.missingInvoiceCount>0)
                        " Bỏ qua " + summary.missingInvoiceCount + " bill thiếu dữ liệu." else "") +
                    " Chỉ cộng bill đủ điều kiện; đây là lợi nhuận ước tính, chưa trừ chi phí vận hành.")
            val filtered=marginRows.filter {
                range.includes(it.invoice) && it.estimatedOwnerMarginVnd != null
            }
            label(results,"BILL ĐÃ TÍNH TRONG KỲ (" + filtered.size + ")",
                12f,true,cyan,12)
            filtered.take(90).forEach { row ->
                section(results,"#" + row.invoice.number + " · " + row.invoice.customer,
                    row.invoice.displayDate + "\nTiền hàng: " +
                    (row.saleGoodsVnd?.let(SatoriData::money) ?: "Chưa xác minh") +
                    " · Vốn 55%: " +
                    (row.estimatedPurchaseVnd?.let(SatoriData::money)
                        ?: "Chưa xác minh") +
                    "\nHoa hồng CTV: " +
                    (row.estimatedCtvCommissionVnd?.let(SatoriData::money)
                        ?: "Chưa xác minh") +
                    "\nLợi nhuận sau CTV ước tính: " +
                    (row.estimatedOwnerMarginVnd?.let(SatoriData::money)
                        ?: "Chưa đủ dữ liệu") +
                    (row.reason?.let { "\nCần rà soát: " + it } ?: ""))
            }
            if(summary.excludedInvalidDates>0)
                label(results,"Bỏ qua " + summary.excludedInvalidDates +
                    " hóa đơn ngày không hợp lệ; chưa tính vào tổng lợi nhuận.",
                    11f,false,Color.rgb(175,94,0),10)
            if(filtered.size>90)
                label(results,"Đang giới hạn 90 bill, chọn kỳ ngắn hơn để xem tiếp.",
                    11f,false,softInk,8)
        }

        fun addField(key:String,heading:String,initial:String) {
            label(fields,heading,11.5f,true,softInk,8)
            val field=EditText(this).apply {
                setSingleLine(true)
                setText(initial)
                textSize=13f
                setTextColor(ink)
                background=panelBackground(Color.WHITE,10)
                setPadding(dp(11),0,dp(11),0)
                contentDescription=heading
            }
            fields.addView(field,LinearLayout.LayoutParams(-1,dp(43)).apply {
                topMargin=dp(4)
            })
            inputs[key]=field
            field.addTextChangedListener(object:TextWatcher {
                override fun beforeTextChanged(s:CharSequence?,start:Int,
                    count:Int,after:Int) {}
                override fun onTextChanged(s:CharSequence?,start:Int,
                    before:Int,count:Int) { redraw() }
                override fun afterTextChanged(s:Editable?) {}
            })
        }
        fun updateFields() {
            fields.removeAllViews()
            inputs.clear()
            when(periodChoice.selectedItemPosition.coerceIn(0,choices.lastIndex)) {
                1 -> addField("day","Ngày (YYYY-MM-DD)",todayIso)
                2 -> addField("month","Tháng (YYYY-MM)",
                    java.time.YearMonth.from(homeDate).toString())
                3 -> addField("year","Năm (YYYY)",homeDate.year.toString())
                4 -> {
                    addField("from","Từ ngày (YYYY-MM-DD)",
                        today.withDayOfMonth(1).toString())
                    addField("to","Đến ngày (YYYY-MM-DD)",todayIso)
                }
            }
            redraw()
        }
        periodChoice.onItemSelectedListener =
            object:android.widget.AdapterView.OnItemSelectedListener {
                override fun onItemSelected(p:android.widget.AdapterView<*>?,
                    v:View?,pos:Int,id:Long) { updateFields() }
                override fun onNothingSelected(p:android.widget.AdapterView<*>?) {}
            }
        periodChoice.setSelection(homeProfitChoice.coerceIn(0, 3))
        updateFields()
        val scroll=ScrollView(this).apply { addView(panel) }
        AlertDialog.Builder(this)
            .setTitle("Accounting Pro · Lãi gộp theo kỳ")
            .setView(scroll).setPositiveButton("Đóng",null).show()
    }

    /**
     * Shared date filter for Debt and Profit. The same period is applied to
     * both cards and the debt invoice list; no invoice states are written.
     */
    private fun showDebtProfitFilter() {
        val today = java.time.LocalDate.now()
        val choices = listOf("Tất cả", "Theo ngày", "Theo tháng",
            "Theo năm", "Khoảng tùy chỉnh")
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(12))
        }
        label(panel, "Áp dụng chung cho Công nợ và Lợi nhuận",
            12f, true, ink)
        val picker = darkSpinner(choices)
        picker.setSelection(debtProfitChoice)
        panel.addView(picker, LinearLayout.LayoutParams(-1, dp(44)).apply {
            topMargin = dp(8)
        })
        val fields = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        panel.addView(fields)
        val inputs = mutableMapOf<String, EditText>()
        val initial = debtProfitPeriod.from ?: today
        fun input(key: String, caption: String, value: String) {
            label(fields, caption, 11.5f, true, softInk, 9)
            val field = EditText(this).apply {
                textSize = 13f
                setSingleLine(true)
                setText(value)
                setTextColor(ink)
                setPadding(dp(11), 0, dp(11), 0)
                background = panelBackground(Color.rgb(248, 249, 252), 10)
                contentDescription = caption
            }
            fields.addView(field, LinearLayout.LayoutParams(-1, dp(43)).apply {
                topMargin = dp(4)
            })
            inputs[key] = field
        }
        fun redrawFields() {
            fields.removeAllViews()
            inputs.clear()
            when (picker.selectedItemPosition) {
                1 -> input("day", "Ngày (YYYY-MM-DD)", initial.toString())
                2 -> input("month", "Tháng (YYYY-MM)",
                    java.time.YearMonth.from(initial).toString())
                3 -> input("year", "Năm (YYYY)", initial.year.toString())
                4 -> {
                    input("from", "Từ ngày (YYYY-MM-DD)", initial.toString())
                    input("to", "Đến ngày (YYYY-MM-DD)",
                        (debtProfitPeriod.through ?: today).toString())
                }
            }
        }
        picker.onItemSelectedListener =
            object : android.widget.AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: android.widget.AdapterView<*>?,
                    view: View?, position: Int, id: Long) { redrawFields() }
                override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
            }
        redrawFields()
        val dialog = AlertDialog.Builder(this)
            .setTitle("Lọc thời gian")
            .setView(panel)
            .setNegativeButton("Hủy", null)
            .setNeutralButton("Xóa lọc", null)
            .setPositiveButton("Áp dụng", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener {
                debtProfitPeriod = AccountingProMargin45Period.all()
                debtProfitChoice = 0
                dialog.dismiss()
                render()
            }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                fun value(key: String) = inputs[key]?.text?.toString()?.trim().orEmpty()
                val period = try {
                    when (picker.selectedItemPosition) {
                        1 -> AccountingProMargin45Period.day(
                            java.time.LocalDate.parse(value("day")))
                        2 -> java.time.YearMonth.parse(value("month")).let {
                            AccountingProMargin45Period.month(it.year, it.monthValue)
                        }
                        3 -> AccountingProMargin45Period.year(value("year").toInt())
                        4 -> AccountingProMargin45Period.custom(
                            java.time.LocalDate.parse(value("from")),
                            java.time.LocalDate.parse(value("to")))
                        else -> AccountingProMargin45Period.all()
                    }
                } catch (_: Exception) {
                    Toast.makeText(this,
                        "Ngày không hợp lệ. Dùng YYYY-MM-DD, YYYY-MM hoặc YYYY.",
                        Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }
                debtProfitPeriod = period
                debtProfitChoice = picker.selectedItemPosition
                dialog.dismiss()
                render()
            }
        }
        dialog.show()
    }

    private fun renderDebt(parent: LinearLayout, data: SatoriSnapshot) {
        val margins = CtvProfitSourcePolicy.profitRows(data)
        val report = AccountingProDebtProfitPolicy.report(
            data.invoices, margins, debtProfitPeriod)
        val marginByInvoice =
            java.util.IdentityHashMap<SatoriInvoice, AccountingProMargin45Row>().apply {
                margins.forEach { put(it.invoice, it) }
            }
        button(parent, "☷ Lọc thời gian · " + debtProfitPeriod.title) {
            showDebtProfitFilter()
        }
        val totals = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.TOP
        }
        fun totalCard(title: String, amount: String, detail: String, bg: Int,
                      gapRight: Int = 0) {
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(11), dp(13), dp(11), dp(13))
                background = panelBackground(Color.WHITE, 21)
                elevation = if (SatoriUiTheme.raised(this@NativeMainActivity))
                    dp(5).toFloat() else 0f
            }
            label(card, title, 11.5f, true, Color.rgb(20, 103, 104))
            label(card, amount, 17.5f, true, invoiceMoneyRed, 7).apply {
                maxLines = 2
                setAutoSizeTextTypeUniformWithConfiguration(12, 18, 1,
                    android.util.TypedValue.COMPLEX_UNIT_SP)
            }
            label(card, detail, 10.5f, false, softInk, 6)
            totals.addView(card, LinearLayout.LayoutParams(0, -2, 1f).apply {
                this.marginEnd = dp(gapRight)
            })
        }
        totalCard("Tổng công nợ cần thu",
            report.outstandingVnd?.let(SatoriData::money) ?: "Chưa xác minh",
            report.outstandingInvoices.size.toString() + " hóa đơn chưa thanh toán",
            Color.rgb(227, 247, 243), 7)
        val known = report.margin.computedInvoiceCount
        val eligible = report.margin.totalInvoiceCount
        val unknown = report.margin.missingInvoiceCount
        totalCard(if ((data.collaboratorRegistryLoaded && data.collaborators.isNotEmpty())) "Tổng lợi nhuận sau CTV"
            else "Lợi nhuận · thiếu hồ sơ CTV",
            report.margin.estimatedMarginKnownVnd?.let(SatoriData::money)
                ?: "Chưa đủ dữ liệu",
            "Ước tính · " + known + "/" + eligible + " hóa đơn" +
                (if (unknown > 0) " · $unknown chưa rõ" else ""),
            Color.rgb(244, 250, 247))
        parent.addView(totals)
        label(parent, (if ((data.collaboratorRegistryLoaded && data.collaborators.isNotEmpty()))
            "Lợi nhuận sau hoa hồng CTV được đối chiếu từ hồ sơ đăng ký; "
            else "⚠ Mobile API chưa gửi hồ sơ CTV. Không hiển thị lãi gộp thành lợi nhuận; ") +
            "ước tính theo giá nhập chiết khấu 45%, chưa trừ phí giao và vận hành.",
            10.5f, false, softInk, 6)
        if (debtProfitChoice != 0 && report.invalidDateDebtCount > 0)
            label(parent, report.invalidDateDebtCount.toString() +
                " hóa đơn công nợ có ngày không hợp lệ nên không thuộc bộ lọc thời gian.",
                10.5f, false, Color.rgb(175, 94, 0), 6)
        button(parent, "☷ Lọc danh sách hóa đơn") { showLedger(data) }
        label(parent, "Công nợ theo khách hàng", 15f, true, ink, 14)
        report.outstandingInvoices.forEach { invoice ->
            invoiceQuickCard(parent, invoice, fromDebt = true)
            styleUi25dInvoiceCard(parent)
            showProfitInsideInvoiceCard(parent, marginByInvoice[invoice],
                (data.collaboratorRegistryLoaded && data.collaborators.isNotEmpty()))
        }
        if (report.outstandingInvoices.isEmpty())
            section(parent, "Không có hóa đơn cần thu trong kỳ",
                "Không bao gồm hóa đơn đã thanh toán, đã hủy hoặc 'Không Tính'.")
        label(parent, "Lưu ý: Khách thanh toán và thanh toán cho Satori là hai trạng thái độc lập.",
            10.5f, false, softInk, 12)
    }

    private fun renderNewOrderInfo(parent: LinearLayout) {
        label(parent, "Chọn cách tạo đơn", 17f, true, ink, 15)
        renderUi25dOrderChoices(parent, canWrite)
        if (canWrite) {
            section(parent, "Đã sẵn sàng lên đơn",
                "Tạo hóa đơn nhiều mặt hàng, chọn đúng điểm giao, nhập số tiền và ghi chú.")
            button(parent, "+ TẠO HÓA ĐƠN MỚI", true) { launchEditor() }
        } else {
            section(parent, "Chưa được cấp quyền ghi đơn",
                "Đăng nhập Google và kết nối Mobile API chủ sở hữu trước khi lưu. " +
                "App không ghi trực tiếp lên tệp Drive và không dùng khóa bí mật.")
            button(parent, "KẾT NỐI ĐỂ LÊN ĐƠN", true) {
                if (apiEndpoint == null) configureMobileApi() else connectGoogle()
            }
        }
    }

    private fun showTrash() {
        val endpoint = apiEndpoint
        val token = accessToken
        if (!canAction("mobile.trash") || !canAction("orders.restore") ||
            endpoint == null || token == null) {
            Toast.makeText(this, "Chưa có quyền quản lý thùng rác.", Toast.LENGTH_LONG).show()
            return
        }
        if (isLoading) return
        isLoading = true
        statusMessage = "Đang đọc thùng rác 30 ngày…"
        render()
        Thread {
            val reply = runCatching { MobileApiClient.trash(endpoint, token) }
            runOnUiThread {
                isLoading = false
                reply.fold(
                    onSuccess = { json ->
                        val arr = json.optJSONArray("orders")
                        if (arr == null || arr.length() == 0) {
                            Toast.makeText(this, "Thùng rác không có hóa đơn.", Toast.LENGTH_LONG).show()
                        } else {
                            val entries = (0 until arr.length()).map { arr.getJSONObject(it) }
                            val labels = entries.map {
                                "#" + it.optString("invoiceNo") + " · " + it.optString("name") +
                                    "\n" + SatoriData.money(it.optLong("total"))
                            }
                            AlertDialog.Builder(this)
                                .setTitle("THÙNG RÁC 30 NGÀY")
                                .setItems(labels.toTypedArray()) { _, index ->
                                    val chosen = entries[index]
                                    val invoice = chosen.optInt("invoiceNo")
                                    val customer = chosen.optString("name")
                                    val total = chosen.optLong("total")
                                    AlertDialog.Builder(this)
                                        .setTitle("Khôi phục hóa đơn #" + invoice + "?")
                                        .setMessage(customer + "\n" + SatoriData.money(total) +
                                            "\nKhôi phục với đúng mã hóa đơn cũ, không tạo đơn mới.")
                                        .setNegativeButton("Hủy", null)
                                        .setPositiveButton("XÁC NHẬN KHÔI PHỤC") { _, _ ->
                                            val p = JSONObject()
                                                .put("expectedRevision", snapshot?.revision ?: -1)
                                                .put("requestId", UUID.randomUUID().toString().replace("-", ""))
                                                .put("invoiceNo", invoice)
                                                .put("id", chosen.optString("id"))
                                                .put("expectedName", customer)
                                                .put("expectedTotal", total)
                                                .put("confirmed", true)
                                            executeWrite("orders.restore", p) { _, _ -> }
                                        }.show()
                                }.setNegativeButton("Đóng", null).show()
                        }
                        render()
                    },
                    onFailure = { error ->
                        statusMessage = "Không đọc được thùng rác: " + (error.message ?: "Lỗi")
                        render()
                    }
                )
            }
        }.start()
    }

    /** Owner-only financial correction. Never updates the UI optimistically. */
    private fun confirmInvoicePayment(invoice: SatoriInvoice, action: String,
                                      onSuccess: () -> Unit) {
        val no = invoice.number.toIntOrNull()?.takeIf { it > 0 } ?: return
        if (!invoice.canChangePayment || !canAction(action) || isLoading) return
        val title = when (action) {
            "payments.markCustomerPaid" -> "Xác nhận khách đã trả đủ"
            "payments.markCustomerUnpaid" -> "Chuyển khách về chưa thanh toán"
            "payments.markSatoriPaid" -> "Đã thanh toán cho Satori"
            "payments.markSatoriUnpaid" -> "Hoàn tác thanh toán Satori"
            else -> return
        }
        val isCorrection = action != "payments.markCustomerPaid"
        val customerTarget = action.startsWith("payments.markCustomer")
        val currentPaid = if (customerTarget) invoice.customerHasPaid else invoice.satoriHasPaid
        val targetPaid = action.endsWith("Paid")
        val group = if (customerTarget) "Khách hàng" else "Satori"
        val currentStatus = if (currentPaid) "Đã thanh toán" else "Chưa thanh toán"
        val nextStatus = if (targetPaid) "Đã thanh toán" else "Chưa thanh toán"
        val confirmation = "Hóa đơn #" + no + "\nKhách: " + invoice.customer +
            "\nTổng: " + SatoriData.money(invoice.total) +
            "\nNhóm: " + group +
            "\nHiện tại: " + currentStatus +
            "\nChuyển sang: " + nextStatus +
            "\n\nTrạng thái KHÁCH và SATORI là hai khoản ghi nhận độc lập. " +
            "Chỉ xác nhận sau khi đã đối chiếu thanh toán thật."
        val reason = EditText(this).apply {
            hint = "Lý do / chứng từ đối soát (bắt buộc)"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            setSingleLine(false)
            minLines = 2
            maxLines = 3
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle(title).setMessage(confirmation)
            .apply { if (isCorrection) setView(reason) }
            .setNegativeButton("Hủy", null)
            .setPositiveButton("XÁC NHẬN", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val note = reason.text.toString().trim()
                if (isCorrection && (note.length < 3 || note.length > 300)) {
                    reason.error = "Cần ghi lý do từ 3 đến 300 ký tự"
                    return@setOnClickListener
                }
                val payload = JSONObject()
                    .put("expectedRevision", snapshot?.revision ?: -1L)
                    .put("invoiceNo", no)
                    .put("id", invoice.id)
                    .put("expectedName", invoice.customer)
                    .put("expectedTotal", invoice.total)
                    .put("confirmed", true)
                if (isCorrection) payload.put("reason", note)
                else payload.put("amount", invoice.total)
                dialog.dismiss()
                executeWrite(action, payload) { success, _ ->
                    if (success) onSuccess()
                }
            }
        }
        dialog.show()
    }

    private fun invoiceMiniAction(parent: LinearLayout, iconRes: Int, title: String,
                                  fill: Int, tint: Int? = null, click: () -> Unit) {
        val icon = ImageView(this).apply {
            setImageResource(iconRes)
            if (tint != null) setColorFilter(tint)
            scaleType = ImageView.ScaleType.FIT_CENTER
            // The drawable stays small while the full 48dp square remains tappable.
            val inset = if (tint == null) dp(10) else dp(13)
            setPadding(inset, inset, inset, inset)
            background = GradientDrawable().apply {
                setColor(fill)
                cornerRadius = dp(12).toFloat()
                if (tint != null) setStroke(dp(1), Color.rgb(225, 233, 233))
            }
            contentDescription = title
            tooltipText = title
            isFocusable = true
            isClickable = true
            setOnClickListener { click() }
        }
        parent.addView(icon, LinearLayout.LayoutParams(dp(48), dp(48)).apply {
            marginStart = if (parent.childCount == 0) 0 else dp(6)
        })
    }

    /** The detail dialog follows the active cover/inner-screen window size. */
    private fun resizeInvoiceDialog(dialog: AlertDialog) {
        // Keep the full detail page fullscreen across Fold open/close.
        dialog.window?.setLayout(
            android.view.WindowManager.LayoutParams.MATCH_PARENT,
            android.view.WindowManager.LayoutParams.MATCH_PARENT)
        val decor = dialog.window?.decorView ?: return
        val summary = decor.findViewWithTag<LinearLayout>("satori_invoice_summary_row")
        val expanded = resources.configuration.screenWidthDp >= 600
        if (summary != null && summary.childCount == 3) {
            val info = summary.getChildAt(0)
            val separator = summary.getChildAt(1)
            val total = summary.getChildAt(2)
            summary.orientation = if (expanded) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            summary.gravity = Gravity.CENTER_VERTICAL
            info.layoutParams = if (expanded) LinearLayout.LayoutParams(0, -2, 1.6f)
                else LinearLayout.LayoutParams(-1, -2)
            separator.layoutParams = if (expanded)
                LinearLayout.LayoutParams(dp(1), dp(80)).apply { marginStart = dp(14) }
                else LinearLayout.LayoutParams(-1, dp(1)).apply { topMargin = dp(14) }
            total.layoutParams = if (expanded) LinearLayout.LayoutParams(0, -2, 1f)
                else LinearLayout.LayoutParams(-1, -2)
            total.setPadding(if (expanded) dp(18) else 0,
                if (expanded) 0 else dp(16), 0, 0)
        }
        val actionCard = decor.findViewWithTag<LinearLayout>("satori_invoice_action_card")
        if (actionCard != null && actionCard.childCount == 2) {
            val toolbar = actionCard.getChildAt(0)
            val share = actionCard.getChildAt(1)
            actionCard.orientation = if (expanded) LinearLayout.HORIZONTAL
                else LinearLayout.VERTICAL
            toolbar.layoutParams = if (expanded)
                LinearLayout.LayoutParams(0, -2, 1f)
                else LinearLayout.LayoutParams(-1, -2)
            share.layoutParams = if (expanded)
                LinearLayout.LayoutParams(dp(220), -2).apply { marginStart = dp(16) }
                else LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) }
            val title = (toolbar as? LinearLayout)?.getChildAt(0)
            title?.visibility = if (!expanded &&
                resources.configuration.screenWidthDp < 370) View.GONE else View.VISIBLE
        }
        val grid = decor.findViewWithTag<LinearLayout>("satori_invoice_detail_grid")
            ?: return
        grid.orientation = if (expanded) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
        if (grid.childCount == 2) {
            val customer = grid.getChildAt(0)
            val products = grid.getChildAt(1)
            customer.layoutParams = if (expanded)
                LinearLayout.LayoutParams(0, -2, 1f)
                else LinearLayout.LayoutParams(-1, -2)
            products.layoutParams = if (expanded)
                LinearLayout.LayoutParams(0, -2, 1f)
                else LinearLayout.LayoutParams(-1, -2)
            customer.setPadding(0, 0, if (expanded) dp(10) else 0, 0)
            products.setPadding(if (expanded) dp(10) else 0, 0, 0, 0)
            grid.requestLayout()
        }
    }

    /** Two independent payment flags; tapping a row must still confirm via Mobile API. */
    private fun invoicePaymentRow(parent: LinearLayout, name: String, paid: Boolean,
                                  paidText: String, unpaidText: String,
                                  onTap: (() -> Unit)?) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(9), dp(10), dp(9))
            background = panelBackground(surface, 13)
            minimumHeight = dp(49)
            if (onTap != null) {
                isClickable = true
                isFocusable = true
                setOnClickListener { onTap() }
            }
        }
        val title = TextView(this).apply {
            text = name
            textSize = 13f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(ink)
            includeFontPadding = false
        }
        row.addView(title, LinearLayout.LayoutParams(0, -2, 1f))
        val state = TextView(this).apply {
            text = if (paid) paidText else unpaidText
            textSize = 12f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(if (paid) Color.rgb(15, 126, 83) else gold)
            includeFontPadding = false
            setPadding(dp(9), dp(5), dp(9), dp(5))
            background = GradientDrawable().apply {
                setColor(if (paid) Color.rgb(229, 247, 237)
                         else Color.rgb(255, 246, 223))
                cornerRadius = dp(10).toFloat()
            }
        }
        row.addView(state)
        if (onTap != null) {
            val edit = ImageView(this).apply {
                setImageResource(R.drawable.ic_satori_edit)
                setColorFilter(softInk)
                contentDescription = "Đổi trạng thái " + name
                setPadding(dp(5), dp(5), dp(5), dp(5))
            }
            row.addView(edit, LinearLayout.LayoutParams(dp(25), dp(25)).apply {
                marginStart = dp(6)
            })
            row.contentDescription = name + ": " +
                (if (paid) paidText else unpaidText) + ". Chạm để cập nhật."
        }
        parent.addView(row, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(6)
        })
    }

    private fun openInvoice(invoice: SatoriInvoice) {
        // One shared fullscreen detail page for Home, Invoices, Debt, Customers
        // and notification entrypoints. It is not a narrow Android alert popup.
        var invoiceDialog: AlertDialog? = null
        val expanded = resources.configuration.screenWidthDp >= 600
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(night)
            fitsSystemWindows = true
        }
        val stickyHeader = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(if (expanded) 28 else 17), dp(12),
                dp(if (expanded) 28 else 17), dp(12))
            setBackgroundColor(Color.WHITE)
            elevation = dp(3).toFloat()
        }
        val pageHeading = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        label(pageHeading, "Chi tiết hóa đơn #" + invoice.number, 20f, true, ink)
        label(pageHeading, invoice.customer + "  •  " + invoice.displayDate,
            11.5f, false, softInk, 4)
        stickyHeader.addView(pageHeading, LinearLayout.LayoutParams(0, -2, 1f))
        val closePage = ImageView(this).apply {
            setImageResource(R.drawable.ic_satori_close)
            setColorFilter(Color.rgb(207, 46, 46))
            setPadding(dp(11), dp(11), dp(11), dp(11))
            background = panelBackground(Color.rgb(255, 239, 240), 14)
            contentDescription = "Đóng chi tiết hóa đơn"
            isClickable = true
            isFocusable = true
            setOnClickListener { invoiceDialog?.dismiss() }
        }
        stickyHeader.addView(closePage, LinearLayout.LayoutParams(dp(46), dp(46)).apply {
            marginStart = dp(14)
        })
        page.addView(stickyHeader, LinearLayout.LayoutParams(-1, -2))
        val wrapper = ScrollView(this).apply {
            setBackgroundColor(night)
            overScrollMode = View.OVER_SCROLL_NEVER
            isFillViewport = false
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(if (expanded) 28 else 16), dp(14),
                dp(if (expanded) 28 else 16), dp(28))
            setBackgroundColor(night)
        }
        wrapper.addView(content, FrameLayout.LayoutParams(-1, -2))
        page.addView(wrapper, LinearLayout.LayoutParams(-1, 0, 1f))
        // Design preview: one restrained mint summary card, total prominent in red.
        val brandGreen = Color.rgb(0, 132, 122)
        val brandPale = Color.rgb(230, 247, 242)
        val amountRed = Color.rgb(207, 37, 45)
        val statusRed = Color.rgb(191, 40, 49)
        val summaryRow = LinearLayout(this).apply {
            orientation = if (expanded) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            tag = "satori_invoice_summary_row"
            setPadding(dp(18), dp(16), dp(18), dp(17))
            background = panelBackground(Color.WHITE, 22)
            elevation = if (SatoriUiTheme.raised(this@NativeMainActivity)) dp(4).toFloat() else 0f
        }
        val summaryInfo = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        val summaryTitleRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val receipt = ImageView(this).apply {
            setImageResource(R.drawable.ic_satori_invoice)
            setColorFilter(brandGreen)
            setPadding(dp(8), dp(8), dp(8), dp(8))
            background = background(brandPale, 12)
            contentDescription = "Hóa đơn"
        }
        summaryTitleRow.addView(receipt, LinearLayout.LayoutParams(dp(42), dp(42)).apply {
            marginEnd = dp(12)
        })
        label(summaryTitleRow, "Tóm tắt hóa đơn", 17f, true, ink)
        summaryInfo.addView(summaryTitleRow)
        val stateRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(9), 0, 0)
        }
        label(stateRow, invoice.displayDate, 12f, true, brandGreen)
        val isAlertStatus = !invoice.customerHasPaid || invoice.isCancelled || invoice.isNonCounted
        val statusText = TextView(this).apply {
            text = invoice.status
            textSize = 11f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(if (isAlertStatus) statusRed else Color.rgb(18, 125, 82))
            setPadding(dp(9), dp(5), dp(9), dp(5))
            background = background(
                if (isAlertStatus) Color.rgb(255, 236, 236) else brandPale, 12)
            maxLines = 2
        }
        stateRow.addView(statusText, LinearLayout.LayoutParams(-2, -2).apply {
            marginStart = dp(12)
        })
        summaryInfo.addView(stateRow)
        if (invoice.creationTimeLabel.isNotBlank()) {
            label(summaryInfo, "Khách đặt lúc: " + invoice.creationTimeLabel,
                11.5f, false, softInk, 9)
        } else {
            label(summaryInfo, "Chưa có giờ đặt hàng trong dữ liệu nguồn",
                11f, false, softInk, 9)
        }
        val summaryDivider = View(this).apply {
            setBackgroundColor(Color.rgb(218, 230, 232))
        }
        val totalArea = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(if (expanded) dp(18) else 0, if (expanded) 0 else dp(16), 0, 0)
        }
        label(totalArea, if (invoice.isNonCounted) "Giá trị tính" else "Tổng thanh toán",
            12f, false, softInk)
        label(totalArea, SatoriData.money(invoice.displayPayable), 27f, true,
            if (invoice.isNonCounted) Color.rgb(105, 74, 164) else amountRed, 5)
        if (expanded) {
            summaryRow.addView(summaryInfo, LinearLayout.LayoutParams(0, -2, 1.6f))
            summaryRow.addView(summaryDivider, LinearLayout.LayoutParams(dp(1), dp(80)).apply {
                marginStart = dp(14)
            })
            summaryRow.addView(totalArea, LinearLayout.LayoutParams(0, -2, 1f))
        } else {
            summaryRow.addView(summaryInfo, LinearLayout.LayoutParams(-1, -2))
            summaryRow.addView(summaryDivider, LinearLayout.LayoutParams(-1, dp(1)).apply {
                topMargin = dp(14)
            })
            summaryRow.addView(totalArea, LinearLayout.LayoutParams(-1, -2))
        }
        content.addView(summaryRow)
        if (invoice.isTest) label(content,
            "DỮ LIỆU TEST • KHÔNG TÍNH DOANH THU/CÔNG NỢ",
            12f, true, Color.rgb(181, 95, 6), 9)
        if (invoice.isLinkedPairBill) {
            label(content, invoice.pairLabel, 13f, true, cyan, 10)
            if (invoice.isInternalCollaboratorBill) label(content,
                "BẢN ĐỐI SOÁT CTV • KHÔNG CỘNG DOANH THU, KHÔNG THU TIỀN KHÁCH",
                12f, true, Color.rgb(181, 95, 6), 6)
            if (invoice.pairDiscountPercent != null) label(content,
                "Chiết khấu đã lưu: " + invoice.pairDiscountPercent + "%",
                12f, false, softInk, 6)
        }

        // On Fold: use the full inner screen with two balanced columns;
        // on phones: stack the same sections vertically.
        val detailGrid = LinearLayout(this).apply {
            orientation = if (expanded) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            gravity = Gravity.TOP
            tag = "satori_invoice_detail_grid"
        }
        val customerBlock = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 0, if (expanded) dp(10) else 0, 0)
        }
        val productBlock = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(if (expanded) dp(10) else 0, 0, 0, 0)
        }
        if (expanded) {
            detailGrid.addView(customerBlock, LinearLayout.LayoutParams(0, -2, 1f))
            detailGrid.addView(productBlock, LinearLayout.LayoutParams(0, -2, 1f))
        } else {
            detailGrid.addView(customerBlock, LinearLayout.LayoutParams(-1, -2))
            detailGrid.addView(productBlock, LinearLayout.LayoutParams(-1, -2))
        }
        content.addView(detailGrid, LinearLayout.LayoutParams(-1, -2))
        // Shared section components: outer white cards, consistent icon sizes
        // and a single typography scale for phone and unfolded Fold.
        fun invoiceSection(parent: LinearLayout, title: String, iconRes: Int): LinearLayout {
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(14), dp(14), dp(16))
                background = panelBackground(Color.WHITE, 20)
                elevation = if (SatoriUiTheme.raised(this@NativeMainActivity))
                    dp(3).toFloat() else 0f
            }
            val header = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val icon = ImageView(this).apply {
                setImageResource(iconRes)
                setColorFilter(brandGreen)
                contentDescription = title
            }
            header.addView(icon, LinearLayout.LayoutParams(dp(24), dp(24)).apply {
                marginEnd = dp(10)
            })
            label(header, title, 16f, true, ink)
            card.addView(header)
            val body = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
            }
            card.addView(body, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(10)
            })
            parent.addView(card, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(14)
            })
            return body
        }

        fun invoiceContact(parent: LinearLayout, iconRes: Int, caption: String,
                           value: String, tint: Int, fill: Int) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(10), dp(9), dp(10), dp(9))
                background = panelBackground(Color.WHITE, 12)
            }
            val icon = ImageView(this).apply {
                setImageResource(iconRes)
                setColorFilter(tint)
                setPadding(dp(10), dp(10), dp(10), dp(10))
                background = background(fill, 11)
                contentDescription = caption
            }
            row.addView(icon, LinearLayout.LayoutParams(dp(42), dp(42)).apply {
                marginEnd = dp(12)
            })
            val lines = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            if (caption.isNotBlank()) label(lines, caption, 11.5f, false, softInk)
            val valueLabel = label(lines, value, 14f, true, ink,
                if (caption.isBlank()) 0 else 3)
            valueLabel.maxLines = 5
            row.addView(lines, LinearLayout.LayoutParams(0, -2, 1f))
            parent.addView(row, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(8)
            })
        }

        fun invoicePriceRow(parent: LinearLayout, title: String, amount: Long) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(2), dp(6), dp(2), dp(6))
            }
            val name = label(row, title, 12f, false, softInk)
            name.layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
            label(row, SatoriData.money(amount), 13f, true, amountRed)
            parent.addView(row)
        }

        val customerCard = invoiceSection(customerBlock,
            "Thông tin khách hàng", R.drawable.ic_satori_users)
        invoiceContact(customerCard, R.drawable.ic_satori_users, "",
            invoice.customer, brandGreen, brandPale)
        invoiceContact(customerCard, R.drawable.ic_satori_phone, "Số điện thoại",
            invoice.phone.ifBlank { "Chưa có số điện thoại" },
            Color.rgb(20, 135, 94), Color.rgb(234, 249, 241))
        invoiceContact(customerCard, R.drawable.ic_satori_map_pin, "Địa chỉ giao hàng",
            invoice.address.ifBlank { "Chưa có địa chỉ" },
            Color.rgb(21, 109, 180), Color.rgb(235, 246, 255))
        if (invoice.duplicateFrom.isNotBlank()) {
            label(customerCard, "Bản giá sao từ #" + invoice.duplicateFrom +
                " — cần kiểm tra trước khi tính doanh thu.",
                11f, true, gold, 9)
        }

        val productCard = invoiceSection(productBlock,
            "Sản phẩm (" + invoice.lines.size + " dòng)", R.drawable.ic_satori_invoice)
        invoice.lines.forEach { line ->
            val productRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(11), dp(11), dp(10), dp(11))
                background = panelBackground(Color.WHITE, 12)
            }
            val productKind = InvoiceProductPresentation.icon(line.description, line.code)
            val iconRes = when (productKind) {
                InvoiceProductPresentation.Icon.WATER -> R.drawable.ic_product_water
                InvoiceProductPresentation.Icon.GUAVA -> R.drawable.ic_product_guava
                InvoiceProductPresentation.Icon.SOURSOP -> R.drawable.ic_product_soursop
                InvoiceProductPresentation.Icon.FRUIT -> R.drawable.ic_product_fruit
                InvoiceProductPresentation.Icon.DRINK -> R.drawable.ic_product_drink
                InvoiceProductPresentation.Icon.PACKAGE -> R.drawable.ic_product_package
            }
            val productIcon = ImageView(this).apply {
                setImageResource(iconRes)
                setColorFilter(Color.rgb(25, 109, 180))
                background = background(Color.rgb(235, 246, 255), 12)
                setPadding(dp(10), dp(10), dp(10), dp(10))
                contentDescription = "Biểu tượng " + line.description
            }
            productRow.addView(productIcon,
                LinearLayout.LayoutParams(dp(43), dp(43)).apply { marginEnd = dp(11) })
            val textGroup = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            label(textGroup, line.description, 13.5f, true, ink)
            label(textGroup, "x" + line.quantity + " " + line.unit + " × " +
                SatoriData.money(line.unitPrice), 11.5f, false, softInk, 5)
            val lineDiscount = InvoiceProductPresentation.discountPercent(line)
            if (lineDiscount != null && invoice.lines.size > 1) {
                label(textGroup, "Discount " +
                    InvoiceProductPresentation.formatPercent(lineDiscount),
                    11f, true, brandGreen, 5)
            }
            productRow.addView(textGroup, LinearLayout.LayoutParams(0, -2, 1f))
            productCard.addView(productRow, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(7)
            })
        }
        productCard.addView(View(this).apply {
            setBackgroundColor(Color.rgb(230, 236, 239))
        }, LinearLayout.LayoutParams(-1, dp(1)).apply {
            topMargin = dp(13)
            bottomMargin = dp(5)
        })
        // This is the stored discounted line total, not the list-price total:
        // never subtract invoice discounts a second time.
        val storedLineSubtotal = invoice.lines.sumOf { it.amount }
        invoicePriceRow(productCard, "Thành tiền", storedLineSubtotal)
        val discountLine = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(2), dp(6), dp(2), dp(6))
        }
        val discountTitle = label(discountLine, "Discount %", 12f, false, softInk)
        discountTitle.layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        label(discountLine,
            InvoiceProductPresentation.invoiceDiscountLabel(invoice.lines),
            12f, true, brandGreen)
        productCard.addView(discountLine)
        invoicePriceRow(productCard, "Phí giao", invoice.shipping)
        invoicePriceRow(productCard, "Thuế VAT", invoice.vat)
        val productTotal = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(13), dp(12), dp(13))
            background = background(brandPale, 12)
        }
        val totalCaption = label(productTotal,
            if (invoice.isNonCounted) "Giá trị tính" else "Tổng thanh toán",
            14f, true, brandGreen)
        totalCaption.layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        label(productTotal, SatoriData.money(invoice.displayPayable), 19f, true,
            if (invoice.isNonCounted) Color.rgb(105, 74, 164) else amountRed)
        productCard.addView(productTotal, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(7)
        })
        if (invoice.isNonCounted) {
            label(productCard, "KHÔNG TÍNH • Không phải khoản phải thu", 12f, true,
                Color.rgb(105, 74, 164), 8)
            label(productCard, "Tổng tiền gốc để đối chiếu: " +
                SatoriData.money(invoice.total) +
                ". PDF giữ giá gốc, không sử dụng để yêu cầu thanh toán.",
                11f, false, softInk, 5)
        }
        if (invoice.deliveryNote.isNotBlank()) {
            label(productCard, "Ghi chú giao hàng", 12f, true, brandGreen, 12)
            label(productCard, invoice.deliveryNote, 12f, false, ink, 5)
        }
        // PDF is the original invoice PDF, not a new visual mockup.
        button(productCard, "Xem PDF", true, R.drawable.ic_satori_eye) {
            NativeInvoicePdf.preview(this, invoice)
        }
        val validInvoiceNumber = invoice.number.toIntOrNull()?.takeIf { it > 0 }
        val canEditPayment = validInvoiceNumber != null && invoice.canChangePayment

        fun requestPayment(action: String) {
            if (!canAction(action)) {
                AlertDialog.Builder(this)
                    .setTitle("Chưa kết nối quyền thanh toán")
                    .setMessage("Cần Google Owner và Mobile API cấp quyền " + action +
                        ". Chế độ đọc Google Drive không được ghi thanh toán.")
                    .setNegativeButton("Đóng", null)
                    .setPositiveButton("Kiểm tra kết nối") { _, _ ->
                        showConnectionSettings()
                    }.show()
            } else {
                confirmInvoicePayment(invoice, action) { invoiceDialog?.dismiss() }
            }
        }

        // The two payment states remain independent and retain their Owner API
        // confirmation, audit reason, permission checks and revision guards.
        val paymentCard = invoiceSection(customerBlock,
            "Thanh toán", R.drawable.ic_satori_debt)
        if (invoice.isNonCounted) {
            label(paymentCard, "KHÔNG TÍNH • GIÁ TRỊ 0 đ • KHÓA THANH TOÁN",
                12f, true, Color.rgb(105, 74, 164))
        } else if (invoice.isCancelled) {
            label(paymentCard, "ĐÃ HỦY • KHÔNG TÍNH DOANH THU / CÔNG NỢ",
                12f, true, statusRed)
            if (invoice.customerPaidAt.isNotBlank() || invoice.satoriPaidAt.isNotBlank())
                label(paymentCard, "Có dấu thời gian thanh toán trước khi hủy. " +
                    "Cần đối soát / hoàn tiền; không tự ghi nhận đã thanh toán.",
                    11f, false, softInk, 6)
        } else {
            val customerAction = if (invoice.customerHasPaid) "payments.markCustomerUnpaid"
                                 else "payments.markCustomerPaid"
            val satoriAction = if (invoice.satoriHasPaid) "payments.markSatoriUnpaid"
                               else "payments.markSatoriPaid"
            val customerClick: (() -> Unit)? = if (canEditPayment) {
                { requestPayment(customerAction) }
            } else null
            val satoriClick: (() -> Unit)? = if (canEditPayment) {
                { requestPayment(satoriAction) }
            } else null
            invoicePaymentRow(paymentCard, "Khách hàng", invoice.customerHasPaid,
                "Đã thanh toán", "Chưa thanh toán", customerClick)
            invoicePaymentRow(paymentCard, "Satori", invoice.satoriHasPaid,
                "Đã thanh toán", "Chưa thanh toán", satoriClick)
            if (validInvoiceNumber == null) {
                label(paymentCard, "Số hóa đơn không hợp lệ • đã khóa thao tác ghi.",
                    11f, true, gold, 6)
            }
        }

        fun confirmInternalShare(action: () -> Unit) {
            if (!invoice.isInternalCollaboratorBill) { action(); return }
            AlertDialog.Builder(this)
                .setTitle("PDF CTV NỘI BỘ • KHÔNG GỬI KHÁCH")
                .setMessage("Bill này có giá chiết khấu riêng cho cộng tác viên. " +
                    "Chỉ gửi đúng CTV, không gửi cho khách mua hàng. Anh xác nhận?")
                .setNegativeButton("Hủy", null)
                .setPositiveButton("Đúng CTV, tiếp tục") { _, _ -> action() }
                .show()
        }

        // Compact one-line tools on Fold; separate label and a single
        // full-width share button on narrow cover screens.
        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
        }
        if (invoice.canEditOrDelete && validInvoiceNumber != null) {
            invoiceMiniAction(actions, R.drawable.ic_satori_edit, "Sửa hóa đơn",
                Color.rgb(233, 248, 245), brandGreen) {
                if (!canAction("orders.update")) {
                    AlertDialog.Builder(this)
                        .setTitle("Chưa được cấp quyền sửa hóa đơn")
                        .setMessage("Cần Google Owner và Mobile API cấp orders.update. " +
                            "Chế độ đọc Drive không được sửa hóa đơn.")
                        .setNegativeButton("Đóng", null)
                        .setPositiveButton("Kiểm tra kết nối") { _, _ ->
                            showConnectionSettings()
                        }.show()
                } else {
                    invoiceDialog?.dismiss()
                    requestInvoiceEdit(invoice)
                }
            }
            invoiceMiniAction(actions, R.drawable.ic_satori_trash,
                "Xóa hóa đơn • thùng rác 30 ngày", Color.rgb(255, 243, 243),
                Color.rgb(207, 46, 46)) {
                confirmSoftDelete(invoice) { invoiceDialog?.dismiss() }
            }
        }
        invoiceMiniAction(actions, R.drawable.ic_brand_zalo, "Gửi PDF qua Zalo",
            Color.rgb(0, 104, 255)) {
            confirmInternalShare {
                try { NativeInvoicePdf.shareZalo(this, invoice) }
                catch (error: Exception) {
                    Toast.makeText(this, "Không chia sẻ được Zalo: " +
                        (error.message ?: ""), Toast.LENGTH_LONG).show()
                }
            }
        }
        invoiceMiniAction(actions, R.drawable.ic_brand_messenger, "Gửi PDF qua Messenger",
            Color.rgb(0, 132, 255)) {
            confirmInternalShare {
                try { NativeInvoicePdf.shareMessenger(this, invoice) }
                catch (error: Exception) {
                    Toast.makeText(this, "Không chia sẻ được Messenger: " +
                        (error.message ?: ""), Toast.LENGTH_LONG).show()
                }
            }
        }

        val actionCard = LinearLayout(this).apply {
            tag = "satori_invoice_action_card"
            orientation = if (expanded) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(15), dp(12), dp(15), dp(14))
            background = panelBackground(Color.WHITE, 20)
            elevation = if (SatoriUiTheme.raised(this@NativeMainActivity))
                dp(3).toFloat() else 0f
        }
        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val toolTitle = label(toolbar, "Thao tác", 15f, true, ink)
        toolTitle.layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        if (!expanded && resources.configuration.screenWidthDp < 370)
            toolTitle.visibility = View.GONE
        toolbar.addView(actions, LinearLayout.LayoutParams(-2, -2))
        if (expanded) {
            actionCard.addView(toolbar, LinearLayout.LayoutParams(0, -2, 1f))
        } else {
            actionCard.addView(toolbar, LinearLayout.LayoutParams(-1, -2))
        }
        val shareHolder = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        button(shareHolder, "Chia sẻ PDF", false, R.drawable.ic_satori_share) {
            confirmInternalShare {
                try { NativeInvoicePdf.share(this, invoice) }
                catch (_: Exception) {
                    Toast.makeText(this, "Không xuất được PDF, hãy thử lại.",
                        Toast.LENGTH_LONG).show()
                }
            }
        }
        actionCard.addView(shareHolder,
            if (expanded) LinearLayout.LayoutParams(dp(220), -2).apply {
                marginStart = dp(16)
            } else LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(8)
            })
        content.addView(actionCard, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(14)
        })
        val dialog = AlertDialog.Builder(this)
            .setView(page)
            .create()
        dialog.setCanceledOnTouchOutside(false)
        invoiceDialog = dialog
        activeInvoiceDialog = dialog
        dialog.setOnDismissListener {
            if (activeInvoiceDialog === dialog) {
                activeInvoiceDialog = null
                // Mark as read only after the user closes this invoice's detail card.
                val number = invoice.number.toLongOrNull()
                if (number != null && number in currentInvoiceBadge().unread) {
                    acknowledgeInvoiceBadge(number)
                    // Refresh both Home and Invoice badges, including the recent-card "MỚI" label.
                    if (!isFinishing && !isDestroyed) render()
                }
            }
        }
        dialog.setOnShowListener {
            dialog.window?.setBackgroundDrawable(
                android.graphics.drawable.ColorDrawable(night))
            resizeInvoiceDialog(dialog)
        }
        dialog.show()
    }

    private fun configureMobileApi() {
        val entry = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_VARIATION_URI
            setText(apiEndpoint.orEmpty())
            setSingleLine(false)
            setPadding(dp(18), dp(12), dp(18), dp(12))
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("KẾT NỐI MOBILE API")
            .setMessage("Nhập liên kết /exec của Apps Script Bot API đã được kích hoạt quyền Android chủ sở hữu. Chỉ nhập đường dẫn, KHÔNG nhập khóa HMAC hay mật khẩu.")
            .setView(entry)
            .setNegativeButton("Hủy", null)
            .setPositiveButton("LƯU & KẾT NỐI", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val candidate = entry.text.toString().trim()
                if (!MobileApiClient.saveEndpoint(this, candidate)) {
                    entry.error = "Chỉ chấp nhận liên kết HTTPS Apps Script /macros/s/.../exec"
                    return@setOnClickListener
                }
                apiEndpoint = MobileApiClient.endpoint(this)
                actorId = ""
                // Previously loaded file snapshots are read-only until verified API connects.
                dataSource = ""
                snapshot = null
                allowedActions = emptySet()
                dialog.dismiss()
                connectGoogle()
            }
        }
        dialog.show()
    }

    /**
     * Production owner Mobile API: compare canonical Drive ledger revision
     * without transferring customer records on every timer tick.
     */
    private fun checkMobileRevision() {
        if (!foreground || isLoading || isCheckingMobileRevision ||
            authorizationPending || authorizationDeclined ||
            preferredSource() != AutoSyncPolicy.MOBILE_API) return
        val endpoint = apiEndpoint ?: return
        val token = accessToken ?: return
        val current = snapshot ?: run { refreshFromMobileApi(); return }
        if (!allowedActions.contains("mobile.revision")) return
        isCheckingMobileRevision = true
        lastMobileRevisionProbeElapsedMs = SystemClock.elapsedRealtime()
        Thread {
            val latest = runCatching { MobileApiClient.revision(endpoint, token) }
            runOnUiThread {
                isCheckingMobileRevision = false
                if (!foreground || accessToken != token || apiEndpoint != endpoint ||
                    preferredSource() != AutoSyncPolicy.MOBILE_API) return@runOnUiThread
                latest.fold(
                    onSuccess = { revision ->
                        if (LiveSyncPolicy.mobileChanged(current.revision, revision) ||
                            AutoSyncPolicy.due(lastOnlineReadElapsedMs,
                                SystemClock.elapsedRealtime(), fallbackReadMs))
                            refreshFromMobileApi()
                    },
                    onFailure = { error ->
                        statusMessage = "⚠ Mobile API chưa xác minh được đơn mới: " +
                            (error.message ?: "Lỗi kết nối")
                        if (error is MobileApiError &&
                            error.apiCode in setOf("AUTH_FAILED", "FORBIDDEN")) {
                            if (error.apiCode == "AUTH_FAILED")
                                recoverRejectedOAuthToken(token)
                            else accessToken = null
                            allowedActions = emptySet()
                            lastSyncAttemptElapsedMs = 0L
                        }
                        render()
                    }
                )
            }
        }.start()
    }

    /**
     * A still-deployed old Mobile API can provide real invoices but OMIT the
     * registered CTV key. Do not show gross profit in that case.
     * Recover from the verified canonical Drive file only when the OAuth token
     * has read permission and both snapshots are the SAME revision and orders.
     * The API remains authoritative for write permissions, never Drive.
     */
    private fun reconcileMobileCtvRegistry(remote: MobileSnapshot,
                                           token: String): MobileSnapshot {
        val api = remote.snapshot
        if (api.collaboratorRegistryLoaded && api.collaborators.isNotEmpty()) return remote
        val cached = if (ctvBridgeToken == token)
            ctvBridgeSnapshot?.let { CtvProfitSourcePolicy.recover(api, it) }
            else null
        if (cached != null) return remote.copy(snapshot = cached)
        if (ctvBridgeRevision == api.revision && ctvBridgeToken == token) return remote
        ctvBridgeToken = token
        ctvBridgeRevision = api.revision
        val direct = runCatching { DriveReadClient.loadWithToken(token) }.getOrNull()
            ?: return remote
        val recovered = CtvProfitSourcePolicy.recover(api, direct) ?: return remote
        ctvBridgeSnapshot = direct
        return remote.copy(snapshot = recovered)
    }

    private fun refreshFromMobileApi() {
        lastSyncAttemptElapsedMs = SystemClock.elapsedRealtime()
        val endpoint = apiEndpoint ?: run {
            statusMessage = "Chưa cấu hình Mobile API."
            render()
            return
        }
        val token = accessToken ?: run { connectGoogle(); return }
        if (isLoading) return
        isLoading = true
        statusMessage = "Đang xác thực chủ sở hữu và đồng bộ hóa đơn…"
        render()
        Thread {
            val outcome = runCatching {
                reconcileMobileCtvRegistry(MobileApiClient.snapshot(endpoint, token), token)
            }
            val pending = pendingWrite
            val trash = if (outcome.isSuccess && pending != null &&
                pending.belongsTo(endpoint, outcome.getOrThrow().actorId) &&
                pending.action == "orders.delete" &&
                outcome.getOrThrow().allowedActions.contains("mobile.trash"))
                runCatching { MobileApiClient.trash(endpoint, token) }.getOrNull() else null
            runOnUiThread {
                isLoading = false
                outcome.fold(
                    onSuccess = {
                        val prior = snapshot
                        if (prior != null && !LiveSyncPolicy.canApplySnapshot(prior.revision, it.snapshot.revision)) {
                            statusMessage = "⚠ Mobile API trả revision cũ. Không ghi đè hóa đơn."
                            allowedActions = emptySet()
                            actorId = ""
                            dataSource = ""
                            render()
                            return@runOnUiThread
                        }
                        snapshot = it.snapshot
                        lastMobileRevisionProbeElapsedMs = SystemClock.elapsedRealtime()
                        allowedActions =
                            if (getPreferences(MODE_PRIVATE).getBoolean(
                                    "mobile_owner_readonly_fallback", false))
                                it.allowedActions.filter { a -> a.startsWith("mobile.") }.toSet()
                            else it.allowedActions
                        actorId = it.actorId
                        dataSource = "Minh Satori API"
                        lastReadAt = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
                        lastOnlineReadElapsedMs = SystemClock.elapsedRealtime()
                        statusMessage = if (it.snapshot.collaboratorRegistryLoaded && it.snapshot.collaborators.isNotEmpty())
                            "Đã đồng bộ hóa đơn và hồ sơ CTV (" +
                                it.snapshot.collaborators.size + " hồ sơ)."
                        else "⚠ Mobile API chưa gửi hồ sơ CTV và Drive chưa cấp quyền đọc. " +
                            "Lợi nhuận đang khóa; cần kết nối Drive hoặc cập nhật Apps Script."
                        notifyVerifiedNewInvoices(prior, it.snapshot)
                        if (pending != null && pending.belongsTo(endpoint, it.actorId)) {
                            if (pending.confirmedIn(it.snapshot, trash)) finishPendingWrite(pending)
                            else statusMessage = "Đã đồng bộ; còn thao tác đang chờ cần kiểm tra hoặc gửi lại đúng yêu cầu cũ."
                        }
                    },
                    onFailure = {
                        // A previous 3-bill sample must not remain on-screen as
                        // Production merely because a new API validation failed.
                        if (snapshot?.let { old ->
                                ProductionLedgerPolicy.rejection(old) != null } == true) {
                            snapshot = null
                        }
                        allowedActions = emptySet()
                        dataSource = ""
                        statusMessage = "⚠ Không kiểm tra được Mobile API: " +
                            (it.message ?: "không rõ lỗi") +
                            ". Chưa bật chức năng lưu đơn."
                        if (it is MobileApiError && it.apiCode == "AUTH_FAILED") {
                            recoverRejectedOAuthToken(token)
                        } else if (it is MobileApiError && it.apiCode == "FORBIDDEN") {
                            accessToken = null
                            statusMessage += " Cần xác minh tài khoản và OAuth client được cho phép."
                        }
                    }
                )
                render()
            }
        }.start()
    }

    private fun finishPendingWrite(pending: PendingMobileWrite): Boolean {
        return runCatching { pendingStore.clear(pending) }.fold(
            onSuccess = { if (pendingWrite == pending) pendingWrite = null; true },
            onFailure = {
                pendingStorageError = true
                statusMessage = "Đã nhận kết quả nhưng chưa cập nhật được bản chờ. Ghi mới vẫn khóa để tránh trùng."
                false
            }
        )
    }

    private fun reviewPendingWrite(pending: PendingMobileWrite) {
        if (isLoading || !pending.belongsTo(apiEndpoint.orEmpty(), actorId) ||
            !hasServerAction(pending.action) || pendingStorageError) return
        val p = pending.payload
        val order = p.optJSONObject("order")
        val description = if (order != null)
            order.optString("name") + " · " + SatoriData.money(order.optLong("total"))
        else "Hóa đơn #" + p.optString("invoiceNo")
        AlertDialog.Builder(this)
            .setTitle("Tiếp tục thao tác đang chờ")
            .setMessage(description + "\n\nApp sẽ gửi lại nguyên yêu cầu cũ, giữ mã chống trùng và revision. " +
                "Nếu dữ liệu đã thay đổi, server sẽ yêu cầu kiểm tra lại. " +
                "Anh nên đồng bộ trước để kiểm tra thao tác đã hoàn tất chưa.")
            .setNegativeButton("Đồng bộ kiểm tra") { _, _ -> refreshFromMobileApi() }
            .setNeutralButton("Đóng", null)
            .setPositiveButton("GỬI LẠI YÊU CẦU CŨ") { _, _ ->
                executeWrite(pending.action, p) { _, _ -> }
            }.show()
    }

    private fun executeWrite(
        action: String,
        payload: JSONObject,
        completed: (Boolean, String) -> Unit
    ) {
        val endpoint = apiEndpoint
        val token = accessToken
        val prior = pendingWrite
        val contents = JSONObject(payload.toString())
        if (!contents.has("requestId")) contents.put("requestId",
            UUID.randomUUID().toString().replace("-", ""))
        if (SatoriOrderValidation.requiresTestLedger(action, contents)) {
            completed(false, "Đơn TEST phải chuyển sang môi trường thử, không được lưu vào sổ hóa đơn thật.")
            return
        }
        val exactRetry = prior?.matches(endpoint.orEmpty(), actorId, action, contents) == true
        if (!hasServerAction(action) || endpoint == null || token == null || isLoading ||
            pendingStorageError || (prior != null && !exactRetry)) {
            completed(false, "Cần đúng tài khoản, quyền và kết quả thao tác đang chờ trước khi ghi mới.")
            return
        }
        val pending = prior ?: PendingMobileWrite(endpoint, actorId, action,
            contents.toString(), System.currentTimeMillis())
        pendingWrite = pending
        isLoading = true
        statusMessage = "Đang lưu an toàn và gửi thao tác Minh Satori…"
        render()
        Thread {
            // Flush encrypted journal BEFORE sending any request. A failed disk/key
            // operation must never fall back to sending without process-death recovery.
            val stored = runCatching { pendingStore.save(pending) }
            if (stored.isFailure) {
                runOnUiThread {
                    isLoading = false
                    pendingStorageError = true
                    statusMessage = "Không lưu được bản chờ an toàn. Chưa gửi yêu cầu lên server."
                    completed(false, statusMessage)
                    render()
                }
                return@Thread
            }
            val result = runCatching {
                MobileApiClient.request(endpoint, token, action, pending.payload,
                    UUID.randomUUID().toString().replace("-", ""))
            }
            val uncertain = result.exceptionOrNull()?.let {
                MobileWriteOutcome.requiresReconciliation(it)
            } ?: false
            val latest = if (result.isSuccess || uncertain)
                runCatching { MobileApiClient.snapshot(endpoint, token) }.getOrNull() else null
            val trash = if (uncertain && action == "orders.delete" && latest != null &&
                latest.allowedActions.contains("mobile.trash"))
                runCatching { MobileApiClient.trash(endpoint, token) }.getOrNull() else null
            val proved = latest != null && pending.belongsTo(endpoint, latest.actorId) &&
                pending.confirmedIn(latest.snapshot, trash)
            runOnUiThread {
                isLoading = false
                if (latest != null && pending.belongsTo(endpoint, latest.actorId)) {
                    snapshot = latest.snapshot
                    allowedActions = latest.allowedActions
                    actorId = latest.actorId
                    dataSource = "Minh Satori API"
                    lastReadAt = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
                    lastOnlineReadElapsedMs = SystemClock.elapsedRealtime()
                }
                val alreadyPaid = result.getOrNull()?.optJSONObject("data")
                    ?.optBoolean("alreadyPaid", false) == true
                if ((result.isSuccess &&
                        MobileWriteOutcome.acceptsServerSuccess(action, alreadyPaid, proved)) || proved) {
                    finishPendingWrite(pending)
                    if (latest == null) {
                        snapshot = null
                        allowedActions = emptySet()
                        dataSource = ""
                    }
                    val message = if (proved && result.isFailure)
                        "Đã xác minh thao tác được lưu trước khi mất kết nối. Không ghi thêm lần nữa."
                    else "Server xác nhận thành công."
                    if (!pendingStorageError) statusMessage = message
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show()
                    completed(true, message)
                } else if (result.isFailure && MobileWriteOutcome.mayDiscardAfterRejection(
                        result.exceptionOrNull()!!, prior != null)) {
                    finishPendingWrite(pending)
                    statusMessage = "Server từ chối yêu cầu: " +
                        (result.exceptionOrNull()?.message ?: "Cần kiểm tra dữ liệu.")
                    // Never reuse a stale snapshot after any rejected operation.
                    snapshot = null
                    allowedActions = emptySet()
                    dataSource = ""
                    completed(false, statusMessage)
                } else {
                    statusMessage = if (result.isSuccess && alreadyPaid)
                        "Hóa đơn đã thanh toán nhưng chưa xác minh được chính yêu cầu của máy này. " +
                            "Giữ bản chờ an toàn, không ghi tiền thêm. Cần đối chiếu giao dịch."
                    else "Chưa xác minh được kết quả trước đó. Đã giữ bản chờ mã hóa, " +
                        "khóa ghi mới và giữ nguyên mã chống trùng kể cả khi đóng app."
                    val error = result.exceptionOrNull()
                    if (error is MobileApiError && error.apiCode in setOf("AUTH_FAILED", "FORBIDDEN")) {
                        accessToken = null
                        actorId = ""
                        allowedActions = emptySet()
                        dataSource = ""
                        statusMessage += " Cần đăng nhập Google lại để tiếp tục đối chiếu."
                    }
                    completed(false, statusMessage)
                }
                render()
            }
        }.start()
    }

    private fun launchEditor(editing: SatoriInvoice? = null,
                             customer: SatoriInvoice? = null) {
        val loaded = snapshot
        val action = if (editing == null) "orders.create" else "orders.update"
        if (!canAction(action) || loaded == null) {
            Toast.makeText(this, "Tài khoản chưa được cấp quyền lên/sửa đơn.", Toast.LENGTH_LONG).show()
            return
        }
        NativeOrderEditor.show(this, loaded, editing, customer) { action, payload, done ->
            executeWrite(action, payload, done)
        }
    }

    private fun refreshFromPicker() {
        lastSyncAttemptElapsedMs = SystemClock.elapsedRealtime()
        val selected = fileUri ?: run {
            statusMessage = "Anh cần chọn file MinhSatori_Live_Data.json."
            render()
            return
        }
        if (isLoading) return
        isLoading = true
        statusMessage = "Đang đọc file Drive được chọn qua Android."
        render()
        Thread {
            val result = try {
                // Prevent accidentally displaying a downloaded backup or unrelated file.
                val chosenName = contentResolver.query(
                    selected, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
                )?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                }.orEmpty()
                if (chosenName.isNotBlank() && !chosenName.contains(
                        "MinhSatori_Live_Data", ignoreCase = true)) {
                    throw IllegalArgumentException("Đang chọn file '" + chosenName +
                        "'. Anh hãy chọn MinhSatori_Live_Data.json trên Drive.")
                }
                val bytes = contentResolver.openInputStream(selected)?.use { stream ->
                    val buffer = ByteArray(8192)
                    val target = ByteArrayOutputStream()
                    while (true) {
                        val count = stream.read(buffer)
                        if (count < 0) break
                        if (target.size() + count > 12_000_000)
                            throw IllegalArgumentException("File quá lớn.")
                        target.write(buffer, 0, count)
                    }
                    target.toByteArray()
                } ?: throw IllegalArgumentException("Không mở được file đã chọn.")
                val parsed = SatoriData.fromDriveState(String(bytes, Charsets.UTF_8))
                require(parsed.updatedAt.isNotBlank()) {
                    "File thiếu ngày cập nhật."
                }
                ProductionLedgerPolicy.rejection(parsed)?.let { throw IllegalArgumentException(it) }
                Result.success(parsed)
            } catch (e: Exception) {
                Result.failure<SatoriSnapshot>(e)
            }
            runOnUiThread {
                isLoading = false
                result.fold(
                    onSuccess = {
                        snapshot = it
                        dataSource = "file Google Drive"
                        lastReadAt = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
                        lastOnlineReadElapsedMs = SystemClock.elapsedRealtime()
                        statusMessage = "⚠ Đã đọc file thủ công. Đây có thể là bản tĩnh; bấm ↻ Refresh để đồng bộ từ Google Drive live."
                    },
                    onFailure = {
                        snapshot = null
                        dataSource = ""
                        lastOnlineReadElapsedMs = 0L
                        statusMessage = "Không đọc được dữ liệu: " +
                            (it.message ?: "không rõ nguyên nhân") +
                            ". Bấm CHỌN FILE DRIVE KHÁC để kết nối lại."
                    }
                )
                render()
            }
        }.start()
    }

    private fun connectGoogle(automatic: Boolean = false, emailOnlyFallback: Boolean = false,
                              askAccount: Boolean = false) {
        if (isLoading || authorizationPending || (automatic && authorizationDeclined)) return
        if (!automatic) authorizationDeclined = false
        authorizationPending = true
        lastSyncAttemptElapsedMs = SystemClock.elapsedRealtime()
        // Ask owner for read-only Drive in API mode as well. Older deployed
        // Mobile API versions may omit the CTV registry, so only the owner
        // canonical Drive source can safely reconcile the profit calculation.
        // If Drive consent is restricted, retain existing email-only API login
        // but fail closed on profit rather than showing a gross-margin number.
        val scopes = mutableListOf(Scope("https://www.googleapis.com/auth/userinfo.email"))
        if (!emailOnlyFallback) {
            scopes.add(Scope("https://www.googleapis.com/auth/drive.readonly"))
        }
        val builder = AuthorizationRequest.builder().setRequestedScopes(scopes)
        if (askAccount) builder.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT)
        val request = builder.build()
        statusMessage = "Đang xác thực tài khoản Google được cấp quyền Minh Satori."
        render()
        Identity.getAuthorizationClient(this).authorize(request)
            .addOnSuccessListener {
                authorizationPending = false
                applyAuthorization(it)
            }
            .addOnFailureListener {
                authorizationPending = false
                if (!emailOnlyFallback && apiEndpoint != null) {
                    // Drive OAuth consent may be restricted; owner Mobile API
                    // only needs verified email scope and uses server-side Drive.
                    connectGoogle(automatic = true, emailOnlyFallback = true)
                } else {
                    statusMessage = "⚠ Google chưa cấp quyền đăng nhập. " +
                        "Chưa truy cập được Drive hoặc Mobile API; không xóa dữ liệu cũ."
                    render()
                }
            }
    }

    private fun applyAuthorization(result: AuthorizationResult) {
        if (result.hasResolution()) {
            val pending = result.pendingIntent
            if (pending == null) {
                statusMessage = "Google không trả về màn hình cấp quyền."
                render()
                return
            }
            try {
                authorizationPending = true
                permissionLauncher.launch(IntentSenderRequest.Builder(pending.intentSender)
                    .build())
            } catch (_: Exception) {
                authorizationPending = false
                statusMessage = "Không mở được màn hình cấp quyền Google."
                render()
            }
        } else {
            val token = result.accessToken
            if (token.isNullOrBlank() ||
                !result.grantedScopes.contains("https://www.googleapis.com/auth/userinfo.email")) {
                statusMessage = "Google chưa cấp quyền xác minh email chủ sở hữu."
                render()
                return
            }
            actorId = ""
            allowedActions = emptySet()
            dataSource = ""
            if (preferGoogleDrive() || apiEndpoint == null) {
                if (!result.grantedScopes.contains("https://www.googleapis.com/auth/drive.readonly")) {
                    accessToken = token
                    if (recoverDriveAccessUsingOwnerApi(token)) return
                    statusMessage = "⚠ Google không cấp quyền Drive chỉ đọc " +
                        "và chưa có Mobile API chủ sở hữu đã lưu. Chưa cập nhật dữ liệu."
                    render()
                    return
                }
            }
            accessToken = token
            if (preferGoogleDrive() || apiEndpoint == null) refreshFromDrive()
            else refreshFromMobileApi()
        }
    }

    /**
     * A Drive 403 can mean wrong account, insufficient OAuth scope, or policy.
     * Instead of retrying it forever, use the previously configured owner
     * Apps Script Mobile API, authenticated with the user's Google token.
     *
     * Automatic fallback is read-only; no invoice write/delete capabilities
     * become available merely because a read provider changed.
     */
    private fun recoverDriveAccessUsingOwnerApi(token: String): Boolean {
        val endpoint = apiEndpoint ?: return false
        if (isLoading || authorizationPending || authorizationDeclined) return false
        isLoading = true
        statusMessage = "Drive từ chối quyền đọc. Đang thử Mobile API chủ sở hữu đã lưu…"
        render()
        Thread {
            val result = runCatching { MobileApiClient.snapshot(endpoint, token) }
            runOnUiThread {
                isLoading = false
                if (accessToken != token || apiEndpoint != endpoint) return@runOnUiThread
                result.fold(
                    onSuccess = { remote ->
                        val prior = snapshot
                        if (remote.snapshot.invoices.isEmpty() ||
                            remote.snapshot.invoices.all { it.isTest }) {
                            // A legacy 3-fake-bill Mobile API must not silently
                            // replace the production ledger after a Drive 403.
                            statusMessage = "⚠ Mobile API đang trả dữ liệu TEST hoặc trống. " +
                                "Không được thay thế dữ liệu Minh Satori thật."
                        } else if (prior != null &&
                            !LiveSyncPolicy.canApplySnapshot(prior.revision, remote.snapshot.revision)) {
                            statusMessage = "⚠ Mobile API trả dữ liệu cũ hơn lần đã xác minh. " +
                                "Giữ nguyên hóa đơn, không ghi đè."
                        } else {
                            getPreferences(MODE_PRIVATE).edit()
                                .putString("satori_source_mode", AutoSyncPolicy.MOBILE_API)
                                .putBoolean("google_drive_auto_read", false)
                                .putBoolean("mobile_owner_readonly_fallback", true)
                                .apply()
                            snapshot = remote.snapshot
                            allowedActions = remote.allowedActions.filter {
                                it.startsWith("mobile.")
                            }.toSet()
                            actorId = remote.actorId
                            dataSource = "Minh Satori API"
                            lastDriveVersion = null
                            lastMobileRevisionProbeElapsedMs = SystemClock.elapsedRealtime()
                            lastOnlineReadElapsedMs = SystemClock.elapsedRealtime()
                            lastReadAt = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
                            statusMessage = "Đã chuyển sang Mobile API chủ sở hữu • " +
                                "tự đồng bộ mỗi 20 giây; chỉ xem hóa đơn."
                        }
                    },
                    onFailure = { error ->
                        val reason = if (error is MobileApiError)
                            error.apiCode + ": " + error.message
                        else error.message ?: "Không có phản hồi từ Mobile API"
                        statusMessage = "⚠ Google Drive từ chối quyền (HTTP 403); " +
                            "Mobile API chủ sở hữu cũng chưa kết nối được: " + reason +
                            ". Chưa cập nhật dữ liệu; không xóa hóa đơn cũ."
                    }
                )
                render()
            }
        }.start()
        return true
    }

    /**
     * Lightweight foreground probe. Only reload a full Drive ledger if its
     * Google file.version changed from the last verified snapshot. No UI
     * reconstruction when no invoice changed.
     */
    private fun checkDriveVersion() {
        if (!foreground || isLoading || isCheckingVersion || authorizationPending ||
            authorizationDeclined || preferredSource() != AutoSyncPolicy.DRIVE) return
        val token = accessToken ?: return
        if (snapshot == null) { refreshFromDrive(); return }
        isCheckingVersion = true
        lastVersionProbeElapsedMs = SystemClock.elapsedRealtime()
        Thread {
            val response = runCatching { DriveReadClient.versionWithToken(token) }
            runOnUiThread {
                isCheckingVersion = false
                if (!foreground || accessToken != token ||
                    preferredSource() != AutoSyncPolicy.DRIVE) return@runOnUiThread
                response.fold(
                    onSuccess = { version ->
                        if (LiveSyncPolicy.driveChanged(lastDriveVersion, version) ||
                            AutoSyncPolicy.due(lastOnlineReadElapsedMs,
                                SystemClock.elapsedRealtime(), fallbackReadMs)) {
                            refreshFromDrive()
                        }
                    },
                    onFailure = { error ->
                        if (error is DriveReadPermissionDenied &&
                            recoverDriveAccessUsingOwnerApi(token)) {
                            // Fallback will render the verified owner snapshot.
                        } else {
                            statusMessage = "⚠ Chưa kiểm tra được đơn mới: " +
                                (error.message ?: "Lỗi mạng") +
                                ". Dữ liệu hiển thị là lần đồng bộ trước."
                            if (error.message?.contains("hết hạn") == true) {
                                accessToken = null
                                lastSyncAttemptElapsedMs = 0L
                            }
                            render()
                        }
                    }
                )
            }
        }.start()
    }

    private fun refreshFromDrive() {
        lastSyncAttemptElapsedMs = SystemClock.elapsedRealtime()
        if (isLoading) return
        val token = accessToken ?: run { connectGoogle(); return }
        isLoading = true
        statusMessage = "Đang đọc dữ liệu thật từ Google Drive."
        render()
        Thread {
            val response = runCatching {
                // Read the version BEFORE the snapshot; any concurrent
                // change triggers another check on the next foreground tick.
                val version = DriveReadClient.versionWithToken(token)
                Pair(DriveReadClient.loadWithToken(token), version)
            }
            runOnUiThread {
                isLoading = false
                response.fold(
                    onSuccess = { (current, version) ->
                        val old = snapshot
                        if (old != null && !LiveSyncPolicy.canApplySnapshot(old.revision, current.revision)) {
                            statusMessage = "⚠ Drive trả revision " + current.revision +
                                " cũ hơn dữ liệu đã xác minh " + old.revision +
                                ". Không ghi đè hóa đơn."
                        } else {
                            snapshot = current
                            lastDriveVersion = version
                            lastVersionProbeElapsedMs = SystemClock.elapsedRealtime()
                            dataSource = "Google Drive API"
                            lastReadAt = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
                            lastOnlineReadElapsedMs = SystemClock.elapsedRealtime()
                            statusMessage = "Đã đồng bộ • kiểm tra mỗi 20 giây; đối chiếu đầy đủ mỗi 60 giây."
                            notifyVerifiedNewInvoices(old, current)
                        }
                    },
                    onFailure = { error ->
                        if (error is DriveReadPermissionDenied &&
                            recoverDriveAccessUsingOwnerApi(token)) {
                            // Fallback in flight, keep previous verified rows.
                        } else {
                            statusMessage = "⚠ Chưa đồng bộ được đơn mới: " +
                                (error.message ?: "Lỗi mạng") +
                                ". Dữ liệu đang hiển thị có thể đã cũ."
                            if (statusMessage.contains("hết hạn")) accessToken = null
                        }
                    }
                )
                render()
            }
        }.start()
    }
}
