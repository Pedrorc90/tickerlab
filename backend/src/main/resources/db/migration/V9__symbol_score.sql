-- Second computed column of the table, after rs_rating: it blends three of the quoted metrics
-- into one number instead of measuring anything new, so it is written by the same sweep that
-- ranks relative strength. See SymbolRepository#scoreStrength.
ALTER TABLE symbol
    -- 1 to 99 on the same scale as rs_rating, so the two columns read against each other.
    -- Null until a sweep has scored the ticker, or when it lacks one of the three inputs.
    ADD COLUMN score INTEGER;

CREATE INDEX ix_symbol_score ON symbol (score);
