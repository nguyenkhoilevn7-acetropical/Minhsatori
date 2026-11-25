package vn.minhsatori.app

/**
 * Owner-only "who created this invoice" label (cards + detail; never the PDF).
 *
 * 1. V2 account: ONLY from server-verified checkout origins (PostgreSQL V2,
 *    owner session), matched on exact ledger id + invoice number, and the
 *    checkout requestId must equal the bill's apiRequestId when provided.
 * 2. Otherwise the ledger creation channel:
 *    - Bot API + request id starting "chatgpt-"  -> ChatGPT
 *    - Bot API + other hand-written request id   -> AI assistant via Bot API
 *    - Bot API + machine UUID (V2 checkout shape) -> account not verified yet
 *    - no Bot API source                          -> created manually (web-app/App)
 * Recipient name/phone, discount and CTV links are never used to guess an account.
 */
internal object InvoiceOrderAccountSource {
    const val UNKNOWN = "Chưa xác định tài khoản đặt hàng"
    const val ROLE_FROM_ORDER = "ORDER_SNAPSHOT"
    const val ROLE_FROM_CURRENT_PROFILE = "CURRENT_PROFILE"
    const val CURRENT_PROFILE_NOTE = "Vai trò theo hồ sơ hiện tại, không phải lúc đặt"
    const val CHATGPT = "ChatGPT"
    const val AI_BOT_API = "Trợ lý AI qua Bot API"
    const val MANUAL = "Chủ shop tạo thủ công (web-app/App)"
    const val V2_SESSION_EXPIRED_CARD = "Đơn V2 · chưa xác minh tài khoản (phiên V2 trên máy đã hết hạn)"
    const val V2_SESSION_EXPIRED_DETAIL =
        "Đơn đặt qua V2. Phiên đăng nhập V2 trên máy đã hết hạn (chỉ có hạn 7 ngày) nên chưa đọc được " +
        "tài khoản đặt hàng. App đang tự gia hạn bằng Gmail chủ shop; nếu vẫn hiện dòng này, bấm " +
        "\"Gia hạn phiên V2\" bên dưới."
    const val V2_UNAVAILABLE_CARD = "Đơn V2 · chưa xác minh tài khoản (máy chủ V2 chưa phản hồi)"
    const val V2_UNAVAILABLE_DETAIL =
        "Đơn đặt qua V2. Máy chủ V2 chưa phản hồi (có thể đang khởi động). Tài khoản đặt hàng sẽ tự hiện khi kết nối lại."
    const val V2_NO_EVIDENCE_CARD = "Đơn V2 · chưa có bằng chứng tài khoản đặt hàng"
    const val V2_NO_EVIDENCE_DETAIL =
        "Đơn đặt qua V2, nhưng máy chủ V2 không có checkout đã chốt khớp đúng mã hóa đơn và mã yêu cầu. " +
        "Không đoán tài khoản theo tên, số điện thoại hay địa chỉ người nhận."

    enum class Creator { V2_ACCOUNT, CHATGPT, AI_BOT_API, V2_UNVERIFIED, MANUAL, UNKNOWN }

    data class Display(
        val card: String,
        val detail: String,
        val verifiedLogin: Boolean,
        val accountName: String = "",
        val accountRole: String = "",
        /** True when the role was captured at checkout; false = current profile. */
        val roleFromOrder: Boolean = false,
        val creator: Creator = Creator.UNKNOWN
    ) {
        /** Role line for the detail screen, explicit about where the role comes from. */
        val roleDetail: String get() =
            if (!verifiedLogin) "" else if (roleFromOrder) accountRole
            else "$accountRole · $CURRENT_PROFILE_NOTE"
    }

    /** Exact server enum only; aliases are rejected so a typo never becomes a role. */
    fun role(value: String): String? = when (value) {
        "retail" -> "Khách Lẻ"
        "agency" -> "Đại Lý"
        "collaborator" -> "CTV"
        else -> null
    }

    private val uuid = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    private val unknown = Display(UNKNOWN, UNKNOWN, false)

    /** Creation channel from the ledger only; used when no verified account exists. */
    fun creator(invoice: SatoriInvoice): Display {
        val requestId = invoice.requestId
        if (invoice.source != "bot_api") {
            return if (invoice.source.isBlank() && requestId.isBlank())
                Display("Tạo bởi: $MANUAL", MANUAL, false, creator = Creator.MANUAL)
            else unknown
        }
        return when {
            requestId.startsWith("chatgpt-") && requestId.length > 8 ->
                Display("Tạo bởi: $CHATGPT", "$CHATGPT (Bot API)", false, creator = Creator.CHATGPT)
            uuid.matches(requestId) ->
                Display(UNKNOWN, UNKNOWN, false, creator = Creator.V2_UNVERIFIED)
            requestId.isNotBlank() ->
                Display("Tạo bởi: $AI_BOT_API", AI_BOT_API, false, creator = Creator.AI_BOT_API)
            else -> unknown
        }
    }

    /**
     * A V2 checkout (Bot API + UUID request id) with no verified origin: say WHY instead of a
     * silent "Chưa xác định". [feed] is the state of the live V2 feed on this phone; null keeps
     * the old wording (no reason known). Never names an account without server evidence.
     */
    fun explainUnverifiedV2(display: Display, feed: V2OrderOriginsClient.FeedState?): Display {
        if (display.creator != Creator.V2_UNVERIFIED || feed == null) return display
        return when (feed) {
            V2OrderOriginsClient.FeedState.NO_SESSION,
            V2OrderOriginsClient.FeedState.SESSION_EXPIRED ->
                display.copy(card = V2_SESSION_EXPIRED_CARD, detail = V2_SESSION_EXPIRED_DETAIL)
            V2OrderOriginsClient.FeedState.UNAVAILABLE ->
                display.copy(card = V2_UNAVAILABLE_CARD, detail = V2_UNAVAILABLE_DETAIL)
            V2OrderOriginsClient.FeedState.OK ->
                display.copy(card = V2_NO_EVIDENCE_CARD, detail = V2_NO_EVIDENCE_DETAIL)
        }
    }

    fun resolve(
        invoice: SatoriInvoice,
        snapshot: SatoriSnapshot?,
        v2Origins: List<SatoriOrderOrigin> = emptyList(),
        v2Feed: V2OrderOriginsClient.FeedState? = null
    ): Display = explainUnverifiedV2(resolveVerified(invoice, snapshot, v2Origins), v2Feed)

    private fun resolveVerified(
        invoice: SatoriInvoice,
        snapshot: SatoriSnapshot?,
        v2Origins: List<SatoriOrderOrigin>
    ): Display {
        if (invoice.id.isBlank() || invoice.number.isBlank()) return unknown
        fun matching(feed: List<SatoriOrderOrigin>) = feed.filter {
            it.ledgerInvoiceId == invoice.id || it.invoiceNo == invoice.number
        }
        // Within ONE feed, a second row for the same id or number (even identical)
        // is a duplicate and makes the invoice unknown.
        val fromRegistry = matching(snapshot?.orderOrigins.orEmpty())
        val fromV2 = matching(v2Origins)
        if (fromRegistry.size > 1 || fromV2.size > 1) return unknown
        if (fromRegistry.isEmpty() && fromV2.isEmpty()) return creator(invoice)
        // Across the two feeds the same account must be stated identically.
        fun identity(o: SatoriOrderOrigin) = listOf(o.ledgerInvoiceId, o.invoiceNo,
            o.accountId, o.accountName, o.accountRole, o.roleSource)
        if (fromRegistry.isNotEmpty() && fromV2.isNotEmpty() &&
            identity(fromRegistry.single()) != identity(fromV2.single())) return unknown
        val origin = fromV2.singleOrNull() ?: fromRegistry.single()
        if (origin.ledgerInvoiceId != invoice.id || origin.invoiceNo != invoice.number)
            return unknown
        if (origin.requestId.isNotEmpty() && origin.requestId != invoice.requestId) return unknown
        val name = origin.accountName
        if (origin.accountId.isBlank() || name.isBlank() || name != name.trim()) return unknown
        val accountRole = role(origin.accountRole) ?: return unknown
        val fromOrder = origin.roleSource == ROLE_FROM_ORDER
        val card = "Đặt từ: $name · $accountRole" + if (fromOrder) "" else " (hồ sơ hiện tại)"
        return Display(card, name, true, name, accountRole, fromOrder, Creator.V2_ACCOUNT)
    }
}
