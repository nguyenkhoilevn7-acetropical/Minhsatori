-- One verified Google account may own multiple ADMIN-APPROVED historical
-- delivery-point leads. Preserve each lead ID, revision, and account FK.
-- Additive, idempotent migration. No invoice/payment/commission writes.
BEGIN;
ALTER TABLE satori_v2_customer_leads
 DROP CONSTRAINT IF EXISTS satori_v2_customer_leads_linked_account_id_key;
CREATE INDEX IF NOT EXISTS satori_v2_customer_leads_linked_account_lookup_idx
 ON satori_v2_customer_leads(linked_account_id)
 WHERE linked_account_id IS NOT NULL;
COMMIT;
