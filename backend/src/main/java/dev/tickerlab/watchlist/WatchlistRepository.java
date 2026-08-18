package dev.tickerlab.watchlist;

import dev.tickerlab.user.AppUser;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface WatchlistRepository extends JpaRepository<Watchlist, UUID> {

    List<Watchlist> findAllByOwnerIdOrderByCreatedAtAsc(UUID ownerId);

    /** The id alone is not enough to hand a list over: another owner's id is a 404, not a hit. */
    Optional<Watchlist> findByIdAndOwnerId(UUID id, UUID ownerId);

    boolean existsByOwnerIdAndNameIgnoreCase(UUID ownerId, String name);

    /** One-off, from the seeder: the lists that predate V10 belong to whoever boots first. */
    @Modifying
    @Query("update Watchlist w set w.owner = :owner where w.owner is null")
    int adoptOrphans(AppUser owner);
}
