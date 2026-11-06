package vn.minhsatori.app

/** Owner-only attribution. Invoice identity is never inferred from delivery data. */
internal object InvoiceOrderAccountSource {
    const val UNKNOWN = "Chưa xác định tài khoản đặt hàng"
    data class Display(val card: String, val detail: String, val verifiedLogin: Boolean,
                       val accountName: String = "", val accountRole: String = "")

    private fun role(value: String): String? = when (value.trim().lowercase()) {
        "retail", "customer" -> "Khách Lẻ"
        "agency" -> "Đại Lý"
        "collaborator", "ctv" -> "CTV"
        "admin", "owner" -> "Quản trị"
        else -> null
    }

    fun resolve(invoice: SatoriInvoice, snapshot: SatoriSnapshot?): Display {
        fun unknown() = Display(UNKNOWN, UNKNOWN, false)
        val candidates = snapshot?.orderOrigins.orEmpty().filter {
            it.ledgerInvoiceId == invoice.id && it.invoiceNo == invoice.number
        }
        // Duplicates, even identical ones, are not authoritative evidence.
        if (candidates.size > 1) return unknown()
        val mapped = candidates.singleOrNull()
        val direct = if (invoice.orderedByAccountId.isNotBlank() &&
            invoice.orderedByName.isNotBlank() && role(invoice.orderedByRole) != null)
            SatoriOrderOrigin(invoice.id, invoice.number, invoice.orderedByAccountId,
                invoice.orderedByName, invoice.orderedByRole) else null
        if (direct != null && mapped != null &&
            (direct.accountId != mapped.accountId || direct.accountName != mapped.accountName ||
                role(direct.accountRole) != role(mapped.accountRole))) return unknown()
        val source = mapped ?: direct ?: return unknown()
        if (source.accountId.isBlank() || source.accountName.isBlank()) return unknown()
        val accountRole = role(source.accountRole) ?: return unknown()
        val name = source.accountName.trim()
        return Display("Đặt từ: $name · $accountRole", name, true, name, accountRole)
    }
}
