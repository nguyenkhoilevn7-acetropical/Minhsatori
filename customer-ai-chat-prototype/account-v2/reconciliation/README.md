# Offline customer review contract

`reviewCustomers` is a pure, non-deployed preparation tool. It consumes two explicitly supplied normalized snapshots; it never reads Production, writes a database, merges a profile, assigns a Google identity, or applies a discount. It is not an import API or an authentication layer. The caller must authorize the requested tenant before collecting either snapshot. Do not expose this module as an endpoint without real backend authorization tests.

Each row requires `tenantId`, stable source-local `id`, positive integer `revision`, `name`, `phone`, `kind` (`customer`, `agency`, `collaborator`), `addresses` (array of strings) and integer `discountBps` (0..10000). Optional `googleSub` is usable only with `googleVerified:true` from an independently verified identity source, never a customer-supplied claim. Legacy/SQL field mappings are not yet implemented and must preserve provenance and revisions.

The report contains source/target IDs, revisions and reason codes only. No raw names, contact data or Google subjects. Treat identifiers as private anyway. All results explicitly prohibit writes. Names alone never match. Vietnamese mobile normalization is intentionally narrow; landlines, foreign or malformed numbers remain unmatched for manual handling, not silently discarded from a production import. Shared phone numbers are not identity proof. Both source collisions and multiple target candidates require human review. Address arrays are compared without collapsing multiple addresses into one. Role and discount differences are flagged, never inherited automatically.

Before any future import: verified backup, canonical source snapshot/revision, admin-approved mapping per source row, exact target revision check, scoped account authorization, recorded address selection, independently approved policy version, and reversible audit record. Re-run conflict checks if either revision changed. Do not merge across tenants or infer Google subject from email, name or telephone.

Tests use fake data only: `node --test customer-ai-chat-prototype/account-v2/tests/customer-review.test.mjs`.
