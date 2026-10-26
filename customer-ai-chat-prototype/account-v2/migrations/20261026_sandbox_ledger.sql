-- Synthetic reconciliation only. No canonical production ledger writes.
CREATE TABLE IF NOT EXISTS satori_v2_sandbox_receipts (
 invoice_id uuid PRIMARY KEY REFERENCES satori_v2_test_invoices(id),
 canonical_id text NOT NULL UNIQUE CHECK(canonical_id LIKE 'TEST-%'),
 invoice_number text NOT NULL UNIQUE CHECK(invoice_number LIKE 'TEST-%'),
 quote_digest text NOT NULL,
 receipt_digest text NOT NULL,
 paid_vnd bigint NOT NULL DEFAULT 0 CHECK(paid_vnd>=0),
 revision integer NOT NULL DEFAULT 1,
 pdf jsonb,
 verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS satori_v2_sandbox_commission_ledger (
 invoice_id uuid PRIMARY KEY REFERENCES satori_v2_sandbox_receipts(invoice_id),
 collaborator_account_id uuid NOT NULL REFERENCES satori_v2_accounts(id),
 amount_vnd bigint NOT NULL CHECK(amount_vnd>=0),
 basis text NOT NULL CHECK(basis='goods-only')
);
CREATE TABLE IF NOT EXISTS satori_v2_sandbox_payment_events (
 event_id uuid PRIMARY KEY,
 invoice_id uuid NOT NULL REFERENCES satori_v2_sandbox_receipts(invoice_id),
 event_digest text NOT NULL,
 previous_paid_vnd bigint NOT NULL,
 paid_vnd bigint NOT NULL,
 revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(invoice_id,revision)
);
