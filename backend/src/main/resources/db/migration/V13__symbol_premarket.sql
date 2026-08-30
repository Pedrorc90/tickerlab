-- The premarket pair. Both columns are owned by the premarket sweep and read together: a gap
-- with no volume behind it does not say whether the move is tradeable or two prints wide.
ALTER TABLE symbol
    -- Distance from yesterday's close in percent, straight from Yahoo's preMarketChangePercent.
    -- Yahoo only sends that field while the premarket session is open, so this stays null on a
    -- day nobody ran the sweep before the bell.
    ADD COLUMN gap_percent NUMERIC(10,4),
    -- Shares traded between 04:00 ET and the run, summed from Alpaca's SIP bars: the whole
    -- market and not the IEX sample. Null for every symbol the gap filter did not keep, which
    -- is the other 5.900 of them.
    ADD COLUMN premarket_volume BIGINT;

-- The gap is what the premarket scan sorts on, and it is a column of mostly nulls: the index
-- is read every morning by the one query that matters and skipped by the rest.
CREATE INDEX ix_symbol_gap_percent ON symbol (gap_percent);
