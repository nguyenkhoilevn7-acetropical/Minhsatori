# Deploy Apps Script cho Grok ledger tools: HỦY đơn + lịch sử hóa đơn (cách an toàn)

Áp dụng cho PR tiếp nối #428. Người thao tác: chủ cửa hàng (hoặc người được chủ giao), trên **Apps Script Editor** của project **Minh Satori Drive Sync** (project chứa `BotApi.gs`, `readState_()`).

## Nguyên tắc an toàn

`BotApi.gs` đang chạy trên production **không trùng** với GitHub (nhánh `main` và nhánh V2 khác nhau; production có thể có lệnh không nằm trong GitHub như `orders.update`). Vì vậy cách này:

1. **Không sửa gì bên trong `SatoriBotApi`** (SCOPES, auth, read, write, handle giữ nguyên 100%).
2. Chỉ **thêm file mới** + **thêm đúng 1 dòng** ở đầu hàm `doPost(e)`.
3. Có **công tắc** `SATORI_GROK_LEDGER_ENABLED` trong Script Properties: khác `1` (hoặc chưa tạo) thì hệ thống chạy **y hệt hôm nay**. Tắt/bật tức thì, không cần deploy lại.
4. Add-on chỉ nhận đúng 2 lệnh `orders.cancel` và `orders.auditHistory`; mọi request khác (ChatGPT, V2 checkout, website, Android `?route=android`) đi thẳng vào BotApi cũ, không bị đụng.

| Lệnh | Khóa gọi | Quyền cần |
|---|---|---|
| `orders.cancel` (HỦY = "Đã hủy", 0 đ, vẫn giữ hóa đơn) | khóa **GHI V2** | `orders:cancel` |
| `orders.delete` (XÓA = Thùng Rác 30 ngày) — đã có sẵn trong BotApi | khóa **GHI V2** | `orders:delete` |
| `orders.auditHistory` (chỉ đọc lịch sử) | khóa **ĐỌC V2** | `orders:read` **và** `"role":"owner"` |
| `debt.summary` (công nợ) — đã có sẵn trong BotApi | khóa **ĐỌC V2** | `debt:read` |
| `orders.previewUpdate` | — | **KHÔNG làm.** Cần `orders:update` trên khóa đọc → tuyệt đối không cấp. Tool Grok `satori_order_preview_update` tiếp tục báo thiếu quyền (fail closed) là đúng. |

> Không bước nào cần xem, chép hay gửi secret. Nếu màn hình đang hiện secret: không chụp, không dán vào chat.

---

## 1. Sao lưu (bắt buộc, không thay đổi gì)

1. **Triển khai (Deploy) → Quản lý triển khai (Manage deployments)**.
2. Tìm deployment **Web app** có URL trùng biến Render `SATORI_READ_ENDPOINT` / `SATORI_V2_CANONICAL_WRITE_ENDPOINT` (dạng `https://script.google.com/macros/s/.../exec`). **Ghi lại số Version hiện tại** (ví dụ `Version 20`) = điểm rollback. Có nhiều deployment thì chỉ ghi/sửa đúng cái Render đang gọi.
3. (Khuyên làm) **Tổng quan → Tạo bản sao (Make a copy)**: lưu toàn bộ code. Bản sao không mang Script Properties nên không lộ secret.

## 2. Kiểm tra trước

Trong Editor, Ctrl+F trên **toàn bộ** các file, tìm: `SatoriGrokLedgerApi`, `SatoriOrderCancel`, `SatoriOrderAuditHistory`, `GROK_LEDGER`.
Nếu đã có bất kỳ chuỗi nào → **dừng**, báo lại để đối chiếu.

## 3. Thêm file (chưa có tác dụng gì cho tới bước 6)

Nút **+** cạnh "Tệp" → **Tập lệnh (Script)**, đặt tên, dán **toàn bộ** nội dung từ GitHub (nhánh của PR):

| Tên file trên Editor | Dán từ |
|---|---|
| `BotApiOrderCancel` | `api/BotApiOrderCancel.gs` |
| `BotApiOrderAuditHistory` | `api/BotApiOrderAuditHistory.gs` |
| `BotApiGrokLedger` | `api/BotApiGrokLedger.gs` |
| `GrokLedgerScopesSetup` | `api/GrokLedgerScopesSetup.gs` (tạm, xóa ở bước 7) |

Lưu (Ctrl+S). Thứ tự file không quan trọng.

## 4. Thêm 1 dòng vào `doPost(e)`

Mở file có `function doPost(e){` (thường là `BotApi.gs`, ở cuối file). Thêm **đúng 1 dòng** làm dòng **đầu tiên** bên trong hàm, không sửa gì khác:

```js
function doPost(e){
  if(typeof SatoriGrokLedgerApi!=='undefined'){var grokLedger=SatoriGrokLedgerApi.tryHandle(e);if(grokLedger)return grokLedger;}
  ... (giữ nguyên toàn bộ nội dung cũ của doPost, kể cả nhánh route=android) ...
}
```

Lưu. Nếu Editor báo lỗi cú pháp → sửa đến hết lỗi, chưa deploy.

Vì sao an toàn: `tryHandle` trả `null` (= để BotApi cũ xử lý như hôm nay) khi request có `?route=`, không phải JSON, không phải 2 lệnh mới, hoặc công tắc chưa bật. Mọi lỗi ở bước phân loại cũng trả `null`.

## 5. Cấp quyền khóa trong Script Properties

Property: **`SATORI_BOT_CLIENTS_JSON`** (⚙ Cài đặt dự án → Thuộc tính tập lệnh). Cấu trúc:

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

- keyId khóa GHI V2 = biến Render **`SATORI_V2_CANONICAL_WRITE_KEY_ID`** (lúc tạo là `gemini_v2_writer_20261028`, đối chiếu lại trên Render).
- keyId khóa ĐỌC V2 = biến Render **`SATORI_READ_KEY_ID`**.
- keyId không phải secret. Secret nằm ở `SATORI_V2_CANONICAL_WRITE_SECRET` / `SATORI_READ_HMAC_SECRET` trên Render — không cần mở.
- Khóa ĐỌC chỉ thêm `debt:read` + `"role":"owner"`. **Tuyệt đối không** thêm `orders:update`, `orders:write`, `orders:delete`, `orders:cancel`, `payments:write`.
- Thêm `role` không ảnh hưởng gì tới BotApi cũ (BotApi không đọc trường này). Thêm `orders:cancel` cũng vậy (BotApi cũ không có lệnh dùng scope này). `debt:read` và `orders:delete` có hiệu lực ngay với lệnh cũ `debt.summary` / `orders.delete` — đó là đúng mục đích.

**Cách A (khuyên dùng)** — file `GrokLedgerScopesSetup`:
1. Điền 2 dòng đầu file: `SATORI_GROK_WRITER_KEY_ID='<SATORI_V2_CANONICAL_WRITE_KEY_ID>'`, `SATORI_GROK_READER_KEY_ID='<SATORI_READ_KEY_ID>'`. Lưu.
2. Chạy **`satoriGrokScopesCheck`**: nhật ký chỉ in `keyId enabled role secretLength scopes`. Xác nhận 2 keyId tồn tại.
3. Chạy **`satoriGrokScopesApply`** → kết quả `APPLY_DONE_BACKUP_IN_SATORI_BOT_CLIENTS_JSON_BACKUP_GROK_20261115`. Hàm tự sao lưu, chỉ đổi `scopes`/`role`, kiểm tra lại secret không đổi; **từ chối và không đổi gì** nếu: chưa điền keyId, 2 keyId trùng, không tìm thấy khóa, khóa đọc đã có quyền ghi (`READER_KEY_ALREADY_HAS_WRITE_SCOPE_STOP` → báo lại), hoặc đã có backup cũ.
4. Chạy lại **`satoriGrokScopesCheck`**: `secretLength` mọi khóa giống hệt bước 2.

**Cách B** — sửa tay property: chỉ thêm chuỗi scope vào mảng `"scopes"` và `,"role":"owner"` cho khóa đọc. Sai 1 dấu phẩy là mọi bot báo `AUTH_FAILED` → nên dùng Cách A.

## 6. Deploy phiên bản mới GIỮ NGUYÊN URL, rồi mới bật công tắc

1. **Triển khai → Quản lý triển khai** → chọn đúng deployment ở bước 1 → **bút chì (Chỉnh sửa)**.
2. **Phiên bản → Phiên bản mới**, mô tả `Grok ledger add-on (switch off)`. Không đổi "Thực thi với tư cách" / "Ai có quyền truy cập". **Triển khai**.
3. URL `.../exec` phải **giống hệt** trước. **Không** dùng "Tạo bản triển khai mới".
4. Kiểm tra hệ thống cũ vẫn chạy (công tắc đang tắt nên mọi thứ như hôm nay): mở web app, xem danh sách hóa đơn; trên Grok gọi `satori_system_status`.
5. **Bật công tắc**: ⚙ Cài đặt dự án → Thuộc tính tập lệnh → **Thêm thuộc tính** `SATORI_GROK_LEDGER_ENABLED` = `1` → Lưu. Có hiệu lực ngay, không cần deploy.

## 7. Kiểm tra sau khi bật (chỉ đọc)

Trên Grok (Render đã bật `GROK_OWNER_READS_ENABLED=1` hoặc `GROK_OWNER_WRITES_ENABLED=1`):

1. `satori_system_status` → có `ledgerRevision`.
2. `satori_debt_summary` → ra công nợ.
3. `satori_order_audit_history` với 1 số hóa đơn có thật → có `entries` (có thể rỗng nếu sổ chưa lưu lịch sử của hóa đơn đó — hệ thống không tự bịa).
4. `satori_order_preview_update` → **phải** báo khóa đọc chưa được cấp quyền. Nếu chạy được → báo lại ngay.
5. HỦY đơn thật chỉ làm khi chủ cửa hàng chọn hóa đơn cụ thể và đồng ý (request → "ok" → confirm). Logic HỦY đã test bằng sổ giả (`tests/bot-api-cancel-audit.cjs`).

Sau khi 1–4 đúng: chạy `satoriGrokScopesClearBackup`, rồi **xóa file `GrokLedgerScopesSetup`** (Lưu, không cần deploy lại).

## 8. Rollback (từ nhanh nhất)

| Tình huống | Cách làm | Thời gian |
|---|---|---|
| Có gì bất thường với HỦY / lịch sử | Đổi `SATORI_GROK_LEDGER_ENABLED` thành `0` (hoặc xóa property) | tức thì, không deploy |
| Muốn tắt hẳn Grok ghi | Render: `GROK_OWNER_WRITES_ENABLED=0` | vài phút |
| Muốn quay lại code cũ | Quản lý triển khai → bút chì → Phiên bản = **số đã ghi ở bước 1** → Triển khai (URL giữ nguyên) | 1 phút |
| Quyền khóa (Cách A, trước khi xóa backup) | Chạy `satoriGrokScopesRollback` → khôi phục nguyên văn property cũ | tức thì |
| Quyền khóa (đã xóa backup / Cách B) | Sửa tay: bỏ `orders:cancel`, `orders:delete` (nếu trước đó chưa có), `debt:read`, `"role":"owner"` | vài phút |

Rollback không hoàn tác dữ liệu: hóa đơn đã HỦY vẫn "Đã hủy" và vẫn có dòng trong `satori_order_cancel_audit_v1` (append-only, không ảnh hưởng tính toán). Muốn khôi phục một hóa đơn đã hủy, chủ cửa hàng đổi trạng thái trong app.
