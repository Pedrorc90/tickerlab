-- What ticker an ISIN is, decided by the user and by nobody else.
--
-- A DeGiro statement identifies an instrument by ISIN and never by ticker, so the imported rows
-- alone can price nothing. Resolving it automatically was considered and dropped: the same ISIN
-- trades on several venues under several tickers, and a guess that picks the wrong one prints a
-- valuation that is confidently wrong -- worse than the dash it replaced.
--
-- Per owner and not per account, because the answer does not change between two accounts of the
-- same person, and per owner it survives deleting an account and re-importing its statements.
CREATE TABLE broker_symbol_map (
    owner_id   UUID NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    isin       VARCHAR(12) NOT NULL,
    -- Free text and not a foreign key to `symbol`: the screener only sweeps the US universe, and
    -- half of a European account would be unmappable if the ticker had to exist there first.
    symbol     VARCHAR(20) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, isin)
);
