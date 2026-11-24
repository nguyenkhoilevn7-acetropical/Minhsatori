-- Additive V2-ONLY journal columns for reusing the EXISTING canonical invoice ledger.
-- Never run against Apps Script, Drive ledger, or a non-V2 PostgreSQL DB.
-- Requires isolated V2 backup/restore and migration approval before production.
ALTER TABLE satori_v2_order_requests
 ADD COLUMN IF NOT EXISTS canonical_intent jsonb NULL,
 ADD COLUMN IF NOT EXISTS ledger_invoice_id text NULL,
 ADD COLUMN IF NOT EXISTS ledger_invoice_total bigint NULL,
 ADD COLUMN IF NOT EXISTS submit_started_at timestamptz NULL,
 ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz NULL;

DO $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname='v2_canonical_intent_object'
 ) THEN
  ALTER TABLE satori_v2_order_requests
   ADD CONSTRAINT v2_canonical_intent_object
    CHECK(canonical_intent IS NULL OR jsonb_typeof(canonical_intent)='object');
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname='v2_canonical_total_nonnegative'
 ) THEN
  ALTER TABLE satori_v2_order_requests
   ADD CONSTRAINT v2_canonical_total_nonnegative
    CHECK(ledger_invoice_total IS NULL OR ledger_invoice_total BETWEEN 0 AND 100000000000);
 END IF;
END
$$;

-- One canonical invoice may never be assigned to two V2 checkout requests.
CREATE UNIQUE INDEX IF NOT EXISTS v2_canonical_invoice_unique_idx
 ON satori_v2_order_requests(ledger_invoice_no)
 WHERE ledger_invoice_no IS NOT NULL;

-- Historical isolated TEST records retain NULL canonical_intent; they cannot
-- be replayed through the writer. No existing invoice/history is modified.
