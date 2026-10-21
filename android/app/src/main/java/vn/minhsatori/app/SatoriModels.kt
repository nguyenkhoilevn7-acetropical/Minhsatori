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
    val listPrice: Long,
    val discountPercent: Double? = null
)

data class SatoriReceiver(
    val name: String,
    val phone: String,
    val location: String
)

data class SatoriCustomerMemory(
    val id: String,
    val name: String,
    val aliases: List<String>,
    val defaultPhone: String,
    val defaultLocation: String,
    val discountPercent: Double?,
    val preferredProduct: String,
    val orderCount: Int,
    val receivers: List<SatoriReceiver>
)

data class SatoriLine(
    val description: String,
    val quantity: Int,
    val unit: String,
    val unitPrice: Long,
    val listPrice: Long,
    val code: String = "",
    val discountPercent: Double? = null
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
    val requestId: String = "",
    val updateRequestId: String = "",
    val restoreRequestId: String = "",
    val taxCode: String = "",
    val paymentRequestId: String = ""
) {
    val isExcluded: Boolean get() = status.equals("Không Tính", ignoreCase = true) ||
        status.equals("Đã hủy", ignoreCase = true)
    val customerHasPaid: Boolean get() =
        status.equals("Đã thanh toán", ignoreCase = true) || customerPaidAt.isNotBlank()
    // "Đã TT Satori" reflects settlement with Satori, NOT payment by customer.
    // Keep edits/deletes protected but allow recording the customer's payment.
    val canEditOrDelete: Boolean get() = !isExcluded && !customerHasPaid &&
        !status.equals("Đã TT Satori", ignoreCase = true)
    val canMarkCustomerPaid: Boolean get() = !isExcluded && !customerHasPaid && total > 0L
    val isOutstanding: Boolean get() = !isExcluded && !customerHasPaid && total > 0L
    // Keep source dates untouched, but never sort impossible dates as recent orders.
    // Malformed dates are preserved for manual review instead of being guessed.
    val sortDate: String get() {
        val raw = date.trim()
        val match = Regex("""^(\d{1,2})/(\d{1,2})/(\d{4})$""").matchEntire(raw)
        return try {
            val parsed = if (match == null) {
                // The old UI also accepted ISO yyyy-MM-dd strings.
                java.time.LocalDate.parse(raw)
            } else {
                val (day, month, year) = match.destructured
                java.time.LocalDate.of(year.toInt(), month.toInt(), day.toInt())
            }
            parsed.toString().replace("-", "")
        } catch (_: java.time.DateTimeException) {
            "00000000"
        }
    }
    val hasValidDate: Boolean get() = sortDate != "00000000"
    val displayDate: String get() =
        if (hasValidDate) date else "⚠ Ngày cần kiểm tra: " + date.ifBlank { "(trống)" }
}

data class SatoriSnapshot(
    val revision: Long,
    val updatedAt: String,
    val invoices: List<SatoriInvoice>,
    val products: List<SatoriProduct> = emptyList(),
    val customerMemory: List<SatoriCustomerMemory> = emptyList()
) {
    val activeCount: Int get() = invoices.count { !it.isExcluded }
    val outstandingCount: Int get() = invoices.count { it.isOutstanding }
    val outstandingAmount: Long get() = invoices.filter { it.isOutstanding }.sumOf { it.total }

    // A requestId is committed to the single Drive ledger by the server.
    // After a lost HTTP response, this can confirm a write without resending it.
    fun confirmedWrite(action: String, requestId: String): SatoriInvoice? {
        if (requestId.isBlank()) return null
        return invoices.firstOrNull { invoice ->
            when (action) {
                "orders.create" -> invoice.requestId == requestId
                "orders.update" -> invoice.updateRequestId == requestId
                "orders.restore" -> invoice.restoreRequestId == requestId
                else -> false
            }
        }
    }

    // After the customer-payment HTTP reply is lost, validate the exact invoice
    // and amount from an authoritative refreshed snapshot. This confirms the
    // payment state, not which device triggered it; never resend a new payment.
    fun confirmedCustomerPayment(invoiceNo: String, amount: Long): SatoriInvoice? {
        if (invoiceNo.isBlank() || amount < 0L) return null
        return invoices.singleOrNull { invoice ->
            invoice.number == invoiceNo && invoice.total == amount &&
                invoice.customerHasPaid && !invoice.isExcluded
        }
    }
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
                        code = string(row, "code"),
                        discountPercent = if (row.has("discountPercent") && !row.isNull("discountPercent"))
                            row.optDouble("discountPercent").takeIf { it.isFinite() } else null
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
                requestId = string(x, "apiRequestId"),
                updateRequestId = string(x, "apiUpdateRequestId"),
                restoreRequestId = string(x, "apiRestoreRequestId"),
                paymentRequestId = string(x, "apiPaymentRequestId"),
                taxCode = string(x, "taxCode")
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
                listPrice = item.optLong("listPrice", 0).coerceAtLeast(0),
                discountPercent = if (item.has("discountPercent") &&
                    !item.isNull("discountPercent"))
                    item.optDouble("discountPercent").takeIf { it.isFinite() } else null
            )
        }
        // Memory is private customer data. Only read it when the verified source
        // supplies the field; never synthesize entries from old APK defaults.
        val memoryRows = try {
            JSONArray(values.optString("satori_ai_customer_memory", "[]"))
        } catch (_: Exception) { JSONArray() }
        require(memoryRows.length() <= 5000) { "Bộ nhớ khách hàng vượt giới hạn an toàn." }
        val memory = (0 until memoryRows.length()).mapNotNull { index ->
            val row = memoryRows.optJSONObject(index) ?: return@mapNotNull null
            val name = string(row, "name")
            if (name.isBlank()) return@mapNotNull null
            val aliasesJson = row.optJSONArray("aliases") ?: JSONArray()
            val receiverRows = row.optJSONArray("receivers") ?: JSONArray()
            val receivers = (0 until minOf(50, receiverRows.length())).mapNotNull { j ->
                val r = receiverRows.optJSONObject(j) ?: return@mapNotNull null
                SatoriReceiver(string(r, "name"), string(r, "phone"), string(r, "location"))
            }
            SatoriCustomerMemory(
                id = string(row, "id").ifBlank { "memory-" + index },
                name = name,
                aliases = (0 until minOf(40, aliasesJson.length())).mapNotNull { j ->
                    aliasesJson.optString(j, "").trim().takeIf { it.isNotBlank() }
                },
                defaultPhone = string(row, "defaultPhone"),
                defaultLocation = string(row, "defaultLocation"),
                discountPercent = if (row.has("discountPercent") &&
                    !row.isNull("discountPercent"))
                    row.optDouble("discountPercent").takeIf { it.isFinite() } else null,
                preferredProduct = string(row, "preferredProduct"),
                orderCount = row.optInt("orderCount", 0).coerceAtLeast(0),
                receivers = receivers
            )
        }
        return SatoriSnapshot(revision, string(root, "updatedAt"), invoices, products, memory)
    }

    // Presentation separators do not change the recipient's phone number.
    // Still require matching delivery address, so separate delivery points stay separate.
    fun customerKey(invoice: SatoriInvoice): String =
        normalized(invoice.customer) + "|" + invoice.phone.filter { it.isDigit() } + "|" +
            normalized(invoice.address)

    fun search(invoice: SatoriInvoice, query: String): Boolean {
        val needle = normalized(query)
        if (needle.isBlank()) return true
        // Match the website's invoice lookup: short numeric or #/HD/Bill queries
        // select an exact invoice number, not coincidental phone/address digits.
        val prefixedInvoice = Regex(
            """^(?:#|hd\s*#?|bill\s*#?|hoa\s+don\s*#?)\s*(\d+)$"""
        ).matchEntire(needle)
        if (prefixedInvoice != null) {
            return invoice.number.trimStart('0') ==
                prefixedInvoice.groupValues[1].trimStart('0')
        }
        if (needle.matches(Regex("""\d{1,4}"""))) {
            return invoice.number.trimStart('0') == needle.trimStart('0')
        }
        val content = normalized(listOf(invoice.number, invoice.customer, invoice.phone,
            invoice.address, invoice.lines.joinToString(" ") { it.description })
            .joinToString(" "))
        if (content.contains(needle)) return true
        // A customer typing 0903123456 must also find a stored "0903 123 456".
        val phoneDigits = query.filter { it.isDigit() }
        return phoneDigits.length >= 5 &&
            invoice.phone.filter { it.isDigit() }.contains(phoneDigits)
    }
}
