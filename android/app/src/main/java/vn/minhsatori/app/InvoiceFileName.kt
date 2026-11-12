package vn.minhsatori.app

import java.text.Normalizer

/**
 * File name of every invoice PDF the app creates or shares:
 *   <số hóa đơn>_<tên người nhận>_<ngày order dd-MM-yyyy>.pdf
 *   e.g. 5989_Cong_ty_TNHH_Nha_Hang_12-11-2026.pdf
 * Nothing else (no UUID, prefix or version). ASCII only, like the website's
 * share names, so chat apps and Windows/Zalo PC keep it intact.
 */
object InvoiceFileName {
    private const val MAX_NAME = 60

    fun pdf(number: String, recipient: String, orderDate: String): String {
        val no = number.replace(Regex("[^A-Za-z0-9]"), "").take(24).ifBlank { "HD" }
        val name = ascii(recipient).take(MAX_NAME).trim('_').ifBlank { "Khach" }
        val date = dayMonthYear(orderDate)
        return listOf(no, name, date).filter { it.isNotBlank() }.joinToString("_") + ".pdf"
    }

    fun pdf(invoice: SatoriInvoice): String = pdf(invoice.number, invoice.customer, invoice.date)

    /** Vietnamese -> ASCII, every run of other characters -> one underscore. */
    internal fun ascii(value: String): String =
        Normalizer.normalize(value, Normalizer.Form.NFD)
            .replace(Regex("\\p{Mn}+"), "")
            .replace('đ', 'd').replace('Đ', 'D')
            .replace(Regex("[^A-Za-z0-9]+"), "_")
            .trim('_')

    /** Ledger dates are dd/MM/yyyy (older rows may be yyyy-MM-dd). */
    internal fun dayMonthYear(value: String): String {
        val v = value.trim()
        Regex("^(\\d{1,2})/(\\d{1,2})/(\\d{4})").find(v)?.let { m ->
            val (d, mo, y) = m.destructured
            return d.padStart(2, '0') + "-" + mo.padStart(2, '0') + "-" + y
        }
        Regex("^(\\d{4})-(\\d{2})-(\\d{2})").find(v)?.let { m ->
            val (y, mo, d) = m.destructured
            return "$d-$mo-$y"
        }
        return ascii(v).take(20)
    }
}
