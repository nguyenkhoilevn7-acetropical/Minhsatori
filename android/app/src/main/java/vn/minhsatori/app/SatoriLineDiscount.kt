package vn.minhsatori.app

import java.math.BigDecimal
import java.math.RoundingMode

/** A UI-only discount: canonical invoice payload remains unitPrice + listPrice. */
internal object SatoriLineDiscount {
    private val hundred = BigDecimal.valueOf(100L)
    private val decimal = Regex("""^\d{1,3}(?:[.,]\d{1,2})?$""")

    fun rate(raw: String): BigDecimal {
        val text = raw.trim().replace(',', '.')
        require(decimal.matches(text)) {
            "Chiết khấu phải từ 0–100%, tối đa 2 chữ số thập phân."
        }
        return BigDecimal(text).also {
            require(it <= hundred) { "Chiết khấu phải từ 0–100%." }
        }
    }

    fun unitPrice(listPrice: Long, raw: String): Long {
        require(listPrice in 1L..10000000000L) { "Nhập giá niêm yết hợp lệ trước khi nhập chiết khấu." }
        return BigDecimal.valueOf(listPrice).multiply(hundred.subtract(rate(raw)))
            .divide(hundred, 0, RoundingMode.HALF_UP).longValueExact()
    }

    /** Display only: never use a rounded inferred rate to overwrite a stored price. */
    fun fromPrices(listPrice: Long, price: Long): String {
        if (listPrice <= 0L || price < 0L || price > listPrice) return ""
        return BigDecimal.valueOf(listPrice - price).multiply(hundred)
            .divide(BigDecimal.valueOf(listPrice), 2, RoundingMode.HALF_UP)
            .stripTrailingZeros().toPlainString()
    }
}
