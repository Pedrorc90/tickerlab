package dev.tickerlab.portfolio;

import dev.tickerlab.portfolio.dto.OrderRequest;
import dev.tickerlab.portfolio.dto.OrderResponse;
import dev.tickerlab.portfolio.dto.PortfolioRequest;
import dev.tickerlab.portfolio.dto.PortfolioResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/portfolios")
public class PortfolioController {

    private final PortfolioService service;

    PortfolioController(PortfolioService service) {
        this.service = service;
    }

    @GetMapping
    public List<PortfolioResponse> list() {
        return service.list();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public PortfolioResponse create(@Valid @RequestBody PortfolioRequest request) {
        return service.create(request);
    }

    @PutMapping("/{id}")
    public PortfolioResponse rename(@PathVariable UUID id, @Valid @RequestBody PortfolioRequest request) {
        return service.rename(id, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(id);
    }

    /** Returns the whole portfolio back so the panel repaints from one response. */
    @PostMapping("/{id}/orders")
    public PortfolioResponse execute(@PathVariable UUID id, @Valid @RequestBody OrderRequest request) {
        return service.execute(id, request);
    }

    /** Without {@code symbol} it is the whole book; with it, the fills to draw on that chart. */
    @GetMapping("/{id}/orders")
    public List<OrderResponse> orders(@PathVariable UUID id,
                                      @RequestParam(required = false) String symbol) {
        return symbol == null || symbol.isBlank() ? service.orders(id) : service.orders(id, symbol);
    }

    @ExceptionHandler(PortfolioNotFoundException.class)
    ResponseEntity<Map<String, String>> handleNotFound(PortfolioNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(DuplicatePortfolioNameException.class)
    ResponseEntity<Map<String, String>> handleDuplicate(DuplicatePortfolioNameException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", ex.getMessage()));
    }

    /**
     * A refused order is the user's, not the server's: not enough cash and not enough shares are
     * both 422 rather than 500, and the message is the one the panel prints.
     */
    @ExceptionHandler({InsufficientCashException.class, InsufficientSharesException.class})
    ResponseEntity<Map<String, String>> handleRefused(RuntimeException ex) {
        return ResponseEntity.unprocessableEntity().body(Map.of("error", ex.getMessage()));
    }

    /** No price is the market being unreachable, not a bad request. */
    @ExceptionHandler(PriceUnavailableException.class)
    ResponseEntity<Map<String, String>> handleNoPrice(PriceUnavailableException ex) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of("error", ex.getMessage()));
    }
}
