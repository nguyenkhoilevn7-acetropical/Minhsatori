-- Owner PDF delivery queue for Grok (Zalo Desktop on the owner's computer).
-- Additive and isolated: one row per NEW verified canonical invoice, created by
-- the same relay that sends the owner push. No invoice or ledger writes.
CREATE TABLE IF NOT EXISTS satori_v2_owner_pdf_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_key text NOT NULL UNIQUE CHECK (length(source_key) BETWEEN 3 AND 160),
 invoice_no bigint NOT NULL CHECK (invoice_no > 0),
 ledger_id text NOT NULL CHECK (length(ledger_id) BETWEEN 1 AND 80),
 recipient_name text NOT NULL DEFAULT '' CHECK (length(recipient_name) <= 160),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
 attempts integer NOT NULL DEFAULT 0,
 last_note text CHECK (last_note IS NULL OR length(last_note) <= 200),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS satori_v2_owner_pdf_deliveries_pending
 ON satori_v2_owner_pdf_deliveries(created_at) WHERE status IN ('pending','failed');
