package vn.minhsatori.app

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Read-only percentage math for Android owner invoice editing.
 * The server schema continues to receive integer shippingAmount/vatAmount (VND).
 * Both percentages are based on the goods subtotal, never on the tax-inclusive total.
 */
internal object SatoriPercentCharges {
    private val decimal = Regex("""^\d{1,3}(?:[.,]\d{1,2})?$""")
    private val hundred = BigDecimal.valueOf(100L)

    fun rate(raw: String): BigDecimal {
        val normalized = raw.trim().removeSuffix("%").trim().replace(',', '.')
        require(decimal.matches(normalized)) {
            "Phần trăm chỉ nhận số từ 0 đến 100, tối đa 2 chữ số thập phân."
        }
        val value = BigDecimal(normalized)
        require(value <= hundred) { "VAT/Shipping phải nằm trong khoảng 0–100%." }
        return value
    }

    /** Whole-VND half-up rounding, matching normal Math.round percentage semantics. */
    fun amount(goods: Long, rawPercent: String): Long {
        require(goods >= 0L) { "Tiền hàng không hợp lệ." }
        return try {
            BigDecimal.valueOf(goods).multiply(rate(rawPercent))
                .divide(hundred, 0, RoundingMode.HALF_UP).longValueExact()
        } catch (_: ArithmeticException) {
            throw IllegalArgumentException("Tiền thuế hoặc phí giao vượt giới hạn.")
        }
    }

    /** Show a meaningful initial percent, without manufacturing a false precision. */
    fun fromAmount(goods: Long, charge: Long): String {
        require(goods >= 0 && charge >= 0) { "Số tiền không hợp lệ." }
        if (goods == 0L) return "0"
        return BigDecimal.valueOf(charge).multiply(hundred)
            .divide(BigDecimal.valueOf(goods), 2, RoundingMode.HALF_UP)
            .stripTrailingZeros().toPlainString()
    }

    /**
     * Preserve legacy integer VND if the owner did not change its percentage
     * and the goods subtotal is unchanged. This avoids silent ±1 VND edits to
     * historical invoices whose old amount used a different rounding rule.
     */
    fun charge(goods: Long, percent: String, originalGoods: Long?,
               originalCharge: Long?, percentModified: Boolean): Long {
        if (!percentModified && originalGoods == goods && originalCharge != null) {
            require(originalCharge >= 0) { "Phí hoặc thuế gốc không hợp lệ." }
            return originalCharge
        }
        return amount(goods, percent)
    }
}
