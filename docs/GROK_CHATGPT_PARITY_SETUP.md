# Cho Grok làm được những gì ChatGPT làm trong Minh Satori — các bước cho chủ cửa hàng

Quyết định ngày 16/11/2026: Grok chỉ dùng **đúng các lệnh Apps Script đang có** (như ChatGPT), **không thêm chức năng mới** vào sổ.
Không có lệnh HỦY: trạng thái "Đã hủy" chỉ đổi trong app.

Grok làm được (mọi thao tác ghi đều phải qua: Grok gửi tóm tắt → anh trả lời "ok" → Grok mới xác nhận):

| Việc | Lệnh sổ có sẵn |
|---|---|
| Tra cứu, chi tiết hóa đơn, PDF, tìm sản phẩm, công nợ, bảng kê PDF, lịch sử sửa, Thùng Rác | system.status, orders.list, catalogue.list, debt.summary, orders.auditHistory, trash.list |
| Xem trước sửa hóa đơn (không ghi) | orders.previewUpdate |
| Sửa hóa đơn chưa thanh toán / hoàn tác lần sửa gần nhất | orders.update / orders.undoUpdate |
| Ghi nhận / bỏ ghi nhận khách đã trả, đã thanh toán Satori | payments.markCustomerPaid / markCustomerUnpaid / markSatoriPaid / markSatoriUnpaid |
| Xóa vào Thùng Rác 30 ngày / khôi phục | orders.delete / orders.restore |
| Tạo đơn | orders.create (như cũ) |

> Không bước nào cần xem, chép hay gửi secret. Không chụp màn hình có secret.

## Bước 1 — Gỡ phần HỦY vừa thêm vào Apps Script (nếu còn)
Mở project **Minh Satori Drive Sync** → `BotApi.gs`, Ctrl+F `orders.cancel`. Nếu thấy, xóa đúng 3 chỗ:
1. Trong `SCOPES`: `,'orders.cancel':'orders:cancel'` (giữ dấu `}` và `;` phía sau).
2. Trong `function write(...)`: dòng `if(action==='orders.cancel')need(...Thiếu BotApiOrderCancel.gs');` và đoạn
   `action==='orders.cancel'?SatoriOrderCancel.cancel(s,all,p,actor):` ở đầu chuỗi `result=`.
3. Trong `handle`: `||identity.action==='orders.cancel'`.

Xóa file **BotApiOrderCancel** (chuột phải → Xóa). Nếu có file **BotApiGrokLedger** thì xóa luôn, và xóa dòng `SatoriGrokLedgerApi` trong `doPost` nếu có. Lưu (Ctrl+S).
Ctrl+F lại `orders.cancel` trên toàn project: phải không còn.

- **Nếu bản có HỦY CHƯA được deploy:** chỉ cần lưu, không deploy.
- **Nếu ĐÃ deploy:** Triển khai → Quản lý triển khai → bút chì trên đúng deployment Render đang gọi → Phiên bản: chọn **phiên bản trước khi thêm HỦY** → Triển khai. URL giữ nguyên.

## Bước 2 — Cấp quyền cho 2 khóa của Grok (Script Properties)
Dùng hàm một lần `GrokLedgerScopesSetup` (tự sao lưu, chỉ đổi scopes/role, không in secret):
1. Mở file **GrokLedgerScopesSetup** trên Editor (nếu chưa có thì tạo file Script mới cùng tên), **thay toàn bộ** nội dung bằng `api/GrokLedgerScopesSetup.gs` trong PR này.
2. Điền 2 dòng đầu (keyId không phải secret, lấy ở Render → Environment):
   - `SATORI_GROK_WRITER_KEY_ID` = giá trị `SATORI_V2_CANONICAL_WRITE_KEY_ID`
   - `SATORI_GROK_READER_KEY_ID` = giá trị `SATORI_READ_KEY_ID`
3. Chạy `satoriGrokScopesCheck` → xem nhật ký (chỉ có keyId, role, độ dài secret, scopes).
4. Chạy `satoriGrokScopesApply` → phải thấy `APPLY_DONE_BACKUP_IN_SATORI_BOT_CLIENTS_JSON_BACKUP_GROK_20261116`.
   - Khóa GHI V2 được thêm: `orders:delete`, `orders:update`, `payments:write`, `role: owner`.
   - Khóa ĐỌC V2 được thêm: `debt:read`, `role: owner`. **Không bao giờ** có `orders:update`.
   - Hàm từ chối, không đổi gì nếu: chưa điền keyId, 2 keyId trùng, không tìm thấy khóa, khóa đọc đã có quyền ghi, hoặc đã có bản sao lưu trước.
5. Chạy lại `satoriGrokScopesCheck`: `secretLength` của mọi khóa phải giống hệt bước 3.

Có hiệu lực ngay, không cần deploy Apps Script.
Lưu ý: khóa GHI V2 cũng là khóa của trang đặt hàng V2. Sau bước này khóa đó có quyền sửa đơn và ghi nhận thanh toán giống khóa ChatGPT: giữ secret của nó chỉ trên Render.

## Bước 3 — Deploy máy chủ (Render)
Sau khi duyệt và merge PR, deploy service V2 như mọi lần. Bảng `satori_v2_grok_write_requests` tự được thêm cột (migration chỉ thêm, không xóa).
Biến môi trường giữ như hiện tại: `GROK_OWNER_WRITES_ENABLED=1`, `SATORI_V2_CANONICAL_WRITES_ENABLED=1` và các biến khóa ghi/đọc V2.

## Bước 4 — Kiểm tra trên Grok (chưa ghi gì)
1. `satori_debt_summary` → ra công nợ.
2. `satori_order_audit_history` (một hóa đơn đã từng sửa) → ra lịch sử.
3. `satori_order_preview_update` cho một hóa đơn chưa thanh toán → ra trước/sau, **không ghi sổ**.
4. `satori_order_update_request` / `satori_payment_request` → Grok gửi tóm tắt. **Không trả lời "ok"** nếu chỉ thử: yêu cầu tự hết hạn sau 30 phút, sổ không đổi.
5. Muốn thử ghi thật: chọn 1 hóa đơn, trả lời "ok" → kiểm tra trong app → hoàn tác bằng `satori_order_undo_update_request` hoặc `satori_payment_request` với change ngược lại.

Xong: chạy `satoriGrokScopesClearBackup`, rồi xóa file **GrokLedgerScopesSetup**.

## Tắt nhanh / quay lại
| Muốn | Cách |
|---|---|
| Tắt mọi thao tác ghi của Grok | Render: `GROK_OWNER_WRITES_ENABLED=0` (đọc vẫn chạy nếu `GROK_OWNER_READS_ENABLED=1`) |
| Thu hồi quyền khóa (trước khi xóa backup) | Chạy `satoriGrokScopesRollback` → trả nguyên văn cấu hình cũ |
| Thu hồi quyền khóa (đã xóa backup) | Sửa tay `SATORI_BOT_CLIENTS_JSON`: bỏ các scope và `"role":"owner"` đã thêm |
| Quay lại máy chủ cũ | Render: Rollback về deploy trước |
