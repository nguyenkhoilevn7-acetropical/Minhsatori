# Optional per-line VAT: release and rollback runbook (11/11/2026)

Status: TECHNICALLY READY FOR OWNER APPROVAL. Nothing below has been executed
in production. Each numbered gate needs its own explicit owner approval.

## What changes
- Default `vatMode=invoice` is unchanged: no new fields means the historic
  `vatAmount` contract, identical totals and identical PDF bytes.
- Optional `vatMode=per_line`: `vatExempt` > `items[i].vatRate` >
  `order.vatRate`; missing rate -> `VAT_RATE_REQUIRED`. Line VAT is
  half-up whole VND, summed once (`vatAmount`), `total = goods + shipping + vatAmount`.
  Errors: `VAT_MISMATCH`, `LINE_VAT_MISMATCH`, `VAT_RATE_REQUIRED`,
  `TOTAL_MISMATCH`, `REQUEST_ID_CONFLICT`, `PER_LINE_VAT_REQUIRED` (edit cannot
  silently drop per-line), `PER_LINE_VAT_NOT_SUPPORTED` (CTV pair orders).

## Integration order (verified with merge-base / SHAs)
1. `release/optional-vat-integration-20261111` -> `fix/android-invoice-notification-open-20261101`
   (contains #401 -> #407 -> #408, the live-parity fix, and the 5 Android-branch CI
   commits; merges cleanly). Close #401/#407/#408 as merged-through, and #403/#404
   as superseded (#408 already carries their code: `minsatari-runtime.mjs` is
   byte-identical to #404, `order-intake.mjs` is the corrected #403 version).
2. #409 -> `feature/account-based-ordering-v2-20261025` (the Render V2 branch;
   its old base `feat/grok-pdf-delivery-mcp-20261111` was merged as #406). Clean merge.

## Gate A: Apps Script (owner approval required)
The live project source has diverged from `api/BotApi.gs` (live-only `pdf.get`,
`orders.getExactBatch`, different `markPaid`/`paid`). NEVER push `api/BotApi.gs`
over it. Instead:
1. `clasp clone 1eNEyHXe891ziuT4UY9ij-FellKSZ7Psi8y-5q0O2aiRaOsTA5x-eXOZg` into an empty folder.
2. Backup: create an Apps Script version "Backup before optional VAT" (current
   newest is version 20; production web app deployment `AKfycbxGbnHe…` serves version 19).
3. `node api/tools/port-optional-vat-to-live.mjs BotApi.js BotApi.ported.js`
   (refuses if any target function differs from the pre-VAT base).
4. Run the VAT contract and Bot API suites against the ported file (see PR body).
5. Replace only `BotApi` content (Apps Script API `projects.updateContent`, other
   files byte-identical, order preserved), create a new version, point the
   production deployment to it.
- Rollback: point deployment `AKfycbxGbnHe…` back to version 19 (one API call);
  ledger data is untouched because old invoices carry no new fields.

## Gate B: V2 (Render `srv-dbeuv50m7kps73f6ac40`, autoDeploy off)
Merge #409, then trigger a deploy. Rollback: redeploy the previous live commit
(`8975151e`).

## Gate C: Android signed APK
Current production: v0.4.58 build 75. Release commit on the Android branch must
bump `versionCode 76 / versionName 0.4.59` AND `android/release-request.json`
together (repo tests require them equal; editing the request file triggers the
signed release workflow). Do not bump in the integration PR.

## Gate D: Grok/ChatGPT real order writes
`SATORI_ENABLE_WRITES` and `GROK_OWNER_WRITES_ENABLED` are read only by the
connector runtime (`connector/`), not by the V2 service. Their live values were
not readable from this session: UNKNOWN. Keep them unset until approved.
