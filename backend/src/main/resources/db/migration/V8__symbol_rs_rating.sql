-- Unlike every other metric on this table, this one is not quoted from Yahoo: it is computed
-- here by ranking the universe against itself after each sweep, so it only means anything
-- relative to whatever else is listed today. See QuoteRefresher#rank.
ALTER TABLE symbol
    -- 1 to 99, IBD-style. Null until a sweep has ranked the ticker, or when it lacks the
    -- inputs the ranking reads.
    ADD COLUMN rs_rating INTEGER;

CREATE INDEX ix_symbol_rs_rating ON symbol (rs_rating);
