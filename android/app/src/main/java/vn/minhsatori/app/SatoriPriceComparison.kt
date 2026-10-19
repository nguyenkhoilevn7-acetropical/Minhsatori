package vn.minhsatori.app

/**
 * Read-only, conservative comparison of two differently priced representations
 * of the SAME physical delivery. This is NOT the Satori supplier Excel matcher.
 *
 * Never collapse repeated orders merely because a name or product matches.
 * Explicit linkage OR a "Không Tính" price-only view is also required.
 * Missing phone/address/date/line items => review, not an automatic match.
 */
data class SatoriPricePair(
    val delivery: SatoriInvoice,
    val alternate: SatoriInvoice,
    val priceDifference: Long
)

data class SatoriComparisonReview(
    val invoices: List<SatoriInvoice>,
    val reason: String
)

data class SatoriInternalComparison(
    val pairs: List<SatoriPricePair>,
    val toReview: List<SatoriComparisonReview>,
    val notPairedCount: Int
)

object SatoriPriceComparison {
    private fun basket(invoice: SatoriInvoice): String? {
        if (invoice.lines.isEmpty() || invoice.lines.any {
                it.quantity <= 0 || it.description.isBlank() || it.description == "Sản phẩm"
            }) return null
        return invoice.lines.groupBy {
            SatoriData.normalized(it.code.ifBlank { it.description }) + "|" +
                SatoriData.normalized(it.unit)
        }.map { (key, lines) -> key + ":" + lines.sumOf { it.quantity } }
            .sorted().joinToString(";")
    }

    private fun creationMillis(invoice: SatoriInvoice): Long? {
        // The website generates order.id = Date.now(); that 13-digit epoch is
        // evidence of creation time. Do not treat unrelated numeric IDs as dates.
        val millis = invoice.id.toLongOrNull() ?: return null
        return millis.takeIf { it in 1577836800000L..4102444800000L }
    }

    private fun closeInTime(a: SatoriInvoice, b: SatoriInvoice): Boolean {
        val first = creationMillis(a) ?: return false
        val second = creationMillis(b) ?: return false
        // A price view copied within 30 min can be recognized; older deliveries
        // still require manual review rather than an invented time relationship.
        return kotlin.math.abs(first - second) <= 30L * 60L * 1000L
    }

    private fun linked(a: SatoriInvoice, b: SatoriInvoice): Boolean {
        val byNumber = a.duplicateFrom == b.number || b.duplicateFrom == a.number
        val alternatePrice = a.status == "Không Tính" || b.status == "Không Tính"
        return byNumber || alternatePrice
    }

    fun compare(invoices: List<SatoriInvoice>): SatoriInternalComparison {
        // Cancelled invoices remain visible elsewhere but are not candidates.
        val candidates = invoices.filterNot { it.status == "Đã hủy" }
        val group = candidates.groupBy { invoice ->
            SatoriData.normalized(invoice.customer) + "|" + invoice.sortDate +
                "|" + (basket(invoice) ?: "")
        }
        val matched = mutableListOf<SatoriPricePair>()
        val reviews = mutableListOf<SatoriComparisonReview>()
        for (rows in group.values.filter { it.size > 1 }) {
            if (rows.size != 2) {
                reviews += SatoriComparisonReview(rows,
                    "Có hơn hai hóa đơn cùng khách, ngày và giỏ hàng; không tự ghép.")
                continue
            }
            val (a, b) = rows
            val phoneA = a.phone.filter(Char::isDigit)
            val phoneB = b.phone.filter(Char::isDigit)
            val addressA = SatoriData.normalized(a.address)
            val addressB = SatoriData.normalized(b.address)
            val sameName = SatoriData.normalized(a.customer).isNotBlank() &&
                SatoriData.normalized(a.customer) != "khach vang lai"
            val sameDay = a.hasValidDate && b.hasValidDate &&
                a.sortDate == b.sortDate
            val sameBasket = basket(a) != null && basket(a) == basket(b)
            val sameReceiver = phoneA.isNotBlank() && phoneA == phoneB &&
                addressA.isNotBlank() && addressA == addressB
            if (!sameName || !sameDay || !sameBasket || !sameReceiver) {
                reviews += SatoriComparisonReview(rows,
                    "Thiếu hoặc khác ngày, số điện thoại, địa chỉ hay danh sách hàng; " +
                        "cần đối chiếu trước khi gộp.")
                continue
            }
            if (!linked(a, b)) {
                reviews += SatoriComparisonReview(rows,
                    "Thông tin giao trùng nhưng chưa xác nhận là hai bản giá; " +
                        "có thể khách đặt hai lần riêng.")
                continue
            }
            if (!closeInTime(a, b)) {
                reviews += SatoriComparisonReview(rows,
                    "Chưa xác minh được hai bản giá tạo gần nhau trong 30 phút " +
                        "(thiếu thời điểm tạo hoặc tạo cách xa); không tự ghép.")
                continue
            }
            val main = when {
                a.status == "Không Tính" && b.status != "Không Tính" -> b
                b.status == "Không Tính" && a.status != "Không Tính" -> a
                a.total >= b.total -> a
                else -> b
            }
            val alternate = if (main === a) b else a
            matched += SatoriPricePair(main, alternate,
                kotlin.math.abs(a.total - b.total))
        }
        return SatoriInternalComparison(
            pairs = matched,
            toReview = reviews,
            notPairedCount = candidates.size - matched.size * 2
        )
    }
}
