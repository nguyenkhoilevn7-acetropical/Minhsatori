-- Grok Phase B: owner order drafts awaiting the owner's 4-digit approval in Grok.
-- Additive and isolated. The ledger (Apps Script) remains the only invoice store;
-- this table holds the immutable priced draft, the hashed approval code and the
-- requestId used for exactly-once orders.create + readback.
CREATE TABLE IF NOT EXISTS satori_v2_grok_order_drafts (
 id uuid PRIMARY KEY,
 request_id text NOT NULL UNIQUE CHECK (request_id ~ '^[A-Za-z0-9_-]{8,100}$'),
 code_hash text NOT NULL CHECK (length(code_hash) = 64),
 code_attempts integer NOT NULL DEFAULT 0,
 customer_ref jsonb,
 order_payload jsonb NOT NULL,
 summary text NOT NULL CHECK (length(summary) <= 20000),
 status text NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft','submitting','committed','uncertain','rejected','cancelled')),
 invoice_no bigint CHECK (invoice_no IS NULL OR invoice_no > 0),
 ledger_id text CHECK (ledger_id IS NULL OR length(ledger_id) <= 80),
 last_note text CHECK (last_note IS NULL OR length(last_note) <= 200),
 expires_at timestamptz NOT NULL,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS satori_v2_grok_order_drafts_open
 ON satori_v2_grok_order_drafts(created_at) WHERE status IN ('draft','submitting','uncertain');
