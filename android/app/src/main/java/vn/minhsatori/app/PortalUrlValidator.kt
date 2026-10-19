package vn.minhsatori.app

import java.net.URI

/**
 * Accept only the authenticated owner-only Apps Script web app.
 *
 * Google's Chrome account routing may append ?authuser=0&pli=1 to an owner's
 * working URL. Keep these benign routing parameters while refusing unknown
 * params, encoded keys, fragments and anything that could leak credentials.
 */
object PortalUrlValidator {
    private val deploymentPath = Regex("^/macros/s/[A-Za-z0-9_-]+/exec$")
    private val allowedQuery = mapOf(
        "authuser" to Regex("^[0-9]{1,2}$"),
        "pli" to Regex("^[01]$")
    )

    fun normalize(input: String): String? {
        val candidate = input.trim()
        val uri = try {
            URI(candidate)
        } catch (_: Exception) {
            return null
        }
        if (uri.scheme != "https" || uri.host != "script.google.com" ||
            uri.port != -1 || uri.userInfo != null ||
            uri.rawFragment != null || !deploymentPath.matches(uri.path ?: "")
        ) return null

        if (uri.rawQuery != null) {
            if (uri.rawQuery.isBlank()) return null
            val seen = mutableSetOf<String>()
            for (pair in uri.rawQuery.split('&')) {
                val separator = pair.indexOf('=')
                if (separator < 1 || separator == pair.length - 1) return null
                val key = pair.substring(0, separator)
                val value = pair.substring(separator + 1)
                if (!seen.add(key) || allowedQuery[key]?.matches(value) != true) return null
            }
        }
        return candidate
    }
}
