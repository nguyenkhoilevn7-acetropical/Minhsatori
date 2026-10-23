package vn.minhsatori.app

import org.json.JSONObject
import java.io.IOException

/**
 * Pure revision/version policy shared by the live Drive and owner Mobile API
 * readers. No token, invoice, or customer data is persisted on the handset.
 */
internal object LiveSyncPolicy {
    fun driveVersion(json: String): Long {
        val raw = try { JSONObject(json).optString("version") } catch (_: Exception) { "" }
        val n = raw.toLongOrNull()
        if (n == null || n <= 0L) throw IOException("Drive không trả phiên bản hợp lệ.")
        return n
    }

    fun mobileRevision(data: JSONObject): Long {
        val revision = data.optString("revision").toLongOrNull()
        if (revision == null || revision < 1L)
            throw IOException("Mobile API không trả revision hợp lệ.")
        return revision
    }

    /** A lower Drive version may indicate replacement of a shared file. */
    fun driveChanged(previous: Long?, current: Long): Boolean =
        previous == null || previous != current

    fun mobileChanged(previousRevision: Long, remoteRevision: Long): Boolean =
        previousRevision != remoteRevision

    /** Never roll an already-verified ledger backwards on a stale replica. */
    fun canApplySnapshot(oldRevision: Long?, incomingRevision: Long): Boolean =
        incomingRevision >= 0L && (oldRevision == null || incomingRevision >= oldRevision)
}
