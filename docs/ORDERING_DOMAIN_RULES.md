# Minh Satori — quy tắc nghiệp vụ đặt hàng và cấp link (2026-10-24)

**Trạng thái:** yêu cầu nghiệp vụ của chủ hệ thống; là tiêu chuẩn thiết kế và kiểm thử cho các thay đổi liên quan đến khách hàng, điểm giao, đại lý, AI và hóa đơn. Tài liệu này KHÔNG cấp quyền ghi dữ liệu thật và KHÔNG tự động triển khai code.

## 1. Khái niệm bắt buộc tách riêng
- **Đại lý / người được chủ shop cấp quyền đặt hàng** (agency): một thực thể ổn định, có ID riêng, có thể quản lý nhiều điểm giao và nhiều người nhận.
- **Điểm giao** (delivery location): có ID ổn định, thuộc đại lý; gồm địa chỉ đủ chi tiết (số nhà/tầng/căn hộ nếu có), liên hệ giao nhận và chính sách giá/chiết khấu của điểm đó.
- **Đơn hàng / hóa đơn** (order/invoice): giao dịch phát sinh mỗi lần khách xác nhận giỏ. Cùng một điểm giao được phép có bao nhiêu hóa đơn cũng được. Không dùng số hóa đơn lịch sử như ID duy nhất của điểm giao.
- **Link truy cập** (invitation): một link ổn định cho đại lý; chỉ gắn đến agency ID và quyền truy cập; dữ liệu địa chỉ và giá được đọc từ cấu hình bền vững ở backend, không mã hóa đóng băng toàn bộ 17 địa chỉ vào đường link.
- **Giỏ hàng / báo giá** (cart/quote): chưa phải hóa đơn. Gemini chỉ diễn giải ý định đặt hàng, không quyết định giá, giảm giá, quyền sử dụng địa chỉ hoặc trạng thái thanh toán.

## 2. Luật gom dữ liệu và lịch sử
1. Một đại lý có thể có nhiều địa chỉ; một điểm giao có nhiều đơn hàng. **Khách mua lặp lại không phải dữ liệu lỗi**.
2. Nhiều đơn cùng điểm giao => gom thành một mục điểm giao trong danh sách, nhưng giữ **tất cả hóa đơn cũ** riêng biệt và không sửa/xóa hóa đơn nguồn.
3. Gom theo địa chỉ giao thực tế **đủ chi tiết** và ngữ cảnh đại lý. Chuẩn hóa chữ hoa/thường, dấu cách, cách ghi, số điện thoại. Không tự động coi hai số điện thoại khác nhau là hai điểm giao nếu địa chỉ thực tế giống nhau. **Không tự động gộp** khi cùng tòa nhà nhưng khác căn hộ/tầng/người nhận, hoặc địa chỉ mơ hồ. Gắn cờ chủ duyệt.
4. Nhiều hồ sơ nhắc cùng số hóa đơn cũ, cùng địa chỉ hoặc thiếu số điện thoại => chỉ ghi nhận để đối chiếu, **không khóa toàn bộ đại lý**. Hồ sơ cần xác minh được đặt ở danh sách riêng, hồ sơ hợp lệ vẫn tiếp tục hoạt động.
5. Khi chủ sửa/duyệt một điểm giao, cập nhật dữ liệu điểm giao cho **cùng một link đại lý đang hoạt động**; không buộc phát hành link mới chỉ để thêm/bớt địa chỉ. Nếu điểm giao bị tắt, link không còn cho chọn điểm đó.
6. **Không dùng số hóa đơn làm primary key để truy tìm điểm giao**. Hóa đơn lịch sử có thể trùng số, được nhập thủ công hoặc đã chỉnh sửa. Location ID và Agency ID là định danh độc lập.

## 3. Chính sách giá và hóa đơn
1. Chủ hệ thống định mức giảm % riêng cho từng điểm giao: 20%, 25%, 30%...; có thể thay đổi về sau; chỉ chủ có quyền sửa.
2. Mọi hiển thị giá, báo giá cuối và hóa đơn đều được backend tính lại từ sản phẩm hiện hành + mức giảm của locationId đã duyệt + phí/VAT tương ứng. UI, link và Gemini không được sửa tỷ lệ.
3. Mỗi lần xác nhận một giỏ được phép tạo **đúng một hóa đơn** gồm nhiều SKU. Không có hai hóa đơn CTV/khách; không nhân bản đơn cho mỗi tin nhắn AI.
4. Khi lưu hóa đơn, **lưu snapshot** tên người nhận, địa chỉ, giảm giá, đơn giá, phí/VAT và từng dòng sản phẩm đã được xác nhận. Chỉnh hồ sơ/giá sau này không được tự thay đổi lịch sử đơn cũ.
5. Không được ghi hóa đơn thật chỉ vì xem giỏ, gửi tin nhắn chat, đổi điểm giao, hoặc xem báo giá.
6. Giỏ chưa xác nhận có thể thay đổi tự do; khi đổi điểm giao phải hủy báo giá cũ và tính lại giá.
7. Phân biệt chính xác **repeat purchase** và **network retry**:
   - Khách xác nhận giao dịch mới lần 2 => idempotency key mới => hóa đơn thứ 2 hợp lệ, dù mặt hàng/địa chỉ/số lượng y hệt.
   - Client gửi lại **cùng checkout request ID** do mạng chập chờn hoặc bấm nhiều lần => trả lại kết quả giao dịch cũ, không tạo hóa đơn thứ 2.
   - Không chống trùng bằng tên khách, địa chỉ, SKU, số lượng hay tổng tiền.

## 4. Luồng duy nhất trên website/app Minh Satori hiện có
1. Chủ truy cập quản trị, chọn đại lý, nhìn thấy danh sách điểm giao tổng hợp từ lịch sử; hồ sơ cần duyệt nằm riêng.
2. Chủ đặt mức giảm từng địa chỉ, kích hoạt/điều chỉnh quyền truy cập, bấm **Cấp link** chỉ một lần.
3. Đại lý mở link đã cấp, được xác thực, chọn một điểm giao đã được duyệt.
4. Đại lý trao đổi tự nhiên với Gemini: mặt hàng, số lượng, nhiều SKU, lưu ý giao hàng; mọi mục thêm vào **cùng một giỏ**.
5. Backend lập báo giá riêng cho địa chỉ đã chọn; đại lý xem rõ số lượng, địa chỉ, giảm giá, tổng tiền rồi xác nhận.
6. Backend ghi một hóa đơn thật qua API Minh Satori khi đủ quyền. App và website cập nhật danh sách đơn; hỗ trợ refresh thủ công khi đồng bộ bị trễ.
7. Người mua có thể tiếp tục đặt lần 2, lần 3... trên cùng link và cùng điểm giao.

## 5. Tiêu chí kiểm thử bắt buộc trước khi kết luận 'đã xong'
- Khách A mua 10 lần, cùng một điểm giao => một hồ sơ địa chỉ, 10 hóa đơn độc lập.
- Hai địa chỉ thực tế khác nhau của A => hai điểm giao.
- Hai dòng lịch sử trùng số hóa đơn #68 => không làm mất dữ liệu và không khóa toàn bộ quyền cấp link.
- Cùng địa chỉ, khác cách viết/số điện thoại => gợi ý gộp; nếu không chắc phải yêu cầu chủ duyệt.
- Địa chỉ thiếu điện thoại => hiện "Cần duyệt" và link vẫn cho các địa chỉ hợp lệ đặt hàng.
- 17 bản ghi lịch sử nhưng ít hơn 17 điểm giao độc lập vẫn hợp lệ; không ép số lượng.
- Hai điểm giao có chiết khấu 20% / 35% => báo giá khác nhau; khách không sửa được thông qua chat hoặc developer tools.
- Chủ thêm/duyệt một địa chỉ sau khi cấp link => **link cũ thấy điểm mới** mà không cần gửi lại link.
- Một giỏ có 3 sản phẩm và nhiều tin nhắn chat => chỉ một hóa đơn khi xác nhận.
- Cùng request ID gửi 3 lần => một hóa đơn; xác nhận đơn mới với request ID khác => hóa đơn mới.
- App/web mở ở hai thiết bị => thấy đơn và chỉnh sửa sau khi sync; có nút refresh dự phòng.
- Toàn bộ test dữ liệu giả/sandbox đạt trước; kiểm tra đầy đủ Production theo phê duyệt riêng; không thao tác xóa/sửa hóa đơn nguồn.

## 6. Khuyến nghị dữ liệu tối thiểu (kiến trúc, không phải code đang triển khai)
- agencies(id, display_name, status)
- agency_links(id, agency_id, token_hash, expires_at, revoked_at)
- delivery_locations(id, agency_id, label, full_address, contact_name, phone, active, review_status, discount_percent, updated_at)
- location_order_history(location_id, order_id) hoặc orders.location_id
- carts(id, agency_id, location_id, status, updated_at)
- orders(id, agency_id, location_id, request_id UNIQUE, confirmed_at, status, delivery_snapshot, pricing_snapshot)
- order_items(order_id, sku, qty, list_price, discount_percent, net_unit_price, subtotal)
- Trường `review_status` tách khỏi trạng thái đại lý; lỗi một điểm không ảnh hưởng các điểm khác.

## 7. Nguồn tham khảo công khai (KHÔNG đại diện mã backend bí mật của Grab/Shopee)
- Shopify B2B CompanyLocation: https://shopify.dev/docs/api/admin-graphql/latest/objects/companylocation
- Shopify B2B data model: https://shopify.dev/docs/apps/build/b2b
- Shopify Order: https://shopify.dev/docs/api/admin-graphql/latest/objects/Order
- GrabFood SDK chính thức: https://github.com/grab/grabfood-api-sdk-go
- Shopee Trung tâm trợ giúp, quản lý đơn đa kênh: https://help.shopee.vn/portal/1/article/98754
- Shopee Trung tâm trợ giúp, quản lý nhiều địa chỉ: https://help.shopee.vn/portal/4/article/79433
- Stripe idempotency: https://docs.stripe.com/api/idempotent_requests
- Shopify duplicate events and retry: https://shopify.dev/docs/apps/build/webhooks/verify-deliveries

## 8. Phạm vi
Không xây thêm website/app/Lovable cho luồng này. Thực hiện trên code và dữ liệu Minh Satori hiện có, thay đổi nhỏ nhất có thể; kiểm thử thực tế trước khi báo thành công. Không công khai secret, số điện thoại, địa chỉ thật trong fixtures hoặc GitHub logs.
