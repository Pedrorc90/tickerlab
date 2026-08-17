package dev.tickerlab.screener;

import dev.tickerlab.screener.dto.RefreshResult;
import dev.tickerlab.screener.dto.ScreenerFilters;
import dev.tickerlab.screener.dto.ScreenerPage;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/screener")
public class ScreenerController {

    private final ScreenerService service;

    ScreenerController(ScreenerService service) {
        this.service = service;
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
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) String sort,
            @RequestParam(defaultValue = "false") boolean desc) {
        ScreenerFilters filters = new ScreenerFilters(q, exchange, minMarketCap, minPrice, maxPrice, minVolume,
                minChange, maxChange, minPer, maxPer, maxPriceToBook, minDividendYield,
                maxDividendYield, minChange52w,
                minFromHigh52w, minVsSma50, maxVsSma50, minVsSma200, maxVsSma200, maxFromLow52w,
                minAvgVolume3m, minSharesOutstanding, minForwardPer, maxForwardPer, minEps, maxAnalystRating,
                minRsRating, minScore, minRelVolume, maxRelVolume);
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
