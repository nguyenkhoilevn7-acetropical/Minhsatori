# Deploy Apps Script cho Grok ledger tools: HỦY đơn + lịch sử hóa đơn

Áp dụng cho PR tiếp nối #428. Người thao tác: chủ cửa hàng (hoặc người được chủ giao), trên **Apps Script Editor** của project **Minh Satori Drive Sync** (project chứa `BotApi.gs`, `readState_()`).

Kết quả sau khi làm xong:

| Lệnh Bot API | Khóa nào gọi | Quyền cần |
|---|---|---|
| `orders.cancel` (HỦY = trạng thái "Đã hủy", 0 đ, vẫn giữ hóa đơn) | khóa **GHI V2** | `orders:cancel` |
| `orders.delete` (XÓA = vào Thùng Rác 30 ngày) — đã có sẵn | khóa **GHI V2** | `orders:delete` |
| `orders.auditHistory` (chỉ đọc lịch sử) | khóa **ĐỌC V2** | `orders:read` **và** `"role":"owner"` |
| `debt.summary` (công nợ) — đã có sẵn | khóa **ĐỌC V2** | `debt:read` |
| `orders.previewUpdate` | — | **KHÔNG làm.** Lệnh này cần `orders:update` trên khóa đọc; tuyệt đối không cấp. Tool `satori_order_preview_update` của Grok sẽ tiếp tục báo "chưa được cấp quyền" (fail closed) — đó là đúng. |

> Không có bước nào cần xem, chép hay gửi secret. Nếu màn hình nào đang hiện secret, **không chụp màn hình, không dán vào chat**.

---

## 0. Cảnh báo quan trọng: KHÔNG dán đè cả file BotApi.gs

`api/BotApi.gs` trên nhánh `feature/account-based-ordering-v2-20261025` **không phải** bản đang chạy trên production (bản trên `main` khác nhiều, và production có thể có thêm lệnh không nằm trong GitHub, ví dụ `orders.update`, `orders.getExactBatch`). Dán đè cả file có thể **làm mất lệnh đang chạy** (ChatGPT, Android, V2 checkout).

Vì vậy: chỉ **thêm 3 file mới** và **sửa tay 6 chỗ nhỏ** trong `BotApi.gs` đang có trên Editor, theo đúng mục 3.

---

## 1. Sao lưu trước khi làm (bắt buộc)

1. Mở Apps Script Editor của project → **Triển khai (Deploy) → Quản lý triển khai (Manage deployments)**.
2. Tìm deployment **Web app** có URL trùng với biến môi trường Render `SATORI_READ_ENDPOINT` / `SATORI_V2_CANONICAL_WRITE_ENDPOINT` (dạng `https://script.google.com/macros/s/.../exec`). **Ghi lại số phiên bản (Version) hiện tại**, ví dụ `Version 20`. Đây là điểm rollback.
   - Nếu có nhiều deployment (ví dụ một cái cho web app, một cái cho Bot API), chỉ ghi và chỉ sửa đúng cái mà Render đang gọi.
3. Bên trái bấm **Lịch sử phiên bản (Project history)** → xác nhận phiên bản ở bước 2 tồn tại.
4. (Khuyên làm) **Tổng quan → Tạo bản sao (Make a copy)** để có bản lưu toàn bộ code. Bản sao **không** mang theo Script Properties, nên không lộ secret.

## 2. Kiểm tra trước: đã có sẵn chưa?

Trong file `BotApi.gs` trên Editor, bấm Ctrl+F lần lượt tìm:

- `orders.cancel` · `SatoriOrderCancel` · `orders.auditHistory` · `OWNER_ROLE_ACTIONS`

Nếu **đã có** bất kỳ chuỗi nào → **dừng lại**, báo lại (production đã có bản khác, cần đối chiếu trước khi sửa).
Tìm thêm `orders.previewUpdate`: nếu production đã có lệnh này thì **không đụng tới nó**, và vẫn không cấp `orders:update` cho khóa đọc.

## 3. Thêm file và sửa BotApi.gs

### 3.1 Thêm 3 file mới (nút **+** cạnh "Tệp" → **Tập lệnh / Script**)

| Tên file trên Editor (Apps Script tự thêm `.gs`) | Dán toàn bộ nội dung từ GitHub |
|---|---|
| `BotApiOrderCancel` | `api/BotApiOrderCancel.gs` |
| `BotApiOrderAuditHistory` | `api/BotApiOrderAuditHistory.gs` |
| `GrokLedgerScopesSetup` | `api/GrokLedgerScopesSetup.gs` (chỉ dùng ở mục 4, xóa sau khi xong) |

Thứ tự file không quan trọng: `BotApi.gs` chỉ gọi tới `SatoriOrderCancel` / `SatoriOrderAuditHistory` lúc có request; thiếu file thì lệnh trả `CONFIG_MISSING`, không ghi gì.

### 3.2 Sửa `BotApi.gs` đúng 6 chỗ

Code production có thể dài hơn bản dưới đây; chỉ cần chèn **đúng đoạn được tô** vào **đúng vị trí** mô tả.

**(1) SCOPES** — trong khối `var SCOPES={ ... };`, thêm 2 dòng ngay trước dấu `};` đóng khối (nhớ dấu phẩy ở dòng phía trên):

```js
 'orders.cancel':'orders:cancel','orders.auditHistory':'orders:read'};
```

**(2) Danh sách lệnh cần role owner** — ngay dưới dòng `};` của SCOPES, thêm:

```js
// Actions that ALSO require client.role==='owner' in SATORI_BOT_CLIENTS_JSON (scope alone is not enough).
var OWNER_ROLE_ACTIONS={'orders.auditHistory':true};
```

**(3) Trong `function auth(o)`** — ngay dưới dòng có `client.scopes.includes(SCOPES[o.action]),'FORBIDDEN'`, thêm:

```js
 need(!OWNER_ROLE_ACTIONS[o.action]||client.role==='owner','FORBIDDEN','Bot không có quyền');
```

và sửa dòng `return` cuối hàm `auth` thành (thêm `,keyId:o.keyId`):

```js
 return {action:o.action,payload:p,nonce:o.keyId+':'+o.nonce,keyId:o.keyId};
```

**(4) Trong `function read(s,action,p)`** — ngay dưới dòng `var all=rows(s);`, thêm:

```js
 if(action==='orders.auditHistory'){
  need(typeof SatoriOrderAuditHistory!=='undefined','CONFIG_MISSING','Thiếu BotApiOrderAuditHistory.gs');
  return SatoriOrderAuditHistory.read(s,all,p);
 }
```

**(5) `function write(...)`** — đổi dòng khai báo thành có thêm tham số `actor`, thêm 1 dòng kiểm tra, và chèn nhánh `orders.cancel` **ngay sau** `var all=rows(s),result=`:

```js
function write(s,action,p,actor){
 if(action==='orders.cancel')need(typeof SatoriOrderCancel!=='undefined','CONFIG_MISSING','Thiếu BotApiOrderCancel.gs');
 var all=rows(s),result=action==='orders.cancel'?SatoriOrderCancel.cancel(s,all,p,actor):
  ... (giữ nguyên toàn bộ phần còn lại của chuỗi điều kiện đang có) ...
```

(Trong PR, nhánh này nằm sau `orders.delete`; vị trí trong chuỗi `?:` không quan trọng, miễn là đứng **trước** nhánh mặc định cuối cùng — nhánh thanh toán.)

**(6) `function handle(e)`** — trong biểu thức `isWrite=...`, thêm `identity.action==='orders.cancel'||` ngay sau `isWrite=`; và ở dòng gọi `write(...)` thêm tham số actor:

```js
   var s=state(),isWrite=identity.action==='orders.cancel'||identity.action==='...giữ nguyên các lệnh cũ...';
   var result=isWrite?write(s,identity.action,identity.payload,'botapi:'+identity.keyId):{revision:s.revision,data:read(s,identity.action,identity.payload)};
```

Các chỗ khác gọi `write(s,action,p)` (ví dụ `ownerMobileWrite` của Android) **giữ nguyên**: Android không được phép gọi `orders.cancel`.

Bấm **Lưu (Ctrl+S)**. Nếu Editor báo lỗi cú pháp → sửa đến khi hết lỗi, **chưa deploy**.

## 4. Cấp quyền cho khóa trong Script Properties

Property: **`SATORI_BOT_CLIENTS_JSON`** (Cài đặt dự án ⚙ → Thuộc tính tập lệnh / Script Properties). Cấu trúc:

```json
{
  "<keyId khóa GHI V2>": {"enabled": true, "secret": "<GIỮ NGUYÊN, KHÔNG ĐỤNG>",
                          "scopes": ["orders:read", "orders:write", "orders:cancel", "orders:delete"]},
  "<keyId khóa ĐỌC V2>": {"enabled": true, "secret": "<GIỮ NGUYÊN, KHÔNG ĐỤNG>",
                          "scopes": ["orders:read", "...scopes đang có...", "debt:read"],
                          "role": "owner"},
  "...các khóa khác": "GIỮ NGUYÊN"
}
```

- keyId khóa GHI V2 = giá trị biến Render **`SATORI_V2_CANONICAL_WRITE_KEY_ID`** (lúc tạo là `gemini_v2_writer_20261028` — đối chiếu lại trên Render).
- keyId khóa ĐỌC V2 = giá trị biến Render **`SATORI_READ_KEY_ID`**.
- keyId **không phải** secret; secret nằm ở `SATORI_V2_CANONICAL_WRITE_SECRET` / `SATORI_READ_HMAC_SECRET` trên Render — không cần mở.
- Khóa ĐỌC: **chỉ thêm** `debt:read` và `"role":"owner"`. **Tuyệt đối không** thêm `orders:update`, `orders:write`, `orders:delete`, `orders:cancel`, `payments:write`.

### Cách A (khuyên dùng): chạy hàm trong `GrokLedgerScopesSetup.gs`

Hàm này tự sao lưu, chỉ đổi `scopes`/`role`, kiểm tra lại secret không đổi, và không bao giờ in secret.

1. Mở file `GrokLedgerScopesSetup`, điền 2 dòng đầu:
   ```js
   var SATORI_GROK_WRITER_KEY_ID='<SATORI_V2_CANONICAL_WRITE_KEY_ID>';
   var SATORI_GROK_READER_KEY_ID='<SATORI_READ_KEY_ID>';
   ```
   Lưu.
2. Chọn hàm **`satoriGrokScopesCheck`** → **Chạy**. Nhật ký chỉ in `keyId enabled role secretLength scopes`. Xác nhận đúng 2 keyId tồn tại.
3. Chọn **`satoriGrokScopesApply`** → **Chạy**. Kết quả đúng: `APPLY_DONE_BACKUP_IN_SATORI_BOT_CLIENTS_JSON_BACKUP_GROK_20261115`. Hàm **từ chối và không đổi gì** nếu: chưa điền keyId, 2 keyId trùng nhau, không tìm thấy khóa, khóa đọc đang có sẵn quyền ghi (`READER_KEY_ALREADY_HAS_WRITE_SCOPE_STOP` → báo lại, không tự xử lý), hoặc đã có bản sao lưu từ lần trước.
4. Chạy lại **`satoriGrokScopesCheck`**: khóa ghi có `orders:cancel,orders:delete`; khóa đọc có `debt:read` và `role=owner`; `secretLength` của mọi khóa **giống hệt** bước 2.

### Cách B: sửa tay

Bấm **Chỉnh sửa** property `SATORI_BOT_CLIENTS_JSON`, chỉ thêm các chuỗi scope vào mảng `"scopes"` và thêm `,"role":"owner"` vào object khóa đọc. Không sửa ký tự nào khác. Rủi ro: JSON sai một dấu phẩy là **mọi** bot báo `AUTH_FAILED` → nên dùng Cách A.

## 5. Deploy phiên bản mới, GIỮ NGUYÊN URL

1. **Triển khai → Quản lý triển khai**.
2. Chọn đúng deployment đã ghi ở mục 1 → bấm biểu tượng **bút chì (Chỉnh sửa)**.
3. Ô **Phiên bản** → chọn **Phiên bản mới (New version)**. Mô tả: `Grok ledger: orders.cancel + orders.auditHistory`.
4. Không đổi "Thực thi với tư cách" và "Ai có quyền truy cập". Bấm **Triển khai**.
5. URL `.../exec` **phải giống hệt** trước. **Không** dùng "Tạo bản triển khai mới (New deployment)" — làm vậy sinh URL mới và Render sẽ vẫn gọi bản cũ.

Lưu ý: Script Properties (mục 4) có hiệu lực ngay, kể cả với phiên bản cũ; code mới (mục 3) chỉ có hiệu lực sau bước 5.

## 6. Kiểm tra sau deploy (chỉ đọc)

Trên Grok (connector "Minh Satori PDF Zalo-xai", Render đã bật `GROK_OWNER_READS_ENABLED=1` hoặc `GROK_OWNER_WRITES_ENABLED=1`):

1. `satori_system_status` → có `ledgerRevision`, số hóa đơn.
2. `satori_debt_summary` → ra công nợ (trước đây báo thiếu quyền `debt.summary`).
3. `satori_order_audit_history` với 1 số hóa đơn có thật → trả danh sách `entries` (có thể rỗng nếu hóa đơn chưa có lịch sử lưu trong sổ — đó là đúng, hệ thống không tự bịa lịch sử).
4. `satori_order_preview_update` → **phải** báo "Khóa đọc V2 chưa được cấp quyền orders.previewUpdate". Nếu nó chạy được → báo lại ngay (có nghĩa khóa đọc đang có `orders:update`).
5. HỦY đơn thật: chỉ làm khi chủ cửa hàng chọn một hóa đơn cụ thể và đồng ý (request → "ok" → confirm). Toàn bộ logic HỦY đã được test bằng sổ giả (`tests/bot-api-cancel-audit.cjs`).

Sau khi 1–4 đúng: chạy `satoriGrokScopesClearBackup` rồi **xóa file `GrokLedgerScopesSetup`** khỏi project (Lưu, không cần deploy lại).

## 7. Rollback

| Muốn quay lại | Cách làm |
|---|---|
| Code (mục 3) | **Triển khai → Quản lý triển khai → bút chì** trên đúng deployment → ô Phiên bản chọn **số phiên bản đã ghi ở mục 1** → Triển khai. URL giữ nguyên. |
| Quyền khóa (mục 4, Cách A) | Chạy `satoriGrokScopesRollback` (chỉ còn dùng được trước khi chạy `satoriGrokScopesClearBackup`): khôi phục đúng nguyên văn property cũ. |
| Quyền khóa (Cách B / đã xóa backup) | Sửa tay `SATORI_BOT_CLIENTS_JSON`: bỏ `orders:cancel`, `orders:delete` (nếu trước đó khóa ghi chưa có), `debt:read` và `"role":"owner"` của khóa đọc. Hoặc tắt nhanh ở Render: `GROK_OWNER_WRITES_ENABLED=0`. |

Rollback **không** hoàn tác dữ liệu: hóa đơn đã HỦY vẫn ở trạng thái "Đã hủy" và vẫn có dòng trong `satori_order_cancel_audit_v1` (append-only, không ảnh hưởng tính toán). Muốn khôi phục một hóa đơn đã hủy, chủ cửa hàng đổi trạng thái trong app.
