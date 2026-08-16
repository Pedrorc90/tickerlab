-- All six ride along in the quote call that already brings the price, so they cost no
-- extra request.
ALTER TABLE symbol
    ADD COLUMN avg_volume_3m      BIGINT,
    ADD COLUMN shares_outstanding BIGINT,
    ADD COLUMN forward_per        NUMERIC(12, 4),
    -- Trailing twelve months. Negative for a company losing money.
    ADD COLUMN eps                NUMERIC(12, 4),
    -- Yahoo's consensus, kept as its number: 1 is a strong buy and 5 a sell, so lower is
    -- better here — the opposite of every other column on the table.
    ADD COLUMN analyst_rating     NUMERIC(4, 2),
    -- Distance to the 52-week low: zero at the low, positive above it.
    ADD COLUMN from_low_52w       NUMERIC(12, 4);

CREATE INDEX ix_symbol_avg_volume_3m ON symbol (avg_volume_3m);
CREATE INDEX ix_symbol_analyst_rating ON symbol (analyst_rating);
