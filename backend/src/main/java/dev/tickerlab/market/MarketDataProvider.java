package dev.tickerlab.market;

import java.util.List;

/**
 * Source of market data. The rest of the app only knows this interface, so swapping the
 * free Yahoo endpoints for a paid feed later means writing one new implementation.
 */
public interface MarketDataProvider {

    /** Ticker autocomplete. Returns an empty list when nothing matches. */
    List<SymbolMatch> search(String query);

    /** Price history for a symbol at the given granularity. */
    CandleSeries candles(String symbol, Timeframe timeframe);
}
