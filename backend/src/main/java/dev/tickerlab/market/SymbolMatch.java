package dev.tickerlab.market;

/** One entry of the ticker autocomplete. */
public record SymbolMatch(
        String symbol,
        String name,
        String exchange,
        String sector,
        String industry
) {
}
