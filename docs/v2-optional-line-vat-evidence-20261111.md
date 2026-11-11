# V2 optional line VAT PDF evidence — 2026-11-11

This is an **independent V2 patch**, not a V2 source-tree import into the VAT PR.
Apply `docs/v2-optional-line-vat-20261111.patch` to the V2 branch at base commit
`c08c38a2652fce9bc8cc50c806c15f1689e1de55`
(`origin/feat/grok-pdf-delivery-mcp-20261111` as inspected locally).
No production endpoint, Drive data, database, customer or messaging service was contacted.

## Actual renderer paths and version

- `customer-ai-chat-prototype/account-v2/local-invoice-read.mjs` obtains the signed exact current invoice and projects canonical fields.
- `customer-ai-chat-prototype/account-v2/local-invoice-pdf.mjs` validates and maps this projection. Its import resolves **one directory up** to the renderer below.
- `customer-ai-chat-prototype/original-website-pdf.mjs` is the actual pdfmake renderer. It identifies extraction source `ea7cdfb9b927c55114d3186b5ca8291b9350ebf6`, exports template version `SATORI_PDF_VIETQR_20261021`, and includes immutable `timestamp` in its fingerprint. That existing V2 timestamp format is preserved.
- There is no `account-v2/original-website-pdf.mjs` on the inspected V2 branch.

## Patch scope

The two projections preserve tax snapshots **only** for `vatMode: per_line`.
A shared validator checks exemption, custom/header fallback rate, VND half-up line tax,
line/aggregate mismatches and safe amounts. The renderer adds row annotations and a
mixed VAT summary label only in explicit per-line mode. Legacy definitions and keys
retain their original shape. No write API, quote pricing, order creation, flags,
archive/sending authorization or ledger policy changes are included.

## Verification (all synthetic and offline)

- `node --test account-v2/tests/*.test.mjs`: **PASS, 423/423**, including five added tests.
- Focused new plus existing V2 PDF tests: **PASS, 15/15**.
- Real PDF golden: pdfmake **0.2.10**, existing repository logo, fixed PDF creation
  time `2026-11-11T00:00:00.000Z`; unmodified renderer copied directly from the base
  commit and modified renderer produced **byte-for-byte equal** PDFs and equal
  version keys for the same legacy fake invoice.
- Golden size: **137125 bytes**; SHA-256:
  `1b807fc0d20da90d0c009a257721ab29edc0895b87f0b3ed5a0508aa53f34a65`.
  The permanent test asserts this fixed-clock golden.
- Real mixed PDF: goods **100015**, shipping **2000**, VAT **8001**, total **110016**;
  rows are 8%/8000, exempt 0%/0, and 10% of 5 VND rounded half-up to 1.
  `pdftotext` verifies row annotations, stored aggregate VAT and total; rendered
  PNG was visually inspected for table alignment, annotations, totals and QR.
- Incorrect line/aggregate VAT, missing required rate and invalid tax options fail
  before export; input fixture remains unchanged.

## Limits

This patch is prepared locally against the exact base above. It is not pushed,
merged, deployed or CI-verified remotely. Synthetic Node tests execute the real V2
renderer but do not establish current production deployment parity or authorize
invoice creation/PDF delivery. No Apps Script backup/version was created.
The V2 branch intentionally retains its existing immutable timestamp in the PDF
fingerprint; root website/archive compatibility keys do not gain that V2-only field.
