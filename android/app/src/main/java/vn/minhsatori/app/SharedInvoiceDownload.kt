package vn.minhsatori.app

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import java.io.File

/**
 * Zalo copies a PDF received from a private FileProvider into its own storage
 * and prefixes a random id ("790a233d-…_5986 - Siêu thị - 2026-11-10.pdf").
 * A shared file that lives in the public Downloads collection is the same kind
 * of item Samsung "My Files" shares. So before sharing, the rendered invoice is
 * published once to Download/Minh Satori/ under its exact customer-facing name,
 * and that MediaStore Uri is shared. Re-sharing the same invoice overwrites the
 * same entry (never "name (1).pdf"). No permission is needed (Android 10+);
 * older Android keeps the previous FileProvider share.
 */
object SharedInvoiceDownload {
    const val FOLDER = "Minh Satori"
    private val relativePath = "Download/$FOLDER/"

    /** Returns a MediaStore Uri for [file], or null to fall back to FileProvider. */
    fun publish(context: Context, file: File): Uri? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        return runCatching { publishQ(context, file) }.getOrNull()
    }

    private fun publishQ(context: Context, file: File): Uri {
        val resolver = context.contentResolver
        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        // Only this app's own entries are visible here without storage permission.
        val existing = resolver.query(collection, arrayOf(MediaStore.MediaColumns._ID),
            MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " +
                MediaStore.MediaColumns.RELATIVE_PATH + "=?",
            arrayOf(file.name, relativePath), null)?.use { c ->
            if (c.moveToFirst()) android.content.ContentUris.withAppendedId(collection, c.getLong(0)) else null
        }
        val uri = existing ?: resolver.insert(collection, ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
            put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf")
            put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }) ?: error("MediaStore insert failed")
        try {
            if (existing != null) resolver.update(uri, ContentValues().apply {
                put(MediaStore.MediaColumns.IS_PENDING, 1) }, null, null)
            // "wt" truncates, so a shorter re-render never leaves stale bytes.
            resolver.openOutputStream(uri, "wt").use { out ->
                requireNotNull(out) { "MediaStore stream unavailable" }
                file.inputStream().use { it.copyTo(out) }
            }
            resolver.update(uri, ContentValues().apply {
                put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
            if (existing == null) runCatching { resolver.delete(uri, null, null) }
            throw e
        }
        // MediaStore may still have renamed it on a clash with a foreign file: then
        // the name would not be the customer-facing one, so do not use it.
        val stored = resolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME),
            null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
        check(stored == file.name) { "MediaStore renamed the file" }
        return uri
    }
}
