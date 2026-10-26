-- Isolated adapter exercise. Never dispatches a production order.
CREATE TABLE IF NOT EXISTS satori_v2_sandbox_outbox (
 invoice_id uuid PRIMARY KEY REFERENCES satori_v2_test_invoices(id),
 idempotency_key text NOT NULL UNIQUE,
 quote_digest text NOT NULL,
 state text NOT NULL CHECK(state IN ('READY','ATTEMPTED','UNCERTAIN','VERIFIED')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 1),
 updated_at timestamptz NOT NULL DEFAULT now()
);
