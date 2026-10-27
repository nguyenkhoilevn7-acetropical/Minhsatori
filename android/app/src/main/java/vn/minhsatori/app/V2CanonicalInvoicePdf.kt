package vn.minhsatori.app

import android.content.Context
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

/**
 * Original archival PDF only. Do not render a new invoice on Android for V2.
 * The authenticated web chat and Gemini clients use the same backend bytes.
 * Must execute off Android's UI thread; never store session credentials on disk.
 */
internal object V2CanonicalInvoicePdf {
    private const val MAX_BYTES = 10 * 1024 * 1024
    private const val PDF_ROUTE = "/api/v2/invoice-document?id="

    fun download(invoiceId: String, expectedSha256: String,
                 session: String, csrf: String): ByteArray {
        val canonicalUuid = runCatching { UUID.fromString(invoiceId).toString() }
            .getOrNull() ?: throw IllegalArgumentException("Mã hóa đơn không hợp lệ")
        require(invoiceId.equals(canonicalUuid, true)) { "Mã hóa đơn không hợp lệ" }
        require(Regex("[a-f0-9]{64}").matches(expectedSha256)) { "Thiếu mã băm PDF gốc" }
        require(Regex("[a-f0-9]{64}").matches(session) &&
            Regex("[a-f0-9]{48}").matches(csrf)) { "Phiên đăng nhập không hợp lệ" }

        val connection = URL(V2OwnerApi.ORIGIN + PDF_ROUTE + canonicalUuid)
            .openConnection() as HttpsURLConnection
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 18000
        connection.readTimeout = 25000
        connection.useCaches = false
        connection.requestMethod = "GET"
        connection.setRequestProperty("Cookie",
            "satori_v2_session=$session; satori_v2_csrf=$csrf")
        connection.setRequestProperty("Accept", "application/pdf")
        connection.setRequestProperty("Cache-Control", "no-store")
        try {
            val code = connection.responseCode
            if (code != 200) throw IllegalStateException(
                "PDF gốc chưa sẵn sàng hoặc tài khoản không có quyền ($code)")
            require(connection.contentType?.substringBefore(';') == "application/pdf") {
                "Máy chủ không trả PDF gốc"
            }
            require(connection.getHeaderField("X-Content-SHA256") == expectedSha256) {
                "Sai mã xác thực PDF"
            }
            require(connection.contentLengthLong in -1L..MAX_BYTES.toLong()) {
                "PDF vượt giới hạn an toàn"
            }
            val stream = connection.inputStream
            val output = ByteArrayOutputStream()
            stream.use { input ->
                val buf = ByteArray(8192)
                while (true) {
                    val read = input.read(buf)
                    if (read < 0) break
                    require(output.size() + read <= MAX_BYTES) { "PDF vượt giới hạn an toàn" }
                    output.write(buf, 0, read)
                }
            }
            val data = output.toByteArray()
            require(data.size > 5 && data.copyOfRange(0, 5).contentEquals(
                byteArrayOf(37, 80, 68, 70, 45))) { "PDF không hợp lệ" }
            val computed = MessageDigest.getInstance("SHA-256").digest(data)
                .joinToString("") { "%02x".format(it.toInt() and 0xff) }
            require(computed == expectedSha256) {
                "PDF không giống bản lưu trữ, từ chối hiển thị"
            }
            return data
        } finally {
            connection.disconnect()
        }
    }

    /** Only call with bytes already checked by download(). No public storage. */
    fun savePrivate(context: Context, invoiceId: String, bytes: ByteArray): File {
        val safe = UUID.fromString(invoiceId).toString()
        require(invoiceId.equals(safe, true) && bytes.size in 6..MAX_BYTES)
        val folder = File(context.cacheDir, "v2_verified_invoices")
        require(folder.isDirectory || folder.mkdirs()) { "Không lưu được PDF tạm" }
        val file = File(folder, "MinhSatori-$safe.pdf")
        file.outputStream().use { it.write(bytes) }
        require(file.length() == bytes.size.toLong())
        return file
    }
}
