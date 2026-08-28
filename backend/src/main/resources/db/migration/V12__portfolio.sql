-- Paper trading. Money that is not real, kept exactly as if it were: the cash left, what is
-- held and at what average cost, and every order ever filled.
CREATE TABLE portfolio (
    id            UUID PRIMARY KEY,
    owner_id      UUID NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    name          VARCHAR(60) NOT NULL,
    -- Frozen at creation. The return of a portfolio is meaningless without the number it
    -- started from, and topping up later would rewrite every percentage already read.
    initial_cash  NUMERIC(18,2) NOT NULL,
    cash          NUMERIC(18,2) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same rule as the watchlists: the name is unique per owner, not across the table.
CREATE UNIQUE INDEX uq_portfolio_owner_name ON portfolio (owner_id, lower(name));

-- One row per symbol held, deleted when the last share goes. Derivable from the order book,
-- but not cheaply: rebuilding it would mean replaying every fill and deciding FIFO vs average
-- on each read, and the average cost is the one number the screen shows on every line.
CREATE TABLE portfolio_position (
    portfolio_id UUID NOT NULL REFERENCES portfolio (id) ON DELETE CASCADE,
    symbol       VARCHAR(20) NOT NULL,
    -- Whole shares only: fractional buying is a different product, not a smaller one.
    quantity     BIGINT NOT NULL CHECK (quantity > 0),
    -- Weighted average, untouched by sells. Selling realises a profit; it does not change
    -- what the remaining shares cost.
    avg_cost     NUMERIC(18,4) NOT NULL,
    opened_at    TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (portfolio_id, symbol)
);

-- Append-only. Nothing here is ever updated or deleted: the fill price is written into the
-- row so that a later sweep moving the quote cannot rewrite what an order cost.
CREATE TABLE portfolio_order (
    id            UUID PRIMARY KEY,
    portfolio_id  UUID NOT NULL REFERENCES portfolio (id) ON DELETE CASCADE,
    symbol        VARCHAR(20) NOT NULL,
    name          VARCHAR(120),
    side          VARCHAR(4) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    quantity      BIGINT NOT NULL CHECK (quantity > 0),
    price         NUMERIC(18,4) NOT NULL,
    -- Null on a buy: a purchase realises nothing. On a sell it is (price - avg_cost) * qty,
    -- computed against the average the position carried at that moment and never recomputed.
    realized_pnl  NUMERIC(18,2),
    -- Which source filled it, so a run of orders taken from stale closes is legible later
    -- instead of looking like the sweep was working.
    price_source  VARCHAR(10) NOT NULL,
    executed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_portfolio_order_portfolio ON portfolio_order (portfolio_id, executed_at DESC);
