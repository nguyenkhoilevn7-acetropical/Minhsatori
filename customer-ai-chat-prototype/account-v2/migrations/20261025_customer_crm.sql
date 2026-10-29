-- V2-only CRM extension. Never migrates Apps Script invoices or legacy /ctv links.
BEGIN;
ALTER TABLE satori_v2_accounts ADD COLUMN IF NOT EXISTS access_status text NOT NULL DEFAULT 'PENDING';
ALTER TABLE satori_v2_accounts ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='v2_account_access_state') THEN
  ALTER TABLE satori_v2_accounts ADD CONSTRAINT v2_account_access_state
   CHECK(access_status IN ('PENDING','ACTIVE','SUSPENDED','REMOVED'));
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS satori_v2_registrations(
 account_id uuid PRIMARY KEY REFERENCES satori_v2_accounts(id) ON DELETE RESTRICT,
 full_name text NOT NULL CHECK(length(trim(full_name)) BETWEEN 2 AND 120),
 phone text NOT NULL CHECK(length(phone) BETWEEN 9 AND 24),
 address text NOT NULL CHECK(length(trim(address)) BETWEEN 5 AND 400),
 company_name text NOT NULL DEFAULT '',
 tax_code text NOT NULL DEFAULT '',
 note text NOT NULL DEFAULT '',
 requested_type text NOT NULL DEFAULT 'retail'
  CHECK(requested_type IN ('retail','agency','collaborator')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 submitted_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz NULL,
 reviewed_by uuid NULL REFERENCES satori_v2_accounts(id)
);
CREATE TABLE IF NOT EXISTS satori_v2_customer_leads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 full_name text NOT NULL,
 email text NOT NULL DEFAULT '',
 phone text NOT NULL,
 address text NOT NULL,
 company_name text NOT NULL DEFAULT '',
 tax_code text NOT NULL DEFAULT '',
 note text NOT NULL DEFAULT '',
 requested_type text NOT NULL DEFAULT 'retail'
  CHECK(requested_type IN ('retail','agency','collaborator')),
 discount_bps integer NOT NULL DEFAULT 0 CHECK(discount_bps BETWEEN 0 AND 10000),
 collaborator_bps integer NULL CHECK(collaborator_bps BETWEEN 0 AND 10000),
 linked_account_id uuid NULL UNIQUE REFERENCES satori_v2_accounts(id),
 active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE satori_v2_customer_leads ADD COLUMN IF NOT EXISTS collaborator_bps integer NULL;
DO $ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='v2_lead_ctv_bps_range') THEN
  ALTER TABLE satori_v2_customer_leads ADD CONSTRAINT v2_lead_ctv_bps_range
   CHECK (collaborator_bps IS NULL OR collaborator_bps BETWEEN 0 AND 10000);
 END IF;
END $;
CREATE INDEX IF NOT EXISTS satori_v2_customer_leads_active_idx
 ON satori_v2_customer_leads(active,created_at DESC);
CREATE INDEX IF NOT EXISTS satori_v2_account_access_idx
 ON satori_v2_accounts(access_status,created_at DESC);
COMMIT;
