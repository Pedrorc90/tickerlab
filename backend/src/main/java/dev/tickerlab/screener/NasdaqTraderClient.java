package dev.tickerlab.screener;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Reads the official listing files Nasdaq Trader publishes for the whole US market. They
 * are pipe separated text, need no API key, and are rewritten once a day. Everything
 * file-shaped stays in this class: the rest of the screener only sees {@link Listing}.
 */
@Component
public class NasdaqTraderClient {

    private static final String NASDAQ_PATH = "/dynamic/SymDir/nasdaqlisted.txt";
    private static final String OTHER_PATH = "/dynamic/SymDir/otherlisted.txt";

    /** The last line of both files is a footer, not a security. */
    private static final String FOOTER_PREFIX = "File Creation Time";

    /**
     * Warrants, rights, units, preferred shares and notes are listed alongside the shares
     * they hang off, and they more than double the size of the table without being
     * something anyone charts. The files carry no security-type column, so the name is
     * what gives them away — the wording is boilerplate ("- Warrants", "Units, each
     * consisting of…"). ETFs do have their own column and are dropped through it.
     */
    private static final Pattern DERIVED_SECURITY = Pattern.compile(
            "\\b(warrants?|rights?|units?)\\b|preferred|debenture|\\bnotes\\b", Pattern.CASE_INSENSITIVE);

    /** otherlisted.txt names the venue with a single letter. */
    private static final Map<String, String> EXCHANGES = Map.of(
            "A", "NYSE American",
            "N", "NYSE",
            "P", "NYSE Arca",
            "Z", "Cboe BZX",
            "V", "IEX");

    private final RestClient client;

    NasdaqTraderClient(RestClient.Builder builder, @Value("${tickerlab.nasdaq-trader.base-url}") String baseUrl) {
        this.client = builder
                .baseUrl(baseUrl)
                .defaultHeader("Accept", "text/plain")
                .build();
    }

    /** One listed share, already normalised to the ticker Yahoo would understand. */
    public record Listing(String symbol, String name, String exchange) {
    }

    public List<Listing> fetchAll() {
        List<Listing> listings = new ArrayList<>(8000);
        listings.addAll(parseNasdaq(download(NASDAQ_PATH)));
        listings.addAll(parseOther(download(OTHER_PATH)));
        return listings;
    }

    private String download(String path) {
        String body = client.get()
                .uri(path)
                .retrieve()
                .onStatus(HttpStatusCode::isError, (req, res) -> {
                    throw new ScreenerDataException("Nasdaq Trader returned status " + res.getStatusCode()
                            + " for " + path);
                })
                .body(String.class);
        if (body == null || body.isBlank()) {
            throw new ScreenerDataException("Nasdaq Trader returned an empty " + path);
        }
        return body;
    }

    /** Columns: Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot|ETF|NextShares */
    private static List<Listing> parseNasdaq(String body) {
        List<Listing> listings = new ArrayList<>();
        for (String[] fields : rows(body, 8)) {
            if (isTestIssue(fields[3]) || isYes(fields[6]) || isDerived(fields[1])) {
                continue;
            }
            listings.add(new Listing(symbol(fields[0]), name(fields[1]), "NASDAQ"));
        }
        return listings;
    }

    /** Columns: ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot|Test Issue|NASDAQ Symbol */
    private static List<Listing> parseOther(String body) {
        List<Listing> listings = new ArrayList<>();
        for (String[] fields : rows(body, 8)) {
            if (isTestIssue(fields[6]) || isYes(fields[4]) || isDerived(fields[1])) {
                continue;
            }
            String symbol = symbol(fields[7]);
            if (symbol.isEmpty()) {
                symbol = symbol(fields[0]);
            }
            String exchange = EXCHANGES.getOrDefault(clean(fields[2]), "Other");
            listings.add(new Listing(symbol, name(fields[1]), exchange));
        }
        return listings;
    }

    /** Drops the header, the footer and any row too short to trust. */
    private static List<String[]> rows(String body, int expectedColumns) {
        List<String[]> rows = new ArrayList<>();
        String[] lines = body.split("\\R");
        for (int i = 1; i < lines.length; i++) {
            String line = lines[i];
            if (line.isBlank() || line.startsWith(FOOTER_PREFIX)) {
                continue;
            }
            String[] fields = line.split("\\|", -1);
            if (fields.length < expectedColumns) {
                continue;
            }
            rows.add(fields);
        }
        return rows;
    }

    private static boolean isTestIssue(String field) {
        return isYes(field);
    }

    private static boolean isDerived(String name) {
        return DERIVED_SECURITY.matcher(clean(name)).find();
    }

    private static boolean isYes(String field) {
        return "Y".equalsIgnoreCase(clean(field));
    }

    private static String clean(String field) {
        return field == null ? "" : field.trim();
    }

    /**
     * Nasdaq Trader separates the share class with a dot (BRK.B) in every column it
     * publishes, including the one named "NASDAQ Symbol". Yahoo — where the chart comes
     * from — spells the same security BRK-B, so the dot is translated here, at the edge.
     */
    private static String symbol(String field) {
        return clean(field).replace('.', '-');
    }

    /**
     * The files put no ceiling on the security name, so an unusually long one would take
     * the whole refresh down on insert. A display name survives being cut.
     */
    private static String name(String field) {
        String cleaned = clean(field);
        return cleaned.length() <= Symbol.MAX_NAME_LENGTH
                ? cleaned
                : cleaned.substring(0, Symbol.MAX_NAME_LENGTH);
    }
}
