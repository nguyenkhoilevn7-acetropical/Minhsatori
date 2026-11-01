-- Optional owner-only FCM outbox. Isolated V2 namespace; no invoice writes.
-- Apply only after database backup and staging validation.
CREATE TABLE IF NOT EXISTS satori_v2_owner_push_devices (
 device_id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES satori_v2_accounts(id) ON DELETE CASCADE,
 session_hash char(64) NOT NULL REFERENCES satori_v2_sessions(token_hash) ON DELETE CASCADE,
 token text NOT NULL CHECK(length(token) BETWEEN 40 AND 4096),
 token_hash char(64) NOT NULL UNIQUE,
 enabled boolean NOT NULL DEFAULT true,
 registered_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS satori_v2_owner_push_active
 ON satori_v2_owner_push_devices(account_id) WHERE enabled=true;

CREATE TABLE IF NOT EXISTS satori_v2_owner_push_feed_state (
 feed text PRIMARY KEY CHECK(feed IN ('invoices','registrations')),
 initialized boolean NOT NULL DEFAULT false,
 last_checked_at timestamptz
);
CREATE TABLE IF NOT EXISTS satori_v2_owner_push_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('official_invoice_created','owner_registration_pending')),
 source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 160),
 invoice_no bigint CHECK(invoice_no IS NULL OR invoice_no>0),
 eligible boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,source_key)
);
CREATE INDEX IF NOT EXISTS satori_v2_owner_push_eligible_idx
 ON satori_v2_owner_push_events(created_at) WHERE eligible=true;

CREATE TABLE IF NOT EXISTS satori_v2_owner_push_deliveries (
 event_id uuid NOT NULL REFERENCES satori_v2_owner_push_events(id) ON DELETE CASCADE,
 device_id uuid NOT NULL REFERENCES satori_v2_owner_push_devices(device_id) ON DELETE CASCADE,
 attempts integer NOT NULL DEFAULT 0,
 retry_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,
 last_error_code text,
 PRIMARY KEY(event_id,device_id)
);
CREATE INDEX IF NOT EXISTS satori_v2_owner_push_retries
 ON satori_v2_owner_push_deliveries(retry_at) WHERE delivered_at IS NULL;
