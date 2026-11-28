package vn.minhsatori.app

import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/**
 * UI-only invoice presentation. Monetary totals, stored prices and VAT are
 * never recalculated or written back to the canonical invoice.
 */
internal object InvoiceProductPresentation {
    enum class Icon { WATER, GUAVA, SOURSOP, FRUIT, DRINK, PACKAGE }

    fun icon(description: String, productCode: String = ""): Icon {
        val text = " " + SatoriData.normalized("$description $productCode") + " "
        return when {
            listOf(" nuoc suoi ", " suoi ", " tinh khiet ", " nuoc khoang ",
                " drinking water ", " bottled water ", " water ")
                .any { text.contains(it) } -> Icon.WATER
            listOf(" oi ", " guava ").any { text.contains(it) } -> Icon.GUAVA
            listOf(" mang cau ", " na dai ", " soursop ", " custard apple ")
                .any { text.contains(it) } -> Icon.SOURSOP
            listOf(" matcha ", " cafe ", " coffee ", " tra ", " sinh to ",
                " nuoc ep ", " smoothie ", " soda ", " juice ")
                .any { text.contains(it) } -> Icon.DRINK
            listOf(" trai cay ", " xoai ", " mit ", " dua ", " dau ", " tao ",
                " cam ", " quyt ", " thanh long ", " buoi ", " dua hau ",
                " fruit ", " chuoi ", " chanh ", " bo ")
                .any { text.contains(it) } -> Icon.FRUIT
            else -> Icon.PACKAGE
        }
    }

    /**
     * Prefer the stored line discount. Derive only if an actual list price
     * exists and is not less than the net unit price; never guess 0%.
     */
    fun discountPercent(line: SatoriLine): Double? {
        val explicit = line.discountPercent
            ?.takeIf { it.isFinite() && it >= 0.0 && it <= 100.0 }
        if (explicit != null) return explicit
        if (line.listPrice <= 0L || line.unitPrice < 0L ||
            line.unitPrice > line.listPrice) return null
        return (line.listPrice - line.unitPrice).toDouble() /
            line.listPrice.toDouble() * 100.0
    }

    /**
     * If mixed discounts occur on an invoice, show a descriptive label.
     * Weighted discount cannot reliably be reconstructed after rounding,
     * so no single guessed percentage is displayed.
     */
    fun invoiceDiscountLabel(lines: List<SatoriLine>): String {
        if (lines.isEmpty()) return "Chưa có dữ liệu"
        val values = lines.map { discountPercent(it) }
        if (values.all { it == null }) return "Chưa có dữ liệu"
        if (values.any { it == null }) return "Theo từng sản phẩm"
        val first = values.first()!!
        if (values.any { it != null && kotlin.math.abs(it - first) > 0.005 }) {
            return "Theo từng sản phẩm"
        }
        return formatPercent(first)
    }

    fun formatPercent(value: Double): String {
        return DecimalFormat("0.##", DecimalFormatSymbols(Locale("vi", "VN")))
            .format(value) + "%"
    }
}
