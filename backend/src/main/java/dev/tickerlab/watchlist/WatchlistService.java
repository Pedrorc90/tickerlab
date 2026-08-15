package dev.tickerlab.watchlist;

import dev.tickerlab.watchlist.dto.WatchlistEntryRequest;
import dev.tickerlab.watchlist.dto.WatchlistResponse;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WatchlistService {

    private final WatchlistRepository repository;

    WatchlistService(WatchlistRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<WatchlistResponse> list() {
        return repository.findAllByOrderByCreatedAtAsc().stream()
                .map(WatchlistResponse::from)
                .toList();
    }

    @Transactional
    public WatchlistResponse create(String name) {
        String trimmed = name.trim();
        requireFreeName(trimmed);
        Watchlist watchlist = new Watchlist();
        watchlist.setId(UUID.randomUUID());
        watchlist.setName(trimmed);
        return WatchlistResponse.from(repository.save(watchlist));
    }

    @Transactional
    public WatchlistResponse rename(UUID id, String name) {
        Watchlist watchlist = require(id);
        String trimmed = name.trim();
        if (!trimmed.equalsIgnoreCase(watchlist.getName())) {
            requireFreeName(trimmed);
        }
        watchlist.setName(trimmed);
        return WatchlistResponse.from(watchlist);
    }

    @Transactional
    public void delete(UUID id) {
        repository.delete(require(id));
    }

    /** Idempotent: re-adding a symbol leaves the list untouched. */
    @Transactional
    public WatchlistResponse addEntry(UUID id, WatchlistEntryRequest request) {
        Watchlist watchlist = require(id);
        watchlist.addEntry(request.symbol(), request.name());
        return WatchlistResponse.from(watchlist);
    }

    @Transactional
    public WatchlistResponse removeEntry(UUID id, String symbol) {
        Watchlist watchlist = require(id);
        watchlist.removeEntry(symbol);
        return WatchlistResponse.from(watchlist);
    }

    private Watchlist require(UUID id) {
        return repository.findById(id).orElseThrow(() -> new WatchlistNotFoundException(id));
    }

    private void requireFreeName(String name) {
        if (repository.existsByNameIgnoreCase(name)) {
            throw new DuplicateWatchlistNameException(name);
        }
    }
}
