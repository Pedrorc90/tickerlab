CREATE TABLE watchlist (
    id         UUID PRIMARY KEY,
    name       VARCHAR(60) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_watchlist_name ON watchlist (lower(name));

-- The symbol is the identity: there is no ticker table to point at, and Yahoo is
-- the only source of truth for what a symbol means.
CREATE TABLE watchlist_entry (
    watchlist_id UUID NOT NULL REFERENCES watchlist (id) ON DELETE CASCADE,
    symbol       VARCHAR(20) NOT NULL,
    name         VARCHAR(120),
    added_at     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (watchlist_id, symbol)
);

-- One list from the start, so the panel is never empty on a fresh database.
INSERT INTO watchlist (id, name) VALUES (gen_random_uuid(), 'Favoritos');
