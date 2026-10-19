package vn.minhsatori.app

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File

/** Native PDF shares use the same A4 invoice fields/layout as the website. */
object NativeInvoicePdf {
    fun shareZalo(context: Context, invoice: SatoriInvoice) =
        shareInternal(context, invoice, "com.zing.zalo")

    fun shareMessenger(context: Context, invoice: SatoriInvoice) =
        shareInternal(context, invoice, "com.facebook.orca")

    fun share(context: Context, invoice: SatoriInvoice) =
        shareInternal(context, invoice, null)

    private fun shareInternal(context: Context, invoice: SatoriInvoice, target: String?) {
        Toast.makeText(context, "Đang chuẩn bị PDF theo mẫu website…",
            Toast.LENGTH_SHORT).show()
        // QR retrieval and full A4 PDF composition happen off the UI thread.
        Thread {
            val result = runCatching {
                val folder = File(context.cacheDir, "shared_invoices")
                require(folder.isDirectory || folder.mkdirs()) { "Không tạo được thư mục PDF." }
                val safeNumber = invoice.number
                    .replace(Regex("[^a-zA-Z0-9_-]"), "").take(24)
                val output = File(folder, "MinhSatori_HD_" +
                    safeNumber.ifBlank { "invoice" } + ".pdf")
                WebsiteInvoicePdf.render(context, invoice, output)
                require(output.length() > 100) { "File PDF không hợp lệ." }
                output
            }
            Handler(Looper.getMainLooper()).post {
                if (context is Activity && context.isFinishing) return@post
                result.fold(
                    onSuccess = { file ->
                        runCatching { openShare(context, invoice, file, target) }
                            .onFailure { err ->
                                Toast.makeText(context,
                                    "Không chia sẻ được PDF: " + (err.message ?: "Lỗi"),
                                    Toast.LENGTH_LONG).show()
                            }
                    },
                    onFailure = { err ->
                        Toast.makeText(context,
                            "Không tạo được PDF: " + (err.message ?: "Lỗi"),
                            Toast.LENGTH_LONG).show()
                    }
                )
            }
        }.start()
    }

    private fun openShare(context: Context, invoice: SatoriInvoice, file: File,
                          target: String?) {
        val uri = FileProvider.getUriForFile(
            context, context.packageName + ".fileprovider", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "Hóa đơn Minh Satori #" + invoice.number)
            putExtra(Intent.EXTRA_TEXT, WebsiteInvoicePdf.shareMessage(invoice))
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            clipData = ClipData.newUri(context.contentResolver, "Hóa đơn Minh Satori", uri)
        }
        if (target != null) {
            try {
                context.startActivity(Intent(send).apply { setPackage(target) })
                return
            } catch (_: android.content.ActivityNotFoundException) {
                // Missing target app: Android user chooses a sharing destination.
            }
        }
        context.startActivity(Intent.createChooser(send, "Gửi PDF qua Zalo, Messenger…"))
    }
}
