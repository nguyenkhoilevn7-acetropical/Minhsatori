-- Account V2 isolated pilot ONLY. Do not run on Minh Satori ledger or Apps Script.
-- Apply to the dedicated V2 PostgreSQL DB if schema.sql was installed before
-- admin versioned-edit fields were introduced. Transaction is idempotent.
BEGIN;
ALTER TABLE IF EXISTS satori_v2_profiles
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS satori_v2_addresses
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
-- Fail if a wrong existing column type was silently accepted by the ADD IF NOT EXISTS.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema()
      AND table_name IN ('satori_v2_profiles','satori_v2_addresses')
      AND column_name='revision'
      AND data_type<>'integer'
  ) THEN RAISE EXCEPTION 'V2 revision schema mismatch';
  END IF;
END $$;
COMMIT;
