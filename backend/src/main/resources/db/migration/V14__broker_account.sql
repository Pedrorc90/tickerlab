-- Real money, unlike the paper portfolio of V12. Nothing here is decided by the app: every row
-- is a line of a broker statement, imported as it was printed. The two models are kept apart on
-- purpose — a paper portfolio refuses an order it cannot pay for, and a real statement is not
-- allowed an opinion about what already happened.
CREATE TABLE broker_account (
    id         UUID PRIMARY KEY,
    owner_id   UUID NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    name       VARCHAR(60) NOT NULL,
    broker     VARCHAR(10) NOT NULL CHECK (broker IN ('DEGIRO', 'IBKR')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same rule as watchlists and portfolios: the name is unique per owner, not across the table.
CREATE UNIQUE INDEX uq_broker_account_owner_name ON broker_account (owner_id, lower(name));

-- One row per line of a statement, whatever the line was: a fill, a dividend, a fee, a deposit.
-- One table and not one per kind because a statement is read in date order — splitting it would
-- mean a union of six tables to draw the one screen anybody wants.
CREATE TABLE broker_transaction (
    id             UUID PRIMARY KEY,
    account_id     UUID NOT NULL REFERENCES broker_account (id) ON DELETE CASCADE,
    kind           VARCHAR(20) NOT NULL,
    executed_at    TIMESTAMPTZ NOT NULL,

    -- What it was about. Null on a cash movement that touches no instrument (a deposit, an
    -- interest payment). The ISIN is the broker's identifier and the only one always present;
    -- `symbol` stays null until something maps it to the ticker universe of the screener.
    isin           VARCHAR(12),
    product        VARCHAR(120),
    symbol         VARCHAR(20),

    -- Signed the way the statement signs it: positive bought, negative sold. Null on cash rows.
    quantity       BIGINT,
    -- The execution price in `price_currency`, which is NOT necessarily the settlement currency:
    -- DeGiro fills a US stock in USD and settles the account in EUR at `fx_rate`.
    price          NUMERIC(18,4),
    price_currency VARCHAR(3),

    -- What actually moved in the account, signed: negative leaves, positive arrives. This is the
    -- number the balance is built from, and it already carries the fees below folded in.
    amount         NUMERIC(18,2) NOT NULL,
    currency       VARCHAR(3) NOT NULL,
    -- Broken out as well as folded into `amount`, because "what did this cost me in commission"
    -- is a question the amount alone can no longer answer once it is a single net figure.
    fees           NUMERIC(18,2) NOT NULL DEFAULT 0,
    fx_rate        NUMERIC(18,6),

    -- The broker's own id when it prints one. Not the key: DeGiro leaves it empty on the rows it
    -- generates itself, which is exactly the corporate-action pair this import has to recognise.
    external_id    VARCHAR(64),

    -- The idempotency key, and the reason a second import of an overlapping date range is safe.
    -- A digest over the fields that identify the movement rather than over the raw line: the same
    -- transaction exported twice can differ in column order or trailing commas, and re-importing
    -- 2025 after adding 2024 must not produce a second copy of every 2025 row.
    fingerprint    CHAR(64) NOT NULL,

    -- Which upload produced the row, so a bad import can be found and undone as a unit.
    source_file    VARCHAR(160) NOT NULL,
    imported_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per account and not globally: the same statement legitimately imports into two accounts while
-- the user is still working out how they want them split.
CREATE UNIQUE INDEX uq_broker_transaction_fingerprint ON broker_transaction (account_id, fingerprint);
CREATE INDEX ix_broker_transaction_account ON broker_transaction (account_id, executed_at DESC);
-- Holdings are rebuilt by walking the fills of one instrument in order.
CREATE INDEX ix_broker_transaction_isin ON broker_transaction (account_id, isin, executed_at);
