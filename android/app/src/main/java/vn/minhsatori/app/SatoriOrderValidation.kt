package vn.minhsatori.app

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/**
 * Strict input checks shared by the native invoice editor and local unit tests.
 * Bad pasted values must never crash an Android TextWatcher or change a price.
 */
internal object SatoriOrderValidation {
    private val plain = Regex("^[0-9]+$")
    private val grouped = Regex("^[0-9]{1,3}([., ][0-9]{3})+$")

    /** Explicit sandbox markers must never pass through the live invoice API. */
    fun requiresTestLedger(action: String, payload: org.json.JSONObject): Boolean {
        if (action !in setOf("orders.create", "orders.update", "orders.delete",
                "orders.restore", "payments.markCustomerPaid")) return false
        val order = payload.optJSONObject("order")
        fun tagged(obj: org.json.JSONObject): Boolean {
            val keys = listOf("isTest", "test", "testMode", "environment", "mode", "orderType", "status")
            fun marker(value: Any?): Boolean = value == true ||
                (value is String && value.trim().lowercase() in
                    setOf("test", "testing", "sandbox", "test_only", "test-only"))
            if (keys.any { marker(obj.opt(it)) }) return true
            val tags = obj.optJSONArray("tags")
            if (tags != null && (0 until tags.length()).any { marker(tags.opt(it)) }) return true
            // Treat an explicit leading TEST/SANDBOX label as test data, not
            // just "[TEST]" or "TEST ONLY". Customers commonly type "TEST đơn".
            // A word boundary avoids blocking ordinary names like "Testing Cafe".
            val testLabel = Regex("^(?:\\[\\s*TEST\\s*\\]|TEST(?:\\b|_)|SANDBOX(?:\\b|_))", RegexOption.IGNORE_CASE)
            return listOf("name", "note", "deliveryNote").any {
                testLabel.containsMatchIn(obj.optString(it, "").trimStart())
            }
        }
        return tagged(payload) || (order != null && tagged(order)) ||
            listOf("id", "invoiceNo", "expectedInvoiceNo").any {
                payload.optString(it, "").startsWith("TEST-", ignoreCase = true)
            }
    }

    fun amount(raw: String): Long {
        val value = raw.trim().replace('\u00a0', ' ')
        if (value.isEmpty()) return 0L
        val digits = when {
            plain.matches(value) -> value
            grouped.matches(value) -> value.filter { it.isDigit() }
            else -> throw IllegalArgumentException(
                "Số lượng và tiền chỉ nhận chữ số; dấu chấm/phẩy phải ngăn cách hàng nghìn."
            )
        }
        return digits.toLongOrNull()
            ?: throw IllegalArgumentException("Số tiền quá lớn, hãy kiểm tra lại.")
    }

    fun validDeliveryDate(raw: String): String {
        val value = raw.trim()
        if (value.isBlank()) return ""
        // SMART resolver (default) would normalize invalid dates such as 2026-02-30.
        // STRICT ISO parsing rejects impossible calendar dates instead.
        return try {
            LocalDate.parse(value, DateTimeFormatter.ISO_LOCAL_DATE).toString()
        } catch (_: DateTimeParseException) {
            throw IllegalArgumentException("Ngày giao không hợp lệ; dùng YYYY-MM-DD.")
        }
    }

    fun lineAmount(qty: Long, unitPrice: Long): Long {
        require(qty >= 0 && unitPrice >= 0) { "Số lượng/giá không được âm." }
        return try {
            Math.multiplyExact(qty, unitPrice)
        } catch (_: ArithmeticException) {
            throw IllegalArgumentException("Thành tiền vượt giới hạn; kiểm tra số lượng và giá.")
        }
    }

    fun sum(vararg values: Long): Long {
        require(values.all { it >= 0 }) { "Tổng tiền không được âm." }
        return try {
            values.fold(0L) { acc, value -> Math.addExact(acc, value) }
        } catch (_: ArithmeticException) {
            throw IllegalArgumentException("Tổng tiền vượt giới hạn; kiểm tra lại.")
        }
    }
}
