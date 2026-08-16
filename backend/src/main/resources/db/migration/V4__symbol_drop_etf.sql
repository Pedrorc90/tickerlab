-- The screener is about shares: ETFs are filtered out at ingest, so the flag would be
-- false on every row.
ALTER TABLE symbol DROP COLUMN etf;
