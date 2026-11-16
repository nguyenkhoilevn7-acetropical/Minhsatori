# Grok synthetic staging implementation plan

Goal: Deploy the existing V2 MCP handlers in ACE Tropical Staging using fake invoices only.
Architecture: production-snapshot BotApi in a VM, localhost disposable PostgreSQL, actual V2 RPC and HMAC transports. No external invoice transport or Zalo sender. This is test infrastructure, not a second official invoice ledger.

- [ ] Add fail-closed staging isolation tests, then an environment guard.
- [ ] Reuse the production BotApi test fixture and real PostgreSQL with existing request/confirm handlers.
- [ ] Run domain, migration, payment race, PDF queue and staging HTTP smoke tests.
- [ ] Deploy a separate free service from this branch; verify live readiness and MCP behavior.
- [ ] Record actual Grok selection, remaining live permissions, production approval and rollback.

Constraints: no merge, production deploy, real invoice change, real Zalo send, or production credentials. Owner confirmation remains mandatory for official writes. Staging contains public synthetic fixtures only and resets on restart.
