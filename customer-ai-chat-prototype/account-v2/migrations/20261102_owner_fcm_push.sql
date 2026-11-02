-- Owner-only FCM device registry. No client may choose its owner identity.
-- Tokens identify one Firebase installation, never a financial authorization.
CREATE TABLE IF NOT EXISTS satori_v2_owner_push_devices (
    token_sha CHAR(64) PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES satori_v2_accounts(id) ON DELETE CASCADE,
    fcm_token TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'android',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT owner_push_platform CHECK (platform = 'android'),
    CONSTRAINT owner_push_token_len CHECK (length(fcm_token) BETWEEN 50 AND 4096)
);
CREATE INDEX IF NOT EXISTS satori_v2_owner_push_owner_idx
    ON satori_v2_owner_push_devices(account_id, last_seen_at DESC);

-- The canonical invoice number is the idempotency key, not a browser request.
-- Durable event staging avoids sending a push for quotes or unconfirmed orders.
CREATE TABLE IF NOT EXISTS satori_v2_owner_push_events (
    invoice_no BIGINT PRIMARY KEY CHECK (invoice_no > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0
);
