package vn.minhsatori.app

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Direct Drive read-only API. All mutations must go through the owner's
 * Apps Script transaction lock; never PATCH this JSON from Android.
 */
object DriveReadClient {
    const val LIVE_FILE_ID = "14XWSPrxLnKXATwmuHeXGZnCvjDbalghV"
    private const val MAX_BYTES = 12_000_000

    @Throws(IOException::class)
    fun loadWithToken(accessToken: String): SatoriSnapshot {
        require(accessToken.isNotBlank()) { "Chưa cấp quyền Google Drive." }
        val endpoint = URL("https://www.googleapis.com/drive/v3/files/" +
            LIVE_FILE_ID + "?alt=media")
        val connection = (endpoint.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15000
            readTimeout = 20000
            setRequestProperty("Authorization", "Bearer " + accessToken)
            setRequestProperty("Accept", "application/json")
            useCaches = false
            instanceFollowRedirects = false
        }
        try {
            when (connection.responseCode) {
                200 -> Unit
                401 -> throw IOException("Phiên Google đã hết hạn. Hãy kết nối lại.")
                403 -> throw IOException("Tài khoản Google không có quyền đọc dữ liệu Minh Satori.")
                404 -> throw IOException("Không tìm thấy file dữ liệu Minh Satori trong tài khoản này.")
                else -> throw IOException("Không thể đồng bộ Drive (HTTP " +
                    connection.responseCode + ").")
            }
            if (connection.contentLengthLong > MAX_BYTES) {
                throw IOException("File Drive lớn hơn giới hạn tải an toàn.")
            }
            val bytes = connection.inputStream.use { input ->
                val buffer = ByteArray(8192)
                val output = java.io.ByteArrayOutputStream()
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > MAX_BYTES) {
                        throw IOException("Dữ liệu vượt giới hạn an toàn.")
                    }
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            return SatoriData.fromDriveState(String(bytes, Charsets.UTF_8))
        } finally {
            connection.disconnect()
        }
    }
}
