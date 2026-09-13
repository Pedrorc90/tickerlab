package dev.tickerlab.broker;

/**
 * Which DeGiro export a row was read from.
 *
 * <p>It exists because the two files are not two halves of the account, they are two accounts of
 * the same money. A single purchase of NVIDIA is one line in {@code Transactions.csv} — netted to
 * EUR, commission folded in — and four lines in {@code Account.csv}: the trade in USD, both legs
 * of the currency conversion, and the commission on its own. Import both and the cash moves twice,
 * and no fingerprint can prevent it, because the rows really are different rows.
 *
 * <p>So an account commits to one of them. {@link #CASH} is the one to want: it is the whole
 * ledger, its running balance can be checked against the broker's own, and it carries the trades
 * as well. {@link #TRADES} is kept because it is the easier export to find and it is enough to see
 * what a position cost.
 */
public enum StatementKind {

    /** {@code Transactions.csv}: fills only, netted to the account currency. */
    TRADES,

    /** {@code Account.csv}: every movement — fills, fees, dividends, currency legs, deposits. */
    CASH
}
