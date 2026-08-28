package dev.tickerlab.portfolio;

/**
 * Where the fill price came from. Stored on the order so a run of orders taken from stale
 * daily closes reads as such later, instead of looking like a sweep that was working.
 */
public enum PriceSource {

    /** The screener sweep, at most 15 minutes old. */
    SWEEP,

    /** Last daily close from Yahoo, used when the sweep has no price for the symbol. */
    CLOSE
}
