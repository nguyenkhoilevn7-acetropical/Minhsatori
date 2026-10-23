package vn.minhsatori.app

/**
 * Select the owner's previous trusted source without prompting at every launch.
 * First installation defaults to the live Google Drive OAuth read, not the demo
 * Mobile API endpoint. Saved file permissions are honored, not silently replaced.
 * No HMAC credentials or OAuth tokens are stored here.
 */
internal object AutoSyncPolicy {
    const val DRIVE = "drive"
    const val MOBILE_API = "api"
    const val FILE = "file"

    fun source(saved: String?, hasSavedFile: Boolean, hasMobileEndpoint: Boolean): String =
        when (saved) {
            FILE -> if (hasSavedFile) FILE else DRIVE
            MOBILE_API -> if (hasMobileEndpoint) MOBILE_API else DRIVE
            DRIVE -> DRIVE
            else -> if (hasSavedFile) FILE else DRIVE
        }

    fun due(lastAttemptElapsedMs: Long, nowElapsedMs: Long, intervalMs: Long): Boolean =
        lastAttemptElapsedMs <= 0L ||
            nowElapsedMs < lastAttemptElapsedMs ||
            nowElapsedMs - lastAttemptElapsedMs >= intervalMs
}
