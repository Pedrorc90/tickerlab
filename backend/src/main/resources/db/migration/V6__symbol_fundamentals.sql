-- Everything here rides along in the same quote call the price comes from, so there is no
-- extra request to pay for: it is only a matter of storing what Yahoo already sends.
ALTER TABLE symbol
    ADD COLUMN per            NUMERIC(12, 4),
    ADD COLUMN price_to_book  NUMERIC(12, 4),
    -- Yahoo sends this one already as a percentage (2.42 means 2.42 %).
    ADD COLUMN dividend_yield NUMERIC(10, 4),
    ADD COLUMN change_52w     NUMERIC(12, 4),
    -- Distance to the 52-week high: zero at the high, negative below it.
    ADD COLUMN from_high_52w  NUMERIC(10, 4),
    ADD COLUMN vs_sma_50      NUMERIC(10, 4),
    ADD COLUMN vs_sma_200     NUMERIC(10, 4);

-- The three that carry most of the screening weight get an index; the rest ride along on
-- the filters above them.
CREATE INDEX ix_symbol_per ON symbol (per);
CREATE INDEX ix_symbol_dividend_yield ON symbol (dividend_yield);
CREATE INDEX ix_symbol_change_52w ON symbol (change_52w);
