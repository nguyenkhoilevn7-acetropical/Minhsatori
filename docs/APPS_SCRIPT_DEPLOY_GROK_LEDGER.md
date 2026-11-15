# Deploy Apps Script cho Grok ledger tools: HỦY đơn (+ lịch sử hủy) — cách an toàn

Áp dụng cho PR tiếp nối #428. Người thao tác: chủ cửa hàng (hoặc người được chủ giao), trên **Apps Script Editor** của project **Minh Satori Drive Sync**.
Mã production thật đã được đưa lên GitHub (chỉ đọc) tại `apps-script/production-snapshot-20261115/`; mọi thứ dưới đây được viết và test trên chính mã đó.

## Hiện trạng production (đã kiểm tra trên snapshot)

| Lệnh | Production hiện tại | Việc của PR này |
|---|---|---|
| `orders.auditHistory` | **Đã có**: cần `orders:read` + `role` `owner`/`admin`; trả nhật ký sửa `satori_order_edit_audit_v1`. ChatGPT đang dùng. | **Không thay.** Chỉ cấp role `owner` cho khóa ĐỌC V2. Tùy chọn bổ sung dòng HỦY (công tắc 2). |
| `orders.previewUpdate` | **Đã có**: cần `orders:update` + role. | **Không đụng.** Tuyệt đối không cấp `orders:update` cho khóa đọc → tool Grok tiếp tục báo thiếu quyền (đúng). |
| `debt.summary` | Đã có, cần `debt:read`. | Cấp `debt:read` cho khóa ĐỌC V2. |
| `orders.delete` (XÓA → Thùng Rác 30 ngày) | Đã có, cần `orders:delete`. | Cấp `orders:delete` cho khóa GHI V2. |
| `orders.cancel` (HỦY → "Đã hủy", 0 đ, giữ hóa đơn) | **Chưa có.** | Thêm bằng add-on, công tắc 1. Cần `orders:cancel` cho khóa GHI V2. |

## Nguyên tắc an toàn
1. **Không sửa gì bên trong `SatoriBotApi`** (`BotApi.gs` giữ nguyên, trừ 1 dòng ở đầu `doPost`).
2. Add-on `BotApiGrokLedger.gs` chỉ đụng tới 2 lệnh, mỗi lệnh có **công tắc riêng** trong Script Properties, mặc định **tắt**:
   - `SATORI_GROK_LEDGER_ENABLED=1` → bật `orders.cancel`.
   - `SATORI_GROK_AUDIT_CANCEL_MERGE=1` → `orders.auditHistory` vẫn do production trả lời (production tự kiểm tra chữ ký, role, chống replay), add-on chỉ **thêm** các dòng HỦY vào sau.
   Khác `1` (hoặc chưa tạo) = chạy y hệt hôm nay. Tắt tức thì, không cần deploy lại.
3. Request có `?route=android` và mọi lệnh khác (ChatGPT, V2 checkout, website) không bao giờ đi qua add-on.
4. Test `tests/bot-api-cancel-audit.cjs` chạy trên **BotApi.gs production** + dòng hook: với công tắc tắt, toàn bộ lệnh hiện có cho kết quả và dữ liệu sổ **giống hệt** production gốc.

> Không bước nào cần xem, chép hay gửi secret. Nếu màn hình đang hiện secret: không chụp, không dán vào chat.

---

## 1. Sao lưu (bắt buộc, không thay đổi gì)
1. **Triển khai (Deploy) → Quản lý triển khai (Manage deployments)**.
2. Tìm deployment **Web app** có URL trùng biến Render `SATORI_READ_ENDPOINT` / `SATORI_V2_CANONICAL_WRITE_ENDPOINT`. **Ghi lại số Version hiện tại** = điểm rollback. Có nhiều deployment thì chỉ ghi/sửa đúng cái Render đang gọi.
3. **Tổng quan → Tạo bản sao (Make a copy)** (khuyên làm). Bản sao không mang Script Properties nên không lộ secret.

## 2. Kiểm tra trước
1. Ctrl+F trên toàn bộ file, tìm `SatoriGrokLedgerApi`, `SatoriOrderCancel`, `orders.cancel`, `GROK_LEDGER`. Nếu **đã có** → dừng, báo lại.
2. Mở `BotApi.gs`, kéo xuống cuối: hàm phải bắt đầu đúng `function doPost(e) {` và có nhánh `route === 'android'` như snapshot. Nếu khác → dừng, báo lại (editor đã đổi sau snapshot 2026-11-15).

## 3. Thêm file (chưa có tác dụng gì cho tới bước 6)
Nút **+** cạnh "Tệp" → **Tập lệnh (Script)**, đặt tên, dán **toàn bộ** nội dung từ GitHub (nhánh của PR):

| Tên file trên Editor | Dán từ |
|---|---|
| `BotApiOrderCancel` | `api/BotApiOrderCancel.gs` |
| `BotApiGrokLedger` | `api/BotApiGrokLedger.gs` |
| `GrokLedgerScopesSetup` | `api/GrokLedgerScopesSetup.gs` (tạm, xóa ở bước 7) |

Lưu (Ctrl+S).

## 4. Thêm 1 dòng vào `doPost(e)` trong `BotApi.gs`
Thêm **đúng 1 dòng** ngay dưới `function doPost(e) {`, không sửa gì khác:

```js
function doPost(e) {
  if(typeof SatoriGrokLedgerApi!=='undefined'){var grokLedger=SatoriGrokLedgerApi.tryHandle(e);if(grokLedger)return grokLedger;}
  if (e && e.parameter && e.parameter.route === 'android') {
  ... (giữ nguyên phần còn lại) ...
```

Lưu. Nếu Editor báo lỗi cú pháp → sửa đến hết lỗi, chưa deploy.

## 5. Cấp quyền khóa trong Script Properties
Property **`SATORI_BOT_CLIENTS_JSON`** (⚙ Cài đặt dự án → Thuộc tính tập lệnh). Cấu trúc:

```json
{
  "<keyId khóa GHI V2>": {"enabled": true, "secret": "<GIỮ NGUYÊN>",
                          "scopes": ["orders:read", "orders:write", "orders:cancel", "orders:delete"]},
  "<keyId khóa ĐỌC V2>": {"enabled": true, "secret": "<GIỮ NGUYÊN>",
                          "scopes": ["orders:read", "...scopes đang có...", "debt:read"],
                          "role": "owner"},
  "...các khóa khác": "GIỮ NGUYÊN"
}
```

- keyId khóa GHI V2 = biến Render **`SATORI_V2_CANONICAL_WRITE_KEY_ID`** (lúc tạo là `gemini_v2_writer_20261028`, đối chiếu lại).
- keyId khóa ĐỌC V2 = biến Render **`SATORI_READ_KEY_ID`**.
- keyId không phải secret. Secret ở `SATORI_V2_CANONICAL_WRITE_SECRET` / `SATORI_READ_HMAC_SECRET` trên Render — không cần mở.
- Khóa ĐỌC: chỉ thêm `debt:read` + `"role":"owner"`. **Tuyệt đối không** thêm `orders:update`, `orders:write`, `orders:delete`, `orders:cancel`, `payments:write`.
- Hiệu lực ngay (kể cả trước khi deploy), và đúng mục đích: role `owner` mở cho khóa đọc 2 lệnh **chỉ đọc** có sẵn của production là `orders.auditHistory` và `orders.get`; `debt:read` mở `debt.summary`; `orders:delete` mở `orders.delete` cho khóa ghi. `orders:cancel` chưa có tác dụng cho tới bước 6.

**Cách A (khuyên dùng)** — file `GrokLedgerScopesSetup`:
1. Điền 2 dòng đầu: `SATORI_GROK_WRITER_KEY_ID='<SATORI_V2_CANONICAL_WRITE_KEY_ID>'`, `SATORI_GROK_READER_KEY_ID='<SATORI_READ_KEY_ID>'`. Lưu.
2. Chạy **`satoriGrokScopesCheck`** — nhật ký chỉ in `keyId enabled role secretLength scopes`.
3. Chạy **`satoriGrokScopesApply`** → `APPLY_DONE_BACKUP_IN_SATORI_BOT_CLIENTS_JSON_BACKUP_GROK_20261115`. Hàm tự sao lưu, chỉ đổi `scopes`/`role`, kiểm tra secret không đổi; **từ chối và không đổi gì** nếu chưa điền keyId, 2 keyId trùng, không có khóa, khóa đọc đã có quyền ghi (`READER_KEY_ALREADY_HAS_WRITE_SCOPE_STOP` → báo lại), hoặc đã có backup cũ.
4. Chạy lại **`satoriGrokScopesCheck`**: `secretLength` mọi khóa giống hệt bước 2.

**Cách B** — sửa tay property. Sai 1 dấu phẩy là mọi bot báo `AUTH_FAILED` → nên dùng Cách A.

## 6. Deploy GIỮ NGUYÊN URL (công tắc còn tắt), rồi mới bật
1. **Quản lý triển khai** → đúng deployment ở bước 1 → **bút chì** → **Phiên bản mới**, mô tả `Grok ledger add-on (switches off)` → **Triển khai**. Không đổi "Thực thi với tư cách"/"Ai có quyền truy cập".
2. URL `.../exec` phải **giống hệt** trước. **Không** dùng "Tạo bản triển khai mới".
3. Kiểm tra hệ thống cũ (công tắc đang tắt nên phải như hôm nay): web app mở được, danh sách hóa đơn đúng; Grok `satori_system_status` chạy; ChatGPT vẫn xem/sửa hóa đơn như thường.
4. **Bật công tắc 1** (HỦY): Thêm thuộc tính `SATORI_GROK_LEDGER_ENABLED` = `1`.
5. (Tùy chọn) **Bật công tắc 2** (thêm dòng HỦY vào lịch sử): `SATORI_GROK_AUDIT_CANCEL_MERGE` = `1`.
   Lưu ý: lệnh lịch sử dùng chung cho ChatGPT, nên ChatGPT cũng sẽ thấy thêm các dòng HỦY (đánh dấu `kind:"cancel"`); dòng sửa giữ nguyên. Nếu chưa chắc ChatGPT đọc được dạng mới, để tắt.

## 7. Kiểm tra sau khi bật (chỉ đọc)
Trên Grok (Render bật `GROK_OWNER_READS_ENABLED=1` hoặc `GROK_OWNER_WRITES_ENABLED=1`):
1. `satori_system_status` → có `ledgerRevision`.
2. `satori_debt_summary` → ra công nợ.
3. `satori_order_audit_history` với 1 hóa đơn có thật → `entries` = nhật ký sửa của production (có thể rỗng nếu chưa từng sửa — không tự bịa).
4. `satori_order_preview_update` → **phải** báo khóa đọc chưa được cấp quyền. Nếu chạy được → báo lại ngay.
5. HỦY đơn thật chỉ làm khi chủ cửa hàng chọn hóa đơn cụ thể và đồng ý (request → "ok" → confirm).

Xong: chạy `satoriGrokScopesClearBackup`, rồi **xóa file `GrokLedgerScopesSetup`** (Lưu, không cần deploy lại).

## 8. Rollback (từ nhanh nhất)
| Tình huống | Cách làm | Thời gian |
|---|---|---|
| Bất thường ở HỦY | `SATORI_GROK_LEDGER_ENABLED` → `0` (hoặc xóa) | tức thì |
| Bất thường ở lịch sử | `SATORI_GROK_AUDIT_CANCEL_MERGE` → `0` (hoặc xóa) | tức thì |
| Tắt hẳn Grok ghi | Render: `GROK_OWNER_WRITES_ENABLED=0` | vài phút |
| Quay lại code cũ | Quản lý triển khai → bút chì → Phiên bản = **số đã ghi ở bước 1** → Triển khai (URL giữ nguyên) | 1 phút |
| Quyền khóa (Cách A, trước khi xóa backup) | Chạy `satoriGrokScopesRollback` → khôi phục nguyên văn | tức thì |
| Quyền khóa (đã xóa backup / Cách B) | Sửa tay: bỏ `orders:cancel`, `orders:delete` (nếu trước đó chưa có), `debt:read`, `"role":"owner"` | vài phút |

Rollback không hoàn tác dữ liệu: hóa đơn đã HỦY vẫn "Đã hủy" và vẫn có dòng trong `satori_order_cancel_audit_v1` (append-only, không ảnh hưởng tính toán). Muốn khôi phục, chủ cửa hàng đổi trạng thái trong app.
