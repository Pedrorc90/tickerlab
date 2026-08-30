package dev.tickerlab.screener;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * The one number Yahoo does not publish anywhere: how much was traded before the bell. Neither
 * its quote nor its chart carries it — the premarket minutes of {@code /v8/chart} come back with
 * a literal zero volume — so this reads Alpaca's bars instead.
 *
 * <p>The free plan is enough for it, and not with the IEX sample: Alpaca serves the consolidated
 * tape to everyone as long as the window asked for ends at least fifteen minutes ago. A scan that
 * runs at 09:20 to build a list for 09:30 does not care that the last quarter of an hour is
 * missing, so what arrives here is the whole market's volume rather than the 2.5% of it that
 * happens to trade on IEX.
 */
@Component
public class AlpacaBarsClient {

    private static final Logger log = LoggerFactory.getLogger(AlpacaBarsClient.class);

    /** Same shape as the Yahoo sweep: a hundred symbols per call, and 200 calls a minute allowed. */
    public static final int BATCH_SIZE = 100;

    /** The premarket session opens at 04:00 in New York whatever the clock says here. */
    private static final ZoneId MARKET = ZoneId.of("America/New_York");
    private static final LocalTime PREMARKET_OPEN = LocalTime.of(4, 0);
    private static final LocalTime BELL = LocalTime.of(9, 30);

    /**
     * How far back the window has to stop. Fifteen minutes is what the plan asks for and this
     * leaves a minute on top: the cutoff is checked against Alpaca's clock, not ours, and a
     * request that reaches a second too far comes back 403 for the whole batch.
     */
    private static final Duration SIP_DELAY = Duration.ofMinutes(16);

    /** Bars are summed here, so the size only decides how many rows travel. Ten thousand is the cap. */
    private static final String TIMEFRAME = "15Min";
    private static final int PAGE_LIMIT = 10000;

    private final RestClient client;
    private final String keyId;
    private final String secretKey;

    AlpacaBarsClient(RestClient.Builder builder,
                     @Value("${tickerlab.alpaca.base-url}") String baseUrl,
                     @Value("${tickerlab.alpaca.key-id}") String keyId,
                     @Value("${tickerlab.alpaca.secret-key}") String secretKey) {
        this.keyId = keyId;
        this.secretKey = secretKey;
        this.client = builder.clone()
                .baseUrl(baseUrl)
                .defaultHeader("Accept", "application/json")
                .build();
    }

    /** False when no credentials were set, which is the state the app boots in by default. */
    public boolean isConfigured() {
        return !keyId.isBlank() && !secretKey.isBlank();
    }

    /**
     * Shares traded between 04:00 ET and the freshest minute the plan allows, by symbol. A
     * symbol that did not trade at all is absent rather than zero: nothing was measured for it,
     * and a zero would sort as "quiet" next to names that genuinely printed nothing.
     *
     * @return an empty map when the credentials are missing or the window has not opened yet
     */
    public Map<String, Long> premarketVolume(List<String> symbols) {
        if (symbols.isEmpty() || !isConfigured()) {
            return Map.of();
        }
        ZonedDateTime nowInNewYork = ZonedDateTime.now(MARKET);
        Instant start = nowInNewYork.with(PREMARKET_OPEN).toInstant();
        // Never past the bell: after it, what is being asked for is still this morning's
        // premarket and not the session that has been trading over the top of it since.
        Instant end = min(Instant.now().minus(SIP_DELAY), nowInNewYork.with(BELL).toInstant());
        if (!end.isAfter(start)) {
            log.info("Premarket window is not open yet in New York, nothing to ask Alpaca for");
            return Map.of();
        }

        Instant bell = nowInNewYork.with(BELL).toInstant();
        Map<String, Long> volumes = new HashMap<>();
        String pageToken = null;
        do {
            BarsResponse response = fetch(symbols, start, end, pageToken);
            if (response == null || response.bars() == null) {
                break;
            }
            for (Map.Entry<String, List<Bar>> entry : response.bars().entrySet()) {
                String symbol = ours(entry.getKey());
                long traded = 0;
                for (Bar bar : entry.getValue()) {
                    // The bar stamped at the bell is the opening fifteen minutes, and Alpaca's
                    // end is inclusive, so asking up to 09:30 hands it over: measured on AAPL it
                    // was 2.16M of a 3.02M total. Dropped here rather than by shaving a minute
                    // off the request, because what makes it wrong is which session it belongs
                    // to, not how close to the edge it sits.
                    if (bar.v() != null && bar.t() != null && bar.t().isBefore(bell)) {
                        traded += bar.v();
                    }
                }
                volumes.merge(symbol, traded, Long::sum);
            }
            pageToken = response.nextPageToken();
        } while (pageToken != null && !pageToken.isBlank());
        return volumes;
    }

    private BarsResponse fetch(List<String> symbols, Instant start, Instant end, String pageToken) {
        return client.get()
                .uri(uri -> {
                    uri.path("/v2/stocks/bars")
                            .queryParam("symbols", theirs(symbols))
                            .queryParam("timeframe", TIMEFRAME)
                            .queryParam("start", DateTimeFormatter.ISO_INSTANT.format(start))
                            .queryParam("end", DateTimeFormatter.ISO_INSTANT.format(end))
                            // The whole tape. Left to itself this is what the endpoint defaults
                            // to, but it is the one parameter the plan turns on, so it is said.
                            .queryParam("feed", "sip")
                            .queryParam("limit", PAGE_LIMIT)
                            .queryParam("sort", "asc");
                    if (pageToken != null) {
                        uri.queryParam("page_token", pageToken);
                    }
                    return uri.build();
                })
                .header("APCA-API-KEY-ID", keyId)
                .header("APCA-API-SECRET-KEY", secretKey)
                .exchange((request, response) -> {
                    if (response.getStatusCode().isError()) {
                        // 401 is a wrong key pair and 403 a window that reached into the last
                        // fifteen minutes; both are worth reading literally in the log.
                        throw new ScreenerDataException(
                                "Alpaca bars failed with status " + response.getStatusCode());
                    }
                    return response.bodyTo(BarsResponse.class);
                });
    }

    private static Instant min(Instant one, Instant other) {
        return one.isBefore(other) ? one : other;
    }

    /**
     * The share class separator, back to the dot. The table holds Yahoo's spelling — the dot
     * became a dash when the universe was ingested — and Alpaca wants the other one: sending
     * {@code BF-B} does not merely miss that ticker, it answers 400 and takes the whole batch
     * of a hundred down with it.
     */
    private static String theirs(List<String> symbols) {
        StringBuilder joined = new StringBuilder();
        for (String symbol : symbols) {
            if (!joined.isEmpty()) {
                joined.append(',');
            }
            joined.append(symbol.replace('-', '.'));
        }
        return joined.toString();
    }

    /** And back again on the way in, so the keys match the rows they are about to be written to. */
    private static String ours(String symbol) {
        return symbol.replace('.', '-');
    }

    private record BarsResponse(Map<String, List<Bar>> bars,
                                @JsonProperty("next_page_token") String nextPageToken) {
    }

    /**
     * One bar carries eight fields; this reads two. The timestamp is the bar's <em>start</em>,
     * which is what lets the one stamped 09:30 be recognised as the session's and thrown out.
     */
    private record Bar(Instant t, Long v) {
    }
}
