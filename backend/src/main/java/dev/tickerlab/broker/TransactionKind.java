package dev.tickerlab.broker;

/**
 * What a line of a statement was. Deliberately wider than the paper portfolio's BUY/SELL: the
 * point of importing a real statement is that the balance ends up matching the broker's, and it
 * never will while dividends, withholding and fees are dropped as "not a trade".
 */
public enum TransactionKind {

    /** Shares in, cash out. */
    BUY,

    /** Shares out, cash in. */
    SELL,

    /**
     * Shares in and out at the same price and the same instant, from a reincorporation or a
     * ticker change. It is not a purchase, and counting it as one would reset the cost of a
     * position to whatever the shares happened to be worth on the day the paperwork moved.
     */
    CORPORATE_ACTION,

    /** Cash paid on a holding. */
    DIVIDEND,

    /** Tax withheld at source on a dividend, always negative. */
    WITHHOLDING,

    /**
     * A charge that is not attached to a fill: custody, connectivity, an ADR pass-through. The
     * commission on a trade is not this — it lives in {@code fees} on the trade itself, where it
     * belongs to the cost of the position.
     */
    FEE,

    /** Interest credited on the cash balance. */
    INTEREST,

    /** Money in from outside the broker. */
    DEPOSIT,

    /** Money out to the bank. */
    WITHDRAWAL,

    /**
     * One leg of a currency conversion. They come in pairs that net to zero across two
     * currencies, so they move the per-currency balances without changing what the account is
     * worth.
     */
    FX,

    /** Recognised as a real line but not classified. Kept rather than dropped: see the panel. */
    OTHER
}
