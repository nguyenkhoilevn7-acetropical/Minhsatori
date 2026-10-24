package vn.minhsatori.app

/**
 * Fail-closed guard against a previously configured three-invoice Mobile API
 * sandbox being displayed as the owner's canonical production ledger.
 *
 * 2026-10-24: independently checked read-only production system.status:
 * revision 133, 117 invoices, canonical Google Drive Live_Data file.
 * These are LOWER SAFETY BOUNDS (not an expected exact invoice count).
 * Revision may increase and order count may change with real transactions.
 *
 * These bounds cannot prove data authenticity. Owner OAuth and the correct
 * deployed backend/file are still mandatory; this prevents the known sandbox
 * failure and dangerous bulk-regression, not a substitute for authentication.
 */
internal object ProductionLedgerPolicy {
    const val VERIFIED_REVISION_FLOOR: Long = 133L
    const val SUSPICIOUSLY_SMALL_LEDGER: Int = 40

    fun rejection(snapshot: SatoriSnapshot): String? {
        if (snapshot.revision < VERIFIED_REVISION_FLOOR)
            return "Nguồn dữ liệu có revision ${snapshot.revision}, cũ hơn sổ Production đã " +
                "xác minh (revision $VERIFIED_REVISION_FLOOR). Kiểm tra cấu hình Mobile API."
        if (snapshot.invoices.size < SUSPICIOUSLY_SMALL_LEDGER)
            return "Nguồn này chỉ có ${snapshot.invoices.size} hóa đơn, " +
                "không khớp sổ Production đã xác minh có 117 hóa đơn. " +
                "Có thể đang kết nối Mobile API Sandbox hoặc file mẫu."
        if (snapshot.invoices.all { it.isTest })
            return "Nguồn chỉ chứa hóa đơn TEST; không phải sổ Minh Satori Production."
        return null
    }
}
