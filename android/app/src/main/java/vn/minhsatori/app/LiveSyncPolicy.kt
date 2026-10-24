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

    /** Canonical owner Drive file, already used by authenticated direct Drive reads. */
    const val PRODUCTION_LEDGER_KIND = "minh-satori-owner-drive-v15"

    /**
     * Fail closed on historical Android sandbox endpoints that returned a
     * plausible JSON snapshot with revision 1 and 3 mock invoices. Merely
     * having an owner actor ID or HTTP 200 does NOT authenticate the ledger.
     * Revision 133 is the last independently verified production baseline on
     * 2026-10-24. Valid production ledgers must move forward monotonically.
     */
    const val MIN_PRODUCTION_REVISION = 133L

    fun mobileRevision(data: JSONObject): Long {
        val revision = data.optString("revision").toLongOrNull()
        val file = data.optString("ledgerFileId")
        val kind = data.optString("ledgerKind")
        if (file != DriveReadClient.LIVE_FILE_ID || kind != PRODUCTION_LEDGER_KIND ||
            revision == null || revision < MIN_PRODUCTION_REVISION)
            throw MobileApiError("WRONG_LEDGER_SOURCE",
                "Mobile API đang trỏ tới dữ liệu TEST hoặc chưa được cập nhật " +
                "để xác minh nguồn Production. Hãy kết nối API của dự án " +
                "Minh Satori Drive Sync (không phải Sandbox).")
        return revision
    }

    /** The outer API revision must be identical to the loaded invoice snapshot. */
    fun validateMobileSnapshot(data: JSONObject, outerRevision: Long,
                               snapshot: SatoriSnapshot) {
        val checked = mobileRevision(data)
        if (outerRevision != checked || snapshot.revision != checked ||
            snapshot.invoices.isEmpty() || snapshot.invoices.all { it.isTest })
            throw MobileApiError("WRONG_LEDGER_SOURCE",
                "Mobile API trả dữ liệu thiếu hoặc không khớp với sổ " +
                "Minh Satori Production. Không sử dụng dữ liệu TEST.")
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
