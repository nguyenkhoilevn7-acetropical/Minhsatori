-- Grok owner writes = ChatGPT parity, using ONLY existing production BotApi actions:
-- trash/restore (orders.delete/restore), update/undo (orders.update/undoUpdate),
-- payments (payments.markCustomerPaid/Unpaid, markSatoriPaid/Unpaid).
-- Additive and idempotent: one nullable column + a wider kind list. 'cancel' stays
-- allowed so rows created before this change remain valid (no tool creates it anymore).
BEGIN;
ALTER TABLE satori_v2_grok_write_requests ADD COLUMN IF NOT EXISTS payload jsonb;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='satori_v2_grok_write_requests_kind_check'
            AND pg_get_constraintdef(oid) NOT LIKE '%pay_satori_unpaid%') THEN
  ALTER TABLE satori_v2_grok_write_requests DROP CONSTRAINT satori_v2_grok_write_requests_kind_check;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='satori_v2_grok_write_requests_kind_check') THEN
  ALTER TABLE satori_v2_grok_write_requests ADD CONSTRAINT satori_v2_grok_write_requests_kind_check
   CHECK (kind IN ('cancel','trash','restore','update','undo',
                   'pay_customer_paid','pay_customer_unpaid','pay_satori_paid','pay_satori_unpaid'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='satori_v2_grok_write_requests_payload_size') THEN
  ALTER TABLE satori_v2_grok_write_requests ADD CONSTRAINT satori_v2_grok_write_requests_payload_size
   CHECK (payload IS NULL OR length(payload::text) <= 30000);
 END IF;
END $$;
COMMIT;
