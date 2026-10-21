# Minh Satori — archive exact website PDF to Google Drive (staged; NOT deployed)

## Architecture
1. The **existing website** `prepareInvoicePdf(order)` generates the exact pdfmake PDF (including the vector VietQR amount).
2. The website queues the order number/id locally (not PDF data or secrets). It waits until the owner-only Drive sync confirms the order is stored.
3. The Drive iframe parent accepts a PDF archive message only from the exact GitHub Pages origin and iframe window.
4. `satoriSaveInvoicePdf` checks the currently stored order against the PDF's canonical version key and total, verifies %PDF- and SHA-256, then saves the PDF to a private Drive folder. Same invoice/version reuses the same file.
5. ChatGPT can later find `MinhSatori_HD<number>_v<version>.pdf` on connected Drive, retrieve the original bytes, and attach the PDF. It must verify the newest order revision before presenting a prior file.

## Đường dẫn cần dùng
- Dự án Apps Script đang chạy (chỉ chủ sở hữu truy cập): https://script.google.com/d/1eNEyHXe891ziuT4UY9ij-FellKSZ7Psi8y-5q0O2aiRaOsTA5x-eXOZg/edit
- PDF folder của chủ sở hữu: https://drive.google.com/drive/folders/1Z_F4wGd-gtwyELxLCxE2N9NpObYZjR6f
- Pull request mã nguồn: https://github.com/nguyenkhoilevn7-acetropical/Minhsatori/pull/31

## Deployment checklist — existing Apps Script owner only
- The source in Google Drive named `MinhSatori_Drive_Sync_Code.gs` is a **past backup**. First inspect/backup the CURRENT live Apps Script project; never overwrite its current `Code.gs` from this repository.
- Add `api/InvoicePdfArchive.gs` as a **new** server file in the *same* Apps Script project as the working `requireOwner_()` and `readState_()`. Do not add another `doGet` or `doPost`.
- In Script Properties add `SATORI_PDF_ARCHIVE_FOLDER_ID` with the ID of the private `MinhSatori_PDF_Invoices` folder. Do not publish access to that folder or commit IDs/secrets to GitHub.
- In CURRENT `doGet()`, append `satoriPdfArchiveBridgeJs_(appOrigin)` **inside the existing HTML `<script>`** after its `const f=document.getElementById("app")` declaration. Preserve the existing `minhsatori-drive-v1` read/commit handler unchanged. The new bridge checks both the iframe source and origin.
  Example (the current parent HTML string already concatenates its existing handler):
  ```javascript
  // Keep the existing 'const f=...;let busy=...;window.addEventListener(...)' string:
  'const f=document.getElementById("app"); /* existing bridge unchanged */' +
  satoriPdfArchiveBridgeJs_(appOrigin) +
  '</script></body></html>';
  ```
  The comment is explanatory only. Do NOT replace or simplify the live handler shown in this example.
- Run `satoriPdfArchivePreflight()` once from the Apps Script editor. It must report `ok:true` and the intended private folder, and it does not write invoices.
- Reauthorize Apps Script if Google requests Drive scope changes, deploy a **new version of the EXISTING website web-app deployment**, with **Execute as: Me; Who has access: Only myself**. Verify the original website sign-in and Drive sync still work. Do NOT redeploy the separate Bot API as the website.
- In the new website page, save a new **sandbox/fake invoice in the sandbox dataset**, wait for synchronization and ensure the archive file appears. If no isolated state is available, do not create an arbitrary production test invoice just to validate this feature.
- After Apps Script is live, merge the website branch (not before). Test a sandbox invoice through: save -> Drive sync -> PDF created -> Drive file readable -> QR amount scanned. Do not edit or create real invoices for tests.
- Backfill old bills separately in a rate-limited, explicitly approved process; this change archives only bills newly saved/edited while the authenticated Drive app is open. If archive fails, the browser queue persists and retries on reopening the app.

## Safety
- No public upload endpoint, public Drive link, secret, or independent PDF template.
- All data reads are read-only except writing a new PDF file to the archive folder.
- The archived PDF is a snapshot of its bill revision. If a bill changes, its next PDF has a new name and the older file is retained for audit.
- If the website stays closed, no browser-only renderer runs; an Apps Script/server renderer would be needed for guaranteed unattended all-bill backfill.

## Trạng thái xác minh (21/10/2026)
- Mã nguồn và offline CI được kiểm tra trên PR #31; không có chứng cứ triển khai Apps Script production.
- Google Drive folder trống tại thời điểm kiểm tra.
- Connector Google Drive hiện tại chỉ hỗ trợ đọc/ghi file Drive, không có thao tác cập nhật `.gs` trong Apps Script project. Cần thao tác của chủ sở hữu qua giao diện Apps Script (hoặc một trình duyệt được chủ sở hữu ủy quyền) trước khi merge/deploy.
- Không thể coi chỉ có GitHub CI PASS là tính năng đã hoạt động end-to-end.
