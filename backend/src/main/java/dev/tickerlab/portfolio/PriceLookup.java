package dev.tickerlab.portfolio;

import dev.tickerlab.market.Candle;
import dev.tickerlab.market.CandleSeries;
import dev.tickerlab.market.MarketDataProvider;
import dev.tickerlab.market.Timeframe;
import dev.tickerlab.screener.Symbol;
import dev.tickerlab.screener.SymbolRepository;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

/**
 * What a symbol is worth right now, for filling an order and for marking positions to market.
 *
 * <p>Two sources, in order. The screener's {@code symbol} table first: the sweep already refreshes
 * it every 15 minutes for the whole US universe, so pricing a portfolio of ten positions is one
 * query rather than ten HTTP calls. The last daily close second, and it is not decoration — in
 * production the sweep leaves the prices empty (Yahoo refuses the quote session to a datacenter
 * IP, open since 2026-08-18) while {@code /v8/chart} answers Render fine. Without the fallback
 * nothing could be bought there at all.
 *
 * <p>Which one filled an order is written into the order row, so a run of fills taken from stale
 * closes reads as such later instead of looking like a sweep that was working.
 */
@Component
public class PriceLookup {

    private final SymbolRepository symbols;
    private final MarketDataProvider market;

    PriceLookup(SymbolRepository symbols, MarketDataProvider market) {
        this.symbols = symbols;
        this.market = market;
    }

    /** A price and where it came from. */
    public record Priced(BigDecimal price, PriceSource source, String name) {
    }

    /**
     * Prices one symbol, falling back to the daily close. Throws rather than returning null: an
     * order is the one place where a made-up price never stops being wrong.
     */
    public Priced require(String symbol) {
        return of(symbol).orElseThrow(() -> new PriceUnavailableException(symbol));
    }

    public Optional<Priced> of(String symbol) {
        Optional<Symbol> swept = symbols.findById(symbol);
        Optional<Priced> fromSweep = swept
                .filter(row -> row.getPrice() != null)
                .map(row -> new Priced(row.getPrice(), PriceSource.SWEEP, row.getName()));
        if (fromSweep.isPresent()) {
            return fromSweep;
        }
        String name = swept.map(Symbol::getName).orElse(null);
        return lastClose(symbol).map(closed -> new Priced(closed, PriceSource.CLOSE, name));
    }

    /** What the screener knows about a ticker. The price is null when the sweep never got one. */
    public record Snapshot(String name, BigDecimal price) {
    }

    /**
     * Marks a whole portfolio to market in one query. Symbols the sweep cannot price come back
     * with a null price: a position without one shows a dash, and valuing it at its cost would
     * print a portfolio total that quietly pretends nothing moved.
     *
     * <p>No fallback to the daily close here, unlike {@link #of}: that is one HTTP call per
     * symbol, and a summary is repainted far more often than an order is placed.
     */
    public Map<String, Snapshot> snapshot(Collection<String> tickers) {
        if (tickers.isEmpty()) {
            return Map.of();
        }
        Map<String, Snapshot> rows = new HashMap<>();
        for (Symbol row : symbols.findAllById(tickers)) {
            rows.put(row.getSymbol(), new Snapshot(row.getName(), row.getPrice()));
        }
        return rows;
    }

    /**
     * Prices tickers for a screen that gets checked against a broker's own, so freshness is the
     * whole requirement.
     *
     * <p>Deliberately does not use the sweep, unlike {@link #snapshot}. Two reasons, and either
     * would be enough on its own. The sweep is a snapshot of whenever it last ran, which is a
     * figure from hours ago whenever it is not running: it held NVDA at 217,55 from 13:29 while
     * the market was at 219,43, an 11 EUR gap on seven shares that reads as a broken valuation and
     * is really a stale price. And it covers the US universe only, while a real account is
     * whatever the user actually bought -- for a European line the close is the only price there
     * is anyway.
     *
     * <p>Which makes this one HTTP call per ticker, so results are cached for {@link #QUOTE_TTL}:
     * this runs on every repaint of the account screen rather than once per order. Misses are
     * cached too -- a ticker Yahoo does not recognise is a typo the user has to fix, and retrying
     * it on every load would cost the same as a real quote and never succeed.
     */
    public Map<String, Snapshot> quotes(Collection<String> tickers) {
        if (tickers.isEmpty()) {
            return Map.of();
        }
        // The sweep is still worth its one query for the names it knows: what goes stale is the
        // price, not the label, and a line reading "NVIDIA Corp" beats one reading its ISIN.
        Map<String, Snapshot> named = snapshot(tickers);
        Map<String, Snapshot> rows = new HashMap<>();
        for (String ticker : tickers) {
            BigDecimal price = cachedClose(ticker);
            if (price != null) {
                Snapshot swept = named.get(ticker);
                rows.put(ticker, new Snapshot(swept == null ? null : swept.name(), price));
            }
        }
        return rows;
    }

    /** How long a ticker that answered nothing is left alone before being asked again. */
    private static final Duration MISS_TTL = Duration.ofMinutes(15);

    /**
     * Tickers that returned no price, and when. Only the misses are held here.
     *
     * <p>Caching the hits as well was the obvious thing and it was wrong: {@code candles} is
     * already cached for fifteen minutes inside the provider, so a second fifteen-minute cache in
     * front of it does not save a call, it just stacks -- a price could be half an hour old on a
     * screen whose whole job is to agree with the broker. The misses need their own, because a
     * failed lookup throws rather than returning, so the provider's cache never holds it and a
     * typed-in ticker would cost one HTTP call on every repaint forever.
     */
    private final Map<String, Instant> missed = new ConcurrentHashMap<>();

    /** The latest close, straight through the provider's own cache. Null when nothing answers. */
    private BigDecimal cachedClose(String symbol) {
        Instant miss = missed.get(symbol);
        if (miss != null && Duration.between(miss, Instant.now()).compareTo(MISS_TTL) < 0) {
            return null;
        }
        BigDecimal fresh = lastClose(symbol).orElse(null);
        if (fresh == null) {
            missed.put(symbol, Instant.now());
        } else {
            missed.remove(symbol);
        }
        return fresh;
    }

    private Optional<BigDecimal> lastClose(String symbol) {
        try {
            CandleSeries series = market.candles(symbol, Timeframe.DAY);
            List<Candle> candles = series.candles();
            if (candles.isEmpty()) {
                return Optional.empty();
            }
            return Optional.of(BigDecimal.valueOf(candles.getLast().close()));
        } catch (RuntimeException failure) {
            // A dead symbol or a rejected request is "no price", not a 500 on the order.
            return Optional.empty();
        }
    }
}
