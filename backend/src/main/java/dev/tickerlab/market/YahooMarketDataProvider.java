package dev.tickerlab.market;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Reads from Yahoo Finance's public chart and search endpoints. They need no API key and
 * cover daily/weekly/monthly bars back to the 1980s; intraday prices arrive delayed.
 * These are undocumented endpoints, so everything Yahoo-shaped stays inside this class.
 */
@Component
public class YahooMarketDataProvider implements MarketDataProvider {

    /** Yahoo rejects requests without a browser-like agent. */
    private static final String USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

    private static final int MAX_MATCHES = 10;

    private final RestClient client;

    YahooMarketDataProvider(RestClient.Builder builder, @Value("${tickerlab.yahoo.base-url}") String baseUrl) {
        this.client = builder
                .baseUrl(baseUrl)
                .defaultHeader("User-Agent", USER_AGENT)
                .defaultHeader("Accept", "application/json")
                .build();
    }

    @Override
    @Cacheable(cacheNames = "symbolSearch", key = "#query.toLowerCase()")
    public List<SymbolMatch> search(String query) {
        SearchResponse response = client.get()
                .uri(uri -> uri.path("/v1/finance/search")
                        .queryParam("q", query)
                        .queryParam("quotesCount", MAX_MATCHES)
                        .queryParam("newsCount", 0)
                        .build())
                .retrieve()
                .onStatus(HttpStatusCode::isError, (req, res) -> {
                    throw new MarketDataException("Yahoo search failed with status " + res.getStatusCode());
                })
                .body(SearchResponse.class);

        if (response == null || response.quotes() == null) {
            return List.of();
        }
        return response.quotes().stream()
                .filter(q -> "EQUITY".equals(q.quoteType()) || "ETF".equals(q.quoteType()))
                .map(YahooMarketDataProvider::toMatch)
                .toList();
    }

    @Override
    @Cacheable(cacheNames = "candles", key = "#symbol.toUpperCase() + '|' + #timeframe")
    public CandleSeries candles(String symbol, Timeframe timeframe) {
        String ticker = symbol.toUpperCase(Locale.ROOT);
        ChartResponse response = client.get()
                .uri(uri -> uri.path("/v8/finance/chart/{symbol}")
                        .queryParam("range", timeframe.range())
                        .queryParam("interval", timeframe.interval())
                        .build(ticker))
                .retrieve()
                .onStatus(HttpStatusCode::isError, (req, res) -> {
                    if (res.getStatusCode().value() == 404) {
                        throw new SymbolNotFoundException(ticker);
                    }
                    throw new MarketDataException("Yahoo chart failed with status " + res.getStatusCode());
                })
                .body(ChartResponse.class);

        if (response == null || response.chart() == null || isEmpty(response.chart().result())) {
            throw new SymbolNotFoundException(ticker);
        }
        ChartResult result = response.chart().result().getFirst();
        Meta meta = result.meta();
        if (meta == null) {
            throw new SymbolNotFoundException(ticker);
        }
        return new CandleSeries(
                meta.symbol() != null ? meta.symbol() : ticker,
                displayName(meta, ticker),
                meta.currency(),
                meta.fullExchangeName() != null ? meta.fullExchangeName() : meta.exchangeName(),
                timeframe,
                toCandles(result));
    }

    /**
     * Yahoo returns parallel arrays and leaves gaps as nulls (holidays, halted sessions).
     * Bars missing any price are dropped, since a chart cannot draw them anyway.
     */
    private static List<Candle> toCandles(ChartResult result) {
        List<Long> timestamps = result.timestamp();
        if (isEmpty(timestamps) || result.indicators() == null || isEmpty(result.indicators().quote())) {
            return List.of();
        }
        Quote quote = result.indicators().quote().getFirst();
        List<Candle> candles = new ArrayList<>(timestamps.size());
        for (int i = 0; i < timestamps.size(); i++) {
            Double open = at(quote.open(), i);
            Double high = at(quote.high(), i);
            Double low = at(quote.low(), i);
            Double close = at(quote.close(), i);
            if (open == null || high == null || low == null || close == null) {
                continue;
            }
            Long volume = at(quote.volume(), i);
            candles.add(new Candle(timestamps.get(i), open, high, low, close, volume != null ? volume : 0L));
        }
        return candles;
    }

    private static SymbolMatch toMatch(SearchQuote quote) {
        String name = quote.longname() != null ? quote.longname() : quote.shortname();
        return new SymbolMatch(
                quote.symbol(),
                name != null ? name : quote.symbol(),
                quote.exchDisp(),
                quote.sectorDisp(),
                quote.industryDisp());
    }

    private static String displayName(Meta meta, String fallback) {
        if (meta.longName() != null) {
            return meta.longName();
        }
        return meta.shortName() != null ? meta.shortName() : fallback;
    }

    private static <T> T at(List<T> values, int index) {
        return values == null || index >= values.size() ? null : values.get(index);
    }

    private static boolean isEmpty(List<?> values) {
        return values == null || values.isEmpty();
    }

    // --- Yahoo wire format. Unknown fields are ignored by Jackson's default config. ---

    private record ChartResponse(Chart chart) {
    }

    private record Chart(List<ChartResult> result) {
    }

    private record ChartResult(Meta meta, List<Long> timestamp, Indicators indicators) {
    }

    private record Meta(String symbol, String currency, String exchangeName, String fullExchangeName,
                        String longName, String shortName) {
    }

    private record Indicators(List<Quote> quote) {
    }

    private record Quote(List<Double> open, List<Double> high, List<Double> low, List<Double> close,
                         List<Long> volume) {
    }

    private record SearchResponse(List<SearchQuote> quotes) {
    }

    private record SearchQuote(String symbol, String shortname, String longname, String exchDisp,
                               String quoteType, String sectorDisp, String industryDisp) {
    }
}
