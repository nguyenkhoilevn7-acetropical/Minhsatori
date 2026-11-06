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

data class SatoriCollaborator(
    val id: String,
    val name: String,
    val phone: String,
    val discountPercent: Double?
)

/** Verified read-only V2 order attribution keyed by the exact canonical invoice identity. */
data class SatoriOrderOrigin(
    val ledgerInvoiceId: String,
    val invoiceNo: String,
    val accountId: String,
    val accountName: String,
    val accountRole: String,
    /** ORDER_SNAPSHOT = role captured at checkout; anything else = current profile. */
    val roleSource: String = "",
    /** Checkout request id; when present it must equal the bill's apiRequestId. */
    val requestId: String = ""
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
    val paymentRequestId: String = "",
    val isTest: Boolean = false,
    val pairGroupId: String = "",
    val pairRole: String = "",
    val pairInvoiceNo: String = "",
    val collaboratorId: String = "",
    val pairCustomerName: String = "",
    val pairCollaboratorName: String = "",
    val pairDiscountPercent: Double? = null,
    val satoriPaidAt: String = "",
    // Only audit identifiers, never payment proofs/secrets, are retained in memory.
    val paymentAuditKeys: Set<String> = emptySet(),
    val creationTimestampMillis: Long? = null,
    // Read-only expense evidence. No changes to the customer invoice total.
    val ownerBorneVatAmount: Long? = null,
    val ownerBorneVatPercent: Double? = null,
    val ownerBorneVat: Boolean? = null,
    val vatExempt: Boolean = false,
    /** Ledger creation channel, e.g. "bot_api". Only used for the creator label. */
    val source: String = ""
) {
    val isInternalCollaboratorBill: Boolean get() = pairRole == "collaborator"
    val isCustomerPairBill: Boolean get() = pairRole == "customer"
    val isLinkedPairBill: Boolean get() =
        pairGroupId.isNotBlank() || pairRole.isNotBlank()
    val pairLabel: String get() = when (pairRole) {
        "customer" -> "BILL KHÁCH · liên kết #" + pairInvoiceNo
        "collaborator" -> "BILL CTV NỘI BỘ · liên kết #" + pairInvoiceNo
        else -> ""
    }
    // A CTV's settlement is a price reference, not a second physical sale.
    // Cancellation is the authoritative lifecycle state. Retain historical
    // payment timestamps only for audit; they must not revive a cancelled bill.
    val isCancelled: Boolean get() = status.equals("Đã hủy", ignoreCase = true)
    val isNonCounted: Boolean get() = status.equals("Không Tính", ignoreCase = true)
    val isExcluded: Boolean get() = isTest || isInternalCollaboratorBill ||
        isNonCounted || isCancelled
    // Display/accounting only: keep the original invoice total in the audit source.
    val accountingValue: Long get() = if (isExcluded) 0L else total
    val displayPayable: Long get() = if (isNonCounted) 0L else total
    val customerHasPaid: Boolean get() = !isCancelled &&
        (status.equals("Đã thanh toán", ignoreCase = true) || customerPaidAt.isNotBlank())
    // "Đã TT Satori" reflects settlement with Satori, NOT payment by customer.
    // Keep edits/deletes protected but allow recording the customer's payment.
    // Editing/deleting only one half would corrupt a paired CTV delivery.
    val canEditOrDelete: Boolean get() = !isLinkedPairBill && !isExcluded && !customerHasPaid &&
        !status.equals("Đã TT Satori", ignoreCase = true)
    val satoriHasPaid: Boolean get() = !isCancelled &&
        (status.equals("Đã TT Satori", ignoreCase = true) || satoriPaidAt.isNotBlank())
    val canChangePayment: Boolean get() = !isExcluded && total > 0L && id.isNotBlank()
    val canMarkCustomerPaid: Boolean get() = canChangePayment && !customerHasPaid
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
    val creationTimeLabel: String get() = creationTimestampMillis
        ?.takeIf { it in 946684800000L..4102444799999L }
        ?.let { millis ->
            java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm:ss")
                .withZone(java.time.ZoneId.of("Asia/Ho_Chi_Minh"))
                .format(java.time.Instant.ofEpochMilli(millis))
        } ?: ""
    val hasValidDate: Boolean get() = sortDate != "00000000"
    val displayDate: String get() =
        if (hasValidDate) date else "⚠ Ngày cần kiểm tra: " + date.ifBlank { "(trống)" }
}

data class SatoriSnapshot(
    val revision: Long,
    val updatedAt: String,
    val invoices: List<SatoriInvoice>,
    val products: List<SatoriProduct> = emptyList(),
    val customerMemory: List<SatoriCustomerMemory> = emptyList(),
    val collaborators: List<SatoriCollaborator> = emptyList(),
    // True only when a verified source actually supplied the owner CTV registry.
    // Missing key is NOT the same as an empty list of registered collaborators.
    val collaboratorRegistryLoaded: Boolean = false,
    // Optional server-authenticated attribution registry. Never changes bills.
    val orderOrigins: List<SatoriOrderOrigin> = emptyList()
) {
    val activeCount: Int get() = invoices.count { !it.isExcluded }
    val outstandingCount: Int get() = invoices.count { it.isOutstanding }
    val outstandingAmount: Long get() = invoices.filter { it.isOutstanding }.sumOf { it.total }

    // A requestId is committed to the single Drive ledger by the server.
    // After a lost HTTP response, this can confirm a write without resending it.
    fun confirmedWrite(action: String, requestId: String): SatoriInvoice? {
        if (requestId.isBlank()) return null
        // A pair is committed by ONE Bot API request. Never report success
        // after seeing only one half, even if its requestId matches.
        if (action == "orders.create.pair") {
            val rows = invoices.filter {
                !it.isTest && it.requestId == requestId && it.pairGroupId.isNotBlank()
            }
            val buyer = rows.singleOrNull { it.isCustomerPairBill } ?: return null
            val partner = rows.singleOrNull { it.isInternalCollaboratorBill } ?: return null
            return buyer.takeIf {
                rows.size == 2 && buyer.pairGroupId == partner.pairGroupId &&
                    buyer.pairInvoiceNo == partner.number &&
                    partner.pairInvoiceNo == buyer.number &&
                    buyer.collaboratorId.isNotBlank() &&
                    buyer.collaboratorId == partner.collaboratorId &&
                    buyer.total > partner.total &&
                    SatoriData.normalized(buyer.address) ==
                        SatoriData.normalized(partner.address)
            }
        }
        return invoices.firstOrNull { invoice ->
            !invoice.isTest && when (action) {
                "orders.create" -> invoice.requestId == requestId && !invoice.isLinkedPairBill
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
                satoriPaidAt = string(x, "satoriPaidAt"),
                paymentAuditKeys = x.optJSONArray("paymentAudit")?.let { audit ->
                    (0 until audit.length()).mapNotNull { i ->
                        audit.optJSONObject(i)?.let { entry ->
                            val action = entry.optString("action")
                            val requestId = entry.optString("requestId")
                            if (action.startsWith("payments.") && requestId.isNotBlank())
                                "$action:$requestId" else null
                        }
                    }.toSet()
                } ?: emptySet(),
                duplicateFrom = string(x, "duplicatedFromInvoiceNo"),
                requestId = string(x, "apiRequestId"),
                updateRequestId = string(x, "apiUpdateRequestId"),
                restoreRequestId = string(x, "apiRestoreRequestId"),
                paymentRequestId = string(x, "apiPaymentRequestId"),
                taxCode = string(x, "taxCode"),
                isTest = SatoriOrderValidation.requiresTestLedger("orders.create", x),
                pairGroupId = string(x, "pairGroupId"),
                pairRole = string(x, "pairRole"),
                pairInvoiceNo = string(x, "pairInvoiceNo"),
                collaboratorId = string(x, "collaboratorId"),
                pairCustomerName = string(x, "pairCustomerName"),
                pairCollaboratorName = string(x, "pairCollaboratorName"),
                pairDiscountPercent = if (x.has("pairDiscountPercent") &&
                    !x.isNull("pairDiscountPercent"))
                    x.optDouble("pairDiscountPercent").takeIf { it.isFinite() } else null,
                creationTimestampMillis = x.optLong("timestamp", 0L)
                    .takeIf { it in 946684800000L..4102444799999L },
                ownerBorneVatAmount = if (x.has("ownerBorneVatAmount") &&
                    !x.isNull("ownerBorneVatAmount"))
                    x.optLong("ownerBorneVatAmount", 0L) else null,
                ownerBorneVatPercent = if (x.has("ownerBorneVatPercent") &&
                    !x.isNull("ownerBorneVatPercent"))
                    x.optDouble("ownerBorneVatPercent", Double.NaN) else null,
                ownerBorneVat = if (x.has("ownerBorneVat") && !x.isNull("ownerBorneVat"))
                    x.optBoolean("ownerBorneVat", true) else null,
                vatExempt = x.optBoolean("vatExempt", false),
                source = string(x, "source").takeIf { it.length <= 40 }.orEmpty()
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
        // Source-approved CTV registry is read-only. Never infer a discount from an order name alone.
        val registryLoaded = values.has("satori_collaborators_v1") &&
            !values.isNull("satori_collaborators_v1")
        val partnerArray = if (registryLoaded) {
            try {
                JSONArray(values.getString("satori_collaborators_v1"))
            } catch (_: Exception) {
                throw IllegalArgumentException(
                    "Dữ liệu hồ sơ CTV bị lỗi, không thể tính lợi nhuận.")
            }
        } else JSONArray()
        require(partnerArray.length() <= 5000) { "Danh sách CTV vượt giới hạn an toàn." }
        val partners = (0 until partnerArray.length()).mapNotNull { i ->
            val row = partnerArray.optJSONObject(i) ?: return@mapNotNull null
            val id = string(row, "id")
            val name = string(row, "name")
            if (id.isBlank() || name.isBlank()) return@mapNotNull null
            val discount = if (row.has("discountPercent") && !row.isNull("discountPercent"))
                row.optDouble("discountPercent").takeIf { it.isFinite() && it in 0.0..100.0 }
                else null
            SatoriCollaborator(id, name, string(row, "phone"), discount)
        }
        // A separate owner-only registry can attribute OLD V2 invoices without
        // rewriting their immutable canonical invoices. Malformed metadata may
        // never prevent the owner from reading the financial ledger.
        val origins = runCatching {
            val originRows = JSONArray(values.optString("satori_v2_order_origins_v1", "[]"))
            require(originRows.length() <= 50000)
            (0 until originRows.length()).mapNotNull { i ->
                val row = originRows.optJSONObject(i) ?: return@mapNotNull null
                val invoiceId = string(row, "ledgerInvoiceId")
                val invoiceNo = string(row, "invoiceNo")
                val accountId = string(row, "accountId")
                val accountName = string(row, "accountName")
                val accountRole = string(row, "accountRole")
                val roleSource = string(row, "roleSource").takeIf { it.length <= 40 }.orEmpty()
                if (invoiceId.isBlank() || invoiceNo.isBlank() ||
                    accountId.isBlank() || accountName.isBlank() || accountRole.isBlank() ||
                    invoiceId.length > 100 || invoiceNo.length > 24 || accountId.length > 100 ||
                    accountName.length > 150 || accountRole.length > 40)
                    null
                else SatoriOrderOrigin(invoiceId, invoiceNo, accountId, accountName,
                    accountRole, roleSource)
            }
        }.getOrDefault(emptyList())
        return SatoriSnapshot(revision, string(root, "updatedAt"),
            invoices, products, memory, partners, registryLoaded, origins)
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
        val content = normalized(listOf(invoice.number, invoice.customer,
            invoice.pairCustomerName, invoice.pairCollaboratorName,
            invoice.collaboratorId, invoice.pairInvoiceNo, invoice.phone,
            invoice.address, invoice.lines.joinToString(" ") { it.description })
            .joinToString(" "))
        if (content.contains(needle)) return true
        // A customer typing 0903123456 must also find a stored "0903 123 456".
        val phoneDigits = query.filter { it.isDigit() }
        return phoneDigits.length >= 5 &&
            invoice.phone.filter { it.isDigit() }.contains(phoneDigits)
    }
}
