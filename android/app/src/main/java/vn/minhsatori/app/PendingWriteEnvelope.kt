package vn.minhsatori.app

import org.json.JSONObject
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Authenticated encryption: corruption or a different device key must fail closed. */
object PendingWriteEnvelope {
    private val aad = "minhsatori.pending.write.v1".toByteArray(Charsets.UTF_8)

    fun seal(value: PendingMobileWrite, key: SecretKey): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD(aad)
        return JSONObject().put("version", 1)
            .put("iv", Base64.getEncoder().encodeToString(cipher.iv))
            .put("data", Base64.getEncoder().encodeToString(cipher.doFinal(
                value.encode().toByteArray(Charsets.UTF_8))))
            .toString().toByteArray(Charsets.UTF_8)
    }

    fun open(bytes: ByteArray, key: SecretKey): PendingMobileWrite {
        require(bytes.size <= 400_000)
        val encrypted = JSONObject(String(bytes, Charsets.UTF_8))
        require(encrypted.getInt("version") == 1)
        val iv = Base64.getDecoder().decode(encrypted.getString("iv"))
        require(iv.size == 12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        cipher.updateAAD(aad)
        return PendingMobileWrite.decode(String(cipher.doFinal(
            Base64.getDecoder().decode(encrypted.getString("data"))), Charsets.UTF_8))
    }
}
