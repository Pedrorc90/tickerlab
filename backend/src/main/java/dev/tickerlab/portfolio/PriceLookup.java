package dev.tickerlab.portfolio;

import dev.tickerlab.market.Candle;
import dev.tickerlab.market.CandleSeries;
import dev.tickerlab.market.MarketDataProvider;
import dev.tickerlab.market.Timeframe;
import dev.tickerlab.screener.Symbol;
import dev.tickerlab.screener.SymbolRepository;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

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
