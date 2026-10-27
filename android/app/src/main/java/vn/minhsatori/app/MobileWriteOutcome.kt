package vn.minhsatori.app

/** A server error is not always a rejection: the Drive commit may already exist. */
object MobileWriteOutcome {
    private val rejectedBeforeCommit = setOf(
        "AUTH_FAILED", "FORBIDDEN", "MOBILE_NOT_CONFIGURED", "INVALID_ACTION",
        "INVALID_REQUEST", "REVISION_REQUIRED", "REVISION_CONFLICT",
        "INVALID_AMOUNT", "INVALID_ORDER", "INVALID_ITEM", "TOTAL_MISMATCH",
        "PROFILE_CHANGED", "PROFILE_MISMATCH", "PROFILE_CONFIRMATION_REQUIRED",
        "PAID_ORDER_PROTECTED", "CONFIRMATION_REQUIRED", "REASON_REQUIRED",
        "REQUEST_ID_CONFLICT", "CTV_INTERNAL_NOT_RECEIVABLE", "ORDER_CHANGED",
        "REUSED_REQUEST_ID", "BACKUP_FAILED", "CONFIG_MISSING"
    )

    fun requiresReconciliation(error: Throwable): Boolean =
        error !is MobileApiError || error.apiCode !in rejectedBeforeCommit

    // A normal HTTP success or alreadyPaid/alreadySet reply may not identify our
    // financial event after a timeout. Keep the encrypted journal until canonical
    // readback proves this exact requestId and target state.
    fun acceptsServerSuccess(action: String, alreadyPaid: Boolean, exactProof: Boolean): Boolean =
        !action.startsWith("payments.") || exactProof

    // A rejected retry (e.g. expired token) says nothing about whether an earlier
    // attempt committed. Keep that journal until there is authoritative proof.
    fun mayDiscardAfterRejection(error: Throwable, hadPendingBeforeSend: Boolean): Boolean =
        !hadPendingBeforeSend && !requiresReconciliation(error)
}
