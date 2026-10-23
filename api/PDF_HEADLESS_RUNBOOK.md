# Minh Satori — automatic original PDF without opening website

Status: SOURCE + OFFLINE TESTS PREPARED, NOT YET LIVE. Do not claim a production PDF until Drive readback.

## Architecture
- The owner-installed Apps Script 1-minute trigger reads the authoritative Drive ledger. It queues only recently created invoices (within 7 days) whose current-version PDF is missing; deleted invoices are ignored.
- Apps Script sends an HMAC-signed HTTPS POST with just PDF fields to the existing private Render service. No order content is sent to Gemini.
- Render uses exact website PDF function bodies extracted from production index.html, pdfmake 0.2.10, Roboto, VietQR and the official Satori logo. There is NO alternate ReportLab template.
- Apps Script verifies current order, version key, SHA-256, header, size and owner before saving an idempotent private PDF to MinhSatori_PDF_Invoices.
- Afterward ChatGPT can fetch the genuine website-template PDF from Google Drive on request. A trigger is not an exact-minute delivery guarantee; a sleeping Render server may take longer.

## Code
- Render branch feature/headless-pdf-render-20261023: customer-ai-chat-prototype/original-website-pdf.mjs, original-pdf-gateway.mjs, server.mjs, package.json, Dockerfile and fake-only tests.
- Apps Script branch feature/headless-pdf-gas-20261023: api/InvoicePdfArchive.gs adds owner-trigger PDF receipt and pending discovery; api/PdfHeadlessSchedule.gs adds scheduled signed rendering. Existing BotApi.gs and state/ledger code remain untouched.

## Work Cloud Browser — final authenticated deployment ONLY (do not repeat code work)
1. Back up the CURRENT owner Apps Script source, current deployment version and ledger revision. Do NOT run setupDrive, overwrite Code.gs or replace live state with an old backup.
2. Install only the reviewed changes to InvoicePdfArchive.gs and add new PdfHeadlessSchedule.gs to the existing owner project Minh Satori Drive Sync. Leave website doGet bridge and BotApi doPost unchanged.
3. Review, merge and deploy the Render branch to service minh-satori-customer-ai-gemini after making a recovery checkpoint. It has autoDeploy OFF; use a controlled manual deploy. Until its environment key exists, the PDF endpoint returns 404.
4. Generate ONE unpredictable 48+ character HMAC secret in private Work/browser context, NEVER in chat, GitHub, screenshots or logs. Store same exact secret into Apps Script Script Property SATORI_PDF_RENDER_SECRET and Render Environment SATORI_PDF_RENDER_SECRET. This is independent from existing Bot API HMAC; never alter existing keys.
5. Run satoriPdfHeadlessPreflight() under owner account. Confirm it returns ok=true and current revision. Run satoriPdfHeadlessInstall() ONCE (one-minute clock trigger); do not create a duplicate trigger.
6. Verify old Render/Apps Script paths still work, confirm private PDF route rejects unsigned calls. Perform one separately authorized fake test invoice with website CLOSED; confirm original PDF appears on private Drive and matches invoice data, total, VAT and QR. Do not create test orders without owner's permission.
7. Verify repeat clock ticks do NOT create duplicate PDFs or mutate the ledger. On failure, disable new trigger and restore previous Render deploy; retain original website PDF bridge.

## Technical safeguards
- Clock trigger uses Session.getEffectiveUser, compared to OWNER_EMAIL, because there is no browser active user; installation/preflight requireOwner_ remain owner-interactive.
- Render HMAC covers timestamp, fresh nonce, version and JSON order SHA-256, with replay rejection and bounded payload.
- Apps Script rechecks current order/version under lock, PDF SHA and %PDF header, then idempotently stores the private file.
- Cannot be declared live based on GitHub CI alone. ChatGPT connectors cannot edit running Apps Script code / properties / install triggers, so the last authenticated UI deployment must be completed in Work.

No production bill or payment status is changed by the scheduler.
