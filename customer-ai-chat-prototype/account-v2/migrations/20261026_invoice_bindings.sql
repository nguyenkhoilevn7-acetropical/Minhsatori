-- Explicit owner-verified invoice access, never inferred from names or phones.
CREATE TABLE IF NOT EXISTS satori_v2_invoice_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES satori_v2_accounts(id),
 legacy_id text NOT NULL UNIQUE,
 invoice_no bigint NOT NULL UNIQUE CHECK (invoice_no>0),
 verified_revision bigint NOT NULL CHECK (verified_revision>=0),
 verified_by uuid NOT NULL REFERENCES satori_v2_accounts(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS satori_v2_invoice_binding_account ON satori_v2_invoice_bindings(account_id,created_at);
