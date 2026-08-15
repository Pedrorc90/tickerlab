package dev.tickerlab.market;

/**
 * A single OHLCV bar. {@code time} is the bar's opening instant as epoch seconds (UTC),
 * which is the format lightweight-charts expects.
 */
public record Candle(
        long time,
        double open,
        double high,
        double low,
        double close,
        long volume
) {
}
