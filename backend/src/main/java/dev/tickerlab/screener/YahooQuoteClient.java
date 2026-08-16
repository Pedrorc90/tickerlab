package dev.tickerlab.screener;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Reads Yahoo's quote endpoint, which unlike the chart one refuses anonymous callers: it
 * wants a session cookie plus the matching crumb. Both are fetched here on first use and
 * renewed whenever Yahoo starts answering 401.
 *
 * <p>One request covers a hundred tickers, so the whole US universe is around sixty calls.
 */
@Component
public class YahooQuoteClient {

    private static final Logger log = LoggerFactory.getLogger(YahooQuoteClient.class);

    /** Yahoo rejects requests without a browser-like agent. */
    private static final String USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

    /** Measured: a hundred symbols per call answers in ~0.3s and Yahoo never complained. */
    public static final int BATCH_SIZE = 100;

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    /** Where the session cookie comes from. The 404 it returns is expected and harmless. */
    private static final String COOKIE_URL = "https://fc.yahoo.com";

    private final RestClient client;
    private final RestClient cookieClient;

    /** Cookie and crumb travel together: renewing one without the other buys nothing. */
    private volatile Session session;

    YahooQuoteClient(RestClient.Builder builder, @Value("${tickerlab.yahoo.base-url}") String baseUrl) {
        this.client = builder.clone()
                .baseUrl(baseUrl)
                .defaultHeader("User-Agent", USER_AGENT)
                .defaultHeader("Accept", "application/json")
                .build();
        this.cookieClient = builder.clone()
                .defaultHeader("User-Agent", USER_AGENT)
                .build();
    }

    /**
     * Symbols Yahoo does not know are simply absent from the answer, so the result can be
     * shorter than the batch.
     */
    public List<Quote> quotes(List<String> symbols) {
        if (symbols.isEmpty()) {
            return List.of();
        }
        QuoteResponse response = fetch(symbols, session());
        if (response == null) {
            // The session expired mid-sweep: build a fresh one and give the batch one more go.
            log.info("Yahoo rejected the quote session, renewing it");
            response = fetch(symbols, renew());
            if (response == null) {
                throw new ScreenerDataException("Yahoo refused the quote request even with a fresh crumb");
            }
        }
        if (response.quoteResponse() == null || response.quoteResponse().result() == null) {
            return List.of();
        }
        List<Quote> quotes = new ArrayList<>(symbols.size());
        for (QuoteRow row : response.quoteResponse().result()) {
            if (row.symbol() != null) {
                quotes.add(new Quote(
                        row.symbol(),
                        row.regularMarketPrice(),
                        row.regularMarketChangePercent(),
                        row.regularMarketVolume(),
                        row.marketCap(),
                        row.trailingPE(),
                        row.priceToBook(),
                        row.dividendYield(),
                        row.fiftyTwoWeekChangePercent(),
                        asPercent(row.fiftyTwoWeekHighChangePercent()),
                        asPercent(row.fiftyTwoWeekLowChangePercent()),
                        asPercent(row.fiftyDayAverageChangePercent()),
                        asPercent(row.twoHundredDayAverageChangePercent()),
                        row.averageDailyVolume3Month(),
                        row.sharesOutstanding(),
                        row.forwardPE(),
                        row.epsTrailingTwelveMonths(),
                        rating(row.averageAnalystRating())));
            }
        }
        return quotes;
    }

    /** Null means Yahoo turned the session down; anything else is the parsed answer. */
    private QuoteResponse fetch(List<String> symbols, Session current) {
        return client.get()
                .uri(uri -> uri.path("/v7/finance/quote")
                        .queryParam("symbols", String.join(",", symbols))
                        .queryParam("crumb", current.crumb())
                        .build())
                .header("Cookie", current.cookie())
                .exchange((request, response) -> {
                    if (response.getStatusCode().value() == 401 || response.getStatusCode().value() == 403) {
                        return null;
                    }
                    if (response.getStatusCode().isError()) {
                        throw new ScreenerDataException(
                                "Yahoo quote failed with status " + response.getStatusCode());
                    }
                    return response.bodyTo(QuoteResponse.class);
                });
    }

    private Session session() {
        Session current = session;
        return current != null ? current : renew();
    }

    /**
     * The cookie has to be collected before the crumb is asked for: the crumb endpoint
     * answers with plain text tied to whoever is holding that cookie.
     */
    private synchronized Session renew() {
        String cookie = cookieClient.get()
                .uri(COOKIE_URL)
                .exchange((request, response) -> {
                    List<String> headers = response.getHeaders().get("Set-Cookie");
                    if (headers == null || headers.isEmpty()) {
                        throw new ScreenerDataException("Yahoo handed out no session cookie");
                    }
                    return headers.stream().map(YahooQuoteClient::nameAndValue).reduce((a, b) -> a + "; " + b).orElseThrow();
                });

        // The crumb comes back as text/plain, so the JSON default this client carries would
        // earn a 406 here.
        String crumb = client.get()
                .uri("/v1/test/getcrumb")
                .header("Cookie", cookie)
                .headers(headers -> headers.setAccept(List.of(MediaType.ALL)))
                .retrieve()
                .onStatus(HttpStatusCode::isError, (req, res) -> {
                    throw new ScreenerDataException("Yahoo crumb request failed with status " + res.getStatusCode());
                })
                .body(String.class);

        if (crumb == null || crumb.isBlank()) {
            throw new ScreenerDataException("Yahoo handed out an empty crumb");
        }
        Session renewed = new Session(cookie, crumb.trim());
        session = renewed;
        return renewed;
    }

    /**
     * Yahoo is not consistent about this: {@code regularMarketChangePercent} and
     * {@code fiftyTwoWeekChangePercent} arrive as percentages (2.42 for 2.42 %), while the
     * ones comparing against a high or a moving average arrive as fractions (0.0242).
     * Everything is stored as a percentage, so the second kind is scaled here.
     */
    private static BigDecimal asPercent(BigDecimal fraction) {
        return fraction == null ? null : fraction.multiply(HUNDRED);
    }

    /**
     * The consensus arrives as "2.1 - Buy": a number and the words for it. Only the number
     * is kept — the words are derivable from it and the screener filters on the scale.
     */
    private static BigDecimal rating(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String number = raw.split("-", 2)[0].trim();
        try {
            return new BigDecimal(number);
        } catch (NumberFormatException unexpectedShape) {
            return null;
        }
    }

    /** Drops the attributes (Path, Expires, …) that a request header must not carry back. */
    private static String nameAndValue(String setCookie) {
        int end = setCookie.indexOf(';');
        return end < 0 ? setCookie : setCookie.substring(0, end);
    }

    private record Session(String cookie, String crumb) {
    }

    // --- Yahoo wire format. Unknown fields are ignored by Jackson's default config. ---

    private record QuoteResponse(QuoteResult quoteResponse) {
    }

    private record QuoteResult(List<QuoteRow> result) {
    }

    private record QuoteRow(String symbol, BigDecimal regularMarketPrice, BigDecimal regularMarketChangePercent,
                            Long regularMarketVolume, BigDecimal marketCap, BigDecimal trailingPE,
                            BigDecimal priceToBook, BigDecimal dividendYield, BigDecimal fiftyTwoWeekChangePercent,
                            BigDecimal fiftyTwoWeekHighChangePercent, BigDecimal fiftyTwoWeekLowChangePercent,
                            BigDecimal fiftyDayAverageChangePercent, BigDecimal twoHundredDayAverageChangePercent,
                            Long averageDailyVolume3Month, Long sharesOutstanding, BigDecimal forwardPE,
                            BigDecimal epsTrailingTwelveMonths, String averageAnalystRating) {
    }
}
