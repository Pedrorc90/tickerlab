package dev.tickerlab.market;

import java.util.List;

/** A ticker's price history plus the bits of metadata the chart header shows. */
public record CandleSeries(
        String symbol,
        String name,
        String currency,
        String exchange,
        Timeframe timeframe,
        List<Candle> candles
) {
}
