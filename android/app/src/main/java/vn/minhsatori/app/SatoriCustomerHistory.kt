package vn.minhsatori.app

/**
 * Read-only projection of the current, revision-verified satori_orders_v15 snapshot.
 * AI customer memory is NOT an invoice ledger and must never supply payment,
 * item quantity, invoice totals or the current order count.
 *
 * Exact customer-memory attribution needs BOTH a matching alias/name and
 * an existing, exact verified delivery contact (phone + address). Same-name
 * invoices with other contacts remain visible to the owner as unverified
 * candidates, never merged into balances, discounts or customer identity.
 */
internal data class SatoriHistoryMatch(
    val verifiedDelivery: List<SatoriInvoice>,
    val sameNameUnverified: List<SatoriInvoice>
)

internal object SatoriCustomerHistory {
    private fun name(s: String) = SatoriData.normalized(s)
    private fun phone(s: String): String =
        s.filter { it.isDigit() }.trimStart('0')
    private fun activeSource(orders: List<SatoriInvoice>) =
        orders.filterNot { it.isTest || it.isInternalCollaboratorBill }

    private val recentFirst = compareByDescending<SatoriInvoice> {
        it.updatedTimestampMillis ?: it.creationTimestampMillis ?: 0L
    }.thenByDescending { it.sortDate }
        .thenByDescending { it.number.toLongOrNull() ?: 0L }

    fun exactPoint(representative: SatoriInvoice, orders: List<SatoriInvoice>): List<SatoriInvoice> {
        val key = SatoriData.customerKey(representative)
        return activeSource(orders)
            .filter { SatoriData.customerKey(it) == key }
            .sortedWith(recentFirst)
    }

    /** Discover other delivery points for navigation only, never claim shared ownership. */
    fun sameNameOtherPoints(representative: SatoriInvoice, orders: List<SatoriInvoice>): List<SatoriInvoice> {
        val key = SatoriData.customerKey(representative)
        val normalized = name(representative.customer)
        return activeSource(orders)
            .filter { name(it.customer) == normalized && SatoriData.customerKey(it) != key }
            .sortedWith(recentFirst)
    }

    fun forMemory(memory: SatoriCustomerMemory, orders: List<SatoriInvoice>): SatoriHistoryMatch {
        val aliases = (listOf(memory.name) + memory.aliases).map(::name).filter { it.isNotBlank() }.toSet()
        val confirmedContacts = (listOf(SatoriReceiver(memory.name, memory.defaultPhone, memory.defaultLocation)) +
            memory.receivers).mapNotNull {
            val tel = phone(it.phone)
            val address = name(it.location)
            if (tel.length >= 8 && address.isNotBlank()) tel + "|" + address else null
        }.toSet()
        val verified = mutableListOf<SatoriInvoice>()
        val unverified = mutableListOf<SatoriInvoice>()
        activeSource(orders).forEach { invoice ->
            if (name(invoice.customer) !in aliases) return@forEach
            val tel = phone(invoice.phone)
            val address = name(invoice.address)
            if (tel.length >= 8 && tel + "|" + address in confirmedContacts)
                verified.add(invoice)
            else
                unverified.add(invoice)
        }
        return SatoriHistoryMatch(verified.sortedWith(recentFirst),
            unverified.sortedWith(recentFirst))
    }

    fun detail(orders: List<SatoriInvoice>, max: Int = 40): String {
        if (orders.isEmpty()) return "Không tìm thấy hóa đơn ở sổ gốc đã đồng bộ."
        val limit = max.coerceIn(1, 100)
        return orders.take(limit).joinToString("\n\n") { invoice ->
            val products = invoice.lines.filter { it.quantity > 0 }
                .joinToString("; ") { line ->
                    "${line.description} ×${line.quantity} ${line.unit}"
                }.ifBlank { "Chưa có thông tin sản phẩm" }
            buildString {
                append("#").append(invoice.number).append(" · ")
                    .append(invoice.displayDate).append(" · ").append(invoice.status)
                append("\n").append(products)
                append("\nTổng: ").append(SatoriData.money(invoice.total))
                    .append(" · VAT: ").append(SatoriData.money(invoice.vat))
                    .append(" · Giao: ").append(SatoriData.money(invoice.shipping))
                if (invoice.isExcluded) append(" · Không tính doanh thu/công nợ")
                append("\n").append(invoice.customer)
                if (invoice.phone.isNotBlank()) append(" · ").append(invoice.phone)
                if (invoice.address.isNotBlank()) append("\n").append(invoice.address)
                if (invoice.deliveryNote.isNotBlank())
                    append("\nGhi chú: ").append(invoice.deliveryNote)
            }
        } + (if (orders.size > limit) "\n\nCòn ${orders.size - limit} hóa đơn; dùng bộ lọc Sổ kế toán để xem tiếp." else "")
    }
}
