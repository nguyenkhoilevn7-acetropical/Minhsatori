# Hướng dẫn kích hoạt Bot API Minh Satori trên hệ thống thật

**Trạng thái:** File api/BotApi.gs trong GitHub chỉ là mã nguồn; không tự xuất hiện trên Apps Script. Chỉ gọi là API đang chạy khi endpoint HTTP được triển khai và trả lời đúng các lệnh thử nghiệm.

## Không làm mất dữ liệu
- Mở chính xác dự án Google Apps Script đang chạy website Minh Satori, sao lưu toàn bộ mã nguồn hiện tại và Script Properties (trừ giá trị bí mật).
- Kiểm tra dự án chứa readState_(), driveCommit(), driveRead(), doGet() và requireOwner_(). Đừng thay thế những hàm này, đừng chạy lại setupDrive().
- Kiểm tra STATE_FILE_ID trỏ đúng file MinhSatori_Live_Data.json trên Drive. Trước khi sửa phải sao lưu trạng thái hiện tại; bản sao lưu 19/10/2026 hiện có tên MinhSatori_PreBotAPI_2026-10-19_rev96_READONLY.
- Mã được thêm như một tệp mới BotApi.gs trong CÙNG dự án để dùng chung LockService với luồng đồng bộ website. Nếu đã có doPost, cần hợp nhất thay vì thêm hàm trùng tên.
- Không sửa deployment doGet hiện tại. Tạo một deployment riêng cho API.

## Kích hoạt an toàn
1. Trước tiên kiểm thử trên một dự án Apps Script và một **file Drive bản sao riêng**, không trên 111 hóa đơn thật.
2. Trong Script Properties cấu hình SATORI_BOT_CLIENTS_JSON, mỗi client gồm keyId, enabled, secret ngẫu nhiên ít nhất 32 ký tự và scopes.
3. Giữ secret bên trong kho bí mật server-side; tuyệt đối không lưu trong GitHub, HTML, localStorage hoặc hội thoại.
4. Triển khai một Web App POST riêng, thực thi dưới tài khoản quản lý; chọn quyền truy cập phù hợp để server connector gọi được. doGet phải luôn kiểm tra chủ sở hữu, kể cả khi deployment mới được phép nhận POST.
5. Dùng api/bot-client.mjs gọi system.status, customers.search, orders.list và debt.summary trên file thử. Thử thêm các trường hợp chữ ký sai, replay, revision lỗi, khách trùng tên khác địa chỉ, xóa sai ID, xóa hóa đơn đã thanh toán, xóa trùng requestId, mất mạng giữa lúc ghi.
6. Tạo/xóa/khôi phục hóa đơn trên FILE THỬ; xác minh backup trước ghi và readback.
7. Khi đã đạt, triển khai API vào chính dự án Apps Script đang chạy nhưng cấp quyền đọc trước: orders:read, customers:read, debt:read.
8. So khớp revision và số lượng hóa đơn của API với dữ liệu Drive; sau khi xác minh mới bật quyền orders:write, orders:delete, payments:write.
9. Để ChatGPT điều hành trực tiếp từ cuộc trò chuyện phải có custom connector hoặc middleware ký HMAC server-side. Có URL API không đồng nghĩa ChatGPT đã kết nối được.

## Lệnh đã triển khai trong mã
- system.status — trạng thái và revision.
- customers.search — tìm từng điểm giao theo tên, địa chỉ, điện thoại, không tự chọn sai chi nhánh.
- orders.list và debt.summary — tra cứu hóa đơn và công nợ.
- orders.create — yêu cầu chọn customerRef hoặc xác nhận khách mới, requestId và revision.
- orders.delete — chỉ xóa mềm vào thùng rác 30 ngày, yêu cầu ID, số hóa đơn, tên, số tiền, xác nhận và revision.
- payments.markCustomerPaid — chỉ xác nhận thanh toán theo hóa đơn với phiên bản mới nhất.

## Kiểm tra trên server sau khi cấu hình
Đặt SATORI_BOT_API_URL, SATORI_BOT_KEY_ID, SATORI_BOT_SECRET vào biến môi trường server tin cậy. Chạy Node 18+:
- node api/bot-client.mjs system.status '{}'
- node api/bot-client.mjs customers.search '{"query":"Traky Hair"}'

Chỉ thông báo API hoạt động thật sau khi endpoint trả JSON ok:true và đối chiếu thành công với Drive. Tuyệt đối không bật write scopes khi chưa kiểm tra khôi phục.
