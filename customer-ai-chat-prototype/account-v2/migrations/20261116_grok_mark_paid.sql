-- Additive, rerunnable; no ledger changes. Apply only after owner approval.
BEGIN;
ALTER TABLE satori_v2_grok_write_requests DROP CONSTRAINT IF EXISTS satori_v2_grok_write_requests_kind_check;
ALTER TABLE satori_v2_grok_write_requests ADD CONSTRAINT satori_v2_grok_write_requests_kind_check
 CHECK (kind IN ('cancel','trash','restore','update','undo','pay_customer_paid','pay_customer_unpaid',
                'pay_satori_paid','pay_satori_unpaid','mark_paid'));
COMMIT;
