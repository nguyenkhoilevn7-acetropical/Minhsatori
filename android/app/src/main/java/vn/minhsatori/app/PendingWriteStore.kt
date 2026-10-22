package vn.minhsatori.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.io.ByteArrayOutputStream
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** Atomic, encrypted outbox, excluded from Android backup and FileProvider sharing. */
class PendingWriteStore(context: Context,
    journalName: String = "pending-mobile-write.aes",
    private val alias: String = "minhsatori.pending.write.v1") {
    private val base = File(context.noBackupFilesDir, journalName)
    private val file = AtomicFile(base)
    private fun exists() = base.exists() || File(base.path + ".bak").exists() ||
        File(base.path + ".new").exists()

    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        check(create) { "Không mở được khóa bảo vệ thao tác đang chờ; giữ nguyên dữ liệu." }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build())
        return generator.generateKey()
    }

    fun load(): PendingMobileWrite? = synchronized(LOCK) { loadLocked() }

    private fun loadLocked(): PendingMobileWrite? {
        if (!exists()) return null
        val bytes = file.openRead().use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                require(output.size() + count <= 400_000) { "Dữ liệu thao tác chờ vượt giới hạn." }
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        }
        return PendingWriteEnvelope.open(bytes, key(false))
    }

    fun save(pending: PendingMobileWrite): Unit = synchronized(LOCK) {
        val existing = load()
        if (existing != null) {
            check(existing == pending) { "Đang có thao tác chưa xác minh; không ghi đè đơn cũ." }
            return@synchronized
        }
        val encrypted = PendingWriteEnvelope.seal(pending, key(true))
        val output = file.startWrite()
        try {
            output.write(encrypted)
            file.finishWrite(output)
        } catch (error: Exception) {
            file.failWrite(output)
            throw error
        }
        check(load() == pending) { "Chưa xác minh được bản chờ trên thiết bị; chưa gửi yêu cầu." }
    }

    fun clear(pending: PendingMobileWrite): Unit = synchronized(LOCK) {
        val current = load() ?: return@synchronized
        check(current == pending) { "Thao tác đang chờ đã thay đổi; không xóa dữ liệu khác." }
        file.delete()
        check(!exists()) { "Chưa xóa được bản chờ đã xác minh." }
    }

    companion object { private val LOCK = Any() }
}
