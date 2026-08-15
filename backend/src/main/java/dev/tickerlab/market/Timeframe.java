package dev.tickerlab.market;

/**
 * Chart granularity. Each timeframe carries the amount of history that keeps the chart
 * readable: enough bars to be meaningful, not so many that the browser chokes.
 */
public enum Timeframe {

    DAY("1d", "5y"),
    WEEK("1wk", "10y"),
    MONTH("1mo", "max");

    private final String interval;
    private final String range;

    Timeframe(String interval, String range) {
        this.interval = interval;
        this.range = range;
    }

    /** Yahoo's bar size parameter. */
    public String interval() {
        return interval;
    }

    /** Yahoo's history window parameter. */
    public String range() {
        return range;
    }
}
