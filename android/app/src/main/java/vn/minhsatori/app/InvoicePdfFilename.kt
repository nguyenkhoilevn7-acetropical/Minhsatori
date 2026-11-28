package vn.minhsatori.app

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle

/** Filename presented to customers; does not affect canonical invoice identity. */
object InvoicePdfFilename {
    fun forInvoice(invoice: SatoriInvoice): String {
        val number = invoice.number.trim()
        require(number.matches(Regex("""\d{1,12}""")) && number.toLongOrNull() != null &&
            number.toLong() > 0L) { "Thiếu số hóa đơn hợp lệ." }
        val recipient = invoice.customer
            .replace(Regex("""[\u0000-\u001f\u007f\\/:*?"<>|]"""), " ")
            .replace(Regex("""\s+"""), " ").trim().take(80)
        require(recipient.isNotBlank() && recipient != "." && recipient != "..") {
            "Thiếu tên người nhận."
        }
        val rawDate = invoice.date.trim()
        val normalized = try {
            if (Regex("""\d{4}-\d{2}-\d{2}""").matches(rawDate)) {
                LocalDate.parse(rawDate)
            } else {
                LocalDate.parse(rawDate, DateTimeFormatter.ofPattern("d/M/uuuu")
                    .withResolverStyle(ResolverStyle.STRICT))
            }
        } catch (_: RuntimeException) {
            throw IllegalArgumentException("Ngày đặt hàng không hợp lệ.")
        }
        return "$number - $recipient - $normalized.pdf"
    }
}
