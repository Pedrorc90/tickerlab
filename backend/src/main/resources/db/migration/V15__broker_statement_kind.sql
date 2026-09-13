-- Two things V14 could not know it needed, because it was written against the trades export and
-- the cash book turns out to be a different animal.

-- What a cash row says about itself. On a trade the instrument is the identity, and V14 stores it
-- in `product`; on a dividend, a sweep or a connectivity fee there is no instrument at all and the
-- description is the only thing that tells one row from another.
ALTER TABLE broker_transaction ADD COLUMN description VARCHAR(200);

-- Which export the row was read from, and the reason it matters: DeGiro's two files describe the
-- same money at two granularities. One purchase is a single EUR-netted line in Transactions.csv
-- and four lines in Account.csv — the trade in USD, both legs of the currency conversion, and the
-- commission. Loading both into one account does not duplicate rows, it double-counts the money,
-- and no per-row key can catch that because the rows genuinely differ. So an account commits to
-- one kind of statement and the importer refuses the other.
ALTER TABLE broker_transaction ADD COLUMN statement VARCHAR(10) NOT NULL DEFAULT 'TRADES';
ALTER TABLE broker_transaction ALTER COLUMN statement DROP DEFAULT;

CREATE INDEX ix_broker_transaction_statement ON broker_transaction (account_id, statement);
