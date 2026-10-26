package vn.minhsatori.app

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.content.Intent
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Native owner-only V2 CRM, independent of the customer's public /app-v2 and
 * separate from the production invoice ledger screens in NativeMainActivity.
 *
 * Unauthenticated screens are READINESS ONLY. Every V2 admin request requires
 * a dedicated Google ID token -> server-owned session -> CSRF -> immutable
 * owner-sub authorization; ordinary Drive login never becomes V2 admin.
 */
class V2OwnerAdminActivity : AppCompatActivity() {
    private val api = V2OwnerApi()
    private val blue = Color.rgb(0, 122, 255)
    private val ink = Color.rgb(28, 28, 30)
    private val muted = Color.rgb(110, 110, 115)
    private val canvas = Color.rgb(242, 242, 247)
    private val green = Color.rgb(22, 122, 81)
    private val red = Color.rgb(255, 59, 48)
    private lateinit var content: LinearLayout
    private lateinit var indicator: TextView
    private var readyStatus: JSONObject? = null
    private var owner: JSONObject? = null
    private var page = "home"
    private var accountId: String? = null
    private var profileId: String? = null
    private var profileType: String = "retail"

    // Google Play services 22 removed legacy GoogleSignIn. Credential Manager
    // obtains a fresh Google ID token only after the owner taps Sign in.
    private val loginScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val credentialManager by lazy { CredentialManager.create(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = canvas
        window.navigationBarColor = canvas
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or
            View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        buildLayout()
        renderHome()
        refreshReadiness()
    }

    private fun dp(value: Int) = (resources.displayMetrics.density * value + 0.5f).toInt()
    private fun bg(color: Int, radius: Int = 17): GradientDrawable =
        GradientDrawable().apply { setColor(color); cornerRadius = dp(radius).toFloat() }

    private fun text(label: String, size: Float = 14f, bold: Boolean = false,
                     color: Int = ink): TextView = TextView(this).apply {
        this.text = label
        textSize = size
        setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(3), 0, dp(3))
    }

    private fun panel(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(15), dp(13), dp(15), dp(15))
        background = bg(Color.WHITE)
    }

    private fun LinearLayout.block(title: String, details: String? = null,
                                   click: (() -> Unit)? = null) {
        val wrapper = panel()
        wrapper.addView(text(title, 15f, true))
        if (details != null) wrapper.addView(text(details, 12f, false, muted))
        if (click != null) {
            wrapper.isClickable = true
            wrapper.isFocusable = true
            wrapper.setOnClickListener { click() }
            wrapper.contentDescription = title
        }
        addView(wrapper, LinearLayout.LayoutParams(-1, -2).apply {
            bottomMargin = dp(9)
        })
    }

    private fun LinearLayout.action(label: String, destructive: Boolean = false,
                                    click: () -> Unit) {
        val item = text(label, 14f, true, if (destructive) red else blue).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(10))
            background = bg(if (destructive) Color.rgb(255, 239, 238)
                else Color.rgb(234, 243, 255), 12)
            isClickable = true
            isFocusable = true
            setOnClickListener { click() }
        }
        addView(item, LinearLayout.LayoutParams(-1, dp(44)).apply {
            topMargin = dp(6)
        })
    }

    private fun buildLayout() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(canvas)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(10))
            setBackgroundColor(Color.rgb(250, 252, 255))
        }
        val back = text("‹", 30f, false, blue).apply {
            setPadding(dp(5), 0, dp(16), 0)
            setOnClickListener { if (page == "home") finish() else navigate("home") }
            contentDescription = "Quay lại"
        }
        header.addView(back)
        val caption = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        caption.addView(text("MINH SATORI", 17f, true))
        caption.addView(text("QUẢN TRỊ HỆ THỐNG V2", 11f, true, blue))
        header.addView(caption, LinearLayout.LayoutParams(0, -2, 1f))
        val refresh = text("↻", 26f, true, blue).apply {
            setPadding(dp(12), 0, dp(4), 0)
            contentDescription = "Làm mới dữ liệu quản trị V2"
            setOnClickListener { refreshPage() }
        }
        header.addView(refresh)
        root.addView(header)
        indicator = text("Đang kiểm tra Backend V2…", 12f, false, muted).apply {
            setPadding(dp(16), dp(6), dp(16), dp(9))
        }
        root.addView(indicator)
        val scroll = ScrollView(this).apply { isFillViewport = true }
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(26))
        }
        scroll.addView(content)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
    }

    private fun reset(title: String) {
        content.removeAllViews()
        content.addView(text(title, 22f, true), LinearLayout.LayoutParams(-1, -2).apply {
            bottomMargin = dp(12)
        })
        indicator.text = when {
            owner != null && api.authenticated -> "● Chủ V2 đã xác minh · phiên đăng nhập riêng"
            readyStatus?.optBoolean("enabled") == true -> "● Backend V2 sẵn sàng · cần đăng nhập chủ"
            else -> "● Backend V2 chưa mở tài khoản chủ"
        }
        indicator.setTextColor(if (owner != null && api.authenticated) green else muted)
    }

    private fun alert(message: String) {
        AlertDialog.Builder(this).setMessage(message).setPositiveButton("Đóng", null).show()
    }

    private fun work(call: () -> JSONObject, done: (JSONObject) -> Unit) {
        indicator.text = "Đang kết nối Backend V2…"
        Thread {
            val result = runCatching { call() }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                result.fold(onSuccess = done, onFailure = { error ->
                    if (!api.authenticated) owner = null
                    indicator.text = "Kết nối V2 chưa hoàn tất"
                    alert(error.message ?: "Không thể kết nối máy chủ V2")
                })
            }
        }.start()
    }

    private fun refreshReadiness() {
        work({ api.status() }) { status ->
            readyStatus = status
            renderHome()
        }
    }

    private fun signInOwner() {
        val status = readyStatus
        if (status?.optBoolean("enabled") != true) {
            alert("OAuth chủ V2 chưa được kích hoạt trên Render. " +
                "Ứng dụng không thể tự cấp quyền từ Google Drive hay tài khoản khách.")
            return
        }
        val clientId = status.optString("googleClientId")
        if (!clientId.endsWith(".apps.googleusercontent.com")) {
            alert("Máy chủ chưa công bố Web OAuth Client ID hợp lệ.")
            return
        }
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(clientId).build())
            .build()
        loginScope.launch {
            try {
                val response = credentialManager.getCredential(
                    context = this@V2OwnerAdminActivity, request = request)
                val credential = response.credential
                if (credential !is CustomCredential ||
                    credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL)
                    throw SecurityException("Không nhận được thông tin Google hợp lệ")
                val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
                work({ api.ownerLogin(idToken) }) { verified ->
                    owner = verified
                    page = "home"
                    renderHome()
                }
            } catch (_: Exception) {
                alert("Không xác minh được Google ID token. Kiểm tra Web OAuth V2.")
            }
        }
    }

    private fun ensureOwner(): Boolean {
        if (owner == null || !api.authenticated) {
            alert("Chỉ tài khoản Admin V2 được Google xác minh mới được thực hiện tác vụ này.")
            return false
        }
        return true
    }

    private fun navigate(target: String) {
        page = target
        refreshPage()
    }

    private fun refreshPage() {
        if (page == "home") { renderHome(); refreshReadiness(); return }
        if (!ensureOwner()) { page = "home"; renderHome(); return }
        when (page) {
            "customers" -> fetchCustomers()
            "profiles" -> fetchProfiles()
            "addresses" -> fetchAddresses()
            "policies" -> fetchPolicies()
            "ctv-summary" -> fetchCtvSummary()
            "catalogue" -> fetchCatalogue()
            "orders" -> fetchMyOrders()
            else -> renderHome()
        }
    }

    private fun renderHome() {
        reset("Tổng quan quản trị")
        content.block("🛡️ Quản trị tách biệt",
            "Dữ liệu đăng ký, đại lý, CTV và chính sách V2 chỉ nằm trên Backend V2. " +
                "Sổ hóa đơn cũ vẫn quản lý trong ứng dụng Minh Satori hiện tại.")
        val status = readyStatus
        content.block("TRẠNG THÁI BACKEND",
            if (status == null) "Đang kiểm tra…" else
                "V2: " + (if (status.optBoolean("enabled")) "SẴN SÀNG" else "CHƯA KÍCH HOẠT") +
                " · Gemini: " + (if (status.optBoolean("geminiConfigured")) "đã cấu hình" else "chưa cấu hình") +
                " · Đơn thật: vẫn khóa theo xác nhận của server")
        if (owner == null || !api.authenticated) {
            content.action("🔐  Đăng nhập Admin bằng Google") { signInOwner() }
            content.block("Chưa cấp quyền ghi",
                "Muốn chỉnh hồ sơ và chiết khấu phải xác minh Google ID token của chủ trên V2. " +
                "Đăng nhập Drive cũ không được tự động nâng quyền.")
        } else {
            content.block("👤 " + owner!!.optString("name", "Chủ hệ thống"),
                owner!!.optString("email"))
            content.action("♙  Khách hàng & đăng ký") { navigate("customers") }
            content.action("🏢  Đại lý / CTV / hồ sơ") {
                accountId = owner!!.optString("id")
                navigate("profiles")
            }
            content.action("📍  Địa chỉ giao hàng") {
                if (profileId == null) alert("Chọn hồ sơ từ mục Đại lý / CTV trước")
                else navigate("addresses")
            }
            content.action("％  Chiết khấu & chính sách CTV") {
                if (profileId == null) alert("Chọn hồ sơ từ mục Đại lý / CTV trước")
                else navigate("policies")
            }
            content.action("▦  Bảng giá / danh mục sản phẩm") { navigate("catalogue") }
            content.action("▤  Yêu cầu đặt hàng V2 của chủ") { navigate("orders") }
            content.action("🔒  Đăng xuất phiên quản trị") {
                api.clear(); owner = null; accountId = null; profileId = null
                renderHome()
            }
        }
        content.block("Hóa đơn thật • công nợ • PDF",
            "Dùng các mục Hóa đơn, Công nợ, Lên đơn sẵn có ở màn hình chính của App. " +
                "Không sao chép hoặc tự tạo lại hóa đơn từ dữ liệu V2.")
    }

    private data class Field(val key: String, val label: String, val initial: String = "")
    private fun form(title: String, fields: List<Field>, destructive: Boolean = false,
                     submit: (Map<String, String>) -> Unit) {
        if (!ensureOwner()) return
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(19), dp(10), dp(19), dp(8))
        }
        val inputs = mutableMapOf<String, EditText>()
        val toggles = mutableMapOf<String, android.widget.Switch>()
        for (field in fields) {
            if (field.key == "ctvMode") {
                val toggle = android.widget.Switch(this).apply {
                    text = "Tự động tính lợi nhuận CTV"
                    isChecked = field.initial == "ON"
                }
                toggles[field.key] = toggle
                container.addView(toggle)
                continue
            }
            container.addView(text(field.label, 12f, true, muted))
            val edit = EditText(this).apply {
                setText(field.initial)
                textSize = 14f
                setSingleLine(field.key != "address" && field.key != "note")
                if (field.key.contains("phone", ignoreCase = true) || field.key == "discount" ||
                    field.key == "ctvDiscount")
                    inputType = android.text.InputType.TYPE_CLASS_PHONE
            }
            inputs[field.key] = edit
            container.addView(edit)
        }
        val scroll = ScrollView(this).apply { addView(container) }
        AlertDialog.Builder(this).setTitle(title).setView(scroll)
            .setNegativeButton("Hủy", null)
            .setPositiveButton(if (destructive) "Xác nhận thay đổi" else "Lưu", null)
            .create().apply {
                setOnShowListener {
                    getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        val values = inputs.mapValues { it.value.text.toString().trim() }.toMutableMap()
                        toggles.forEach { (key, toggle) ->
                            values[key] = if (toggle.isChecked) "ON" else "OFF"
                        }
                        submit(values)
                        dismiss()
                    }
                }
                show()
            }
    }

    private fun confirm(title: String, message: String, done: () -> Unit) {
        AlertDialog.Builder(this).setTitle(title).setMessage(message)
            .setNegativeButton("Hủy", null).setPositiveButton("Xác nhận") { _, _ -> done() }.show()
    }

    private fun discountBps(raw: String): Int {
        val value = BigDecimal(raw.trim()).multiply(BigDecimal(100))
            .setScale(0, RoundingMode.UNNECESSARY).intValueExact()
        require(value in 0..10000) { "Chiết khấu phải từ 0% đến 100%" }
        return value
    }

    private fun save(method: String, route: String, payload: JSONObject, after: () -> Unit) {
        if (!ensureOwner()) return
        work({ api.request(method, route, payload) }) {
            Toast.makeText(this, "Đã lưu trên Backend V2", Toast.LENGTH_SHORT).show()
            after()
        }
    }

    private fun records(arr: JSONArray, render: (JSONObject) -> Unit) {
        if (arr.length() == 0) content.block("Chưa có dữ liệu", "Không tự tạo thông tin giả.")
        for (i in 0 until arr.length()) render(arr.getJSONObject(i))
    }

    private fun fetchCustomers() {
        reset("Khách hàng V2")
        content.block("Tài khoản đã đăng ký & khách do Admin nhập",
            "Hiển thị tên, địa chỉ, điện thoại và chiết khấu; không bao giờ xem hoặc lưu mật khẩu.")
        content.action("＋ Thêm khách hàng mới") { createLead() }
        work({ api.request("GET", "/api/v2/admin/customers") }) { result ->
            reset("Khách hàng V2")
            content.action("＋ Thêm khách hàng mới") { createLead() }
            content.addView(text("TÀI KHOẢN GOOGLE · " +
                result.optJSONArray("registered")?.length().toString(), 13f, true, blue))
            records(result.optJSONArray("registered") ?: JSONArray()) { item ->
                val name = item.optString("fullName").ifBlank { item.optString("name") }
                val account = item.optString("id")
                val ctvTag = if (item.optBoolean("hasCtvProfile", false))
                    if (item.optBoolean("ctvEnabled", false)) " · CTV đang bật"
                    else " · CTV đã tắt"
                    else ""
                content.block(name + " · " + item.optString("accessStatus") + ctvTag,
                    item.optString("phone") + "\n" + item.optString("address") +
                    "\n" + item.optString("email") + " · CK " +
                    (item.optInt("discountBps") / 100.0).toString() + "%") {
                    accountId = account
                    showRegisteredActions(item)
                }
            }
            content.addView(text("KHÁCH ADMIN THÊM · " +
                result.optJSONArray("leads")?.length().toString(), 13f, true, blue))
            records(result.optJSONArray("leads") ?: JSONArray()) { item ->
                content.block(item.optString("fullName") +
                        if (!item.optBoolean("active", true)) " · Đã lưu trữ" else "",
                    item.optString("phone") + "\n" + item.optString("address") +
                        "\nCK " + item.optInt("discountBps") / 100.0 + "%") {
                    showLeadActions(item)
                }
            }
        }
    }

    private fun leadData(values: Map<String, String>): JSONObject = JSONObject()
        .put("fullName", values.getValue("fullName"))
        .put("phone", values.getValue("phone"))
        .put("address", values.getValue("address"))
        .put("email", values["email"].orEmpty())
        .put("requestedType", values["requestedType"].orEmpty().ifBlank { "retail" })
        .put("companyName", values["companyName"].orEmpty())
        .put("note", values["note"].orEmpty())
        .put("discountBps", discountBps(values["discount"].orEmpty().ifBlank { "0" }))
        .put("confirmed", true)

    private fun createLead() {
        form("Thêm khách hàng V2", listOf(
            Field("fullName","Tên khách / đại lý"),
            Field("phone","Số điện thoại"),
            Field("address","Địa chỉ giao đầy đủ"),
            Field("email","Email (nếu có)"),
            Field("requestedType","Loại: retail / agency / collaborator","retail"),
            Field("discount","Chiết khấu %","0"),
            Field("companyName","Tên cửa hàng (nếu có)"),
            Field("note","Ghi chú")
        )) { input ->
            try {
                val payload = leadData(input)
                confirm("Thêm khách V2", "Tạo hồ sơ trên Backend V2 (không tự cấp Google login)?") {
                    save("POST","/api/v2/admin/customers",payload) { fetchCustomers() }
                }
            } catch (e: Exception) { alert(e.message ?: "Thông tin không hợp lệ") }
        }
    }

    private fun showLeadActions(item: JSONObject) {
        val active = item.optBoolean("active",true)
        val fields = listOf(
            Field("fullName","Tên",item.optString("fullName")),
            Field("phone","Điện thoại",item.optString("phone")),
            Field("address","Địa chỉ",item.optString("address")),
            Field("email","Email",item.optString("email")),
            Field("requestedType","Loại",item.optString("requestedType","retail")),
            Field("discount","Chiết khấu %",(item.optInt("discountBps")/100.0).toString()),
            Field("companyName","Công ty",item.optString("companyName")),
            Field("note","Ghi chú",item.optString("note"))
        )
        val choices = if(active) arrayOf("Sửa hồ sơ", "Lưu trữ hồ sơ") else arrayOf("Đã lưu trữ")
        AlertDialog.Builder(this).setTitle(item.optString("fullName"))
            .setItems(choices) { _, choice ->
                if (!active) return@setItems
                if (choice == 0) form("Sửa hồ sơ khách hàng",fields) { values ->
                    try {
                        val data=leadData(values).put("leadId",item.optString("id"))
                            .put("expectedRevision",item.optInt("revision")).put("active",true)
                        confirm("Lưu thay đổi","Xác nhận ghi lên hồ sơ V2?") {
                            save("PATCH","/api/v2/admin/customer-leads",data) { fetchCustomers() }
                        }
                    } catch (e: Exception) { alert(e.message ?: "Lỗi dữ liệu") }
                }
                else confirm("Lưu trữ hồ sơ",
                    "Hồ sơ sẽ ngừng hoạt động; không xóa hóa đơn cũ hoặc tự thu hồi Google login.") {
                    val data=JSONObject().put("leadId",item.optString("id"))
                        .put("expectedRevision",item.optInt("revision"))
                        .put("active",false).put("confirmed",true)
                    save("PATCH","/api/v2/admin/customer-leads",data) { fetchCustomers() }
                }
            }.show()
    }

    private fun showRegisteredActions(item: JSONObject) {
        val active = item.optString("accessStatus")
        val ctvEnabled = item.optBoolean("ctvEnabled", false)
        val options = mutableListOf("Duyệt tài khoản / cấp chiết khấu", "Tạm khóa tài khoản",
            "Sửa thông tin đã đăng ký", "Quản lý hồ sơ / điểm giao", "Thu hồi quyền V2").apply {
            if (active == "ACTIVE" && item.optBoolean("hasCtvProfile", false)) {
                add(if (ctvEnabled) "Tắt chế độ CTV" else "Bật chế độ CTV")
            }
        }.toTypedArray()
        AlertDialog.Builder(this).setTitle(item.optString("fullName", item.optString("name")))
            .setItems(options) { _, index ->
                when(index) {
                    0 -> form("Duyệt và cấp chiết khấu",listOf(
                        Field("discount","Chiết khấu %",(item.optInt("discountBps")/100.0).toString())
                    )) { fields ->
                        try {
                            val data=JSONObject().put("accountId",item.getString("id"))
                                .put("expectedRevision",item.getInt("revision"))
                                .put("status","ACTIVE")
                                .put("discountBps",discountBps(fields.getValue("discount")))
                                .put("confirmed",true)
                            confirm("Duyệt tài khoản", "Kích hoạt khách và áp dụng chiết khấu V2?") {
                                save("PATCH","/api/v2/admin/customers",data){ fetchCustomers() }
                            }
                        } catch (e: Exception) { alert(e.message ?: "Giá trị không hợp lệ") }
                    }
                    1, 4 -> confirm(if(index==1) "Tạm khóa" else "Thu hồi quyền",
                        "Thao tác sẽ thu hồi phiên V2. Hóa đơn kế toán cũ không bị xóa.") {
                        val data=JSONObject().put("accountId",item.getString("id"))
                            .put("expectedRevision",item.getInt("revision"))
                            .put("status",if(index==1) "SUSPENDED" else "REMOVED")
                            .put("confirmed",true)
                        save("PATCH","/api/v2/admin/customers",data){ fetchCustomers() }
                    }
                    2 -> editRegistered(item)
                    3 -> { accountId=item.optString("id"); navigate("profiles") }
                    5 -> {
                        val nextEnabled = !ctvEnabled
                        val data = JSONObject().put("accountId",item.getString("id"))
                            .put("expectedRevision",item.getInt("revision"))
                            .put("enabled",nextEnabled).put("confirmed",true)
                        confirm(if (nextEnabled) "Bật CTV" else "Tắt CTV",
                            "Chỉ áp dụng cho báo giá và hoa hồng mới. " +
                                "Không thay đổi hoa hồng, hóa đơn đã phát hành.") {
                            save("PATCH","/api/v2/admin/ctv-mode",data) { fetchCustomers() }
                        }
                    }
                }
            }.show()
    }

    private fun editRegistered(item: JSONObject) {
        form("Sửa hồ sơ đã đăng ký",listOf(
            Field("fullName","Tên",item.optString("fullName")),
            Field("phone","Điện thoại",item.optString("phone")),
            Field("address","Địa chỉ",item.optString("address")),
            Field("email","Email Google đã xác minh (không sửa)",item.optString("email")),
            Field("requestedType","Loại đăng ký",item.optString("requestedType","retail")),
            Field("companyName","Công ty",item.optString("companyName")),
            Field("note","Ghi chú",item.optString("note"))
        )) { values ->
            val data=JSONObject().put("accountId",item.optString("id"))
                .put("expectedRevision",item.optInt("registrationRevision"))
                .put("fullName",values.getValue("fullName"))
                .put("phone",values.getValue("phone"))
                .put("address",values.getValue("address"))
                .put("email",item.optString("email"))
                .put("requestedType",values.getValue("requestedType"))
                .put("companyName",values["companyName"])
                .put("note",values["note"])
                .put("confirmed",true)
            confirm("Xác nhận chỉnh sửa", "Không tự sửa địa chỉ của các đơn đã phát hành.") {
                save("PATCH","/api/v2/admin/customers/details",data) { fetchCustomers() }
            }
        }
    }

    private fun fetchProfiles() {
        val id = accountId
        if (id.isNullOrBlank()) { navigate("customers"); return }
        reset("Hồ sơ đại lý / CTV")
        content.action("＋ Thêm hồ sơ") { createProfile(id) }
        work({ api.request("GET","/api/v2/admin/profiles?accountId=$id") }) { result ->
            reset("Hồ sơ đại lý / CTV")
            content.action("＋ Thêm hồ sơ") { createProfile(id) }
            records(result.optJSONArray("profiles") ?: JSONArray()) { profile ->
                content.block(profile.optString("name") + " · " + profile.optString("type"),
                    profile.optString("phone") + " · Revision " +
                        profile.optInt("revision")) {
                    profileId = profile.optString("id")
                    profileType = profile.optString("type")
                    AlertDialog.Builder(this).setTitle(profile.optString("name"))
                        .setItems(if (profileType == "collaborator")
                            arrayOf("Sửa tên / điện thoại","Điểm giao hàng",
                                "Chiết khấu / chính sách","📈 Lợi nhuận CTV")
                            else arrayOf("Sửa tên / điện thoại","Điểm giao hàng",
                                "Chiết khấu / chính sách")) { _, index ->
                            when(index) {
                                0 -> editProfile(profile)
                                1 -> navigate("addresses")
                                2 -> navigate("policies")
                                3 -> navigate("ctv-summary")
                            }
                        }.show()
                }
            }
        }
    }

    private fun createProfile(account: String) {
        form("Thêm hồ sơ",listOf(Field("name","Tên hồ sơ"),
            Field("phone","Điện thoại"),Field("type","retail / agency / collaborator","agency"))) { input ->
            val data=JSONObject().put("accountId",account).put("name",input["name"])
                .put("phone",input["phone"]).put("type",input["type"])
            confirm("Tạo hồ sơ","Tạo hồ sơ mới thuộc đúng tài khoản V2 này?") {
                save("POST","/api/v2/admin/profiles",data){fetchProfiles()}
            }
        }
    }

    private fun editProfile(profile: JSONObject) {
        form("Sửa hồ sơ",listOf(Field("name","Tên",profile.optString("name")),
            Field("phone","Điện thoại",profile.optString("phone")))) { input ->
            val data=JSONObject().put("profileId",profile.optString("id"))
                .put("expectedRevision",profile.optInt("revision"))
                .put("name",input["name"]).put("phone",input["phone"])
            confirm("Xác nhận","Cập nhật hồ sơ; không thay đổi lịch sử hóa đơn?") {
                save("PATCH","/api/v2/admin/profiles",data){fetchProfiles()}
            }
        }
    }

    private fun fetchAddresses() {
        val id=profileId
        if(id.isNullOrBlank()){navigate("home");return}
        reset("Địa chỉ giao hàng")
        content.action("＋ Thêm địa chỉ") { createAddress(id) }
        work({ api.request("GET","/api/v2/admin/addresses?profileId=$id") }) { result ->
            reset("Địa chỉ giao hàng")
            content.action("＋ Thêm địa chỉ") { createAddress(id) }
            records(result.optJSONArray("addresses") ?: JSONArray()) { addr ->
                content.block("📍 " + addr.optString("label") +
                        if(addr.optBoolean("active",true)) "" else " · Đã tạm ngưng",
                    addr.optString("recipientName") + " · " +
                        addr.optString("recipientPhone") + "\n" + addr.optString("address")) {
                    editAddress(id,addr)
                }
            }
        }
    }

    private fun addressFields(a: JSONObject? = null): List<Field> = listOf(
        Field("label","Tên điểm giao",a?.optString("label").orEmpty()),
        Field("recipientName","Người nhận",a?.optString("recipientName").orEmpty()),
        Field("recipientPhone","Điện thoại",a?.optString("recipientPhone").orEmpty()),
        Field("address","Địa chỉ đầy đủ",a?.optString("address").orEmpty())
    )
    private fun addressPayload(values: Map<String,String>): JSONObject = JSONObject()
        .put("label",values["label"]).put("recipientName",values["recipientName"])
        .put("recipientPhone",values["recipientPhone"]).put("address",values["address"])

    private fun createAddress(profile: String) {
        form("Thêm địa chỉ V2",addressFields()) { v ->
            val data=addressPayload(v).put("profileId",profile)
            confirm("Thêm điểm giao","Điểm giao mới sẽ thuộc hồ sơ đang chọn?") {
                save("POST","/api/v2/admin/addresses",data){fetchAddresses()}
            }
        }
    }

    private fun editAddress(profile: String, addr: JSONObject) {
        form("Sửa địa chỉ",addressFields(addr)+
            Field("active","Trạng thái: true / false",addr.optBoolean("active",true).toString())) { v ->
            val active = when(v["active"]){ "true" -> true; "false" -> false
                else -> { alert("Chỉ nhập true hoặc false"); return@form } }
            val data=addressPayload(v).put("profileId",profile)
                .put("addressId",addr.optString("id"))
                .put("expectedRevision",addr.optInt("revision"))
                .put("active",active)
            confirm("Xác nhận điểm giao",
                "Thay đổi chỉ ảnh hưởng báo giá mới; không sửa lịch sử hóa đơn.") {
                save("PATCH","/api/v2/admin/addresses",data){fetchAddresses()}
            }
        }
    }

    private fun fetchPolicies() {
        val id=profileId
        if(id.isNullOrBlank()){navigate("home");return}
        reset("Chiết khấu / chính sách")
        content.block("Phân quyền theo hồ sơ, địa chỉ hoặc sản phẩm",
            "CTV: BẬT hoặc TẮT tự tính lợi nhuận. Một đơn chỉ có một hóa đơn. " +
                "Chính sách mới phải được Admin xác nhận.")
        content.action("＋ Tạo chính sách") { createPolicy(id) }
        work({ api.request("GET","/api/v2/admin/policies?profileId=$id") }) { result ->
            reset("Chiết khấu / chính sách")
            content.action("＋ Tạo chính sách") { createPolicy(id) }
            records(result.optJSONArray("policies") ?: JSONArray()) { p ->
                content.block("CK " + p.optInt("discountBps")/100.0 + "%" +
                        (if(!p.isNull("collaboratorBps")) " · CTV BẬT" else " · CTV TẮT") +
                        if(p.optBoolean("enabled")) "" else " · Ngừng",
                    "Địa chỉ: " + p.optString("addressId","Toàn bộ") +
                        "\nSKU: " + p.optString("productCode","Toàn bộ") +
                        " · V" + p.optInt("version") +
                        (if(!p.isNull("collaboratorBps"))
                            "\nCK CTV " + p.optInt("collaboratorBps")/100.0 +
                            "% · chênh lệch " +
                            (p.optInt("collaboratorBps")-p.optInt("discountBps"))/100.0 +
                            "% trên giá gốc (trước VAT/phí giao)" else "")) {
                    if (p.optBoolean("enabled")) confirm("Ngưng chính sách",
                        "Chỉ vô hiệu hóa chính sách này, không sửa hóa đơn và đơn giá đã chốt.") {
                        val payload=JSONObject().put("profileId",id)
                            .put("policyId",p.optString("id"))
                            .put("expectedRevision",p.optInt("revision"))
                            .put("enabled",false).put("confirmed",true)
                        save("PATCH","/api/v2/admin/policies",payload){fetchPolicies()}
                    }
                }
            }
        }
    }

    private fun createPolicy(profile: String) {
        val fields = mutableListOf(Field("discount","Chiết khấu khách %","20"))
        if (profileType == "collaborator") {
            fields += Field("ctvMode","Tự tính lợi nhuận CTV: ON / OFF","OFF")
            fields += Field("ctvDiscount","Chiết khấu CTV % khi ON","35")
        }
        fields += Field("addressId","ID điểm giao (trống = toàn bộ)")
        fields += Field("productCode","Mã sản phẩm (trống = toàn bộ)")
        form("Chính sách CTV · 1 hóa đơn",fields) { input ->
            try {
                val customer = discountBps(input["discount"].orEmpty())
                val enabled = profileType == "collaborator" &&
                    input["ctvMode"].orEmpty().trim().uppercase() == "ON"
                require(profileType != "collaborator" ||
                    input["ctvMode"].orEmpty().trim().uppercase() in setOf("ON","OFF")) {
                    "CTV chỉ nhận ON hoặc OFF"
                }
                val data=JSONObject().put("profileId",profile)
                    .put("discountBps",customer)
                    .put("invoiceMode","single")
                    .put("confirmed",true)
                if (enabled) {
                    val ctv = discountBps(input["ctvDiscount"].orEmpty())
                    require(ctv > customer) {
                        "Chiết khấu CTV phải lớn hơn chiết khấu khách để có lợi nhuận"
                    }
                    data.put("collaboratorBps",ctv)
                }
                input["addressId"]?.takeIf(String::isNotBlank)?.let { data.put("addressId",it) }
                input["productCode"]?.takeIf(String::isNotBlank)?.let { data.put("productCode",it) }
                val detail = if (enabled)
                    "CTV BẬT. Một hóa đơn khách; tự tính chênh lệch " +
                    ((data.optInt("collaboratorBps")-customer)/100.0) +
                    "% trên giá gốc (chưa VAT/phí giao)."
                else "CTV TẮT. Một hóa đơn khách; không ghi nhận lợi nhuận CTV."
                confirm("Xác nhận chính sách giá",detail +
                    "\nChính sách và hóa đơn cũ không thay đổi.") {
                    save("POST","/api/v2/admin/policies",data){fetchPolicies()}
                }
            } catch (e: Exception) { alert(e.message ?: "Chiết khấu không hợp lệ") }
        }
    }

    private fun fetchCtvSummary() {
        val id = profileId
        if (id.isNullOrBlank() || profileType != "collaborator") {
            alert("Hãy chọn một hồ sơ CTV"); return
        }
        reset("📈 Lợi nhuận CTV")
        content.block("Một hóa đơn · một lần ghi doanh số",
            "Chênh lệch tiền hàng giữa chiết khấu khách và mức CTV. " +
            "Chưa trừ chi phí vận hành; không tính VAT/phí giao.")
        work({ api.request("GET","/api/v2/admin/ctv-summary?profileId=$id") }) { result ->
            reset("📈 Lợi nhuận CTV")
            val money: (Long) -> String = { n ->
                java.text.NumberFormat.getIntegerInstance(
                    java.util.Locale("vi","VN")).format(n) + " đ"
            }
            content.block(result.optString("name","CTV"),"Mã hồ sơ: " + id)
            content.block("✅ HÓA ĐƠN THẬT · CHỈ KHI ĐÃ PHÁT HÀNH",
                "Số hóa đơn: " + result.optInt("completedInvoices") +
                "\nDoanh số tiền hàng: " + money(result.optLong("salesVnd")) +
                "\nLợi nhuận CTV: " + money(result.optLong("profitVnd")))
            content.block("🧪 ĐƠN THỬ · KHÔNG GHI DOANH SỐ",
                "Số đơn thử: " + result.optInt("testOrders") +
                "\nTiền hàng thử: " + money(result.optLong("testSalesVnd")) +
                "\nLợi nhuận mô phỏng: " + money(result.optLong("testProfitVnd")))
            if (result.optBoolean("truncated"))
                content.block("⚠️ Giới hạn báo cáo",
                    "Bản tổng hợp vượt 1.000 đơn, cần phân trang để đối soát đủ.")
            content.action("％ Chỉnh chính sách CTV") { navigate("policies") }
            content.action("↻ Tải lại") { fetchCtvSummary() }
        }
    }

    private fun fetchCatalogue() {
        reset("Danh mục V2")
        content.action("↻ Đồng bộ từ bảng giá Minh Satori") {
            confirm("Đồng bộ bảng giá",
                "Chỉ lấy bảng giá từ nguồn đã xác minh. Không nhập dữ liệu mẫu.") {
                save("POST","/api/v2/admin/catalogue/refresh",
                    JSONObject().put("confirmed",true)) { fetchCatalogue() }
            }
        }
        work({ api.request("GET","/api/v2/catalogue") }) { result ->
            reset("Danh mục V2")
            content.action("↻ Đồng bộ từ bảng giá Minh Satori") {
                confirm("Đồng bộ bảng giá",
                    "Yêu cầu bảng giá chính thức có chữ ký API, không tạo giá mới tùy ý.") {
                    save("POST","/api/v2/admin/catalogue/refresh",
                        JSONObject().put("confirmed",true)) { fetchCatalogue() }
                }
            }
            val arr=result.optJSONArray("items") ?: JSONArray()
            content.block("Danh mục đang hoạt động",arr.length().toString()+" sản phẩm")
            records(arr) { p ->
                content.block(p.optString("name") + " · " + p.optString("unit"),
                    p.optString("code") + " · " + p.optLong("listPrice") + " đ")
            }
        }
    }

    private fun fetchMyOrders() {
        reset("Yêu cầu V2")
        content.block("Đơn V2 thuộc tài khoản chủ",
            "Đây không phải danh sách toàn bộ hóa đơn. Hóa đơn thật, PDF và trạng thái thanh toán " +
                "thuộc sổ Minh Satori gốc ở các mục quản trị của ứng dụng.")
        work({ api.request("GET","/api/v2/orders") }) { result ->
            reset("Yêu cầu V2 của chủ")
            records(result.optJSONArray("orders") ?: JSONArray()) { order ->
                content.block(order.optString("state") + " · " +
                        order.optString("invoiceNo","Chưa có hóa đơn"),
                    order.optString("orderedAt") + "\n" +
                        order.optString("totalVnd") + " VND")
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (page=="home") super.onBackPressed() else navigate("home")
    }

    override fun onDestroy() {
        loginScope.cancel()
        api.clear()
        owner=null
        super.onDestroy()
    }
}
