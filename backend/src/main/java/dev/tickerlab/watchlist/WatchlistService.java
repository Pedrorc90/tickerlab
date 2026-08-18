package dev.tickerlab.watchlist;

import dev.tickerlab.user.AppUserRepository;
import dev.tickerlab.user.CurrentUser;
import dev.tickerlab.watchlist.dto.WatchlistEntryRequest;
import dev.tickerlab.watchlist.dto.WatchlistResponse;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ownership is filtered here and not in the repository: the repository takes an owner id like
 * any other parameter, and this is the one place that decides whose id that is.
 */
@Service
public class WatchlistService {

    private final WatchlistRepository repository;
    private final AppUserRepository users;
    private final CurrentUser currentUser;

    WatchlistService(WatchlistRepository repository, AppUserRepository users, CurrentUser currentUser) {
        this.repository = repository;
        this.users = users;
        this.currentUser = currentUser;
    }

    @Transactional(readOnly = true)
    public List<WatchlistResponse> list() {
        return repository.findAllByOwnerIdOrderByCreatedAtAsc(currentUser.id()).stream()
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
        watchlist.setOwner(users.getReferenceById(currentUser.id()));
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

    /** Someone else's list is a 404 and not a 403: the id is not theirs to know about. */
    private Watchlist require(UUID id) {
        return repository.findByIdAndOwnerId(id, currentUser.id())
                .orElseThrow(() -> new WatchlistNotFoundException(id));
    }

    /** The name only has to be free for this user: two people can both keep a "Watching". */
    private void requireFreeName(String name) {
        if (repository.existsByOwnerIdAndNameIgnoreCase(currentUser.id(), name)) {
            throw new DuplicateWatchlistNameException(name);
        }
    }
}
