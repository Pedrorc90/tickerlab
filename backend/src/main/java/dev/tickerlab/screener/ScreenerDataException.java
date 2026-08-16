package dev.tickerlab.screener;

/** The universe could not be read from Nasdaq Trader. */
public class ScreenerDataException extends RuntimeException {

    public ScreenerDataException(String message) {
        super(message);
    }
}
