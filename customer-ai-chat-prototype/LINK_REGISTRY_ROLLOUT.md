# Minh Satori — Issued Links Drive Registry rollout

## Architecture

- Source: `api/BotApi.gs` on GitHub `main`, Google Apps Script project **Minh Satori Drive Sync**.
- Authoritative state: existing `STATE_FILE_ID` Drive state with `revision`, `values` and the new `satori_issued_links_v1` key.
- Backend: `customer-ai-chat-prototype` on Render `minh-satori-customer-ai-gemini`.
- **Never** use temporary Render disk, localStorage or sandbox backup for real issued links.
- Link directory records exclude the accessCode/PIN. The saved bearer URL is owner-only.

## Deployment dependency and safe order

1. Inspect existing production `BotApi.gs` against GitHub `main` (do not replace unrelated deployed fixes).
2. Make a complete code backup in the owner's existing Google Drive backup/archive workflow.
3. Merge only the new `links.list` and `links.register` Bot API read/write actions, plus their scope map and dispatch, from GitHub main. Retain existing HMAC keys, scopes, `STATE_FILE_ID`, `AccountingCore.gs`, and deployed services.
4. Save and deploy a **new version** of the existing production Apps Script deployment; do not create a new endpoint or keys.
5. Confirm `system.status` and catalog/CTV reads still work with the prior revision and unchanged invoice count; no invoice writes.
6. Verify a signed **owner writer** `links.list` returns `items:[]` (or existing rows), `total`, `hasMore`, and revision. Ordinary read keys MUST be forbidden. No production test record should be written.
7. Only then trigger a manual Render deploy from branch `prototype/customer-ai-gemini-free-20261020`; Render auto-deploy is off.
8. Check `GET /api/admin/real-links/readiness` (authenticated) has `registryReady:true`; same for CTV readiness.
9. In admin, open tab **Link đã cấp**, refresh; inspect existing link records. On a *real user-approved new issuance*, ensure `registrySaved:true`, then verify cross-device list and recipient details. Do not create fake production contacts/bills.
10. If the registry is not ready, do **not** claim the feature is LIVE; new issuance will reject rather than report a false save. Restore prior Render deploy only if necessary to recover the earlier issuance workflow, and never rollback the Drive state by overwriting it.

## Existing previously issued links

- **CTV:** link is deterministic for the current approved `collaboratorId + linkEpoch`; the owner can re-open the existing CTV policy and issue/re-save the *same* link (no new invoice) after registry launch. If linkEpoch changed, the old link is no longer valid.
- **Agency:** historical invite tokens were randomly sealed and never persisted, so an old URL cannot be recreated from the customer name alone. Previously issued agency URLs must be recovered from the owner's messages/records and safely reissued; do not invent prior URLs.
- All new registrations require the registry's Drive commit + independent readback before marking "saved".

## Security and testing

- Bot `links.list` and `links.register` use existing owner `orders:write` HMAC scope only.
- `links.register` uses the current `revision`, Drive prewrite backup, existing script lock, and readback. No orders are modified.
- The Render registry limits pagination and validates the link host; only account-admin bearer may list records.
- Run `node tests/satori-issued-links-registry.test.js` on repo main and `node tests/issued-links-directory.test.mjs` within `customer-ai-chat-prototype`. The Dockerfile enforces the latter during Render build.
