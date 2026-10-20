package vn.minhsatori.app

/** A server error is not always a rejection: the Drive commit may already exist. */
object MobileWriteOutcome {
    private val rejectedBeforeCommit = setOf(
        "AUTH_FAILED", "FORBIDDEN", "MOBILE_NOT_CONFIGURED", "INVALID_ACTION",
        "INVALID_REQUEST", "REVISION_REQUIRED", "REVISION_CONFLICT",
        "INVALID_AMOUNT", "INVALID_ORDER", "INVALID_ITEM", "TOTAL_MISMATCH",
        "PROFILE_CHANGED", "PROFILE_MISMATCH", "PROFILE_CONFIRMATION_REQUIRED",
        "PAID_ORDER_PROTECTED", "CONFIRMATION_REQUIRED", "ORDER_CHANGED",
        "REUSED_REQUEST_ID", "BACKUP_FAILED", "CONFIG_MISSING"
    )

    fun requiresReconciliation(error: Throwable): Boolean =
        error !is MobileApiError || error.apiCode !in rejectedBeforeCommit
}
