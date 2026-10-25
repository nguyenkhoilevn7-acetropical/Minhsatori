-- Minh Satori Account-Based Ordering V2.
-- NEW NAMESPACE ONLY. Never alters production invoices, BotApi.gs, CTV links
-- or current Apps Script STATE_FILE_ID. PostgreSQL 15+.
-- Database migrations must be applied to a NEW isolated database after backup.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS satori_v2_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 google_sub text NOT NULL UNIQUE,
 email text NOT NULL,
 display_name text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT v2_google_sub_valid CHECK (length(google_sub) BETWEEN 5 AND 256)
);
CREATE TABLE IF NOT EXISTS satori_v2_sessions (
 token_hash char(64) PRIMARY KEY,
 csrf_hash char(64) NOT NULL,
 account_id uuid NOT NULL REFERENCES satori_v2_accounts(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS satori_v2_sessions_account_idx ON satori_v2_sessions(account_id);

CREATE TABLE IF NOT EXISTS satori_v2_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES satori_v2_accounts(id) ON DELETE CASCADE,
 type text NOT NULL DEFAULT 'retail' CHECK (type IN ('retail','agency','collaborator')),
 display_name text NOT NULL DEFAULT '',
 phone text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,account_id)
);
CREATE INDEX IF NOT EXISTS satori_v2_profiles_account_idx ON satori_v2_profiles(account_id);

CREATE TABLE IF NOT EXISTS satori_v2_addresses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 profile_id uuid NOT NULL REFERENCES satori_v2_profiles(id) ON DELETE CASCADE,
 label text NOT NULL,
 recipient_name text NOT NULL,
 recipient_phone text NOT NULL,
 address text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,profile_id)
);
CREATE INDEX IF NOT EXISTS satori_v2_address_profile_idx ON satori_v2_addresses(profile_id);

CREATE TABLE IF NOT EXISTS satori_v2_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 profile_id uuid NOT NULL REFERENCES satori_v2_profiles(id) ON DELETE CASCADE,
 address_id uuid NULL,
 product_code text NULL,
 discount_bps integer NOT NULL CHECK (discount_bps BETWEEN 0 AND 10000),
 collaborator_bps integer NULL CHECK (collaborator_bps BETWEEN 0 AND 10000),
 invoice_mode text NOT NULL DEFAULT 'single' CHECK (invoice_mode IN ('single','pair')),
 enabled boolean NOT NULL DEFAULT true,
 version integer NOT NULL CHECK (version >= 1),
 valid_from timestamptz NULL,
 valid_until timestamptz NULL,
 approved_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT v2_pair_rate_required CHECK (invoice_mode = 'single' OR collaborator_bps IS NOT NULL),
 CONSTRAINT v2_policy_product CHECK (product_code IS NULL OR product_code ~ '^TP-[0-9]{5}$'),
 CONSTRAINT v2_policy_period CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from),
 CONSTRAINT v2_policy_address_fk FOREIGN KEY (address_id,profile_id)
   REFERENCES satori_v2_addresses(id,profile_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS satori_v2_policy_scope_version_idx ON satori_v2_policies (
 profile_id,COALESCE(address_id::text,''),COALESCE(product_code,''),version
);
CREATE INDEX IF NOT EXISTS satori_v2_policy_lookup_idx ON satori_v2_policies(profile_id,enabled,version DESC);

CREATE TABLE IF NOT EXISTS satori_v2_catalogue (
 code text PRIMARY KEY CHECK (code ~ '^TP-[0-9]{5}$'),
 name text NOT NULL,
 unit text NOT NULL,
 list_price bigint NOT NULL CHECK (list_price BETWEEN 0 AND 1000000000),
 revision integer NOT NULL CHECK (revision >= 1),
 active boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS satori_v2_carts (
 account_id uuid NOT NULL REFERENCES satori_v2_accounts(id) ON DELETE CASCADE,
 profile_id uuid NOT NULL,
 lines jsonb NOT NULL DEFAULT '[]'::jsonb,
 revision integer NOT NULL DEFAULT 1 CHECK (revision>=1),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,profile_id),
 FOREIGN KEY(profile_id,account_id) REFERENCES satori_v2_profiles(id,account_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS satori_v2_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES satori_v2_accounts(id),
 profile_id uuid NOT NULL,
 address_id uuid NOT NULL,
 payload jsonb NOT NULL,
 cart_revision integer NOT NULL,
 catalogue_revision integer NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(profile_id,account_id) REFERENCES satori_v2_profiles(id,account_id),
 FOREIGN KEY(address_id,profile_id) REFERENCES satori_v2_addresses(id,profile_id)
);
CREATE INDEX IF NOT EXISTS satori_v2_quote_account_idx ON satori_v2_quotes(account_id,created_at DESC);

CREATE TABLE IF NOT EXISTS satori_v2_order_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 quote_id uuid NOT NULL REFERENCES satori_v2_quotes(id),
 account_id uuid NOT NULL REFERENCES satori_v2_accounts(id),
 request_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'PENDING_INTEGRATION'
   CHECK (state IN ('PENDING_INTEGRATION','RELAY_PENDING','UNCERTAIN','COMMITTED','REJECTED')),
 ledger_invoice_no integer NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,request_id),
 UNIQUE(quote_id)
);
CREATE TABLE IF NOT EXISTS satori_v2_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id uuid NULL,
 actor text NOT NULL,
 event_type text NOT NULL,
 resource_id text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- No customer raw messages, OTPs, access codes, ID tokens or HMAC secrets in audit.
-- App DB role: least privilege; never use the Apps Script Drive credentials.
