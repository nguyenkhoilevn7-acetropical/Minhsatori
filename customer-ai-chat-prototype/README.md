# Minh Satori Customer AI Chat — nguyên mẫu riêng, không kết nối production

**Trạng thái:** Bản thử nghiệm độc lập, chưa công bố website khách hàng, chưa kết nối data production, chưa gọi AI thật trong môi trường kiểm thử tự động. Toàn bộ khách, địa chỉ, số điện thoại và đơn mẫu đều là dữ liệu **GIẢ**. Không dùng dữ liệu của Hà Minh Nguyệt hay khách hàng thật.

## Mục tiêu và quyết định đã chốt

- Mỗi **điểm giao của một khách** có **một link cố định**, không tự thay đổi qua các lần mua. Chủ cửa hàng có thể thu hồi/đổi khi nghi ngờ rò rỉ.
- Tên, SĐT, địa chỉ, danh sách SKU được phép mua và mức giá/chiết khấu được **chủ cửa hàng cấu hình và lưu trên server**. Link không chứa PII và không tự cấp quyền với khách khác.
- **OpenAI GPT là nhà cung cấp AI duy nhất** khi kết nối live. Không dùng Gemini/Claude. ChatGPT trong ứng dụng của chủ cửa hàng và API chạy trên website không tự chia sẻ phiên hội thoại hay ký ức; cần truy vấn cùng dữ liệu Minh Satori qua API có quyền.
- GPT làm **nhận diện ý định** (sản phẩm, số lượng, đổi địa chỉ) bằng Structured Outputs. Giá/chiết khấu, quyền, mức phí giao, trùng đơn, dữ liệu phải được tính/kiểm tra bằng code server. Không tin lời khách rằng họ có giá đặc biệt.
- Khách xác nhận **báo giá trước**, sau đó hệ thống mới tạo đơn có idempotency key. **Không tự ghi Đã thanh toán** nếu chưa có chứng từ/xác nhận thu tiền.
- Nếu khách đổi SĐT, người nhận hoặc địa chỉ: **tạm dừng áp dụng giá chiết khấu**; xác minh hoặc duyệt thủ công. Chỉ có link chưa chứng minh được khách là đúng người, kể cả nhập trùng thông tin đã đăng ký. Production phải có phiên xác thực/OTP ở thiết bị lạ.
- Lưu bản PDF phiếu xác nhận cho khách; PDF phải được tạo từ order đã commit và đã đọc lại, không từ JSON do GPT đề xuất.
- Production Minh Satori không thay đổi khi xây dựng và chạy prototype này.

## Có gì chạy được ngay?

### Chế độ 1 — Demo mở trực tiếp trên điện thoại (không OpenAI, không server)

Mở file **`index.html`** trong trình duyệt. Dùng khách giả A (20%) hoặc B (35%), thử nhắn:

- `Cho tôi 10 thùng nước Satori 5L`
- `Cho tôi đặt lại đơn lần trước`
- `Cho tôi 5 thùng nước Satori 500ml`
- `Cho tôi 10 thùng 5L giao đến 999 Đường Lạ` (bị chặn)

Demo offline dùng **parser quy tắc**, không phải một AI thứ ba. Có báo giá, nút xác nhận, bản ghi thử trong localStorage và phiếu in/Lưu PDF qua lệnh In trình duyệt (Save as PDF). **Không đồng bộ** và **không phải bản dành cho khách thật**. Hai link hiển thị trong file chỉ là mã mô phỏng, không thể chia sẻ ra Internet.

### Chế độ 2 — Node sandbox + OpenAI API + PDF tự động

Yêu cầu Node >= 20, Python 3, `reportlab` và một font Unicode tiếng Việt **đã cài trong hệ điều hành** (không kèm font). Không dùng bất kỳ mã API bí mật nào nằm trong HTML, GitHub hoặc chat.

```bash
# chạy trong thư mục chứa README
# thiết lập OPENAI_API_KEY bí mật trên SERVER theo cơ chế quản lý secrets của môi trường chạy
# không nhập API key vào file HTML hay commit .env
export OPENAI_MODEL=gpt-5.6-terra
node server.mjs
```

Mở `http://127.0.0.1:8787/c/demo-a` hoặc `/c/demo-b`. Nếu chưa có `OPENAI_API_KEY`, API **trả lỗi rõ ràng** và **không tạo đơn**; nó không gọi dịch vụ AI khác hay tự bịa kết quả. Khi có key, server gọi Responses API của **OpenAI**, sử dụng cấu trúc JSON có schema strict. Server **chỉ ghi** vào một tệp sandbox ở `os.tmpdir()/minh-satori-customer-chat-SANDBOX/orders.json` hoặc `DEMO_DATA_DIR`, **không** ghi Minh Satori Drive, Apps Script, GitHub hay production.

`GET /health`, `GET /api/session?token=demo-a`, `POST /api/message`, `POST /api/confirm`, `GET /api/invoice/:testRef` hoạt động cho các khách giả. Đường dẫn demo cố định và công khai **không đủ an toàn** để dùng cho khách thật. Chỉ bind loopback `127.0.0.1` mặc định.

### Test tự động (không tiêu OpenAI tokens)

```bash
node tests/test.mjs
```

Test double `tests/mock-openai.mjs` chỉ mô phỏng phản hồi của API OpenAI cho **kiểm thử lập trình** (không phải một model AI khác, không dùng khi chạy bình thường). Kỳ vọng 14/14 kiểm thử PASS, bao gồm kiểm tra PDF bắt đầu `%PDF` và cách ly khách.

## Kiến trúc production đề xuất (CHƯA CÀI ĐẶT)

```text
Link cố định của khách /c/<random-256-bit-token>
        │
        ▼
Server xác minh token băm + phiên/OTP trên thiết bị mới
        │
        ├── Customer & delivery location (khóa ID khách + địa chỉ + SĐT)
        │
        ├── Price policy versioned (do admin cấu hình)
        │
        ▼
OpenAI GPT Responses API / Structured Outputs: chỉ bóc tách ý định
        │
        ▼
Validator: SKU, qty, địa chỉ, policyId, shipping, trạng thái
        │
        ▼
Quote snapshot 10 phút + xác nhận rõ ràng của khách
        │
        ▼
Idempotency key + Apps Script script lock + expectedRevision
        │
        ▼
Minh Satori Bot API orders.create (khi đã phê duyệt tích hợp)
        │
        ├── đọc lại đơn đã ghi, đối chiếu tổng tiền/ID
        ├── xuất PDF từ bản ghi chính thức
        └── thông báo Admin / trả PDF trong chat
```

**Backend dự kiến:** Có thể tái sử dụng `api/BotApi.gs` với hành động `orders.create` và lớp HMAC/quyền ghi hiện có; không để token của khách gọi trực tiếp Bot API. Bộ nối riêng (Node backend hoặc Apps Script Web App có xác thực) giữ API key và HMAC secret ở server. Hàng đợi nếu cần để tránh quá quota đồng thời Apps Script. Tách riêng đơn khách và bill mức giá cộng tác viên; trường `duplicatedFromInvoiceNo` dùng để loại cặp giá khỏi thống kê sản lượng.

**Dữ liệu bổ sung** (mỗi bảng/collection có version/revision):
- `customer_chat_profiles`: `customer_id`, `delivery_location_id`, `name`, `phone`, `address`, `link_token_hash`, `enabled`, `verified_devices`, `policy_id`, `created_at`, `updated_at`.
- `price_policies`: `policy_id`, `version`, `authorized_skus`, `discount_by_sku`, `shipping_rule`, `requires_approval`, `valid_from`, `valid_to`.
- `chat_sessions`: session_id, customer_id, auth level, last activity, locale.
- `draft_quotes`: UUID, customer_id, policy_version, SKU/qty, calculated total, expires_at, status.
- `order_intents`: requestId, confirmation event id, quote hash, production invoice id (once committed), idempotency status.
- `audit_log`: redacted intent, policy decision, actor, revision, timestamps, error/timeout; không ghi key/token/OTP/PII đầy đủ.

**Bảo mật production:** token 256 bit sinh từ CSPRNG, chỉ lưu hash; HTTPS, `Secure HttpOnly SameSite` cookies, OTP ở thiết bị lạ/khách có chiết khấu cao, giới hạn tốc độ và số lần đặt, chính sách revoke link; xác minh giao hàng/địa chỉ không chỉ dựa trên AI. Khóa OpenAI và khóa HMAC đặt trong secrets server. Dữ liệu PII gửi OpenAI tối thiểu; thông báo cho khách theo chính sách dữ liệu. CORS đúng origin, CSRF, CAPTCHA/rate limit chống spam, chống prompt injection (GPT không có quyền tự gọi orders.create khi chưa qua code kiểm duyệt).

**Không làm tự động:** mark paid, sửa bảng giá, tạo khách có chiết khấu, đổi địa chỉ được ưu đãi, xóa hóa đơn, tự gửi Zalo cá nhân. Các việc này cần quyền/xác nhận riêng.

## Mục tiêu hiệu năng & độ chính xác trước pilot thật

- Mục tiêu đề xuất: p50 phản hồi chat trong 3 giây, p95 dưới 8 giây trên mạng tốt; **chỉ là mục tiêu, chưa đo bằng OpenAI thật**. Có timeout 12.5 giây với lỗi rõ ràng và không tạo đơn khi lỗi.
- Không gửi toàn bộ lịch sử 112+ đơn lên AI. Tìm khách, SKU, lần gần nhất bằng truy vấn nội bộ; truyền ngữ cảnh ngắn, nội dung ít tokens, cache prompt chung.
- Ngôn ngữ tiếng Việt không dấu, tên nước nhiều cách gọi, số lượng viết chữ, nhiều sản phẩm, sửa đơn, câu mơ hồ: dùng bộ 50–100 ca kiểm thử. Test acceptance: **0 đơn bị ghi nhầm người/địa chỉ/giá**, ≥98% trích xuất đúng SKU + số lượng trên bộ dữ liệu có nhãn; mọi trường hợp không chắc phải hỏi lại.
- Đánh dấu nhiều sản phẩm/chiết khấu phức tạp/địa chỉ mới là chưa hỗ trợ trong prototype. Trước pilot phải có luồng một giỏ nhiều SKU và test phù hợp.
- PDF phải đọc được đầy đủ dấu tiếng Việt trên Chrome Android và Samsung Internet; chia sẻ Zalo/Messenger phụ thuộc trình duyệt và chính sách từng ứng dụng.

## Chi phí & vận hành

- Mở file HTML offline miễn phí, không có AI thật.
- OpenAI API phát sinh **chi phí riêng**, không nằm trong gói ChatGPT Plus; số tiền tùy loại model và input/output tokens. Cấu hình giới hạn số request, giới hạn tokens, log tính phí và ngân sách dùng thử; dừng khi hết ngân sách.
- Dùng model GPT có hỗ trợ Structured Outputs, cấu hình `OPENAI_MODEL` để thay mà không sửa giá/logic. Khởi đầu có thể thử model GPT chi phí thấp, benchmark 50–100 câu nói thật **đã ẩn PII** trước khi lựa chọn model dùng live.
- Không cần mua domain mới cho pilot; server tin cậy/Apps Script có thể có hạn mức dịch vụ. Giá thực tế phải được đo/đối chiếu trước khi bật.

## Kế hoạch triển khai an toàn sau nguyên mẫu

1. Sao lưu và đối chiếu dữ liệu production, lập **staging Google Apps Script/Drive file riêng**.
2. Gắn OpenAI API key bằng secret trên server, kiểm thử GPT thật chỉ trên khách và đơn giả; tuyệt đối không gắn vào `index.html` công khai.
3. Thêm quản lý link + profile admin, gửi một link test qua Samsung; OTP ở thiết bị mới, kiểm soát chính sách giá.
4. Kết nối `orders.create` của Bot API chỉ sau khi đầy đủ idempotency, kiểm tra revision, lưu, đọc lại, PDF và bảo đảm không trùng bill.
5. Pilot giới hạn với khách đã cho phép, theo dõi kết quả trước khi mở rộng. Không tự merge hoặc triển khai lên production.

## Công nghệ AI

Chỉ dùng GPT qua OpenAI Responses API và Structured Outputs. Parser quy tắc trong file HTML và test double chỉ tồn tại ở **môi trường thử offline**. Không hứa rằng website này có cùng ký ức hay phiên làm việc với ChatGPT cá nhân; toàn bộ thông tin khách có thể đồng nhất nhờ API Minh Satori và chính sách dữ liệu dùng chung.