-- Grok soft cancel: owner asks Grok to cancel ONE invoice, confirms with "ok".
-- Additive only (no DROP/ALTER of existing objects). The ledger (Apps Script)
-- stays the invoice store; the cancel itself is status "Đã hủy" there, never a
-- delete. This table keeps the 30-minute request, the requestId used for the
-- idempotent orders.cancel, and the local audit (who confirmed, when, reason).
CREATE TABLE IF NOT EXISTS satori_v2_grok_cancel_requests (
 id uuid PRIMARY KEY,
 request_id text NOT NULL UNIQUE CHECK (request_id ~ '^[A-Za-z0-9_-]{8,100}$'),
 invoice_no bigint NOT NULL CHECK (invoice_no > 0),
 ledger_id text NOT NULL CHECK (length(ledger_id) BETWEEN 1 AND 80),
 expected_name text NOT NULL CHECK (length(expected_name) <= 200),
 expected_total numeric(16,2) NOT NULL CHECK (expected_total >= 0),
 reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
 summary text NOT NULL CHECK (length(summary) <= 4000),
 status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','submitting','cancelled','uncertain','rejected','expired')),
 requested_by text NOT NULL CHECK (length(requested_by) <= 80),
 confirmed_by text CHECK (confirmed_by IS NULL OR length(confirmed_by) <= 80),
 confirmed_at timestamptz,
 cancelled_at timestamptz,
 ledger_revision bigint,
 last_note text CHECK (last_note IS NULL OR length(last_note) <= 200),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS satori_v2_grok_cancel_requests_invoice
 ON satori_v2_grok_cancel_requests(invoice_no, created_at DESC);
