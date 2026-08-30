package dev.tickerlab.screener;

import dev.tickerlab.screener.dto.RefreshResult;
import dev.tickerlab.screener.dto.ScreenerFilters;
import dev.tickerlab.screener.dto.ScreenerPage;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/screener")
public class ScreenerController {

    private final ScreenerService service;

    /**
     * What the morning task has to send to be let in. It is the only call in the app that is
     * not behind the session cookie, because the caller is Task Scheduler and not a browser.
     */
    private final String premarketToken;

    ScreenerController(ScreenerService service, @Value("${tickerlab.premarket.token}") String premarketToken) {
        this.service = service;
        this.premarketToken = premarketToken;
    }

    @GetMapping("/symbols")
    public ScreenerPage symbols(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String exchange,
            @RequestParam(required = false) BigDecimal minMarketCap,
            @RequestParam(required = false) BigDecimal minPrice,
            @RequestParam(required = false) BigDecimal maxPrice,
            @RequestParam(required = false) Long minVolume,
            @RequestParam(required = false) BigDecimal minChange,
            @RequestParam(required = false) BigDecimal maxChange,
            @RequestParam(required = false) BigDecimal minPer,
            @RequestParam(required = false) BigDecimal maxPer,
            @RequestParam(required = false) BigDecimal maxPriceToBook,
            @RequestParam(required = false) BigDecimal minDividendYield,
            @RequestParam(required = false) BigDecimal maxDividendYield,
            @RequestParam(required = false) BigDecimal minChange52w,
            @RequestParam(required = false) BigDecimal minFromHigh52w,
            @RequestParam(required = false) BigDecimal minVsSma50,
            @RequestParam(required = false) BigDecimal maxVsSma50,
            @RequestParam(required = false) BigDecimal minVsSma200,
            @RequestParam(required = false) BigDecimal maxVsSma200,
            @RequestParam(required = false) BigDecimal maxFromLow52w,
            @RequestParam(required = false) Long minAvgVolume3m,
            @RequestParam(required = false) Long minSharesOutstanding,
            @RequestParam(required = false) BigDecimal minForwardPer,
            @RequestParam(required = false) BigDecimal maxForwardPer,
            @RequestParam(required = false) BigDecimal minEps,
            @RequestParam(required = false) BigDecimal maxAnalystRating,
            @RequestParam(required = false) Integer minRsRating,
            @RequestParam(required = false) Integer minScore,
            @RequestParam(required = false) BigDecimal minRelVolume,
            @RequestParam(required = false) BigDecimal maxRelVolume,
            @RequestParam(required = false) BigDecimal minGapPercent,
            @RequestParam(required = false) BigDecimal maxGapPercent,
            @RequestParam(required = false) Long minPremarketVolume,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) String sort,
            @RequestParam(defaultValue = "false") boolean desc) {
        ScreenerFilters filters = new ScreenerFilters(q, exchange, minMarketCap, minPrice, maxPrice, minVolume,
                minChange, maxChange, minPer, maxPer, maxPriceToBook, minDividendYield,
                maxDividendYield, minChange52w,
                minFromHigh52w, minVsSma50, maxVsSma50, minVsSma200, maxVsSma200, maxFromLow52w,
                minAvgVolume3m, minSharesOutstanding, minForwardPer, maxForwardPer, minEps, maxAnalystRating,
                minRsRating, minScore, minRelVolume, maxRelVolume,
                minGapPercent, maxGapPercent, minPremarketVolume);
        return service.search(filters, page, size, sort, desc);
    }

    /**
     * Forces a quote sweep. Answers straight away with whether this call started one — the
     * sweep itself runs in the background and the table polls for it.
     */
    @PostMapping("/quotes/refresh")
    public Map<String, Boolean> refreshQuotes() {
        return Map.of("started", service.refreshQuotes());
    }

    /**
     * The premarket run: wipes the pair, sweeps Yahoo for the gaps and asks Alpaca for the volume
     * behind the ones that moved. Meant for a scheduled call around 09:20 New York time, so it
     * answers immediately and lets the work happen in the background like every other sweep.
     *
     * <p>Authenticated by a token in a header rather than by the session, and an unset token
     * <em>closes</em> the endpoint instead of opening it: the alternative is that a deploy with
     * one variable missing leaves a public button that starts six thousand calls to Yahoo.
     */
    @PostMapping("/premarket")
    public ResponseEntity<Map<String, Boolean>> premarket(
            @RequestHeader(name = "X-Tickerlab-Token", required = false) String token) {
        if (premarketToken.isBlank()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        if (token == null || !matches(token)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return ResponseEntity.ok(Map.of("started", service.refreshPremarket()));
    }

    /** Constant time: a token compared with equals leaks its length and then its prefix. */
    private boolean matches(String token) {
        return MessageDigest.isEqual(
                token.getBytes(StandardCharsets.UTF_8),
                premarketToken.getBytes(StandardCharsets.UTF_8));
    }

    @GetMapping("/exchanges")
    public List<String> exchanges() {
        return service.exchanges();
    }

    /** Manual for now: the universe changes once a day and the download takes seconds. */
    @PostMapping("/refresh")
    public RefreshResult refresh() {
        return service.refresh();
    }

    @ExceptionHandler(ScreenerDataException.class)
    ResponseEntity<Map<String, String>> handleDataFailure(ScreenerDataException ex) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of("error", ex.getMessage()));
    }
}
