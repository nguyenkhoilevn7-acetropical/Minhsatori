package vn.minhsatori.app

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID

/**
 * Fully native Android preview of the SAME Gemini sandbox API as website customers.
 * No WebView, no production Drive writes, no real customer identities, no hidden key.
 * The public demo-a fixture is explicitly shown, never presented as live synchronized.
 */
class AiSandboxActivity : AppCompatActivity() {
    private val navy = Color.rgb(10, 24, 44)
    private val white = Color.WHITE
    private val blue = Color.rgb(20, 113, 206)
    private val teal = Color.rgb(8, 139, 130)
    private val muted = Color.rgb(172, 196, 218)
    private lateinit var transcript: LinearLayout
    private lateinit var transcriptScroll: ScrollView
    private lateinit var draft: EditText
    private lateinit var send: Button
    private lateinit var catalogueButton: Button
    private lateinit var invoiceUi: AiSandboxInvoiceUi
    private var catalogue: JSONArray = JSONArray()
    private var basket: List<AiSandboxContract.Line>? = null
    private var quotedId: String? = null
    private var confirmRequestId: String? = null
    private var busy = false
    private var alive = true

    private fun dp(n: Int) = (resources.displayMetrics.density * n + .5f).toInt()
    private fun bg(color: Int, radius: Int = 15) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
    }
    private fun text(value: String, size: Float = 14f, color: Int = white, bold: Boolean = false) =
        TextView(this).apply {
            text = value
            textSize = size
            setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
    private fun button(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        textSize = 13f
        isAllCaps = false
        setTextColor(white)
        background = bg(blue, 12)
        setOnClickListener { action() }
    }
    private fun addBubble(message: String, customer: Boolean = false) {
        if (!alive) return
        val holder = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = if (customer) Gravity.END else Gravity.START
            setPadding(dp(7), dp(7), dp(7), dp(4))
        }
        val bubble = text((if (customer) "BẠN\n" else "SATORI AI • DEMO\n") + message, 15f)
        bubble.background = bg(if (customer) teal else blue)
        holder.addView(bubble, LinearLayout.LayoutParams(-2, -2).apply {
            width = (resources.displayMetrics.widthPixels * .86).toInt()
        })
        transcript.addView(holder)
        transcriptScroll.post { if (alive) transcriptScroll.fullScroll(View.FOCUS_DOWN) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        invoiceUi = AiSandboxInvoiceUi(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(navy)
        }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(12), dp(12), dp(9))
        }
        val logo = ImageView(this).apply {
            setImageResource(R.drawable.satori_invoice_logo)
            scaleType = ImageView.ScaleType.FIT_CENTER
            background = bg(white, 10)
            setPadding(dp(4), dp(4), dp(4), dp(4))
            contentDescription = "Logo chính thức Satori"
        }
        top.addView(logo, LinearLayout.LayoutParams(dp(48), dp(48)))
        val title = text("MINH SATORI AI\nChung API với web • CHỈ THỬ NGHIỆM", 15f, white, true)
        top.addView(title, LinearLayout.LayoutParams(0, -2, 1f))
        top.addView(button("Đóng") { finish() })
        root.addView(top)

        val alert = text("SANDBOX: chỉ tài khoản Demo A. Không có khách thật, không chuyển tiền, không ghi vào hệ thống chính.", 12f, Color.rgb(251, 191, 125))
        root.addView(alert)
        transcriptScroll = ScrollView(this).apply { isFillViewport = true }
        transcript = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(5), dp(5), dp(5), dp(5))
        }
        transcriptScroll.addView(transcript)
        root.addView(transcriptScroll, LinearLayout.LayoutParams(-1, 0, 1f))
        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(8), dp(6), dp(8), dp(4))
        }
        catalogueButton = button("＋ Nhiều sản phẩm") { showCatalogue() }
        toolbar.addView(catalogueButton, LinearLayout.LayoutParams(0, dp(48), 1f))
        val history = button("Lịch sử TEST") { showHistory() }
        toolbar.addView(history, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginStart = dp(7) })
        root.addView(toolbar)
        val entry = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(8), dp(5), dp(8), dp(13))
            gravity = Gravity.BOTTOM
        }
        draft = EditText(this).apply {
            hint = "Nhập đơn hàng hoặc chọn nhiều món…"
            setHintTextColor(muted)
            setTextColor(white)
            textSize = 15f
            minLines = 2
            maxLines = 5
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            background = bg(Color.rgb(25, 48, 71), 13)
            setPadding(dp(10), dp(8), dp(10), dp(8))
        }
        entry.addView(draft, LinearLayout.LayoutParams(0, -2, 1f))
        send = button("Gửi") { submit() }
        entry.addView(send, LinearLayout.LayoutParams(dp(70), dp(50)).apply { marginStart = dp(7) })
        root.addView(entry)
        setContentView(root)
        addBubble("Xin chào! Đây là phiên AI dùng chung server Gemini sandbox của website. Anh có thể chọn nhiều mặt hàng vào cùng một giỏ hoặc nhập câu đặt hàng.")
        loadCatalogue()
    }

    private fun request(path: String, payload: JSONObject? = null): JSONObject {
        if (!AiSandboxContract.validEndpoint(AiSandboxContract.BASE_URL))
            throw IllegalStateException("Địa chỉ AI không hợp lệ.")
        val url = URL(AiSandboxContract.BASE_URL + path)
        val connection = url.openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 9000
            connection.readTimeout = 16000
            connection.requestMethod = if (payload == null) "GET" else "POST"
            connection.setRequestProperty("Accept", "application/json")
            if (payload != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            if (status !in 200..299) {
                val msg = if (status in 300..399) "Máy chủ trả về chuyển hướng không được phép." else "Máy chủ trả về mã $status."
                throw IllegalStateException(msg)
            }
            val stream = connection.inputStream
            val bytes = ByteArrayOutputStream()
            stream.use { input ->
                val chunk = ByteArray(4096)
                while (true) {
                    val n = input.read(chunk)
                    if (n < 0) break
                    if (bytes.size() + n > 750_000) throw IllegalStateException("Phản hồi AI quá lớn.")
                    bytes.write(chunk, 0, n)
                }
            }
            return JSONObject(bytes.toString("UTF-8"))
        } finally {
            connection.disconnect()
        }
    }

    private fun runTask(task: () -> JSONObject, done: (JSONObject) -> Unit) {
        if (busy) return
        busy = true
        send.isEnabled = false
        catalogueButton.isEnabled = false
        Thread {
            val result = runCatching { task() }
            runOnUiThread {
                if (!alive || isFinishing || isDestroyed) return@runOnUiThread
                busy = false
                send.isEnabled = true
                catalogueButton.isEnabled = true
                result.onSuccess(done).onFailure { addBubble("Chưa thể kết nối AI thử: " + (it.message ?: "Lỗi mạng.")) }
            }
        }.start()
    }

    private fun loadCatalogue() {
        runTask({
            val result = request("/api/catalogue?token=" + AiSandboxContract.PUBLIC_FIXTURE)
            if (!result.optBoolean("ok")) throw IllegalStateException("Không lấy được danh mục.")
            result
        }, { catalogue = it.optJSONArray("products") ?: JSONArray() })
    }

    private fun showCatalogue() {
        if (catalogue.length() == 0) {
            addBubble("Danh mục đang tải. Vui lòng thử lại sau.")
            loadCatalogue()
            return
        }
        // All controls are native. The cart is assembled only after the customer confirms.
        val controls = ArrayList<Pair<CheckBox, EditText>>()
        val lines = ArrayList<JSONObject>()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(6), dp(16), dp(8))
        }
        for (i in 0 until catalogue.length()) {
            val item = catalogue.optJSONObject(i) ?: continue
            val check = CheckBox(this).apply {
                text = item.optString("name") + " • " + item.optString("unit")
                textSize = 13f
                setTextColor(Color.rgb(24, 49, 77))
            }
            val quantity = EditText(this).apply {
                setText("1")
                hint = "Số lượng"
                inputType = InputType.TYPE_CLASS_NUMBER
                minHeight = dp(42)
                isEnabled = false
            }
            check.setOnCheckedChangeListener { _, checked ->
                quantity.isEnabled = checked
                if (checked && controls.count { it.first.isChecked } > 6) {
                    check.isChecked = false
                    android.widget.Toast.makeText(this@AiSandboxActivity, "Tối đa 6 loại sản phẩm.", android.widget.Toast.LENGTH_SHORT).show()
                }
            }
            layout.addView(check)
            layout.addView(quantity)
            controls.add(check to quantity)
            lines.add(item)
        }
        val scroll = ScrollView(this).apply { addView(layout) }
        val dialog = AlertDialog.Builder(this)
            .setTitle("Chọn nhiều sản phẩm • Satori")
            .setMessage("Chọn các món cùng số lượng rồi bấm Soạn một đơn.")
            .setView(scroll)
            .setNegativeButton("Hủy", null)
            .setPositiveButton("Soạn một đơn", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                try {
                    val selected = controls.mapIndexedNotNull { i, pair ->
                        if (!pair.first.isChecked) null else {
                            val product = lines[i]
                            val qty = pair.second.text.toString().trim().toIntOrNull()
                                ?: throw IllegalArgumentException("Số lượng phải là số nguyên.")
                            AiSandboxContract.Line(product.getString("code"), product.getString("name"),
                                product.getString("unit"), qty)
                        }
                    }
                    val message = AiSandboxContract.cartMessage(selected)
                    basket = selected
                    draft.setText(message)
                    dialog.dismiss()
                    addBubble("Đã soạn chung " + selected.size + " sản phẩm. Kiểm tra và bấm Gửi để nhận một báo giá.")
                } catch (err: Exception) {
                    android.widget.Toast.makeText(this, err.message ?: "Giỏ chưa hợp lệ.", android.widget.Toast.LENGTH_LONG).show()
                }
            }
        }
        dialog.show()
    }

    private fun submit() {
        // Reject an additional tap while a request is pending. Never drop/clear text
        // for a submission that cannot actually be sent.
        if (busy) return
        val message = draft.text.toString().trim()
        if (message.isBlank()) return
        val attached = basket?.takeIf { runCatching { AiSandboxContract.cartMessage(it) }.getOrNull() == message }
        val body = runCatching { AiSandboxContract.requestMessage(message, attached) }.getOrElse {
            addBubble(it.message ?: "Tin nhắn quá dài.")
            return
        }
        // Clear the old quote before sending. No accidental reuse of an expired quote.
        quotedId = null
        confirmRequestId = null
        // Clear immediately after the valid send tap, not only if a quote is
        // returned. This covers clarification-only conversations as well.
        draft.text.clear()
        basket = null
        addBubble(message, true)
        runTask({ request("/api/message", body) }, { result ->
            val explanation = result.optString("message")
            if (explanation.isNotBlank()) addBubble(explanation)
            val quote = result.optJSONObject("quote")
            if (quote != null) {
                quotedId = quote.optString("quoteId")
                confirmRequestId = "android-ai-" + UUID.randomUUID().toString()
                // Structured native quote; no chat-text invoice and no client-side pricing.
                transcript.addView(invoiceUi.invoiceCard(quote, quote = true) { confirmQuote() },
                    LinearLayout.LayoutParams(-1, -2).apply {
                        setMargins(dp(7), dp(8), dp(7), dp(9))
                    })
                transcriptScroll.post { transcriptScroll.fullScroll(View.FOCUS_DOWN) }
            }
        })
    }

    private fun confirmQuote() {
        val id=quotedId ?: return
        val key=confirmRequestId ?: return
        AlertDialog.Builder(this).setTitle("Xác nhận đơn THỬ?")
            .setMessage("Chỉ tạo TEST invoice trên Render sandbox, KHÔNG ghi vào website hoặc Drive thật.")
            .setNegativeButton("Hủy", null)
            .setPositiveButton("Tạo TEST") { _, _ ->
                val body = JSONObject().put("token", AiSandboxContract.PUBLIC_FIXTURE)
                    .put("quoteId", id).put("requestId", key)
                runTask({ request("/api/confirm", body) }, { result ->
                    val order = result.optJSONObject("order")
                    if (order != null && AiSandboxContract.validTestRef(order.optString("ref"))) {
                        quotedId = null
                        confirmRequestId = null
                        addBubble("Đã tạo hóa đơn TEST; khung bên dưới có Xem, Tải PDF và Chia sẻ.")
                        transcript.addView(invoiceUi.invoiceCard(order),
                            LinearLayout.LayoutParams(-1, -2).apply {
                                setMargins(dp(7), dp(8), dp(7), dp(9))
                            })
                        transcriptScroll.post { transcriptScroll.fullScroll(View.FOCUS_DOWN) }
                    } else {
                        addBubble("Chưa nhận được bản ghi hóa đơn TEST. Mở Lịch sử TEST để kiểm tra.")
                    }
                })
            }.show()
    }

    private fun showHistory() {
        runTask({ request("/api/history?token=" + AiSandboxContract.PUBLIC_FIXTURE) }, { result ->
            val orders = result.optJSONArray("orders") ?: JSONArray()
            val scroll = ScrollView(this)
            val list = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), dp(8), dp(12), dp(10))
            }
            list.addView(text(
                "LỊCH SỬ HÓA ĐƠN TEST • " + orders.length() +
                " đơn. Chỉ Demo A; không phải hóa đơn production.", 13f, navy))
            val limit = minOf(orders.length(), 50)
            for (i in 0 until limit) {
                val order = orders.optJSONObject(i) ?: continue
                if (!AiSandboxContract.validTestRef(order.optString("ref"))) continue
                list.addView(invoiceUi.invoiceCard(order),
                    LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(9) })
            }
            if (orders.length()>limit) list.addView(text(
                "Hiện tối đa 50 đơn TEST gần đây. Mở website để tra cứu đầy đủ.",12f,navy))
            scroll.addView(list)
            AlertDialog.Builder(this)
                .setTitle("Hóa đơn • Minh Satori TEST")
                .setView(scroll)
                .setNeutralButton("Xuất Excel") { _,_ -> exportHistoryExcel() }
                .setPositiveButton("Đóng",null)
                .show()
        })
    }

    /**
     * Strict sandbox file download: no arbitrary URL, no redirects, 5 MB cap,
     * MIME signature validation and private cache location with FileProvider.
     */
    private fun downloadTestFile(relativePath: String, isPdf: Boolean, filename: String): File {
        if (!AiSandboxContract.validEndpoint(AiSandboxContract.BASE_URL))
            throw IllegalStateException("Endpoint AI không được phép.")
        if (!filename.matches(Regex("""[A-Za-z0-9_-]{4,90}\.(pdf|xlsx)""")))
            throw IllegalArgumentException("Tên file không hợp lệ.")
        val con=(URL(AiSandboxContract.BASE_URL+relativePath).openConnection() as HttpURLConnection)
        try {
            con.instanceFollowRedirects=false
            con.connectTimeout=9000
            con.readTimeout=20000
            con.requestMethod="GET"
            con.setRequestProperty("Accept",if(isPdf) "application/pdf" else
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            if(con.responseCode!=200)throw IllegalStateException("Máy chủ trả mã "+con.responseCode)
            val expected=if(isPdf) "application/pdf" else
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            if(!con.contentType.orEmpty().substringBefore(";").equals(expected,ignoreCase=true))
                throw IllegalStateException("Máy chủ không trả đúng định dạng hóa đơn.")
            val out=ByteArrayOutputStream()
            con.inputStream.use { input ->
                val buffer=ByteArray(8192)
                while(true){
                    val n=input.read(buffer)
                    if(n<0)break
                    if(out.size()+n>5_000_000)throw IllegalStateException("File hóa đơn vượt 5 MB.")
                    out.write(buffer,0,n)
                }
            }
            val b=out.toByteArray()
            val prefix=if(isPdf) "%PDF-".toByteArray(Charsets.US_ASCII) else byteArrayOf(0x50,0x4B)
            if(b.size<1024||!b.copyOfRange(0,prefix.size).contentEquals(prefix))
                throw IllegalStateException("File hóa đơn bị lỗi hoặc sai định dạng.")
            val folder=File(cacheDir,"shared_invoices")
            if(!folder.exists()&&!folder.mkdirs())throw IllegalStateException("Không tạo được bộ nhớ tạm.")
            return File(folder,filename).also { file ->
                FileOutputStream(file).use { it.write(b) }
            }
        } finally { con.disconnect() }
    }

    private fun openInvoicePdf(ref: String, share: Boolean) {
        if(!AiSandboxContract.validTestRef(ref)){
            addBubble("Mã hóa đơn TEST không hợp lệ.")
            return
        }
        runFileTask({
            val safeRef=URLEncoder.encode(ref,"UTF-8")
            downloadTestFile("/api/invoice/"+safeRef+"?token="+AiSandboxContract.PUBLIC_FIXTURE,
                true,ref+".pdf")
        }, {file ->
            showDocument(file,"application/pdf",share)
        })
    }

    private fun exportHistoryExcel() {
        runFileTask({
            downloadTestFile("/api/history.xlsx?token="+AiSandboxContract.PUBLIC_FIXTURE,
                false,"Satori_Lich_su_TEST.xlsx")
        }, { file -> showDocument(file,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",true) })
    }

    private fun runFileTask(task: () -> File, done: (File) -> Unit) {
        if(busy){addBubble("Đang xử lý yêu cầu khác. Anh thử lại sau nhé.");return}
        busy=true
        send.isEnabled=false
        catalogueButton.isEnabled=false
        Thread {
            val result=runCatching { task() }
            runOnUiThread {
                if(!alive||isFinishing||isDestroyed)return@runOnUiThread
                busy=false
                send.isEnabled=true
                catalogueButton.isEnabled=true
                result.onSuccess(done).onFailure {
                    addBubble("Chưa tải được file TEST: "+(it.message?:"Lỗi mạng."))
                }
            }
        }.start()
    }

    private fun showDocument(file: File,mime: String,share: Boolean) {
        val uri=FileProvider.getUriForFile(this,packageName+".fileprovider",file)
        val intent=if(share){
            Intent(Intent.ACTION_SEND).apply{
                type=mime
                putExtra(Intent.EXTRA_STREAM,uri)
                clipData=ClipData.newUri(contentResolver,file.name,uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }else{
            Intent(Intent.ACTION_VIEW).apply{
                setDataAndType(uri,mime)
                clipData=ClipData.newUri(contentResolver,file.name,uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }
        try {
            startActivity(if(share)Intent.createChooser(intent,"Chia sẻ hóa đơn Satori TEST") else intent)
        }catch(e:ActivityNotFoundException){
            addBubble("Samsung chưa có ứng dụng mở file này. Hãy dùng Chia sẻ để lưu vào Drive hoặc gửi qua Zalo.")
        }
    }

    override fun onDestroy() {
        alive = false
        super.onDestroy()
    }
}
