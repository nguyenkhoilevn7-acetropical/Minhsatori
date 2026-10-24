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

    /**
     * Cheap foreground change probe: Google Drive file.version changes after a
     * successful website/Bot API write. Never download 118+ invoice rows when
     * the file version is unchanged. Requires the same drive.readonly OAuth
     * permission already granted for the existing full snapshot.
     */
    @Throws(IOException::class)
    fun versionWithToken(accessToken: String): Long {
        require(accessToken.isNotBlank()) { "Chưa cấp quyền Google Drive." }
        val url = URL("https://www.googleapis.com/drive/v3/files/" +
            LIVE_FILE_ID + "?fields=version%2CmodifiedTime")
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 10_000
            readTimeout = 10_000
            setRequestProperty("Authorization", "Bearer " + accessToken)
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Cache-Control", "no-cache, no-store")
            setRequestProperty("Pragma", "no-cache")
            useCaches = false
            instanceFollowRedirects = false
        }
        try {
            when (connection.responseCode) {
                200 -> Unit
                401 -> throw IOException("Phiên Google đã hết hạn. Hãy kết nối lại.")
                403 -> throw IOException("Tài khoản Google không có quyền đọc dữ liệu Minh Satori.")
                404 -> throw IOException("Không tìm thấy dữ liệu Minh Satori.")
                else -> throw IOException("Không đọc được phiên bản Drive (HTTP " +
                    connection.responseCode + ").")
            }
            if (connection.contentLengthLong > 8192)
                throw IOException("Phản hồi phiên bản Drive không hợp lệ.")
            val bytes = connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(1024)
                while (output.size() <= 8192) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    output.write(buffer, 0, n)
                }
                output.toByteArray()
            }
            if (bytes.size > 8192) throw IOException("Phản hồi phiên bản Drive quá lớn.")
            return LiveSyncPolicy.driveVersion(String(bytes, Charsets.UTF_8))
        } finally {
            connection.disconnect()
        }
    }

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
            setRequestProperty("Cache-Control", "no-cache, no-store")
            setRequestProperty("Pragma", "no-cache")
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
