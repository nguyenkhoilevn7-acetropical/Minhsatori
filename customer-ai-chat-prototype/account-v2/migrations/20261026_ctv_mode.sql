-- Existing grants retain behavior; owner may disable a CTV across all customers.
ALTER TABLE satori_v2_accounts ADD COLUMN IF NOT EXISTS ctv_enabled boolean NOT NULL DEFAULT true;
