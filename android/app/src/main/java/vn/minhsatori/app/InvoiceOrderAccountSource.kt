package vn.minhsatori.app

/**
 * Read-only invoice attribution, separate from the person receiving goods.
 *
 * We only identify the ordering account when the production ledger has an
 * explicit account ID, display name and role. Older CTV-tagged invoices
 * expose the verified CTV association, but NOT a claimed login identity.
 * No customer-name/phone/address/discount heuristics are permitted.
 */
internal object InvoiceOrderAccountSource {
    data class Display(val card: String, val detail: String, val verifiedLogin: Boolean)

    private fun role(value: String): String? = when (value.trim().lowercase()) {
        "retail", "customer" -> "Khách lẻ"
        "agency" -> "Đại lý"
        "collaborator", "ctv" -> "CTV"
        "admin", "owner" -> "Quản trị"
        else -> null
    }

    fun resolve(invoice: SatoriInvoice, snapshot: SatoriSnapshot?): Display {
        val accountId = invoice.orderedByAccountId.trim()
        val name = invoice.orderedByName.trim()
        val accountRole = role(invoice.orderedByRole)
        if (accountId.isNotEmpty() && name.isNotEmpty() && accountRole != null) {
            val value = "$name · $accountRole"
            return Display("Đặt từ: $value", value, verifiedLogin = true)
        }

        // An explicitly bound collaborator is financially meaningful even when
        // historic invoice records lack the authenticated ordering account.
        val id = invoice.collaboratorId.trim()
        val matched = if (id.isNotEmpty() && snapshot?.collaboratorRegistryLoaded == true)
            snapshot.collaborators.filter { it.id == id }.singleOrNull()
        else null
        if (matched != null && matched.name.isNotBlank()) {
            val value = matched.name.trim() + " · CTV"
            return Display("CTV liên kết: $value",
                "$value (chưa xác minh tài khoản đăng nhập đã đặt đơn)",
                verifiedLogin = false)
        }
        return Display("Đặt từ: Chưa xác minh tài khoản",
            "Chưa có dữ liệu tài khoản đặt hàng trong nguồn hóa đơn.",
            verifiedLogin = false)
    }
}
