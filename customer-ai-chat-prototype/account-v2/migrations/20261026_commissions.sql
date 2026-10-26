-- Additive V2-only migration. Existing invoices and quotes are never rewritten.
CREATE TABLE IF NOT EXISTS satori_v2_commission_grants (
 profile_id uuid PRIMARY KEY REFERENCES satori_v2_profiles(id),
 collaborator_account_id uuid NOT NULL REFERENCES satori_v2_accounts(id),
 enabled boolean NOT NULL DEFAULT true,
 collaborator_bps integer NOT NULL CHECK (collaborator_bps BETWEEN 0 AND 10000),
 customer_bps integer NOT NULL CHECK (customer_bps BETWEEN 0 AND 10000),
 min_customer_bps integer NOT NULL CHECK (min_customer_bps BETWEEN 0 AND 10000),
 max_customer_bps integer NOT NULL CHECK (max_customer_bps BETWEEN 0 AND 10000),
 revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (min_customer_bps<=customer_bps AND customer_bps<=max_customer_bps),
 CHECK (max_customer_bps<=collaborator_bps)
);
CREATE TABLE IF NOT EXISTS satori_v2_test_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL UNIQUE REFERENCES satori_v2_order_requests(id),
 account_id uuid NOT NULL REFERENCES satori_v2_accounts(id),
 collaborator_account_id uuid REFERENCES satori_v2_accounts(id),
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- No UPDATE API: corrections require a new test order, never rewrite snapshots.
CREATE TABLE IF NOT EXISTS satori_v2_test_settlements (
 invoice_id uuid PRIMARY KEY REFERENCES satori_v2_test_invoices(id),
 settled_by uuid NOT NULL REFERENCES satori_v2_accounts(id),
 settled_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS satori_v2_test_invoice_customer ON satori_v2_test_invoices(account_id,created_at);
CREATE INDEX IF NOT EXISTS satori_v2_test_invoice_ctv ON satori_v2_test_invoices(collaborator_account_id,created_at);
