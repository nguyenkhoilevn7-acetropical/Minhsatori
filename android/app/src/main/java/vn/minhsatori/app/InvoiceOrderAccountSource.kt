package vn.minhsatori.app

/**
 * Owner-only attribution of the account that placed an invoice.
 *
 * The ONLY accepted evidence is the server-verified registry
 * `satori_v2_order_origins_v1` delivered by the owner-authenticated Mobile API
 * (PostgreSQL V2 committed checkout → Apps Script → Android). Fields written
 * inside the invoice itself, the recipient name, phone, discount or CTV link
 * are never used: they can be typed by anyone who edits a bill.
 */
internal object InvoiceOrderAccountSource {
    const val UNKNOWN = "Chưa xác định tài khoản đặt hàng"
    const val ROLE_FROM_ORDER = "ORDER_SNAPSHOT"
    const val ROLE_FROM_CURRENT_PROFILE = "CURRENT_PROFILE"
    const val CURRENT_PROFILE_NOTE = "Vai trò theo hồ sơ hiện tại, không phải lúc đặt"

    data class Display(
        val card: String,
        val detail: String,
        val verifiedLogin: Boolean,
        val accountName: String = "",
        val accountRole: String = "",
        /** True when the role was captured at checkout; false = current profile. */
        val roleFromOrder: Boolean = false
    ) {
        /** Role line for the detail screen, explicit about where the role comes from. */
        val roleDetail: String get() =
            if (!verifiedLogin) "" else if (roleFromOrder) accountRole
            else "$accountRole · $CURRENT_PROFILE_NOTE"
    }

    /** Exact server enum only; aliases are rejected so a typo never becomes a role. */
    fun role(value: String): String? = when (value) {
        "retail" -> "Khách Lẻ"
        "agency" -> "Đại Lý"
        "collaborator" -> "CTV"
        else -> null
    }

    private val unknown = Display(UNKNOWN, UNKNOWN, false)

    fun resolve(invoice: SatoriInvoice, snapshot: SatoriSnapshot?): Display {
        if (invoice.id.isBlank() || invoice.number.isBlank()) return unknown
        val all = snapshot?.orderOrigins.orEmpty()
        // Same ledger id OR same number must be one exact record. A second row for
        // either half (duplicate, conflict, reused number) makes the origin unknown.
        val related = all.filter {
            it.ledgerInvoiceId == invoice.id || it.invoiceNo == invoice.number
        }
        if (related.size != 1) return unknown
        val origin = related.single()
        if (origin.ledgerInvoiceId != invoice.id || origin.invoiceNo != invoice.number)
            return unknown
        val name = origin.accountName
        if (origin.accountId.isBlank() || name.isBlank() || name != name.trim()) return unknown
        val accountRole = role(origin.accountRole) ?: return unknown
        val fromOrder = origin.roleSource == ROLE_FROM_ORDER
        val card = "Đặt từ: $name · $accountRole" + if (fromOrder) "" else " (hồ sơ hiện tại)"
        return Display(card, name, true, name, accountRole, fromOrder)
    }
}
