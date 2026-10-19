package vn.minhsatori.app

import java.net.URI

/**
 * Accept only the authenticated owner-only Apps Script web app.
 * Never accept arbitrary URLs from exported Android activities or external intents.
 */
object PortalUrlValidator {
    private val deploymentPath = Regex("^/macros/s/[A-Za-z0-9_-]+/exec$")

    fun normalize(input: String): String? {
        val candidate = input.trim()
        val uri = try {
            URI(candidate)
        } catch (_: Exception) {
            return null
        }
        if (uri.scheme != "https" || uri.host != "script.google.com" ||
            uri.port != -1 || uri.userInfo != null ||
            uri.rawQuery != null || uri.rawFragment != null ||
            !deploymentPath.matches(uri.path ?: "")
        ) return null
        return candidate
    }
}
