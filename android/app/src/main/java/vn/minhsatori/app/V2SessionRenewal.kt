package vn.minhsatori.app

import android.app.Activity
import android.os.SystemClock
import android.webkit.CookieManager
import org.json.JSONObject
import java.net.URL
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/**
 * Renews the owner's 7-day V2 web session without the owner opening Owner V2.
 *
 * Root cause of "Chưa xác định tài khoản đặt hàng" on V2 checkouts: ordering
 * accounts are read with the V2 session cookie, which the server expires after
 * 7 days (Max-Age=604800). The phone then got 401 and silently showed nothing.
 *
 * Flow (same server path as the Owner V2 login button, nothing new on the server):
 * Credential Manager auto-select of a Google account ALREADY authorized for this
 * app -> Google ID token -> POST /api/v2/auth/google -> GET /api/v2/me must say
 * isAdmin -> only then store the HttpOnly session + CSRF cookies in CookieManager.
 * A non-admin Gmail is discarded and never stored. No token is logged or persisted.
 */
object V2SessionRenewal {
    private const val ORIGIN = V2RegistrationAlerts.ORIGIN
    private const val MIN_INTERVAL_MS = 10 * 60_000L
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var lastAttemptMs = 0L
    @Volatile private var inFlight = false

    /** Result for the UI: true = fresh admin cookie stored. Called on the main thread. */
    fun renew(activity: Activity, force: Boolean = false, onDone: (Boolean) -> Unit) {
        val now = SystemClock.elapsedRealtime()
        if (inFlight || (!force && lastAttemptMs != 0L && now - lastAttemptMs < MIN_INTERVAL_MS)) {
            onDone(false); return
        }
        inFlight = true
        lastAttemptMs = now
        worker.execute {
            val clientId = try { clientId() } catch (_: Exception) { null }
            if (clientId == null) { finish(activity, null, onDone); return@execute }
            activity.runOnUiThread { requestToken(activity, clientId, onDone) }
        }
    }

    /** Stores verified admin cookies on the main thread (CookieManager), then reports. */
    private fun finish(activity: Activity, cookies: String?, onDone: (Boolean) -> Unit) {
        activity.runOnUiThread {
            inFlight = false
            val ok = cookies != null && try { store(cookies); true } catch (_: Exception) { false }
            if (!activity.isFinishing && !activity.isDestroyed) onDone(ok)
        }
    }

    private fun requestToken(activity: Activity, clientId: String, onDone: (Boolean) -> Unit) {
        if (activity.isFinishing || activity.isDestroyed) { inFlight = false; return }
        try {
            val nonceBytes = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
            val nonce = android.util.Base64.encodeToString(nonceBytes,
                android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or
                    android.util.Base64.NO_PADDING)
            // Only accounts that already signed in to this app; auto-select = no picker
            // when exactly one such account exists.
            val option = com.google.android.libraries.identity.googleid.GetGoogleIdOption.Builder()
                .setServerClientId(clientId)
                .setFilterByAuthorizedAccounts(true)
                .setAutoSelectEnabled(true)
                .setNonce(nonce)
                .build()
            val request = androidx.credentials.GetCredentialRequest.Builder()
                .addCredentialOption(option)
                .build()
            androidx.credentials.CredentialManager.create(activity).getCredentialAsync(
                context = activity,
                request = request,
                cancellationSignal = null,
                executor = androidx.core.content.ContextCompat.getMainExecutor(activity),
                callback = object : androidx.credentials.CredentialManagerCallback<
                    androidx.credentials.GetCredentialResponse,
                    androidx.credentials.exceptions.GetCredentialException> {
                    override fun onResult(result: androidx.credentials.GetCredentialResponse) {
                        val credential = result.credential
                        val type = com.google.android.libraries.identity.googleid
                            .GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                        if (credential !is androidx.credentials.CustomCredential ||
                            credential.type != type) {
                            finish(activity, null, onDone); return
                        }
                        val token = try {
                            com.google.android.libraries.identity.googleid
                                .GoogleIdTokenCredential.createFrom(credential.data).idToken
                        } catch (_: Exception) { finish(activity, null, onDone); return }
                        worker.execute {
                            val verified = try {
                                exchange(token).takeIf { isAdmin(it) }
                            } catch (_: Exception) { null }
                            finish(activity, verified, onDone)
                        }
                    }

                    override fun onError(
                        e: androidx.credentials.exceptions.GetCredentialException
                    ) { finish(activity, null, onDone) }
                }
            )
        } catch (_: Exception) { finish(activity, null, onDone) }
    }

    private fun open(path: String): HttpsURLConnection =
        (URL(ORIGIN + path).openConnection() as HttpsURLConnection).apply {
            connectTimeout = 15000; readTimeout = 45000 // free Render plan may cold-start
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Cache-Control", "no-store")
        }

    private fun readJson(c: HttpsURLConnection): Pair<Int, JSONObject> {
        val code = c.responseCode
        val body = (if (code in 200..299) c.inputStream else c.errorStream)
            ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "{}"
        return code to (try { JSONObject(body) } catch (_: Exception) { JSONObject() })
    }

    private fun clientId(): String? {
        val c = open("/api/v2/status")
        try {
            val (code, json) = readJson(c)
            val id = json.optString("googleClientId", "")
            return id.takeIf {
                code == 200 && json.optBoolean("enabled") &&
                    Regex("^[0-9]+-[A-Za-z0-9_-]+[.]apps[.]googleusercontent[.]com$").matches(it)
            }
        } finally { c.disconnect() }
    }

    private fun exchange(token: String): String {
        val c = open("/api/v2/auth/google").apply {
            requestMethod = "POST"; doOutput = true
            setRequestProperty("Origin", ORIGIN)
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
        }
        try {
            c.outputStream.use {
                it.write(JSONObject().put("credential", token).toString().toByteArray(Charsets.UTF_8))
            }
            val (code, json) = readJson(c)
            require(code == 200 && json.optBoolean("ok")) { "GOOGLE_LOGIN_FAILED" }
            val cookies = c.headerFields.entries
                .filter { it.key?.equals("set-cookie", true) == true }
                .flatMap { it.value ?: emptyList() }
                .map { it.substringBefore(';').trim() }
            val session = cookies.firstOrNull { it.startsWith("satori_v2_session=") }
            val csrf = cookies.firstOrNull { it.startsWith("satori_v2_csrf=") }
            require(session != null && csrf != null &&
                Regex("^satori_v2_session=[a-f0-9]{64}$").matches(session) &&
                Regex("^satori_v2_csrf=[a-f0-9]{48}$").matches(csrf)) { "INVALID_SESSION_COOKIE" }
            return "$session; $csrf"
        } finally { c.disconnect() }
    }

    private fun isAdmin(cookies: String): Boolean {
        val c = open("/api/v2/me").apply { setRequestProperty("Cookie", cookies) }
        try {
            val (code, json) = readJson(c)
            return code == 200 && json.optJSONObject("account")?.optBoolean("isAdmin") == true
        } finally { c.disconnect() }
    }

    private fun store(cookies: String) {
        val manager = CookieManager.getInstance()
        cookies.split(';').map { it.trim() }.forEach { part ->
            val isSession = part.startsWith("satori_v2_session=")
            if (isSession || part.startsWith("satori_v2_csrf="))
                manager.setCookie(ORIGIN, part + "; Secure; SameSite=Lax; Path=/" +
                    if (isSession) "; HttpOnly" else "")
        }
        manager.flush()
    }
}
