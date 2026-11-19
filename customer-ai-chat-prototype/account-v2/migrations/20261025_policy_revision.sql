-- Isolated V2 pilot only; never modify Apps Script or existing invoice DB.
BEGIN;
ALTER TABLE IF EXISTS satori_v2_policies
 ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
COMMIT;
