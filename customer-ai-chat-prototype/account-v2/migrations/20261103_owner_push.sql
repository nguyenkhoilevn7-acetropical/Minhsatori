-- Owner-only FCM push outbox. Additive, isolated V2 tables; NO invoice writes.
-- Idempotent: safe to run from migrate.mjs and from the opt-in push bootstrap.
CREATE TABLE IF NOT EXISTS satori_v2_owner_push_devices (
 device_id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES satori_v2_accounts(id) ON DELETE CASCADE,
 -- Logout deletes the session row; the device subscription is removed with it.
 session_hash char(64) NOT NULL REFERENCES satori_v2_sessions(token_hash) ON DELETE CASCADE,
 token text NOT NULL CHECK (length(token) BETWEEN 40 AND 4096),
 token_hash char(64) NOT NULL UNIQUE,
 enabled boolean NOT NULL DEFAULT true,
 registered_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 last_error_code text
);
CREATE INDEX IF NOT EXISTS satori_v2_owner_push_devices_active
 ON satori_v2_owner_push_devices(account_id) WHERE enabled=true;

CREATE TABLE IF NOT EXISTS satori_v2_owner_push_feed_state (
 feed text PRIMARY KEY CHECK (feed IN ('invoices')),
 initialized boolean NOT NULL DEFAULT false,
 last_checked_at timestamptz,
 last_error_code text,
 backfill_next bigint,
 backfill_until bigint
);
ALTER TABLE satori_v2_owner_push_feed_state ADD COLUMN IF NOT EXISTS backfill_next bigint;
ALTER TABLE satori_v2_owner_push_feed_state ADD COLUMN IF NOT EXISTS backfill_until bigint;

-- One row per canonical invoice (invoiceNo|ledgerId): the stable event ID.
CREATE TABLE IF NOT EXISTS satori_v2_owner_push_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK (kind IN ('verified_new_invoice')),
 source_key text NOT NULL CHECK (length(source_key) BETWEEN 3 AND 160),
 invoice_no bigint NOT NULL CHECK (invoice_no > 0),
 eligible boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (kind, source_key)
);
CREATE INDEX IF NOT EXISTS satori_v2_owner_push_events_eligible
 ON satori_v2_owner_push_events(created_at) WHERE eligible=true;

CREATE TABLE IF NOT EXISTS satori_v2_owner_push_deliveries (
 event_id uuid NOT NULL REFERENCES satori_v2_owner_push_events(id) ON DELETE CASCADE,
 device_id uuid NOT NULL REFERENCES satori_v2_owner_push_devices(device_id) ON DELETE CASCADE,
 attempts integer NOT NULL DEFAULT 0,
 retry_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,
 last_error_code text,
 PRIMARY KEY (event_id, device_id)
);
CREATE INDEX IF NOT EXISTS satori_v2_owner_push_deliveries_due
 ON satori_v2_owner_push_deliveries(retry_at) WHERE delivered_at IS NULL;
