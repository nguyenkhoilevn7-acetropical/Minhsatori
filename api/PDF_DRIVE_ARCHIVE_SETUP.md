# Minh Satori — archive exact website PDF to Google Drive (staged; NOT deployed)

## Architecture
1. The **existing website** `prepareInvoicePdf(order)` generates the exact pdfmake PDF (including the vector VietQR amount).
2. The website queues the order number/id locally (not PDF data or secrets). It waits until the owner-only Drive sync confirms the order is stored.
3. The Drive iframe parent accepts a PDF archive message only from the exact GitHub Pages origin and iframe window.
4. `satoriSaveInvoicePdf` checks the currently stored order against the PDF's canonical version key and total, verifies %PDF- and SHA-256, then saves the PDF to a private Drive folder. Same invoice/version reuses the same file.
5. ChatGPT can later find `MinhSatori_HD<number>_v<version>.pdf` on connected Drive, retrieve the original bytes, and attach the PDF. It must verify the newest order revision before presenting a prior file.

## Deployment checklist — existing Apps Script owner only
- The source in Google Drive named `MinhSatori_Drive_Sync_Code.gs` is a **past backup**. First inspect/backup the CURRENT live Apps Script project; never overwrite its current `Code.gs` from this repository.
- Add `api/InvoicePdfArchive.gs` as a **new** server file in the *same* Apps Script project as the working `requireOwner_()` and `readState_()`. Do not add another `doGet` or `doPost`.
- In Script Properties add `SATORI_PDF_ARCHIVE_FOLDER_ID` with the ID of the private `MinhSatori_PDF_Invoices` folder. Do not publish access to that folder or commit IDs/secrets to GitHub.
- In CURRENT `doGet()`, append `satoriPdfArchiveBridgeJs_(appOrigin)` **inside the existing HTML `<script>`** after its `const f=document.getElementById("app")` declaration. Preserve the existing `minhsatori-drive-v1` read/commit handler unchanged. The new bridge checks both the iframe source and origin.
- Reauthorize Apps Script if Google requests Drive scope changes, deploy a **new version** of the owner-only web app, and verify login still works.
- After Apps Script is live, merge the website branch (not before). Test a sandbox invoice through: save -> Drive sync -> PDF created -> Drive file readable -> QR amount scanned. Do not edit or create real invoices for tests.
- Backfill old bills separately in a rate-limited, explicitly approved process; this change archives only bills newly saved/edited while the authenticated Drive app is open. If archive fails, the browser queue persists and retries on reopening the app.

## Safety
- No public upload endpoint, public Drive link, secret, or independent PDF template.
- All data reads are read-only except writing a new PDF file to the archive folder.
- The archived PDF is a snapshot of its bill revision. If a bill changes, its next PDF has a new name and the older file is retained for audit.
- If the website stays closed, no browser-only renderer runs; an Apps Script/server renderer would be needed for guaranteed unattended all-bill backfill.
