# Minsatari runtime staging notes

System name in this note: **Minsatari**. ChatGPT project label: **Minh Satori**. Repository: `nguyenkhoilevn7-acetropical/Minhsatori`. Existing action names and the ledger key `satori_orders_v15` are unchanged.

This file is source and test guidance only. It does not deploy a connector, set environment values, or enable writes.

## What is connected today

The installed connector `user-minh-satori` exposes six read-only tools: `satori_system_status`, `satori_customers_search`, `satori_products_search`, `satori_orders_list`, `satori_debt_summary`, and `satori_invoice_pdf`. It does not expose `satori_orders_create` or a Zalo send tool. Its host, deployment id, and version were not visible from the sanitized inventory, so they stay unknown.

The folder `minh-satori-grok-mcp` is an unconfigured local scaffold (HEAD `bf50f1b`, 9 Nov 2026). It advertises eight tools and posts `{method, args}` with a bearer token. That protocol is not the legacy HMAC Apps Script executor. No audited gateway URL is configured. Changing this repository does not change that scaffold and does not change the installed six-tool connector.

## Repo adapter

`connector/minsatari-runtime.mjs` is the repo-side entry for later staging:

- With write flags unset, `listRuntimeTools` returns the same six read names and no create, update, or Zalo tool.
- `satori_products_search` and `satori_invoice_pdf` match the live names, but this repository has no HMAC action for them. Calls fail closed with `CANONICAL_ACTION_ABSENT` instead of inventing rows or a PDF.
- The four HMAC reads that already exist in `connector/lib/satori.mjs` can be exercised only with an injected fake transport. A missing URL, key id, or secret fails closed with `UPSTREAM_NOT_CONFIGURED`.
- Order intake stays in `connector/order-intake.mjs`. A ready draft is submitted only by `submitOrderIntake`, which calls the existing `satori_orders_create` → `orders.create` tool. Both `SATORI_ENABLE_WRITES` and `GROK_OWNER_WRITES_ENABLED` must be the exact string `true`, and a trusted `authorizeWrite` callback must return `true` for that payload. The module refuses to call the process network if no fetcher is passed.
- HMAC `orders.update` is not registered. Owner mobile OAuth remains the only update path.
- `callBearerBridge` rejects an Apps Script `/exec` URL and then fails closed with `BEARER_BRIDGE_NOT_AUDITED`. It does not dispatch.
- `invoiceNotificationText` returns the invoice number and recipient name on two lines. It does not send Zalo or a PDF.

VAT defaults to invoice level for every row, including manual rows. A verified selected profile supplies its saved rate (including explicit 0), or an explicitly supplied invoice rate overrides it. Invoice VAT rounds half up once on the goods total. Missing policy is `VAT_RATE_REQUIRED`; manual entry never implies 0% and no missing rate implies 8%.

Only an explicit `vatMode: "per_line"` intake choice or an explicit line rate/exemption selects per-line mode. Each line then uses its custom rate first, otherwise the verified invoice fallback; an explicitly exempt line has zero VAT. Line calculations use integer basis points and VND half-up, and aggregate VAT is their sum. Provided line or aggregate amounts must agree, otherwise preparation fails with `LINE_VAT_MISMATCH` or `VAT_MISMATCH`. Exemption, explicit rate and confirmed amount survive the prepared canonical payload. The server normalizes an exempt line's stored rate to 0.

`vatMode` and the selected invoice rate appear in the review draft. They do not introduce a second API contract: invoice-mode `orders.create` sends only the aggregate `vatAmount` and omits order `vatRate` and all item tax fields. In the #407 canonical schema, a header `vatRate` means a per-line fallback, so it is sent only after intentional per-line selection. Per-line payloads send item `vatExempt`, `vatRate`, and `vatAmount`. Both modes preserve `deliveryNote` and the stable `requestId`. Missing product, quantity, recipient, price or required VAT policy stops the draft.

## Config names to stage later

Canonical HMAC connector, values stay in the trusted server environment:

- `SATORI_BOT_API_URL`
- `SATORI_BOT_KEY_ID`
- `SATORI_BOT_SECRET`
- `SATORI_ENABLE_WRITES`
- `GROK_OWNER_WRITES_ENABLED`

Bearer scaffold, still unaudited and not wired to HMAC:

- `SATORI_GATEWAY_URL`
- `SATORI_GATEWAY_TOKEN`
- `ENABLE_ORDER_WRITES`
- `ENABLE_ZALO_SEND`

Leave every write and Zalo flag unset. Do not point `SATORI_GATEWAY_URL` at the HMAC executor.

## How a later read-only check would work

After the owner places the HMAC variables in the trusted server environment, and only if they explicitly ask for a read, the existing client is `node api/bot-client.mjs system.status '{}'`. A live connection is real only when that call returns JSON `ok: true` and the revision and invoice count match the Drive ledger. This branch has not run that command. GitHub source does not prove which Apps Script deployment is live.

Offline checks for this branch:

```
node --test connector/tests/order-intake.test.mjs connector/tests/minsatari-runtime.test.mjs
node tests/per-line-vat.test.cjs
```

## Still required before any live create

- Owner approval to install a connector revision that is not the current six-tool server.
- An audited upstream for whichever transport will run: HMAC `orders.create` with `orders:write`, or a bearer gateway that understands per-line `vatRate` and `vatAmount`. The scaffold create schema does not include those fields.
- `SATORI_ENABLE_WRITES=true` and `GROK_OWNER_WRITES_ENABLED=true` set only on that approved host, plus a trusted per-call owner approval callback. A model argument is not approval.
- Read-only proof of the live deployment, then a separate decision to allow writes. Zalo sending stays out of scope.


## Offline reconciliation result (2026-11-11)

`node --test connector/tests/order-intake.test.mjs connector/tests/minsatari-runtime.test.mjs` covers invoice defaults for both catalogue/manual rows, explicit invoice rate and 0%, deliberate mixed per-line tax, exemption, VND half-up, missing policy, amount mismatch rejection, fake-ledger HMAC create/readback and duplicate retries. The missing-product fixture with `qty: 2` asserts `PRODUCT_NOT_FOUND`, not `QUANTITY_REQUIRED`. `deliveryNote` uses the existing #407 connector schema. All transports in these tests are injected fake fixtures. No environment values or live write flags are changed.
