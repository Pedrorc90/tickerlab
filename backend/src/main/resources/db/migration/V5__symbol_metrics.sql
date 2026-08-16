-- Quotes live on the symbol row itself: there is one per ticker, no history is kept, and
-- the screener has to sort the whole universe by them without a join.
ALTER TABLE symbol
    ADD COLUMN price          NUMERIC(18, 4),
    ADD COLUMN change_percent NUMERIC(10, 4),
    ADD COLUMN volume         BIGINT,
    ADD COLUMN market_cap     NUMERIC(24, 2),
    -- Null until the first sweep. It is also what tells the refresher the data went stale.
    ADD COLUMN quoted_at      TIMESTAMPTZ;

-- Sorting the table by a metric touches every row, so each sortable column gets an index.
CREATE INDEX ix_symbol_change_percent ON symbol (change_percent);
CREATE INDEX ix_symbol_market_cap ON symbol (market_cap);
CREATE INDEX ix_symbol_volume ON symbol (volume);
