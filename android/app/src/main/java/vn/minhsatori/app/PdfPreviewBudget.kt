package vn.minhsatori.app

import kotlin.math.ceil
import kotlin.math.sqrt

/** Bounds total PDF preview raster memory and per-page height. */
internal object PdfPreviewBudget {
    const val MAX_TOTAL_BITMAP_BYTES = 24L * 1024L * 1024L
    const val MAX_BITMAP_HEIGHT = 2800

    fun estimatedBytes(pageWidth: Int, pageHeight: Int, width: Int): Long {
        require(pageWidth > 0 && pageHeight > 0 && width > 0)
        val height = ceil(pageHeight.toDouble() * width / pageWidth).toLong()
        return width.toLong() * height * 4L // ARGB_8888
    }

    fun widthForPage(
        pageWidth: Int, pageHeight: Int, remainingPages: Int,
        remainingBytes: Long, preferredWidth: Int
    ): Int {
        require(pageWidth > 0 && pageHeight > 0 && remainingPages > 0)
        require(remainingBytes > 0 && preferredWidth > 0)
        val perPage = remainingBytes / remainingPages
        val heightLimitedWidth = (MAX_BITMAP_HEIGHT.toDouble() * pageWidth / pageHeight).toInt()
        var width = minOf(preferredWidth, heightLimitedWidth,
            sqrt(perPage.toDouble() * pageWidth / (4.0 * pageHeight)).toInt())
        while (width > 0 && (estimatedBytes(pageWidth, pageHeight, width) > perPage ||
                ceil(pageHeight.toDouble() * width / pageWidth) > MAX_BITMAP_HEIGHT)) width--
        require(width >= 128) { "PDF quá dài để xem an toàn trên điện thoại. Hãy dùng Tải PDF." }
        return width
    }
}
