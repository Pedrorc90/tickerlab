package dev.tickerlab.market;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * What one currency is worth in another, today.
 *
 * <p>Needed because a real account settles in one currency and holds instruments quoted in
 * another: DeGiro fills Apple in dollars and keeps the account in euros. Valuing the position at
 * its dollar quote and comparing that against the euro it cost answers a question nobody asked —
 * it is the return the position would have made had the exchange rate never moved, and it differs
 * from what the broker prints by exactly the amount the rate did move.
 *
 * <p>The statement carries the rate of each fill in {@code fx_rate}, and that is deliberately not
 * what is used here. That rate says what the euro bought on the day of the trade; marking a
 * position to market needs what it buys now.
 *
 * <p>Taken from the same daily candles as everything else, through the pair symbol Yahoo uses
 * ({@code USDEUR=X}), and cached like a quote: the account screen repaints far more often than a
 * currency moves.
 */
@Component
public class FxRates {

    /** How long a pair that answered nothing is left alone before being asked again. */
    private static final Duration MISS_TTL = Duration.ofMinutes(15);

    private final MarketDataProvider market;
    /**
     * Pairs that returned no rate, and when. Only the misses: the rate itself comes through the
     * provider's own fifteen-minute cache, and a second cache in front of it would not save a call,
     * it would just let a rate go half an hour stale on a screen that has to agree with a broker.
     */
    private final Map<String, Instant> missed = new ConcurrentHashMap<>();

    FxRates(MarketDataProvider market) {
        this.market = market;
    }

    /**
     * How much of {@code to} one unit of {@code from} buys. One when the currencies match, and
     * empty when nothing could price the pair — the caller then has to show a dash, because a
     * conversion silently done at 1.0 would print a euro figure that is really dollars.
     */
    public Optional<BigDecimal> rate(String from, String to) {
        if (from == null || to == null) {
            return Optional.empty();
        }
        String source = from.toUpperCase(Locale.ROOT);
        String target = to.toUpperCase(Locale.ROOT);
        if (source.equals(target)) {
            return Optional.of(BigDecimal.ONE);
        }
        String pair = source + target + "=X";
        Instant miss = missed.get(pair);
        if (miss != null && Duration.between(miss, Instant.now()).compareTo(MISS_TTL) < 0) {
            return Optional.empty();
        }
        BigDecimal fresh = lastClose(pair).orElse(null);
        // A pair Yahoo does not know is not going to start knowing it within the window, and
        // retrying it would cost an HTTP call on every repaint.
        if (fresh == null) {
            missed.put(pair, Instant.now());
        } else {
            missed.remove(pair);
        }
        return Optional.ofNullable(fresh);
    }

    private Optional<BigDecimal> lastClose(String pair) {
        try {
            List<Candle> candles = market.candles(pair, Timeframe.DAY).candles();
            if (candles.isEmpty()) {
                return Optional.empty();
            }
            return Optional.of(BigDecimal.valueOf(candles.getLast().close()));
        } catch (RuntimeException failure) {
            // An unknown pair or a rejected request is "no rate", not a 500 on the account screen.
            return Optional.empty();
        }
    }
}
