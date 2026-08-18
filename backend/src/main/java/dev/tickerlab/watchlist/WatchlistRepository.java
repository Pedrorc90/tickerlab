package dev.tickerlab.watchlist;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WatchlistRepository extends JpaRepository<Watchlist, UUID> {

    List<Watchlist> findAllByOwnerIdOrderByCreatedAtAsc(UUID ownerId);

    /** The id alone is not enough to hand a list over: another owner's id is a 404, not a hit. */
    Optional<Watchlist> findByIdAndOwnerId(UUID id, UUID ownerId);

    boolean existsByOwnerIdAndNameIgnoreCase(UUID ownerId, String name);
}
