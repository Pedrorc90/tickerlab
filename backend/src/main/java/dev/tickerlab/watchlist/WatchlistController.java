package dev.tickerlab.watchlist;

import dev.tickerlab.watchlist.dto.WatchlistEntryRequest;
import dev.tickerlab.watchlist.dto.WatchlistRequest;
import dev.tickerlab.watchlist.dto.WatchlistResponse;
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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/watchlists")
public class WatchlistController {

    private final WatchlistService service;

    WatchlistController(WatchlistService service) {
        this.service = service;
    }

    @GetMapping
    public List<WatchlistResponse> list() {
        return service.list();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public WatchlistResponse create(@Valid @RequestBody WatchlistRequest request) {
        return service.create(request.name());
    }

    @PutMapping("/{id}")
    public WatchlistResponse rename(@PathVariable UUID id, @Valid @RequestBody WatchlistRequest request) {
        return service.rename(id, request.name());
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(id);
    }

    /** Returns the whole list back so the panel repaints from one response. */
    @PostMapping("/{id}/entries")
    public WatchlistResponse addEntry(@PathVariable UUID id, @Valid @RequestBody WatchlistEntryRequest request) {
        return service.addEntry(id, request);
    }

    @DeleteMapping("/{id}/entries/{symbol}")
    public WatchlistResponse removeEntry(@PathVariable UUID id, @PathVariable String symbol) {
        return service.removeEntry(id, symbol);
    }

    @ExceptionHandler(WatchlistNotFoundException.class)
    ResponseEntity<Map<String, String>> handleNotFound(WatchlistNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(DuplicateWatchlistNameException.class)
    ResponseEntity<Map<String, String>> handleDuplicate(DuplicateWatchlistNameException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", ex.getMessage()));
    }
}
