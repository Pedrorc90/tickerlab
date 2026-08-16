-- The tradable universe behind the screener. Nasdaq Trader publishes it as two pipe
-- separated files, so the symbol itself is the key: there is no vendor id to keep.
CREATE TABLE symbol (
    symbol     VARCHAR(20) PRIMARY KEY,
    name       VARCHAR(200) NOT NULL,
    exchange   VARCHAR(40)  NOT NULL,
    etf        BOOLEAN      NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- The screener filters by typing, and Postgres will not use a plain index for the
-- lower(...) LIKE the query runs.
CREATE INDEX ix_symbol_name_lower ON symbol (lower(name));
CREATE INDEX ix_symbol_exchange ON symbol (exchange);
