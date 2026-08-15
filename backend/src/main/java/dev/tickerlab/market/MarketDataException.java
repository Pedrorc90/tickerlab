package dev.tickerlab.market;

/** Thrown when the upstream data source is unreachable or answers unexpectedly. */
public class MarketDataException extends RuntimeException {

    public MarketDataException(String message) {
        super(message);
    }
}
