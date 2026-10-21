package vn.minhsatori.app

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.appcompat.app.AlertDialog
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
    /**
     * Open the authoritative invoice PDF right inside the application.
     * Generated pages are rendered from private cache; never write Downloads
     * or invoke third-party PDF viewers on the View action.
     */
    fun preview(activity: androidx.appcompat.app.AppCompatActivity, invoice: SatoriInvoice) {
        Toast.makeText(activity, "Đang mở hóa đơn PDF…", Toast.LENGTH_SHORT).show()
        Thread {
            val result = runCatching {
                val directory = File(activity.cacheDir, "shared_invoices")
                require(directory.isDirectory || directory.mkdirs())
                val name = invoice.number.replace(Regex("[^a-zA-Z0-9_-]"), "").take(24)
                val file = File(directory, "Preview_" + name.ifBlank { "invoice" } + ".pdf")
                WebsiteInvoicePdf.render(activity, invoice, file)
                require(file.length() > 100L) { "Không tạo được PDF." }
                val images = ArrayList<Bitmap>()
                try {
                    ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
                        PdfRenderer(descriptor).use { reader ->
                            require(reader.pageCount in 1..20) { "PDF có số trang không hợp lệ." }
                            val width = (activity.resources.displayMetrics.widthPixels -
                                (32 * activity.resources.displayMetrics.density).toInt()).coerceIn(280, 960)
                            repeat(reader.pageCount) { index ->
                                reader.openPage(index).use { page ->
                                    val scale = width.toFloat() / page.width.toFloat()
                                    val height = (page.height.toFloat() * scale).toInt()
                                    require(height in 1..2700) { "Trang PDF quá lớn." }
                                    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                                    try {
                                        bitmap.eraseColor(Color.WHITE)
                                        page.render(bitmap, null,
                                            Matrix().apply { postScale(scale, scale) },
                                            PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                                        images.add(bitmap)
                                    } catch (error: Exception) {
                                        bitmap.recycle()
                                        throw error
                                    }
                                }
                            }
                        }
                    }
                    images
                } catch (error: Exception) {
                    images.forEach { it.recycle() }
                    throw error
                }
            }
            Handler(Looper.getMainLooper()).post {
                if (activity.isFinishing || activity.isDestroyed) {
                    result.getOrNull()?.forEach { it.recycle() }
                    return@post
                }
                result.onFailure { error ->
                    Toast.makeText(activity, "Không xem được PDF: " +
                        (error.message ?: "Lỗi không xác định"), Toast.LENGTH_LONG).show()
                }.onSuccess { images ->
                    val scroll = ScrollView(activity)
                    val layout = LinearLayout(activity).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(8, 10, 8, 10)
                        setBackgroundColor(Color.rgb(227, 233, 240))
                    }
                    images.forEachIndexed { index, bitmap ->
                        val image = ImageView(activity).apply {
                            setImageBitmap(bitmap)
                            adjustViewBounds = true
                            scaleType = ImageView.ScaleType.FIT_CENTER
                            setBackgroundColor(Color.WHITE)
                            contentDescription = "Hóa đơn trang " + (index + 1)
                        }
                        layout.addView(image, LinearLayout.LayoutParams(-1, -2).apply {
                            bottomMargin = 8
                        })
                    }
                    scroll.addView(layout)
                    AlertDialog.Builder(activity)
                        .setTitle("XEM PDF • HÓA ĐƠN #" + invoice.number)
                        .setView(scroll)
                        .setPositiveButton("Đóng", null)
                        .create().apply {
                            setOnDismissListener { images.forEach { it.recycle() } }
                            show()
                        }
                }
            }
        }.start()
    }

}
