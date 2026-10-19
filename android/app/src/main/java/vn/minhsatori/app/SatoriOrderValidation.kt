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
