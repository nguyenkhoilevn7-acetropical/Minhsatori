# Minh Satori Android v0.3.0 — Native thử nghiệm, CHƯA phát hành live

## Những gì đã có trong mã v0.3.0
Màn hình Android native không mở Chrome; đọc hóa đơn và công nợ, xuất và chia sẻ PDF, lên đơn mới, sửa đơn, thanh toán, xóa mềm, khôi phục. Nút ghi chỉ bật khi Google xác thực và server trả allowedActions. Thao tác ghi dùng revision, backup và requestId, không ghi trực tiếp Drive, không chứa secret HMAC trong APK. Bản Android mới đã sửa trường hợp thanh toán lặp, trạng thái Đã TT Satori, hóa đơn Đã hủy và cố gắng xác minh đơn được lưu khi mất phản hồi.

## Điều kiện bắt buộc trước khi triển khai cho kinh doanh
1. Sao lưu và đối chiếu revision/số hóa đơn live, dùng bản sao Drive riêng để thử.
2. Triển khai hai file api/MobileApi.gs và api/BotApi.gs vào cùng dự án Apps Script đang chạy, giữ nguyên website doGet và bảo vệ HMAC. Việc commit GitHub KHÔNG tự triển khai Apps Script.
3. Trong Script Properties phía server thiết lập SATORI_ANDROID_OWNER_EMAIL, SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON, và SATORI_ANDROID_STAFF_PERMISSIONS_JSON nếu cần. KHÔNG đưa secret vào chat hoặc APK.
4. Trong Google Cloud cấp Android OAuth client cho package vn.minhsatori.app và SHA-1 của đúng khóa ký. Dùng keystore phát hành cố định lưu an toàn, không sử dụng khóa debug CI để chạy live.
5. Thử staging: từ chối token giả và tài khoản sai; nhân viên chỉ xem không ghi; kiểm tra tạo/sửa/thu tiền/xóa/khôi phục, requestId chống trùng, revision conflict, backup, đồng bộ nhiều thiết bị.
6. Thử trên Samsung thật: đăng nhập, lưu đơn, PDF tiếng Việt, Zalo/Messenger, mạng ngắt giữa lúc gửi, cập nhật trên website và đọc qua ChatGPT. Khi đó mới cân nhắc phát hành production.

**Trạng thái hiện tại:** bản APK debug và test CI không chứng minh Google OAuth, Apps Script Mobile API hoặc Zalo đã chạy trên Samsung. Không merge/phát hành live nếu chưa kiểm tra các điều kiện trên.

----


## Điểm khác v0.1.2

- Android mở **màn hình native**: Tổng quan, Hóa đơn, Khách hàng, Công nợ, Lên đơn.
- **Không chạy Chrome, không nhúng WebView hoặc PWA để hiển thị dữ liệu.**
- Đồng bộ bằng Android Google Identity với quyền `drive.readonly`, tải JSON live từ Google Drive API. Hoặc chọn file **MinhSatori_Live_Data.json** bằng trình chọn tài liệu Android (không phải Chrome).
- Xem chi tiết hóa đơn và ghi chú khách hàng, xuất PDF bằng Android `PdfDocument`, gửi qua bảng chia sẻ hệ thống (Zalo/Messenger nếu đã cài).
- Tách đơn CTV **Không Tính** khỏi danh sách nợ. `Đã TT Satori` không có nghĩa khách đã thanh toán.
- Dữ liệu hóa đơn giữ trên Google Drive. APK không chứa secret Bot API, không viết lên Google Drive, không giả lập số dư/hóa đơn khi lỗi.
- Bản cập nhật **không** chỉnh sửa website hoặc hóa đơn production.

## Tình trạng chức năng (minh bạch)

| Tính năng | Trạng thái |
|---|---|
| Mở màn hình trong ứng dụng (không Chrome) | ✅ Đã viết và build |
| Xem hóa đơn/khách hàng/công nợ từ snapshot đã đọc | ✅ Đã viết và kiểm tra đơn vị |
| Xuất PDF + Android share sheet | ✅ Đã viết, chờ test Samsung/Zalo thực tế |
| Google Identity/Drive API | ⚠️ Đã viết, cần Android OAuth client và thử thực tế |
| Chọn file qua trình chọn Drive trên Android | ✅ Đã viết, cần thử trên Samsung |
| Tự động đồng bộ liên tục | ⚠️ Google API cần kết nối hợp lệ, bản thử hỗ trợ refresh thủ công |
| Tạo/sửa/xóa đơn và ghi nhận thanh toán trong app | ⚠️ Đã viết; khóa cho đến khi kết nối OAuth + API và xác minh trên Samsung |
| Native app release signing/auto-update | ⛔ Chưa xong. Hiện APK ký debug trên GitHub Actions |

## Build và kiểm thử

```bash
gradle -p android :app:testDebugUnitTest :app:assembleDebug --no-daemon
```

APK nằm tại `android/app/build/outputs/apk/debug/app-debug.apk`.
GitHub workflow `.github/workflows/android-apk.yml` xuất artifact
`MinhSatori-Samsung-Native-v0.2.0-debug`.

### Kết nối Google API trên Android

Google Identity trên Android sẽ cần cấu hình ứng dụng OAuth Android trong Google Cloud tương ứng với:
- package: `vn.minhsatori.app`
- signing SHA-1 của **đúng APK**.
- Google Drive API và OAuth consent/trusted test user nếu thuộc phạm vi cần xác minh.
- scope: `https://www.googleapis.com/auth/drive.readonly` (restricted scope; có thể yêu cầu xác minh khi phát hành công khai).

Không nhúng client secret, HMAC secret hoặc tệp service-account vào APK.
Các build debug từ GitHub Actions có thể có SHA-1 thay đổi mỗi lần; cần keystore phát hành cố định do chủ sở hữu giữ **ngoài GitHub** và lưu signing secret trong nền tảng bảo mật phù hợp.

Để thử trước khi cấu hình OAuth, bấm **CHỌN FILE DRIVE BẰNG ANDROID**, chọn
`MinhSatori_Live_Data.json` trong tài khoản Drive của chủ sở hữu và đối chiếu
`revision`/số hóa đơn với website. Chọn lại hoặc đọc lại file khi cần cập nhật.
Không coi bản sao tải xuống là đồng bộ tức thời.

### Kiểm thử bắt buộc trước khi cho tạo đơn trong app

1. Sao lưu và đọc đúng số hóa đơn live ở thời điểm thực hiện.
2. Kiểm tra Samsung mở app native không dẫn tới Chrome.
3. Đọc đúng 3 hóa đơn không nhầm địa chỉ khách trùng tên, đối chiếu CTV/Không Tính.
4. Xuất PDF tiếng Việt dài nhiều dòng và chia sẻ Zalo/Messenger.
5. Tắt mạng rồi Refresh => không hiển thị dữ liệu cũ như đã đồng bộ thành công.
6. Mọi thao tác tạo/sửa/xóa phải thử trên sandbox bằng API xác thực chủ sở hữu, có idempotency và expectedRevision; không có secret HMAC trong Android.

**Không triển khai chức năng ghi production trực tiếp bằng Drive REST** vì website Apps Script đang dùng giao dịch và khóa đồng bộ riêng. Ghi trực tiếp có thể gây mất đơn hoặc xung đột revision.
