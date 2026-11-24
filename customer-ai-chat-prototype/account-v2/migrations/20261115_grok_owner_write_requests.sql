-- Grok owner write requests: cancel / trash / restore ONE invoice, each confirmed
-- by the owner's "ok". Additive only (no DROP/ALTER of existing objects).
-- The ledger (Apps Script) stays the invoice store:
--   cancel  -> status "Đã hủy" (row kept, counted as 0 đ by the app)
--   trash   -> existing 30-day trash bin (orders.delete), restorable
--   restore -> existing orders.restore from that trash bin
-- Never a hard delete. This table keeps the 30-minute request, the requestId
-- used for the idempotent ledger call, and the local audit (who, when, reason).
CREATE TABLE IF NOT EXISTS satori_v2_grok_write_requests (
 id uuid PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('cancel','trash','restore')),
 request_id text NOT NULL UNIQUE CHECK (request_id ~ '^[A-Za-z0-9_-]{8,100}$'),
 invoice_no bigint NOT NULL CHECK (invoice_no > 0),
 ledger_id text NOT NULL CHECK (length(ledger_id) BETWEEN 1 AND 80),
 expected_name text NOT NULL CHECK (length(expected_name) <= 200),
 expected_total numeric(16,2) NOT NULL CHECK (expected_total >= 0),
 reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
 summary text NOT NULL CHECK (length(summary) <= 4000),
 status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','submitting','done','uncertain','rejected','expired')),
 requested_by text NOT NULL CHECK (length(requested_by) <= 80),
 confirmed_by text CHECK (confirmed_by IS NULL OR length(confirmed_by) <= 80),
 confirmed_at timestamptz,
 done_at timestamptz,
 ledger_revision bigint,
 last_note text CHECK (last_note IS NULL OR length(last_note) <= 200),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS satori_v2_grok_write_requests_invoice
 ON satori_v2_grok_write_requests(invoice_no, created_at DESC);
