# orders.update rollout checkpoint — 2026-11-14

## Scope and invariants

Update GitHub PR #422, GitLab MCP !9 and Bridge !10, and the existing
`appgprj_6ad59503dcbc81919caa03822f4fcbdb` Site. No replacement production
Site or invoice ledger. Only `satori_orders_v15` is canonical. No production
invoice writes during acceptance, including #5993. Paid/settled and CTV paired
invoices remain protected. Preserve optional VAT, PDF paths and 20L retirement.

## Execution gates

1. Read exact heads and CI; inspect live API and existing Site source.
2. Back up the live Apps Script source before any editor changes.
3. Port only edit routes into live source; preserve unrelated live functions.
4. Exercise synthetic ledger tests and the existing isolated staging backend.
5. Verify trusted Owner/Admin role and dedicated `orders:update` credentials.
6. Deploy API, Bridge and MCP after staging acceptance, retaining service URLs.
7. Update and publish the existing Site, preserving audience and existing tools.
8. Verify capabilities, tools, PDF/VAT and both ChatGPT and Grok end to end.

## Verified in this session

- Live BotApi copied read-only; retirement helper is present; edit helpers absent.
- AST port succeeds, preserving unrelated live functions.
- Added call to existing `guardRetiredOrderEdit_` for HMAC edits. Previously the
  helper ran only through the owner-mobile entry point.
- 138 existing offline tests pass; 1 additional live-source test skips without
  an explicit source path. With the actual ported live source, all 11 targeted
  tests pass, including adding/increasing retired 20L rejection.
- Existing Site source now has an unenabled five-tool adapter, separate edit
  credentials, and three synthetic configuration/schema tests passing.
- No production source, environment flags, invoice or deployment changed.

## Outstanding gates

- Render reports both services belong to `ACE Tropical Staging`
  (`tea-dbnusqqjnfac73df60tg`), different from previously selected My Workspace.
  Its connector requires user confirmation before selecting that workspace.
- Staging HTTP acceptance, trusted edit credential provisioning, deployment,
  final-head CI, connector refresh and cross-client acceptance remain pending.

Do not equate local fake-ledger tests with deployed staging or client acceptance.
