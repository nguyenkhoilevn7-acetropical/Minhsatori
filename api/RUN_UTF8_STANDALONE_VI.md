# Chạy thử HMAC UTF-8 của Minh Satori trên Apps Script độc lập

**Mục tiêu:** kiểm tra `Utilities.computeHmacSha256Signature(..., Utilities.Charset.UTF_8)` bằng một giá trị HMAC chuẩn, và xác minh dữ liệu Unicode đã sửa làm đổi chữ ký. Không thử API thật, không dùng Google Drive, không tạo/xóa/sửa hóa đơn.

## Tuyệt đối không thao tác production

- **KHÔNG** mở/sửa dự án Apps Script đang vận hành `Minh Satori Drive Sync`.
- **KHÔNG** chạy `setupDrive()`, `satoriBotSandboxSelfTest()` hoặc `satoriBotProductionReadOnlySmokeTest()` trong bài kiểm tra này.
- **KHÔNG** copy cả `BotApiSandbox.gs` (tệp này cần các hàm `requireOwner_`, `readState_` khác), chỉ copy `SatoriBotUtf8Standalone.gs`.
- **KHÔNG** nhập `STATE_FILE_ID`, `SATORI_BOT_SECRET`, `SATORI_BOT_CLIENTS_JSON`, API URL, hoặc bất kỳ secret production nào.
- **KHÔNG** bấm **Deploy**, không thêm trigger hay cấp quyền quản lý Drive. Tệp standalone chỉ sử dụng dịch vụ `Utilities` và `console`.

## Các bước thao tác thủ công

1. Mở https://script.google.com/ bằng đúng tài khoản Google của anh. Trên Samsung Chrome, nếu trình biên tập không hiển thị đủ, mở menu **⋮ → Trang web cho máy tính** và xoay ngang điện thoại.
2. Chọn **New project / Dự án mới**. Đây phải là một dự án **trống, độc lập**, không được mở dự án Minh Satori đang chạy.
3. Đổi tên dự án mới thành `MinhSatori_UTF8_HMAC_TEST_ONLY`.
4. Mở tệp `Code.gs` mặc định, xóa mẫu `myFunction`, dán **toàn bộ** nội dung từ [SatoriBotUtf8Standalone.gs](./SatoriBotUtf8Standalone.gs) và lưu.
5. Trên thanh chọn hàm (dropdown), chọn `satoriBotSandboxUtf8KnownAnswerTest`, sau đó bấm **Run / Chạy** một lần.
6. Mở **Execution log / Nhật ký thực thi**, kiểm tra có dòng bắt đầu bằng `PASS:` chứa `"ok":true`, `"noDriveAccess":true` và hai kiểm tra HMAC. Nếu thấy `FAIL` hoặc bị yêu cầu cấp quyền Drive, **dừng lại** và báo lỗi; không cấp quyền Drive cho bài thử này.
7. Đóng trình soạn thảo. Để báo kết quả, chỉ cần gửi lại dòng `PASS` hoặc ảnh chụp nhật ký. Không gửi credential hoặc nội dung dữ liệu khách hàng.

## Phân biệt mức kiểm chứng

- ✅ GitHub CI của PR #7 kiểm thử riêng mã nguồn, bao gồm vector HMAC-SHA256 và Unicode, không kết nối Drive.
- ⏳ Sau khi người dùng bấm Run thành công trong dự án standalone mới, ta mới có bằng chứng **Apps Script native** xử lý UTF-8 đúng như reference.
- ⚠️ Bài thử này **không** chứng minh API POST ngoài Internet, OAuth/connector production, quyền ghi hoặc đồng bộ Drive chạy thành công. Các phép thử đó phải được thực hiện riêng trên file Drive sandbox theo đúng quy trình, không dùng 111 hóa đơn production.

## Dữ liệu dùng trong test

Dữ liệu chỉ gồm tên giả lập `Hà Minh Nguyệt – Ốc Q`, key kiểm thử công khai `SANDBOX_ONLY_HMAC_UTF8_REFERENCE_KEY_123456789` và giá trị kiểm thử `97c4f5e3a9f147c53b9d6047056351cfb3f71287e50f0a635cbdfc7636085d3e`. Đây **không phải** mã bí mật production.

**Nhánh và PR:** `test/satori-bot-sandbox-utf8-20261019`, PR #7 giữ ở Draft, không merge/deploy.
