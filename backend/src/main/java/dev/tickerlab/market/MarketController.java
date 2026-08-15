package dev.tickerlab.market;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class MarketController {

    private static final int MIN_QUERY_LENGTH = 1;

    private final MarketDataProvider provider;

    MarketController(MarketDataProvider provider) {
        this.provider = provider;
    }

    /** Ticker autocomplete: GET /api/symbols?q=apple */
    @GetMapping("/symbols")
    public List<SymbolMatch> search(@RequestParam("q") String query) {
        String trimmed = query == null ? "" : query.trim();
        if (trimmed.length() < MIN_QUERY_LENGTH) {
            return List.of();
        }
        return provider.search(trimmed);
    }

    /** Price history: GET /api/candles/AAPL?timeframe=WEEK */
    @GetMapping("/candles/{symbol}")
    public CandleSeries candles(@PathVariable String symbol,
                                @RequestParam(defaultValue = "DAY") Timeframe timeframe) {
        return provider.candles(symbol, timeframe);
    }

    @ExceptionHandler(SymbolNotFoundException.class)
    ResponseEntity<Map<String, String>> handleNotFound(SymbolNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(MarketDataException.class)
    ResponseEntity<Map<String, String>> handleUpstream(MarketDataException ex) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of("error", ex.getMessage()));
    }
}
