# Invoice edits: implementation checkpoint, NOT deployed

## Delivered code

The existing `updateUnpaidOrder` path now also supports Owner/Admin HMAC clients. The sole invoice ledger remains `satori_orders_v15` on Drive; no database or second invoice ledger is introduced.

- Exact `orders.get`, `orders.previewUpdate`, `orders.update`, `orders.auditHistory` and `orders.undoUpdate` actions.
- `orders:update` is a dedicated HMAC scope, separate from creation. For all five new actions, the trusted `SATORI_BOT_CLIENTS_JSON` client must have `role: "owner"` or `role: "admin"`. Never accept role/actor from a request payload. Get/history need `orders:read` in addition to the configured role; preview/update/undo require `orders:update`.
- Read the invoice by number, resolve exact ID, preview the complete edited order, then update using the latest global revision, stable requestId, expected original name/total, explicit confirmation and reason. An ambiguous number fails closed.
- Explicit `priceMode: "inclusive" | "exclusive"`, header `vatRate`, optional `vatMode: "per_line"` and row rate/exemption/discount. Default mode is invoice VAT. Extended line amounts round once; inclusive VAT is gross minus rounded net. Input prices are retained separately from the effective stored net unit price, whose extension reconciles to the rounded net. `listPrice` retains the existing pre-VAT catalogue/accounting basis.
- Status, customer/Satori payment timestamps, invoice number, ID and original date remain unchanged. Paid/settled and paired CTV invoices remain protected; editing them is not supported by this change.
- Full private before/after snapshots, trusted actor, reason and revision are saved atomically with the edit. Verified pre-write backup and readback reuse the existing writer. Undo requires the exact saved postimage, a new requestId and explicit confirmation; any intervening change blocks it. Legacy audit entries without snapshots cannot be undone.
- Existing browser PDF recovery now includes MCP-edited invoices. The owner headless archive can regenerate a recently edited older invoice. Historical PDF files are retained; a new version key is generated. An update response is not proof that the PDF renderer has finished: verify `pdf.get` against the new current version before reporting PDF success.

## Verification performed

All tests use synthetic fixtures. Commands:

```sh
NODE_PATH=/tmp/satori-test-deps/node_modules node --test tests/*.cjs tests/*.test.js tests/*.test.mjs connector/tests/*.test.mjs
NODE_PATH=/tmp/satori-test-deps/node_modules node api/tools/port-order-updates-to-live.cjs <private-live-source> <private-new-source>
SATORI_TEST_BOT_SOURCE=<private-new-source> node --test tests/mcp-orders-update.test.cjs
```

The live Apps Script project was opened read-only and its BotApi source copied for offline comparison. AST comparison confirmed live auth, VAT normalizer and existing edit function match release `e8ab21c4`. The port tool preserves live-only scopes/actions and all unrelated functions. The edit suite also passed against that privately ported live source. No live source or private customer records are committed here.

PDF checks render actual pdfmake bytes: legacy fixtures remain byte-identical; an inclusive-price synthetic invoice shows net 1,370,370, VAT 109,630 and total 1,480,000. These are offline renderer checks, not a production PDF check.

## Remaining release gates

1. Review and merge the GitHub change into the current Android/API integration branch. Review the matching GitLab OAuth gateway change. No APK change or release is needed for the MCP tools themselves.
2. Obtain/verify the deployment configuration of the installed ChatGPT Bot MCP host. Editing `connector/lib/satori.mjs` does not publish or refresh an installed ChatGPT app.
3. Deploy and verify the companion authenticated bridge change. The actual bridge is Render `srv-dbok11e417fc738gg8b0`, branch `feat/minh-satori-read-bridge-20261109` in the same GitLab repository. Its companion change delegates edit actions to Apps Script using dedicated server-side `SATORI_V1_UPDATE_KEY_ID` / `SATORI_V1_UPDATE_SECRET` credentials and `BRIDGE_ENABLE_ORDER_UPDATES=true`; existing read credentials stay unchanged. Capability flags `ordersUpdate`, `revisionCAS`, `idempotentUpdate`, `preWriteBackup`, `editAuditSnapshots` are fetched from signed `orders.capabilities`, not inferred from environment flags. The local HTTP adapter integration test passes with synthetic responses. Do not spoof capability flags or point the bearer protocol at an Apps Script `/exec` URL.
4. Test the deployed API/bridge and both MCP clients against an isolated staging ledger, including OAuth scope grant, request replay/conflict, paid protection, PDF readback and unrelated-record invariance. Local fake HTTP tests do not replace staging.
5. Refresh and back up all current Apps Script files. Port with `api/tools/port-order-updates-to-live.cjs`; never replace live BotApi with repository BotApi, because live has extra PDF/exact-read/payment actions. Port `InvoicePdfArchive.gs` changes separately after comparing its live source. Preserve all other files, functions, deployment IDs and script properties.
6. Configure the existing dedicated Owner/Admin MCP client(s) for the new scope, deploy the API and authenticated upstream bridge, publish/reload ChatGPT tool schemas and deploy Grok. Grok `ENABLE_ORDER_UPDATES` defaults false; turn it on only after the verified bridge and API are ready. Existing OAuth clients need an explicit write grant before edit tools appear.
7. Re-read the owner's specifically authorized target invoice immediately before preview/commit. Verify exact invoice ID/customer/product/address/payment, use the current revision and retain the same requestId on retries. Do not use that invoice to test. Verify persisted totals, payment unchanged, new PDF version and every unrelated invoice unchanged after commit.

## Observed access and blockers

- Production Bot API read access worked. No production invoice was modified.
- Grok `/healthz` reported upstream configured and write disabled. That health response does not verify upstream edit support or OAuth write access.
- The separate bridge service and deployment branch were identified and the edit adapter was implemented/tested as a companion GitLab change; it has not been deployed.
- Render reported the V2 PostgreSQL instance available. A read-only schema query was rejected because its external IP allowlist is empty. No networking or database permissions were changed. PostgreSQL schema has not been directly verified in this session.
- No Apps Script deployment, live property change, MCP publication, staging deployment, production edit, PDF/Zalo send, or Android release was performed.
- Owner's target invoice remains pending the release gates. No replacement invoice was created.
