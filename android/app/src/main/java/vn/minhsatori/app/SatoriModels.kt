package vn.minhsatori.app

import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.util.Locale

/** Only parsed, read-only snapshots; never store customer records on the phone. */
data class SatoriProduct(
    val code: String,
    val name: String,
    val unit: String,
    val unitPrice: Long,
    val listPrice: Long
)

data class SatoriLine(
    val description: String,
    val quantity: Int,
    val unit: String,
    val unitPrice: Long,
    val listPrice: Long,
    val code: String = ""
) {
    val amount: Long get() = quantity.toLong() * unitPrice
}

data class SatoriInvoice(
    val id: String,
    val number: String,
    val date: String,
    val customer: String,
    val phone: String,
    val address: String,
    val status: String,
    val total: Long,
    val shipping: Long,
    val vat: Long,
    val lines: List<SatoriLine>,
    val deliveryNote: String,
    val customerPaidAt: String,
    val duplicateFrom: String,
    val requestId: String = ""
) {
    val isExcluded: Boolean get() = status.equals("Không Tính", ignoreCase = true)
    val customerHasPaid: Boolean get() =
        status.equals("Đã thanh toán", ignoreCase = true) || customerPaidAt.isNotBlank()
    // "Đã TT Satori" reflects settlement with Satori, NOT payment by customer.
    // Keep edits/deletes protected but allow recording the customer's payment.
    val canEditOrDelete: Boolean get() = !isExcluded && !customerHasPaid &&
        !status.equals("Đã TT Satori", ignoreCase = true)
    val canMarkCustomerPaid: Boolean get() = !isExcluded && !customerHasPaid && total > 0L
    val isOutstanding: Boolean get() = !isExcluded && !customerHasPaid && total > 0L
    val sortDate: String get() {
        val parts = date.split("/")
        return if (parts.size == 3) parts[2] + parts[1].padStart(2, '0') +
                parts[0].padStart(2, '0') else date
    }
}

data class SatoriSnapshot(
    val revision: Long,
    val updatedAt: String,
    val invoices: List<SatoriInvoice>,
    val products: List<SatoriProduct> = emptyList()
) {
    val activeCount: Int get() = invoices.count { !it.isExcluded }
    val outstandingCount: Int get() = invoices.count { it.isOutstanding }
    val outstandingAmount: Long get() = invoices.filter { it.isOutstanding }.sumOf { it.total }
}

object SatoriData {
    fun money(value: Long): String = "%,d đ".format(Locale("vi", "VN"), value)

    fun normalized(text: String): String =
        Normalizer.normalize(text.lowercase(Locale.ROOT), Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "")
            .replace('đ', 'd')
            .replace(Regex("\\s+"), " ")
            .trim()

    private fun string(json: JSONObject, key: String): String =
        if (!json.has(key) || json.isNull(key)) "" else json.optString(key, "").trim()

    fun fromDriveState(content: String): SatoriSnapshot {
        val root = JSONObject(content)
        val revision = root.optLong("revision", -1)
        require(revision >= 0) { "Dữ liệu Drive thiếu revision." }
        val values = root.getJSONObject("values")
        val orders = JSONArray(values.getString("satori_orders_v15"))
        require(orders.length() <= 50000) { "Số hóa đơn vượt giới hạn an toàn." }
        val invoices = (0 until orders.length()).map { index ->
            val x = orders.getJSONObject(index)
            val hasItems = x.optJSONArray("items")
            val lines = if (hasItems != null && hasItems.length() > 0) {
                (0 until hasItems.length()).map { j ->
                    val row = hasItems.getJSONObject(j)
                    SatoriLine(
                        description = string(row, "product").ifEmpty { "Sản phẩm" },
                        quantity = row.optInt("qty", 0).coerceAtLeast(0),
                        unit = string(row, "unit").ifEmpty { "Thùng" },
                        unitPrice = row.optLong("unitPrice", 0).coerceAtLeast(0),
                        listPrice = row.optLong("listPrice", 0).coerceAtLeast(0),
                        code = string(row, "code")
                    )
                }
            } else {
                listOf(SatoriLine(
                    description = string(x, "product").ifEmpty { "Sản phẩm" },
                    quantity = x.optInt("qty", 0).coerceAtLeast(0),
                    unit = "Thùng",
                    unitPrice = x.optLong("unitPrice", 0).coerceAtLeast(0),
                    listPrice = x.optLong("listPrice", 0).coerceAtLeast(0)
                ))
            }
            SatoriInvoice(
                id = string(x, "id").ifEmpty { "row-" + index },
                number = string(x, "invoiceNo").ifEmpty { "?" },
                date = string(x, "date"),
                customer = string(x, "name").ifEmpty { "Khách vãng lai" },
                phone = string(x, "phone"),
                address = string(x, "location"),
                status = string(x, "status").ifEmpty { "Chưa thanh toán" },
                total = x.optLong("total", 0).coerceAtLeast(0),
                shipping = x.optLong("shippingAmount", 0).coerceAtLeast(0),
                vat = x.optLong("vatAmount", 0).coerceAtLeast(0),
                lines = lines,
                deliveryNote = string(x, "deliveryNote").take(1000),
                customerPaidAt = string(x, "customerPaidAt"),
                duplicateFrom = string(x, "duplicatedFromInvoiceNo"),
                requestId = string(x, "apiRequestId")
            )
        }.sortedWith(compareByDescending<SatoriInvoice> { it.sortDate }
            .thenByDescending { it.number.toLongOrNull() ?: 0L })
        val catalogue = try {
            JSONArray(values.optString("satori_catalogue_v15", "[]"))
        } catch (_: Exception) { JSONArray() }
        val products = (0 until catalogue.length()).mapNotNull { i ->
            val item = catalogue.optJSONObject(i) ?: return@mapNotNull null
            val name = string(item, "name").ifBlank { string(item, "product") }
            if (name.isBlank()) null else SatoriProduct(
                code = string(item, "code"),
                name = name,
                unit = string(item, "unit").ifBlank { "Thùng" },
                unitPrice = item.optLong("unitPrice", 0).coerceAtLeast(0),
                listPrice = item.optLong("listPrice", 0).coerceAtLeast(0)
            )
        }
        return SatoriSnapshot(revision, string(root, "updatedAt"), invoices, products)
    }

    fun customerKey(invoice: SatoriInvoice): String =
        normalized(invoice.customer) + "|" + normalized(invoice.phone) + "|" +
            normalized(invoice.address)

    fun search(invoice: SatoriInvoice, query: String): Boolean {
        val needle = normalized(query)
        return needle.isBlank() || normalized(listOf(invoice.number, invoice.customer,
            invoice.phone, invoice.address, invoice.lines.joinToString(" ") { it.description })
            .joinToString(" ")).contains(needle)
    }
}
