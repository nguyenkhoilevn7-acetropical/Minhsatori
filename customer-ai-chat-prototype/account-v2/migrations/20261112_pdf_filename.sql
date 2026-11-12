-- Additive owner-only PDF delivery metadata, never ledger or PDF content.
ALTER TABLE satori_v2_owner_pdf_deliveries
 ADD COLUMN IF NOT EXISTS order_date text;
