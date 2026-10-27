# Controlled credential rotation — plan only

No credential values belong in this document. No existing key has been replaced or revoked by this checkpoint.

## Inventory from the reported exposure

Treat the original five Apps Script HMAC client secrets displayed in tool output as exposed, even though no misuse has been observed. Recheck exact client IDs and scopes privately before action; never render Script Properties in a screenshot or log. Known consumers include Minh Satori Bot, Gemini read-only, Gemini owner writer, collaborator approval and collaborator writer. Inventory all Render, Android/mobile, Apps Script, external connector and owner-managed consumers; unknown consumer means do not revoke yet. The dedicated `v2_catalogue_read_20261027` was created later and was not printed; it is separate from the original incident.

Map each old key ID to owner, consumer location, last successful request time, exact action scopes, enabled state, replacement ID, update confirmation and rollback expiry. Do not infer that a similarly named client belongs to a particular deployed service. Store this inventory privately without secret values. Configuration backups containing old secrets must stay private and be included in the later retention/revocation plan; rotating the live value does not remove historical copies.

## Rollout per client, never all at once

1. Capture current JSON/config and verify a private recoverable backup and consumer inventory. Preserve every unrelated client entry byte-for-byte where possible and all effective scopes.
2. At explicit security-access approval, provision a parallel replacement client with a unique key ID and exactly the required scopes. Do not broaden scopes. Existing key remains valid during the bounded migration window. Changing an existing credential through browser requires owner handoff under browser policy; do not perform it implicitly.
3. Move one verified consumer using its secure configuration interface. Never paste credentials in chat/GitHub, command arguments, build output or reports. Verify key-ID-only diagnostics.
4. Test valid signing, bad signature, expired timestamp and missing permission on safe read requests. For write-capable clients, use synthetic sandbox credentials and fixtures to validate write contracts; production read success alone does not prove production write behavior. User approval is required before any actual production write test.
5. Observe remaining traffic by key ID only. Once all consumers are confirmed migrated, disable the old ID without removing its metadata. Verify no unexpected AUTH_FAILED, EXPIRED or FORBIDDEN increase. Revocation is a separate recorded action.
6. On failures, restore the consumer's known-good configuration and temporarily re-enable old ID only within the approved window. Record the incident and narrow the rollback deadline; do not leave exposed old keys enabled indefinitely.
7. Finish with replacement verification, old-key revocation, private backup retention review and redacted evidence on Drive. New key recovery material belongs in the owner's secret store, not alongside encrypted DB backups.

Current result: planning completed; rotation and consumer cutover NOT executed. All original consumers preserved.
